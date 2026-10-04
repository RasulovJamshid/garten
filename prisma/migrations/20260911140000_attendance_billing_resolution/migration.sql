ALTER TABLE attendance_correction ADD COLUMN billing_resolution text NOT NULL DEFAULT 'not_required'
  CHECK (billing_resolution IN ('not_required', 'applied', 'manual_required'));
