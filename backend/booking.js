const zone = 'America/Sao_Paulo';
const services = new Set(['Corte', 'Barba', 'Corte + Barba', 'Sobrancelha']);
export const barbers = [
  { id: 'wilson', name: 'Wilson' },
  { id: 'barbeiro1', name: 'Barbeiro 1' },
  { id: 'barbeiro2', name: 'Barbeiro 2' },
];
const barberIds = new Set(barbers.map(barber => barber.id));

export function localDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function localDateKey(date = new Date()) {
  const { year, month, day } = localDateParts(date);
  return `${year}-${month}-${day}`;
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function dayOffset(date, from) {
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
}

export function validBookingDate(date) {
  if (!validDate(date)) return false;
  const offset = dayOffset(date, localDateKey());
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return offset >= 0 && offset <= 21 && weekday !== 0;
}

export function validBookingTime(time, date) {
  if (typeof time !== 'string' || !/^(0[9]|1[0-8]):00$/.test(time)) return false;
  if (date !== localDateKey()) return true;
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  return time > now;
}

export function normalizeBooking(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  const phone = typeof input.phone === 'string' ? input.phone.replace(/\D/g, '') : '';
  if (!services.has(input.service) || name.length < 2 || name.length > 80) return null;
  if (phone.length < 10 || phone.length > 15) return null;
  if (input.barber_id !== 'any' && !barberIds.has(input.barber_id)) return null;
  if (!validBookingDate(input.date) || !validBookingTime(input.time, input.date)) return null;
  return {
    service: input.service,
    barberId: input.barber_id,
    name,
    phone,
    date: input.date,
    time: input.time,
  };
}
