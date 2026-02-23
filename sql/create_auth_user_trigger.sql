-- Script: Crear trigger que sincroniza nuevos usuarios de auth.users
-- Ajusta el nombre de la tabla objetivo si usas `profiles` en vez de `users`.
-- Pegar este SQL en el editor SQL de Supabase o ejecutarlo con psql contra la DB.

/*
  Lógica:
  - Cuando se inserta un nuevo usuario en auth.users, intenta insertar
    una fila en public.users con id, email y full_name extraído de metadata.
  - Si la tabla `public.users` no existe, el trigger hace NOTICE y no falla.
  - Usa ON CONFLICT DO NOTHING para evitar duplicados si ya existe.
*/

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_table_exists boolean;
  inferred_full_name text;
BEGIN
  -- Ejecutar con search_path seguro (asegura que public.users sea accesible)
  PERFORM set_config('search_path', 'public', true);
  -- Verificar si existe la tabla destino
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) INTO target_table_exists;

  IF NOT target_table_exists THEN
    RAISE NOTICE 'Tabla public.users no encontrada. Ajusta el script si usas otra tabla (ej: public.profiles).';
    RETURN NEW;
  END IF;

  -- Extraer nombre completo desde metadata (intenta varios campos comunes)
  inferred_full_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->> 'full_name', ''),
    NULLIF(NEW.user_metadata->> 'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->> 'fullName', ''),
    NULLIF(NEW.user_metadata->> 'fullName', ''),
    NULLIF(NEW.email, '')
  );

  BEGIN
    INSERT INTO public.users (id, email, full_name, created_at)
    VALUES (NEW.id, NEW.email, inferred_full_name, now())
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN others THEN
    -- Evitar que errores menores rompan el proceso de auth
    RAISE NOTICE 'No se pudo insertar en public.users: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Crear el trigger en auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- NOTAS:
-- 1) Si tu tabla se llama `profiles`, reemplaza `public.users` por `public.profiles`
--    y ajusta las columnas en el INSERT.
-- 2) Ejecuta este script desde el SQL editor de Supabase para que el trigger
--    se aplique en la base de datos administrada.