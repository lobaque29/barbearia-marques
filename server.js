import { createServer } from 'node:http';
import { createHash, randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { barbers, dayOffset, localDateKey, normalizeBooking, validDate } from './booking.js';

const { Pool } = pg;
const deriveScrypt = promisify(scryptCallback);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const maxBodyBytes = 8192;
const bookingAttempts = new Map();
const bookingRateLimit = 10;
const bookingRateWindow = 60_000;
const adminSessionLifetime = 12 * 60 * 60;
const adminLoginAttempts = new Map();
const adminServices = ['Corte', 'Barba', 'Corte + Barba', 'Sobrancelha'];
const configuredAdminPassword = process.env.ADMIN_PASSWORD;
const configuredAdminUsername = process.env.ADMIN_USERNAME;
const adminPasswordHash = configuredAdminPassword
  ? scryptSync(configuredAdminPassword, configuredAdminUsername || 'barbearia-admin', 64)
  : null;

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

function secureCookie(request) {
  return process.env.COOKIE_SECURE === 'true' || request.headers['x-forwarded-proto'] === 'https';
}

function sessionCookie(request, token, maxAge) {
  const secure = secureCookie(request) ? '; Secure' : '';
  return `admin_session=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function requestCookie(request, name) {
  const cookies = request.headers.cookie || '';
  const entry = cookies.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : '';
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sameOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function requireAdmin(request, response) {
  const token = requestCookie(request, 'admin_session');
  if (!/^[\da-f]{64}$/.test(token)) {
    sendJson(response, 401, { error: 'Entre na sua conta para continuar.' });
    return false;
  }
  const session = await pool.query(
    'SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()',
    [tokenHash(token)],
  );
  if (!session.rowCount) {
    response.setHeader('Set-Cookie', sessionCookie(request, '', 0));
    sendJson(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
    return false;
  }
  return true;
}

function loginIsRateLimited(request) {
  const now = Date.now();
  const address = request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown';
  if (adminLoginAttempts.size > 1000) {
    for (const [key, entry] of adminLoginAttempts) {
      if (now - entry.startedAt >= 15 * 60_000) adminLoginAttempts.delete(key);
    }
  }
  if (adminLoginAttempts.size > 1000) return true;
  const current = adminLoginAttempts.get(address);
  if (!current || now - current.startedAt >= 15 * 60_000) {
    adminLoginAttempts.set(address, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > 5;
}

async function loginAdmin(request, response) {
  if (!configuredAdminPassword || !configuredAdminUsername || configuredAdminPassword.length < 12) {
    sendJson(response, 503, { error: 'O acesso administrativo ainda não foi configurado no servidor.' });
    return;
  }
  if (loginIsRateLimited(request)) {
    sendJson(response, 429, { error: 'Muitas tentativas de acesso. Aguarde 15 minutos.' });
    return;
  }
  const input = await readJson(request);
  const username = typeof input.username === 'string' ? input.username : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const candidateHash = await deriveScrypt(password, configuredAdminUsername, 64);
  const usernameMatches = username.length === configuredAdminUsername.length &&
    timingSafeEqual(Buffer.from(username), Buffer.from(configuredAdminUsername));
  const passwordMatches = timingSafeEqual(candidateHash, adminPasswordHash);
  if (!usernameMatches || !passwordMatches) {
    sendJson(response, 401, { error: 'Usuário ou senha incorretos.' });
    return;
  }

  const token = randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, now() + ($2::integer * interval \'1 second\'))',
    [tokenHash(token), adminSessionLifetime],
  );
  await pool.query('DELETE FROM admin_sessions WHERE expires_at <= now()');
  response.setHeader('Set-Cookie', sessionCookie(request, token, adminSessionLifetime));
  sendJson(response, 200, { authenticated: true, username: configuredAdminUsername });
}

function adminDateRange(url) {
  const start = url.searchParams.get('start_date') || localDateKey();
  const end = url.searchParams.get('end_date') || start;
  return validDate(start) && validDate(end) && dayOffset(end, start) >= 0 &&
    dayOffset(end, start) <= 31;
}

async function adminAppointments(url, response) {
  if (!adminDateRange(url)) {
    sendJson(response, 400, { error: 'Escolha um período válido de até 32 dias.' });
    return;
  }
  const start = url.searchParams.get('start_date') || localDateKey();
  const end = url.searchParams.get('end_date') || start;
  const result = await pool.query(
    `SELECT id, service, barber_id, customer_name, customer_phone, status,
            booking_date::text AS booking_date,
            to_char(booking_time, 'HH24:MI') AS booking_time,
            created_at
       FROM appointments
      WHERE booking_date BETWEEN $1::date AND $2::date
      ORDER BY booking_date, booking_time, barber_id`,
    [start, end],
  );
  sendJson(response, 200, result.rows.map(appointment => ({
    ...appointment,
    barber_name: barbers.find(barber => barber.id === appointment.barber_id)?.name || 'Barbeiro',
  })));
}

async function updateAppointment(request, response, id) {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) {
    sendJson(response, 400, { error: 'Agendamento inválido.' });
    return;
  }
  const input = await readJson(request);
  if (!input || !['pending', 'confirmed', 'cancelled'].includes(input.status)) {
    sendJson(response, 400, { error: 'Escolha um status válido para o agendamento.' });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE appointments SET status = $2
        WHERE id = $1
        RETURNING id, status`,
      [id, input.status],
    );
    if (!result.rowCount) {
      sendJson(response, 404, { error: 'Agendamento não encontrado.' });
      return;
    }
    sendJson(response, 200, result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      sendJson(response, 409, { error: 'O barbeiro já tem outro agendamento nesse horário.' });
      return;
    }
    throw error;
  }
}

