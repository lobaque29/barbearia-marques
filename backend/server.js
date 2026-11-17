import { createServer } from 'node:http';
import pg from 'pg';
import { barbers, dayOffset, localDateKey, normalizeBooking, validDate } from './booking.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const maxBodyBytes = 8192;
const bookingAttempts = new Map();
const bookingRateLimit = 10;
const bookingRateWindow = 60_000;

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function isRateLimited(request) {
  const now = Date.now();
  const address = request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown';
  const current = bookingAttempts.get(address);
  if (!current || now - current.startedAt >= bookingRateWindow) {
    bookingAttempts.set(address, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  if (bookingAttempts.size > 1000) {
    for (const [key, entry] of bookingAttempts) {
      if (now - entry.startedAt >= bookingRateWindow) bookingAttempts.delete(key);
    }
  }
  return current.count > bookingRateLimit;
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

async function availability(url, response) {
  const start = url.searchParams.get('start_date');
  const end = url.searchParams.get('end_date');
  if (!validDate(start) || !validDate(end) || dayOffset(end, start) < 0 || dayOffset(end, start) > 21 ||
      dayOffset(start, localDateKey()) < 0 || dayOffset(end, localDateKey()) > 21) {
    sendJson(response, 400, { error: 'Invalid date range.' });
    return;
  }
  const result = await pool.query(
    `SELECT booking_date::text AS booking_date,
          barber_id,
          to_char(booking_time, 'HH24:MI:SS') AS booking_time
       FROM appointments
      WHERE booking_date BETWEEN $1::date AND $2::date
        AND status IN ('pending', 'confirmed')
      ORDER BY booking_date, booking_time`,
    [start, end],
  );
  sendJson(response, 200, result.rows);
}

async function createAppointment(request, response) {
  const booking = normalizeBooking(await readJson(request));
  if (!booking) {
    sendJson(response, 400, { error: 'Confira o serviço, nome, telefone, data e horário.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [booking.date, booking.time],
    );
    const occupied = await client.query(
      `SELECT barber_id
         FROM appointments
        WHERE booking_date = $1::date
          AND booking_time = $2::time
          AND status IN ('pending', 'confirmed')`,
      [booking.date, booking.time],
    );
    const occupiedBarbers = new Set(occupied.rows.map(row => row.barber_id));
    const barber = booking.barberId === 'any'
      ? barbers.find(candidate => !occupiedBarbers.has(candidate.id))
      : barbers.find(candidate => candidate.id === booking.barberId && !occupiedBarbers.has(candidate.id));
    if (!barber) {
      await client.query('ROLLBACK');
      sendJson(response, 409, { reserved: false, error: 'Esse horário acabou de ser reservado para esse barbeiro. Escolha outro horário.' });
      return;
    }
    const inserted = await client.query(
      `INSERT INTO appointments
         (service, barber_id, customer_name, customer_phone, booking_date, booking_time)
       VALUES ($1, $2, $3, $4, $5::date, $6::time)
       RETURNING id, service, barber_id, customer_name, booking_date::text AS booking_date,
                 to_char(booking_time, 'HH24:MI') AS booking_time`,
      [booking.service, barber.id, booking.name, booking.phone, booking.date, booking.time],
    );
    const appointment = inserted.rows[0];
    await client.query(
      'INSERT INTO notification_jobs (appointment_id) VALUES ($1)',
      [appointment.id],
    );
    await client.query('COMMIT');
    sendJson(response, 201, {
      reserved: true,
      booking: { ...appointment, barber_name: barber.name },
      notification: 'queued',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      sendJson(response, 409, { reserved: false, error: 'Esse horário acabou de ser reservado. Escolha outro horário.' });
    } else {
      console.error('Appointment creation failed:', error);
      sendJson(response, 500, { error: 'Não foi possível concluir o agendamento agora.' });
    }
  } finally {
    client.release();
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') {
      await pool.query('SELECT 1');
      sendJson(response, 200, { status: 'ok' });
    } else if (request.method === 'GET' && url.pathname === '/api/availability') {
      await availability(url, response);
    } else if (request.method === 'POST' && url.pathname === '/api/appointments') {
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        sendJson(response, 415, { error: 'Content-Type must be application/json.' });
      } else if (isRateLimited(request)) {
        sendJson(response, 429, { error: 'Muitas tentativas. Aguarde um minuto e tente novamente.' });
      } else {
        await createAppointment(request, response);
      }
    } else {
      sendJson(response, 404, { error: 'Not found.' });
    }
  } catch (error) {
    if (error.status) sendJson(response, error.status, { error: error.message });
    else {
      console.error('API request failed:', error);
      if (!response.headersSent) sendJson(response, 500, { error: 'Internal server error.' });
      else response.destroy();
    }
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log(`Booking API listening on port ${process.env.PORT || 3000}`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
