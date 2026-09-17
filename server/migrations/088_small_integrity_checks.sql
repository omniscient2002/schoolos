-- 088: small integrity checks identified by PERFECT-100 DAT-12/PRD-13.
-- NOT VALID preserves legacy rows while making every new insert/update fail
-- closed; existing dirty values can be reported and cleaned separately.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_method_check') THEN
    ALTER TABLE app.payments ADD CONSTRAINT payments_method_check
      CHECK (lower(method) IN ('upi','razorpay','cash','card','cheque','netbanking','bank_transfer','manual')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_channel_check') THEN
    ALTER TABLE app.communications ADD CONSTRAINT communications_channel_check
      CHECK (lower(channel) IN ('sms','email','whatsapp','phone')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_events_kind_check') THEN
    ALTER TABLE app.transport_events ADD CONSTRAINT transport_events_kind_check
      CHECK (kind IN ('gps_delay','breakdown','boarding')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_category_check') THEN
    ALTER TABLE app.assets ADD CONSTRAINT assets_category_check
      CHECK (lower(category) IN ('hvac','av','power','water','safety','electrical','plumbing','security')) NOT VALID;
  END IF;
END $$;
