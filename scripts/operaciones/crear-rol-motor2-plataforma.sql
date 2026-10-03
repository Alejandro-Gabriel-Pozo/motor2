-- Informe de seguridad 2026-10-01, S-13 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR; paso manual, NO es una migración): separar el rol de PLATAFORMA del
-- rol de ejecución. Hoy `motor2_app` puede escribir `Empresa` (alta, activación, política de plataforma). Con este paso:
--   · `motor2_plataforma` — LOGIN, NOSUPERUSER, NOBYPASSRLS, no dueño: lo usan SOLO `scripts/crear-empresa.ts` y `scripts/politica-empresa.ts`
--     (variable PLATAFORMA_DATABASE_URL; sin ella los scripts siguen usando DATABASE_URL). Mismos privilegios que `motor2_app` (DML sobre todo `public`,
--     porque el alta de una empresa siembra sucursal, roles, permisos…); sigue sujeto al RLS por empresa.
--   · `motor2_app` pierde INSERT/UPDATE/DELETE sobre `Empresa`: un bug o una inyección en la app ya no puede cambiar la política de plataforma, el estado
--     de una empresa ni crear/borrar empresas. La app solo lee `Empresa` (verificado: ninguna escritura sobre `empresa` en `src/` fuera de crear-empresa.ts
--     y cambiar-politica-empresa.ts, que solo corren desde los scripts).
-- ORDEN: primero crear el rol y probar los scripts con PLATAFORMA_DATABASE_URL; recién después correr la última sección (REVOKE) — si no, los scripts
-- (que hoy van como motor2_app) dejan de poder escribir. Los tests y el e2e escriben `Empresa` con `prisma` (motor2_app) en algunos casos:
-- este paso se aplica en producción, no en las bases de test.
--
-- Uso (como dueño/superusuario; la clave por variable psql, nunca en el repo):
--   psql <conexión del dueño a la base> -v clave="<clave>" -f scripts/operaciones/crear-rol-motor2-plataforma.sql          (crea el rol y sus grants)
--   psql <conexión del dueño a la base> -v restringir=1 -f scripts/operaciones/crear-rol-motor2-plataforma.sql              (además quita la escritura de Empresa a motor2_app)
-- En Neon: SOLO con psql y este archivo, conectado como el dueño (`neondb_owner`); no hace falta superusuario. NUNCA crear el rol desde la consola o la API de
-- Neon: esos roles nacen como `neon_superuser` con BYPASSRLS y se saltarían el aislamiento por empresa. Los roles son POR RAMA de Neon: hay que correrlo en
-- cada rama (la de producción de cada despliegue; stockhneuquen y zuluhub son proyectos distintos). Idempotente. Reversa: quitar-rol-motor2-plataforma.sql
-- La URL del rol (PLATAFORMA_DATABASE_URL) vive SOLO en un archivo local gitignored (p. ej. `.env.plataforma.<despliegue>`) y se usa con
-- `DOTENV_CONFIG_PATH=.env.plataforma.<despliegue> npx tsx scripts/crear-empresa.ts ...`. NO se carga en Vercel: la aplicación no debe tener las
-- credenciales del rol que escribe `Empresa` (cargar-env-vercel.sh la rechaza).

\set ON_ERROR_STOP on

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') AS crear \gset
\if :crear
  CREATE ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\else
  ALTER ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\endif

GRANT USAGE ON SCHEMA public TO motor2_plataforma;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_plataforma;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO motor2_plataforma;
SELECT current_user AS dueno \gset
ALTER DEFAULT PRIVILEGES FOR ROLE :"dueno" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO motor2_plataforma;
ALTER DEFAULT PRIVILEGES FOR ROLE :"dueno" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO motor2_plataforma;

-- La auditoría sigue siendo append-only también para la plataforma (migración 20261001230000): el REVOKE de esa migración fue solo a motor2_app.
REVOKE UPDATE, DELETE ON "RegistroAuditoria" FROM motor2_plataforma;

\if :{?restringir}
  REVOKE INSERT, UPDATE, DELETE ON "Empresa" FROM motor2_app;
\endif

SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma');
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios_sobre_empresa
  FROM information_schema.role_table_grants WHERE table_name = 'Empresa' AND grantee IN ('motor2_app', 'motor2_plataforma') GROUP BY grantee;