async function listServices(response) {
  const result = await pool.query(
    'SELECT service, price_cents FROM services ORDER BY service',
  );
  sendJson(response, 200, result.rows);
}

async function updateServices(request, response) {
  const input = await readJson(request);
  if (!input || !Array.isArray(input.services) || input.services.length !== adminServices.length) {
    sendJson(response, 400, { error: 'Informe os valores de todos os serviços.' });
    return;
  }
  const values = new Map();
  for (const item of input.services) {
    if (!item || !adminServices.includes(item.service) ||
        !(item.price_cents === null || (Number.isInteger(item.price_cents) && item.price_cents >= 0 && item.price_cents <= 1000000)) ||
        values.has(item.service)) {
      sendJson(response, 400, { error: 'Confira os preços informados. Use valores entre R$ 0,00 e R$ 10.000,00.' });
      return;
    }
    values.set(item.service, item.price_cents);
  }
  if (values.size !== adminServices.length) {
    sendJson(response, 400, { error: 'Informe os valores de todos os serviços.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [service, priceCents] of values) {
      await client.query(
        `INSERT INTO services (service, price_cents, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (service) DO UPDATE
           SET price_cents = EXCLUDED.price_cents, updated_at = now()`,
        [service, priceCents],
      );
    }
    await client.query('COMMIT');
    await listServices(response);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function adminStats(url, response) {
  if (!adminDateRange(url)) {
    sendJson(response, 400, { error: 'Escolha um período válido de até 32 dias.' });
    return;
  }
  const start = url.searchParams.get('start_date') || localDateKey();
  const end = url.searchParams.get('end_date') || start;
  const [visits, appointments] = await Promise.all([
    pool.query(
      `SELECT visit_date::text AS date, total
         FROM site_visits
        WHERE visit_date BETWEEN $1::date AND $2::date
        ORDER BY visit_date`,
      [start, end],
    ),
    pool.query(
      `SELECT status, count(*)::integer AS total
         FROM appointments
        WHERE booking_date BETWEEN $1::date AND $2::date
        GROUP BY status`,
      [start, end],
    ),
  ]);
  sendJson(response, 200, {
    visits: visits.rows.reduce((total, row) => total + Number(row.total), 0),
    visits_by_day: visits.rows,
    appointments: Object.fromEntries(appointments.rows.map(row => [row.status, row.total])),
  });
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
    } else if (request.method === 'GET' && url.pathname === '/api/services') {
      await listServices(response);
    } else if (request.method === 'POST' && url.pathname === '/api/visits') {
      await pool.query(
        `INSERT INTO site_visits (visit_date, total)
         VALUES ($1::date, 1)
         ON CONFLICT (visit_date) DO UPDATE SET total = site_visits.total + 1`,
        [localDateKey()],
      );
      sendJson(response, 202, { recorded: true });
    } else if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      if (!sameOrigin(request)) {
        sendJson(response, 403, { error: 'Origem da solicitação não permitida.' });
      } else if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        sendJson(response, 415, { error: 'Content-Type must be application/json.' });
      } else {
        await loginAdmin(request, response);
      }
    } else if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
      if (!sameOrigin(request)) {
        sendJson(response, 403, { error: 'Origem da solicitação não permitida.' });
      } else {
        const token = requestCookie(request, 'admin_session');
        if (/^[\da-f]{64}$/.test(token)) {
          await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash(token)]);
        }
        response.setHeader('Set-Cookie', sessionCookie(request, '', 0));
        sendJson(response, 200, { authenticated: false });
      }
    } else if (url.pathname.startsWith('/api/admin/')) {
      if (!await requireAdmin(request, response)) return;
      if (request.method === 'GET' && url.pathname === '/api/admin/session') {
        sendJson(response, 200, { authenticated: true, username: configuredAdminUsername });
      } else if (request.method === 'GET' && url.pathname === '/api/admin/appointments') {
        await adminAppointments(url, response);
      } else if (request.method === 'PATCH' && /^\/api\/admin\/appointments\/[^/]+$/.test(url.pathname)) {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'Origem da solicitação não permitida.' });
        } else if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          sendJson(response, 415, { error: 'Content-Type must be application/json.' });
        } else {
          await updateAppointment(request, response, url.pathname.split('/').at(-1));
        }
      } else if (request.method === 'GET' && url.pathname === '/api/admin/services') {
        await listServices(response);
      } else if (request.method === 'PUT' && url.pathname === '/api/admin/services') {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'Origem da solicitação não permitida.' });
        } else if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          sendJson(response, 415, { error: 'Content-Type must be application/json.' });
        } else {
          await updateServices(request, response);
        }
      } else if (request.method === 'GET' && url.pathname === '/api/admin/stats') {
        await adminStats(url, response);
      } else {
        sendJson(response, 404, { error: 'Not found.' });
      }
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
