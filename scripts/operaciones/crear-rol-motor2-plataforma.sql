-- Rol de PLATAFORMA (informe de seguridad 2026-10-01, S-13; ADR-012 §3 y ADR-019, E4). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR; paso manual, NO es una migración.
--   · `motor2_plataforma` — LOGIN, NOSUPERUSER, NOBYPASSRLS, no dueño: lo usan SOLO `scripts/politica-empresa.ts`,
--     `scripts/modulos-empresa.ts`, `scripts/plataforma/crear-primer-admin.ts` y la consola de `plataforma/` (variable PLATAFORMA_DATABASE_URL).
--     PRIVILEGIO MÍNIMO, tabla por tabla (ADR-012 §3): NO tiene DML sobre todo `public`. Escribe lo que necesita el alta y el gobierno de una empresa y las
--     tablas de identidad de plataforma; NO lee ni escribe tablas de operación (ventas, stock, compras…); NUNCA tiene DELETE. Sigue sujeto al RLS por empresa.
--   · `motor2_app` pierde INSERT/UPDATE/DELETE sobre `Empresa` (con `restringir=1`): un bug o una inyección en la app ya no puede cambiar la política de
--     plataforma, el estado de una empresa ni crear/borrar empresas. La app solo lee `Empresa`.
-- Quién puede qué (lista cerrada; un test la compara con las tablas reales de la base):
--   Empresa, ModuloEmpresa                 SELECT, INSERT, UPDATE   (alta, activación, política; el registro de módulos se actualiza)
--   User, UsuarioEmpresa                   SELECT                   (S-35: solo lectura —el gerente de una empresa—; el primer gerente ya no se crea desde acá: llega por la
--                                                                     invitación y lo incorpora la app. UsuarioSucursal: ningún privilegio. S-33: el actor de un cambio ya no es un User)
--   Accion, Rol, PermisoRol, Unidad, MotivoMerma, DestinoConsumo, Sucursal
--                                          SELECT, INSERT           (siembra del alta)
--   AuditoriaPlataforma                    SELECT, INSERT           (append-only; S-33: aquí quedan los cambios de módulos y de política hechos por script, a nombre del administrador.
--                                                                     RegistroAuditoria ya NO se escribe desde plataforma: sin privilegios)
--   AdminPlataforma y sus códigos/sesión   SELECT, INSERT, UPDATE   (identidad de la consola; sin DELETE)
--   Invitacion                             SELECT, INSERT, UPDATE   (alta, reenvío y revocación de la invitación del gerente, E5; sin DELETE)
--   _prisma_migrations                     SELECT                   (solo lectura de metadatos —nombre y fecha de cada migración—, nunca datos de negocio:
--                                                                     avisa en el inicio si una instalación quedó atrasada en migraciones respecto de otra, ADR-025)
-- Las tablas de identidad las crean las migraciones 20261009120000 y 20261009130000; si el rol se crea antes de aplicarlas, ellas mismas le dan el permiso al
-- crearse (si el rol ya existe) y este script se vuelve a correr después sin riesgo (es idempotente).
-- ORDEN: primero crear el rol y probar los scripts con PLATAFORMA_DATABASE_URL; recién después correr con restringir=1 (el REVOKE a motor2_app): si no, los
-- scripts que hoy van como motor2_app dejan de poder escribir. Los tests y el e2e escriben `Empresa` con `prisma` (motor2_app) en algunos casos: este paso
-- se aplica en producción, no en las bases de test.
--
-- Uso (como dueño; la clave por variable psql, nunca en el repo):
--   psql <conexión del dueño a la base> -1 -v clave="<clave>" -f scripts/operaciones/crear-rol-motor2-plataforma.sql        (rol NUEVO: lo crea con esa clave y le da sus grants; si el rol ya existe, le CAMBIA la contraseña)
--   psql <conexión del dueño a la base> -1 -v restringir=1 -f scripts/operaciones/crear-rol-motor2-plataforma.sql           (rol YA existente, sin clave: NO toca la contraseña; reaplica los grants y además quita la escritura de Empresa a motor2_app)
-- `-1` (una sola transacción) o el ejecutor `scripts/operaciones/ejecutar-sql-de-psql.mjs` (también atómico, y con `--simular` primero): sin eso un fallo a mitad deja el script a medias.
-- ATENCIÓN con `restringir`: el script solo mira si la variable ESTÁ DEFINIDA (`\if :{?restringir}`), no su valor: `-v restringir=0` TAMBIÉN restringe. Para no restringir, no pasarla.
-- En Neon: SOLO con psql y este archivo, conectado como el dueño (`neondb_owner`); no hace falta superusuario. NUNCA crear el rol desde la consola o la API de
-- Neon: esos roles nacen como `neon_superuser` con BYPASSRLS y se saltarían el aislamiento por empresa. Los roles son POR RAMA de Neon: hay que correrlo en
-- cada rama (la de producción de cada despliegue; stockhneuquen y zuluhub son proyectos distintos). Idempotente. Reversa: quitar-rol-motor2-plataforma.sql
-- La URL del rol (PLATAFORMA_DATABASE_URL) vive SOLO en un archivo local gitignored (p. ej. `.env.plataforma.<despliegue>`) y se usa con
-- `DOTENV_CONFIG_PATH=.env.plataforma.<despliegue> npx tsx scripts/politica-empresa.ts ...`. NO se carga en Vercel de la aplicación: la aplicación no debe tener las
-- credenciales del rol que escribe `Empresa` (cargar-env-vercel.sh la rechaza). La consola de plataforma sí la lleva, en SU proyecto de Vercel (ADR-019).

