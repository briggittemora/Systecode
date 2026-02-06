-- Agrega columna para precio por archivo (USD)
ALTER TABLE IF EXISTS public.html_files
ADD COLUMN IF NOT EXISTS price_usd numeric;

-- Backfill: todos los archivos marcados como VIP en epago='vip' -> $2
UPDATE public.html_files
SET price_usd = 2
WHERE (price_usd IS NULL OR price_usd <= 0)
  AND epago = 'vip';

-- (Opcional) Si tienes registros antiguos donde epago era numérico, puedes convertirlos:
-- UPDATE public.html_files
-- SET price_usd = epago::numeric
-- WHERE (price_usd IS NULL OR price_usd <= 0)
--   AND epago ~ '^[0-9]+(\\.[0-9]+)?$'
--   AND epago::numeric > 0;
