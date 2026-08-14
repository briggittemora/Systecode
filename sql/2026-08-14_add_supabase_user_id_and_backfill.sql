-- Script: Añadir columna supabase_user_id a html_files y backfill desde users
-- Fecha: 2026-08-14
-- IMPORTANTE: Haz un backup antes de ejecutar. Revisa y adapta el script a tu entorno.

-- 1) Añadir columna y crear índice (si no existen)
ALTER TABLE public.html_files
  ADD COLUMN IF NOT EXISTS supabase_user_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_html_files_supabase_user_id
  ON public.html_files(supabase_user_id);

-- Opcional: crear columna uploader_name si no existe (para mostrar nombre humano legible)
ALTER TABLE public.html_files ADD COLUMN IF NOT EXISTS uploader_name text;

-- Informe previo
SELECT count(*) AS total_html_files FROM public.html_files;
SELECT count(*) FILTER (WHERE supabase_user_id IS NOT NULL) AS already_with_supabase_user_id FROM public.html_files;
SELECT count(*) FILTER (WHERE uploader_name IS NOT NULL AND trim(uploader_name) <> '') AS already_with_uploader_name FROM public.html_files;

-- Transactional backfill
BEGIN;

-- 2) Backfill desde user_id cuando user_id ya sea un UUID válido
UPDATE public.html_files
SET supabase_user_id = user_id::uuid
WHERE supabase_user_id IS NULL
  AND user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- 3) Backfill cuando user_id contiene un email (legacy)
UPDATE public.html_files hf
SET supabase_user_id = u.id
FROM public.users u
WHERE hf.supabase_user_id IS NULL
  AND hf.user_id IS NOT NULL
  AND hf.user_id LIKE '%@%'
  AND lower(u.email) = lower(hf.user_id);

-- 4) Backfill desde uploader_email si existe
UPDATE public.html_files hf
SET supabase_user_id = u.id
FROM public.users u
WHERE hf.supabase_user_id IS NULL
  AND hf.uploader_email IS NOT NULL
  AND lower(u.email) = lower(hf.uploader_email);

-- 5) Intento de mapeo por nombre (menos fiable) - puede producir falsos positivos
UPDATE public.html_files hf
SET supabase_user_id = u.id
FROM public.users u
WHERE hf.supabase_user_id IS NULL
  AND hf.uploader_name IS NOT NULL
  AND (
    lower(u.full_name) = lower(hf.uploader_name) OR
    lower(u.name) = lower(hf.uploader_name) OR
    lower(u.username) = lower(hf.uploader_name)
  );

-- 6) Poblar uploader_name desde users cuando falte o esté vacío
UPDATE public.html_files hf
SET uploader_name = COALESCE(u.full_name, u.name, u.username, u.email)
FROM public.users u
WHERE hf.supabase_user_id = u.id
  AND (hf.uploader_name IS NULL OR trim(hf.uploader_name) = '');

COMMIT;

-- Informe posterior
SELECT count(*) AS total_html_files_after FROM public.html_files;
SELECT count(*) FILTER (WHERE supabase_user_id IS NOT NULL) AS with_supabase_user_id_after FROM public.html_files;
SELECT count(*) FILTER (WHERE uploader_name IS NOT NULL AND trim(uploader_name) <> '') AS with_uploader_name_after FROM public.html_files;

-- Recomendación: revisar filas que siguen sin supabase_user_id
SELECT id, user_id, uploader_email, uploader_name
FROM public.html_files
WHERE supabase_user_id IS NULL
LIMIT 200;

-- FIN
