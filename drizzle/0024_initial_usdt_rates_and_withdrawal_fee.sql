-- Initial administrator-configurable money settings (Zomato Play launch):
--   USDT deposit rate     ₹100.40 per USDT   (currency.displayRate)
--   USDT withdrawal rate  ₹100.40 per USDT   (currency.payoutRate)
--   Withdrawal fee        1.55 USDT flat, no percentage (withdrawals.*)
-- Touches only these four keys of the single 'default' settings row; every
-- other setting, and every historical record, is left as it is. Administrators
-- change these in Admin → Settings afterwards. Idempotent.
UPDATE "platform_settings"
SET
  "currency" = jsonb_set(jsonb_set("currency", '{displayRate}', '100.4'::jsonb, true), '{payoutRate}', '100.4'::jsonb, true),
  "withdrawals" = jsonb_set(jsonb_set("withdrawals", '{flatFeeUsdt}', '1.55'::jsonb, true), '{percentFee}', '0'::jsonb, true)
WHERE "id" = 'default';
