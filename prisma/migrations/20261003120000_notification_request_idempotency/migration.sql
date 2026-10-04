CREATE TABLE notification_request (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash text NOT NULL,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