\set ON_ERROR_STOP on

-- M.1-C1: la `clave` solo hace falta para CREAR el rol o para CAMBIARLE la contraseña a propósito.
--   · el rol NO existe            → CREATE ROLE … PASSWORD :'clave' (sin `-v clave` falla acá, antes de crear nada).
--   · el rol existe y hay `clave` → ALTER ROLE … PASSWORD :'clave' (rotación deliberada).
--   · el rol existe y NO hay clave → NO se toca el rol (su contraseña es la que ya usa la consola): solo se verifica que siga siendo el rol de la consola.
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') AS crear \gset
\if :crear
  CREATE ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\else
  \if :{?clave}
    ALTER ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
  \else
    DO $$
    DECLARE
      r record;
    BEGIN
      SELECT rolsuper, rolbypassrls, rolcanlogin INTO r FROM pg_roles WHERE rolname = 'motor2_plataforma';
      IF r.rolsuper OR r.rolbypassrls OR NOT r.rolcanlogin THEN
        RAISE EXCEPTION 'M.1 - motor2_plataforma ya existe con atributos que no son los de la consola (rolsuper=%, rolbypassrls=%, rolcanlogin=%). Sin -v clave no se modifica el rol; corregilo a mano o pasá -v clave para volver a definirlo.', r.rolsuper, r.rolbypassrls, r.rolcanlogin;
      END IF;
    END
    $$;
  \endif
\endif

-- Se parte de cero: una versión anterior de este script daba DML sobre todo `public` y default privileges sobre las tablas futuras.
SELECT current_user AS dueno \gset
ALTER DEFAULT PRIVILEGES FOR ROLE :"dueno" IN SCHEMA public REVOKE ALL ON TABLES FROM motor2_plataforma;
ALTER DEFAULT PRIVILEGES FOR ROLE :"dueno" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM motor2_plataforma;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM motor2_plataforma;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM motor2_plataforma;

GRANT USAGE ON SCHEMA public TO motor2_plataforma;

-- S-35, grants = uso (test/arquitectura/grants-igual-a-uso.test.ts compara cada línea con lo que el código de plataforma hace de verdad). Reversa del recorte:
-- scripts/operaciones/revertir-recorte-de-grants-motor2-plataforma.sql
GRANT SELECT, INSERT, UPDATE ON "Empresa", "ModuloEmpresa" TO motor2_plataforma;
GRANT SELECT ON "User", "UsuarioEmpresa" TO motor2_plataforma;
GRANT SELECT, INSERT ON "Accion", "Rol", "PermisoRol", "Unidad", "MotivoMerma", "DestinoConsumo", "Sucursal" TO motor2_plataforma;

-- Solo lectura de metadatos de Prisma (nombre y fecha de cada migración aplicada; CERO datos de negocio): aviso de «instalación atrasada en migraciones»
-- (ADR-025). Siempre existe en una base con al menos una migración aplicada; si no (una base recién creada, antes de migrar), este GRANT no hace nada.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    GRANT SELECT ON public._prisma_migrations TO motor2_plataforma;
  END IF;
END
$$;

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
