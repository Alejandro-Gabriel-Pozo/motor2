-- Rol de PLATAFORMA (informe de seguridad 2026-10-01, S-13; ADR-012 §3 y ADR-019, E4). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR; paso manual, NO es una migración.
--   · `motor2_plataforma` — LOGIN, NOSUPERUSER, NOBYPASSRLS, no dueño: lo usan SOLO `scripts/crear-empresa.ts`, `scripts/politica-empresa.ts`,
--     `scripts/modulos-empresa.ts`, `scripts/plataforma/crear-primer-admin.ts` y la consola de `plataforma/` (variable PLATAFORMA_DATABASE_URL).
--     PRIVILEGIO MÍNIMO, tabla por tabla (ADR-012 §3): NO tiene DML sobre todo `public`. Escribe lo que necesita el alta y el gobierno de una empresa y las
--     tablas de identidad de plataforma; NO lee ni escribe tablas de operación (ventas, stock, compras…); NUNCA tiene DELETE. Sigue sujeto al RLS por empresa.
--   · `motor2_app` pierde INSERT/UPDATE/DELETE sobre `Empresa` (con `restringir=1`): un bug o una inyección en la app ya no puede cambiar la política de
--     plataforma, el estado de una empresa ni crear/borrar empresas. La app solo lee `Empresa`.
-- Quién puede qué (lista cerrada; un test la compara con las tablas reales de la base):
--   Empresa                                SELECT, INSERT, UPDATE   (alta, activación, política)
--   User, ModuloEmpresa                    SELECT, INSERT, UPDATE   (el primer gerente se crea con upsert; el registro de módulos se actualiza)
--   Accion, Rol, PermisoRol, Unidad, MotivoMerma, DestinoConsumo, Sucursal, UsuarioEmpresa, UsuarioSucursal
--                                          SELECT, INSERT           (siembra del alta)
--   RegistroAuditoria, AuditoriaPlataforma SELECT, INSERT           (append-only)
--   AdminPlataforma y sus códigos/sesión   SELECT, INSERT, UPDATE   (identidad de la consola; sin DELETE)
--   Invitacion                             SELECT, INSERT, UPDATE   (alta, reenvío y revocación de la invitación del gerente, E5; sin DELETE)
-- Las tablas de identidad las crean las migraciones 20261009120000 y 20261009130000; si el rol se crea antes de aplicarlas, ellas mismas le dan el permiso al
-- crearse (si el rol ya existe) y este script se vuelve a correr después sin riesgo (es idempotente).
-- ORDEN: primero crear el rol y probar los scripts con PLATAFORMA_DATABASE_URL; recién después correr con restringir=1 (el REVOKE a motor2_app): si no, los
-- scripts que hoy van como motor2_app dejan de poder escribir. Los tests y el e2e escriben `Empresa` con `prisma` (motor2_app) en algunos casos: este paso
-- se aplica en producción, no en las bases de test.
--
-- Uso (como dueño; la clave por variable psql, nunca en el repo):
--   psql <conexión del dueño a la base> -v clave="<clave>" -f scripts/operaciones/crear-rol-motor2-plataforma.sql          (crea el rol y sus grants)
--   psql <conexión del dueño a la base> -v restringir=1 -f scripts/operaciones/crear-rol-motor2-plataforma.sql              (además quita la escritura de Empresa a motor2_app)
-- En Neon: SOLO con psql y este archivo, conectado como el dueño (`neondb_owner`); no hace falta superusuario. NUNCA crear el rol desde la consola o la API de
-- Neon: esos roles nacen como `neon_superuser` con BYPASSRLS y se saltarían el aislamiento por empresa. Los roles son POR RAMA de Neon: hay que correrlo en
-- cada rama (la de producción de cada despliegue; stockhneuquen y zuluhub son proyectos distintos). Idempotente. Reversa: quitar-rol-motor2-plataforma.sql
-- La URL del rol (PLATAFORMA_DATABASE_URL) vive SOLO en un archivo local gitignored (p. ej. `.env.plataforma.<despliegue>`) y se usa con
-- `DOTENV_CONFIG_PATH=.env.plataforma.<despliegue> npx tsx scripts/crear-empresa.ts ...`. NO se carga en Vercel de la aplicación: la aplicación no debe tener las
-- credenciales del rol que escribe `Empresa` (cargar-env-vercel.sh la rechaza). La consola de plataforma sí la lleva, en SU proyecto de Vercel (ADR-019).

\set ON_ERROR_STOP on

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') AS crear \gset
\if :crear
  CREATE ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\else
  ALTER ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\endif

-- Se parte de cero: una versión anterior de este script daba DML sobre todo `public` y default privileges sobre las tablas futuras.
SELECT current_user AS dueno \gset
ALTER DEFAULT PRIVILEGES FOR ROLE :"dueno" IN SCHEMA public REVOKE ALL ON TABLES FROM motor2_plataforma;
ALTER DEFAULT PRIVILEGES FOR ROLE :"dueno" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM motor2_plataforma;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM motor2_plataforma;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM motor2_plataforma;

GRANT USAGE ON SCHEMA public TO motor2_plataforma;

GRANT SELECT, INSERT, UPDATE ON "Empresa", "User", "ModuloEmpresa" TO motor2_plataforma;
GRANT SELECT, INSERT ON "Accion", "Rol", "PermisoRol", "Unidad", "MotivoMerma", "DestinoConsumo", "Sucursal", "UsuarioEmpresa", "UsuarioSucursal", "RegistroAuditoria" TO motor2_plataforma;

-- Tablas de identidad de plataforma e invitaciones: solo si ya las crearon las migraciones (si no, las migraciones darán el permiso al crearse).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AdminPlataforma', 'CodigoDeIngresoPlataforma', 'CodigoDeRecuperacionPlataforma', 'SesionPlataforma', 'Invitacion'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO motor2_plataforma', t);
    END IF;
  END LOOP;
  IF to_regclass('public."AuditoriaPlataforma"') IS NOT NULL THEN
    GRANT SELECT, INSERT ON "AuditoriaPlataforma" TO motor2_plataforma;
  END IF;
END
$$;

\if :{?restringir}
  REVOKE INSERT, UPDATE, DELETE ON "Empresa" FROM motor2_app;
\endif

SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma');
SELECT table_name AS tabla, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios_de_motor2_plataforma
  FROM information_schema.role_table_grants WHERE grantee = 'motor2_plataforma' GROUP BY table_name ORDER BY 1;
