import pg from 'pg';
import { barbers } from './booking.js';
import { buildMessage } from './notifications.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const maxAttempts = 8;

async function claimJob() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `WITH candidate AS (
         SELECT id
           FROM notification_jobs
          WHERE (status IN ('pending', 'retry') AND available_at <= now())
             OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
          ORDER BY available_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE notification_jobs AS job
          SET status = 'processing', attempts = job.attempts + 1, locked_at = now()
         FROM candidate
        WHERE job.id = candidate.id
       RETURNING job.id, job.appointment_id, job.attempts`,
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deliver(job) {
  const appointmentResult = await pool.query(
    `SELECT id, service, barber_id, customer_name, customer_phone,
            booking_date::text AS booking_date,
            to_char(booking_time, 'HH24:MI') AS booking_time
       FROM appointments WHERE id = $1 AND status IN ('pending', 'confirmed')`,
    [job.appointment_id],
  );
  const appointment = appointmentResult.rows[0];
  if (!appointment) {
    await pool.query(
      "UPDATE notification_jobs SET status = 'failed', last_error = 'Appointment is no longer active', locked_at = NULL WHERE id = $1",
      [job.id],
    );
    return;
  }
  appointment.barber_name = barbers.find(barber => barber.id === appointment.barber_id)?.name;

  const scheduleResult = await pool.query(
    `SELECT id, service, barber_id, customer_name,
            to_char(booking_time, 'HH24:MI') AS booking_time
       FROM appointments
      WHERE booking_date = $1::date AND status IN ('pending', 'confirmed')
      ORDER BY booking_time`,
    [appointment.booking_date],
  );

  const baseUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
  const instance = process.env.EVOLUTION_INSTANCE;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const recipient = process.env.ESTABLISHMENT_WHATSAPP;
  if (!baseUrl || !instance || !apiKey || !recipient) {
    throw new Error('Evolution API configuration is incomplete.');
  }

  const response = await fetch(
    `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`,
    {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: formatPhone(recipient),
        text: buildMessage(appointment, scheduleResult.rows.map(item => ({
          ...item,
          barber_name: barbers.find(barber => barber.id === item.barber_id)?.name,
        }))),
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Evolution API returned HTTP ${response.status}: ${details}`);
  }
  await pool.query(
    "UPDATE notification_jobs SET status = 'sent', sent_at = now(), last_error = NULL, locked_at = NULL WHERE id = $1",
    [job.id],
  );
  console.log(`WhatsApp notification sent for appointment ${appointment.id}`);
}

async function run() {
  console.log('WhatsApp notification worker started.');
  while (true) {
    try {
      const job = await claimJob();
      if (!job) {
        await delay(2000);
        continue;
      }
      try {
        await deliver(job);
      } catch (error) {
        const failed = job.attempts >= maxAttempts;
        const backoffSeconds = Math.min(3600, 15 * (2 ** (job.attempts - 1)));
        await pool.query(
          `UPDATE notification_jobs
              SET status = $2, available_at = now() + ($3::integer * interval '1 second'),
                  last_error = $4, locked_at = NULL
            WHERE id = $1`,
          [job.id, failed ? 'failed' : 'retry', backoffSeconds, String(error.message).slice(0, 1000)],
        );
        console.error(`WhatsApp notification attempt ${job.attempts} failed:`, error.message);
      }
    } catch (error) {
      console.error('Notification worker loop failed:', error);
      await delay(5000);
    }
  }
}

run().catch(error => {
  console.error('Notification worker stopped:', error);
  process.exitCode = 1;
}).finally(() => pool.end());

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    await pool.end();
    process.exit(0);
  });
}
