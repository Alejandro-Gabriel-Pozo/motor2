-- Verificación de 20261006120000_clave_de_rol_de_sistema (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: columna_nueva vacía; los roles de cada empresa con su nombre (el backfill le da clave a «admin» y «operador»); y las empresas sin rol «admin».
-- DESPUÉS: columna_nueva = clave; admin y operador con clave igual a su nombre, el resto en NULL; el índice único y el CHECK; ninguna empresa con un rol
-- llamado «admin» sin clave «admin».
SELECT column_name::text AS columna_nueva FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Rol' AND column_name = 'clave';
SELECT e."slug", e."estado"::text AS estado_empresa, r."nombre", r."clave", r."activo"
  FROM "Rol" r JOIN "Empresa" e ON e."id" = r."empresaId" ORDER BY e."slug", r."nombre";
SELECT e."slug", e."estado"::text AS estado_empresa FROM "Empresa" e
  WHERE NOT EXISTS (SELECT 1 FROM "Rol" r WHERE r."empresaId" = e."id" AND r."nombre" = 'admin') ORDER BY 1;
SELECT e."slug" AS empresa_con_admin_sin_clave FROM "Empresa" e
  WHERE EXISTS (SELECT 1 FROM "Rol" r WHERE r."empresaId" = e."id" AND r."nombre" = 'admin')
    AND NOT EXISTS (SELECT 1 FROM "Rol" r WHERE r."empresaId" = e."id" AND r."clave" = 'admin') ORDER BY 1;
SELECT indexname::text FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Rol' ORDER BY 1;
SELECT conname::text, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = to_regclass('public."Rol"') AND contype = 'c' ORDER BY 1;
