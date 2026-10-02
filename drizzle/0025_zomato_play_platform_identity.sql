-- Retire the pre-launch product identity stored in the platform settings row.
-- Each statement matches only the exact old value, so anything an administrator
-- has already edited is left alone, and re-running changes nothing.
--   name      'Nanotron'                    -> 'Zomato Play'
--   tagline   'Crypto investment platform'  -> 'Investment Platform'
--   support email at the retired domain     -> cleared (an administrator sets the
--     real address in Admin -> Settings; the customer app falls back to the
--     deployment's NEXT_PUBLIC_SUPPORT_EMAIL while it is empty)
UPDATE "platform_settings"
SET "platform" = jsonb_set("platform", '{name}', '"Zomato Play"'::jsonb, true)
WHERE "id" = 'default' AND "platform"->>'name' = 'Nanotron';
--> statement-breakpoint
UPDATE "platform_settings"
SET "platform" = jsonb_set("platform", '{tagline}', '"Investment Platform"'::jsonb, true)
WHERE "id" = 'default' AND "platform"->>'tagline' = 'Crypto investment platform';
--> statement-breakpoint
UPDATE "platform_settings"
SET "platform" = jsonb_set("platform", '{supportEmail}', '""'::jsonb, true)
WHERE "id" = 'default' AND lower("platform"->>'supportEmail') LIKE '%@nanotron.app';
--> statement-breakpoint
-- The old rate note claimed a daily update that nothing performs.
UPDATE "platform_settings"
SET "currency" = jsonb_set("currency", '{rateLabel}', '"Platform rate set by Zomato Play"'::jsonb, true)
WHERE "id" = 'default' AND "currency"->>'rateLabel' = 'Indicative rate · updated daily';
