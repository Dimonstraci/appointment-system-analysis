-- DDL для новой БД PostgreSQL.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE service (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
    active boolean NOT NULL DEFAULT true
);
CREATE TABLE specialist (
    id uuid PRIMARY KEY,
    display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120)
);
CREATE TABLE client (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200)
);
CREATE TABLE slot (
    id uuid PRIMARY KEY,
    service_id uuid NOT NULL REFERENCES service(id),
    specialist_id uuid NOT NULL REFERENCES specialist(id),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    published boolean NOT NULL DEFAULT false,
    CHECK (ends_at > starts_at),
    EXCLUDE USING gist (
        specialist_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    )
);
CREATE INDEX slot_service_start_idx ON slot(service_id, starts_at);

CREATE TABLE appointment (
    id uuid PRIMARY KEY,
    slot_id uuid NOT NULL REFERENCES slot(id),
    client_id text NOT NULL REFERENCES client(id),
    status text NOT NULL DEFAULT 'CONFIRMED'
        CHECK (status IN ('CONFIRMED', 'CANCELLED')),
    source text NOT NULL DEFAULT 'WEB' CHECK (source IN ('WEB')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    cancelled_at timestamptz,
    cancelled_by text,
    cancellation_reason text,
    CHECK (
        (status = 'CONFIRMED' AND cancelled_at IS NULL
          AND cancelled_by IS NULL AND cancellation_reason IS NULL)
        OR
        (status = 'CANCELLED' AND cancelled_at IS NOT NULL
          AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL
          AND cancelled_at >= created_at
          AND length(cancelled_by) BETWEEN 1 AND 200
          AND length(btrim(cancellation_reason)) BETWEEN 1 AND 500)
    )
);
CREATE UNIQUE INDEX one_confirmed_per_slot
    ON appointment(slot_id) WHERE status = 'CONFIRMED';
CREATE INDEX appointment_client_idx ON appointment(client_id);
CREATE INDEX appointment_slot_history_idx ON appointment(slot_id);

CREATE TABLE idempotency_result (
    client_id text NOT NULL REFERENCES client(id),
    key uuid NOT NULL,
    slot_id uuid NOT NULL REFERENCES slot(id),
    appointment_id uuid NOT NULL UNIQUE REFERENCES appointment(id),
    response_status integer NOT NULL CHECK (response_status = 201),
    response_body jsonb NOT NULL CHECK (jsonb_typeof(response_body) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (client_id, key),
    CHECK (expires_at = created_at + interval '24 hours')
);
CREATE INDEX idempotency_expiry_idx ON idempotency_result(expires_at);
COMMIT;
