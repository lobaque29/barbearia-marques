CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL CHECK (service IN ('Corte', 'Barba', 'Corte + Barba', 'Sobrancelha')),
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
  service text PRIMARY KEY
    CHECK (service IN ('Corte', 'Barba', 'Corte + Barba', 'Sobrancelha')),
  price_cents integer CHECK (price_cents BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO services (service, price_cents)
VALUES
  ('Corte', NULL),
  ('Barba', NULL),
  ('Corte + Barba', NULL),
  ('Sobrancelha', NULL)
ON CONFLICT (service) DO NOTHING;

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
