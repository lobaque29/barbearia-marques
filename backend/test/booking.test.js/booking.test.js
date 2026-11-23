import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayOffset,
  localDateKey,
  normalizeBooking,
  serviceNames,
  validBookingDate,
  validBookingTime,
  validDate,
} from '../booking.js';
import { buildMessage, formatPhone } from '../notifications.js';

function nextOpenDate() {
  const date = new Date(`${localDateKey()}T00:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 0);
  return date.toISOString().slice(0, 10);
}

test('calendar dates are strict and reject impossible dates', () => {
  assert.equal(validDate('2026-02-28'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('17/11/2026'), false);
});

test('booking window excludes Sundays and dates beyond 21 days', () => {
  const sundayDate = new Date(`${localDateKey()}T00:00:00Z`);
  while (sundayDate.getUTCDay() !== 0) sundayDate.setUTCDate(sundayDate.getUTCDate() + 1);
  const sunday = sundayDate.toISOString().slice(0, 10);
  assert.equal(validBookingDate(sunday), false);
  const tooFar = new Date(`${localDateKey()}T00:00:00Z`);
  tooFar.setUTCDate(tooFar.getUTCDate() + 22);
  assert.equal(validBookingDate(tooFar.toISOString().slice(0, 10)), false);
});

test('only full-hour shop slots from 09:00 through 18:00 are accepted', () => {
  assert.equal(validBookingTime('09:00', nextOpenDate()), true);
  assert.equal(validBookingTime('18:00', nextOpenDate()), true);
  assert.equal(validBookingTime('08:00', nextOpenDate()), false);
  assert.equal(validBookingTime('09:30', nextOpenDate()), false);
});

test('09:00 is unavailable on Fridays', () => {
  const friday = new Date(`${localDateKey()}T00:00:00Z`);
  friday.setUTCDate(friday.getUTCDate() + 1);
  while (friday.getUTCDay() !== 5) friday.setUTCDate(friday.getUTCDate() + 1);
  const fridayDate = friday.toISOString().slice(0, 10);
  const otherOpenDay = new Date(`${fridayDate}T00:00:00Z`);
  otherOpenDay.setUTCDate(otherOpenDay.getUTCDate() + 1);
  while (otherOpenDay.getUTCDay() === 0) otherOpenDay.setUTCDate(otherOpenDay.getUTCDate() + 1);
  const otherOpenDate = otherOpenDay.toISOString().slice(0, 10);

  assert.equal(validBookingTime('09:00', fridayDate), false);
  assert.equal(validBookingTime('10:00', fridayDate), true);
  assert.equal(validBookingTime('09:00', otherOpenDate), true);
  assert.equal(normalizeBooking({
    service: 'Corte social',
    barber_id: 'wilson',
    name: 'Carlos',
    phone: '31988887777',
    date: fridayDate,
    time: '09:00',
  }), null);
});

test('booking input is normalized and validated before reaching PostgreSQL', () => {
  const date = nextOpenDate();
  assert.deepEqual(normalizeBooking({
    service: 'Disfarçado + Barba',
    barber_id: 'any',
    name: '  Carlos Silva  ',
    phone: '(31) 98888-7777',
    date,
    time: '15:00',
  }), {
    service: 'Disfarçado + Barba',
    barberId: 'any',
    name: 'Carlos Silva',
    phone: '31988887777',
    date,
    time: '15:00',
  });
  assert.equal(normalizeBooking({ service: 'Inventado', name: 'Carlos', phone: '31988887777', date, time: '15:00' }), null);
  assert.equal(normalizeBooking({ service: 'Corte social', barber_id: 'wilson', name: 'C', phone: '31988887777', date, time: '15:00' }), null);
  assert.equal(normalizeBooking({ service: 'Corte social', barber_id: 'wilson', name: 'Carlos', phone: '123', date, time: '15:00' }), null);
  assert.equal(normalizeBooking({ service: 'Corte social', barber_id: 'unknown', name: 'Carlos', phone: '31988887777', date, time: '15:00' }), null);
  for (const service of serviceNames) {
    assert.equal(normalizeBooking({ service, barber_id: 'wilson', name: 'Carlos', phone: '31988887777', date, time: '15:00' })?.service, service);
  }
  assert.equal(normalizeBooking({ service: 'Pomada', barber_id: 'wilson', name: 'Carlos', phone: '31988887777', date, time: '15:00' }), null);
});

test('date offsets are whole calendar days', () => {
  assert.equal(dayOffset('2026-11-18', '2026-11-17'), 1);
});

test('WhatsApp numbers use the Brazilian country code', () => {
  assert.equal(formatPhone('(31) 98888-7777'), '5531988887777');
  assert.equal(formatPhone('+55 (31) 98888-7777'), '5531988887777');
});

test('WhatsApp notification contains contact, new booking, and the full daily agenda', () => {
  const appointment = {
    id: 'new',
    customer_name: 'Carlos Silva',
    customer_phone: '31988887777',
    barber_id: 'wilson',
    barber_name: 'Wilson',
    service: 'Corte + Barba',
    booking_date: '2026-11-18',
    booking_time: '15:30',
  };
  const message = buildMessage(appointment, [
    { id: 'old', customer_name: 'João Souza', service: 'Corte', barber_name: 'Barbeiro 1', booking_time: '09:00' },
    { ...appointment },
  ]);
  assert.match(message, /NOVO AGENDAMENTO RECEBIDO/);
  assert.match(message, /Contato:\* \+5531988887777/);
  assert.match(message, /Barbeiro:\* Wilson/);
  assert.match(message, /09:00 - João Souza \(Corte · Barbeiro 1\)/);
  assert.match(message, /15:30 - Carlos Silva \(Corte \+ Barba · Wilson\).*Novo/);
  assert.match(message, /— Barbearia Marques$/);
});
