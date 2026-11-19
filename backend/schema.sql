CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  barber_id text NOT NULL DEFAULT 'wilson',
  customer_name text NOT NULL CHECK (char_length(btrim(customer_name)) BETWEEN 2 AND 80),
  customer_phone text NOT NULL CHECK (customer_phone ~ '^[0-9]{10,15}$'),
  booking_date date NOT NULL,
  booking_time time without time zone NOT NULL
    CHECK (booking_time BETWEEN time '09:00' AND time '18:00'
      AND extract(minute FROM booking_time) = 0
      AND extract(second FROM booking_time) = 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extract(dow FROM booking_date) <> 0)
);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS barber_id text NOT NULL DEFAULT 'wilson';

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_service_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_service_check CHECK (service IN (
  'Corte', 'Corte + Barba', 'Corte disfarçado', 'Corte social', 'Barba', 'Pezinho',
  'Sobrancelha', 'Máquina geral', 'Pigmentação', 'Relaxamento',
  'Disfarçado + Barba + Sobrancelha', 'Disfarçado + Barba', 'Disfarçado + Sobrancelha',
  'Social + Barba + Sobrancelha', 'Social + Barba', 'Social + Sobrancelha'
));

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_barber_id_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_barber_id_check
  CHECK (barber_id IN ('wilson', 'barbeiro1', 'barbeiro2')) NOT VALID;

DROP INDEX IF EXISTS appointments_active_slot_unique;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_slot_unique
  ON appointments (booking_date, booking_time, barber_id)
  WHERE status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS appointments_schedule_idx
  ON appointments (booking_date, booking_time, barber_id)
  WHERE status IN ('pending', 'confirmed');

CREATE TABLE IF NOT EXISTS notification_jobs (
  id bigserial PRIMARY KEY,
  appointment_id uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_jobs_ready_idx
  ON notification_jobs (available_at, id)
  WHERE status IN ('pending', 'retry');

CREATE TABLE IF NOT EXISTS services (
  service text PRIMARY KEY,
  price_cents integer CHECK (price_cents BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE services DROP CONSTRAINT IF EXISTS services_service_check;
ALTER TABLE services ADD CONSTRAINT services_service_check CHECK (service IN (
  'Corte', 'Corte + Barba', 'Corte disfarçado', 'Corte social', 'Barba', 'Pezinho',
  'Sobrancelha', 'Máquina geral', 'Pigmentação', 'Relaxamento',
  'Disfarçado + Barba + Sobrancelha', 'Disfarçado + Barba', 'Disfarçado + Sobrancelha',
  'Social + Barba + Sobrancelha', 'Social + Barba', 'Social + Sobrancelha'
));

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  INSERT INTO schema_migrations (name) VALUES ('2026-11-service-catalog')
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    INSERT INTO services (service, price_cents) VALUES
      ('Corte disfarçado', 3500), ('Corte social', 3000), ('Barba', 3000),
      ('Pezinho', 1500), ('Sobrancelha', 1500), ('Máquina geral', 2000),
      ('Pigmentação', 3000), ('Relaxamento', 3000),
      ('Disfarçado + Barba + Sobrancelha', 6500), ('Disfarçado + Barba', 5500),
      ('Disfarçado + Sobrancelha', 4500), ('Social + Barba + Sobrancelha', 6000),
      ('Social + Barba', 5000), ('Social + Sobrancelha', 4000)
    ON CONFLICT (service) DO UPDATE SET price_cents = EXCLUDED.price_cents, updated_at = now();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS site_visits (
  visit_date date PRIMARY KEY,
  total bigint NOT NULL DEFAULT 0 CHECK (total >= 0)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash char(64) PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx
  ON admin_sessions (expires_at);
