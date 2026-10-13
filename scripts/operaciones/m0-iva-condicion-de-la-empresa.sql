-- M0-IVA, paso de DATOS: fija la condición de una empresa frente al IVA (`Empresa.condicionIva`). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base; NO es una migración.
-- Corre DESPUÉS de la migración 20261015101000_m0_iva_condicion_de_la_empresa. Lo hace la PLATAFORMA (variante A de D-1), nunca la propia empresa: se corre como `motor2_plataforma`
-- (privilegio mínimo: ya tiene UPDATE sobre "Empresa" y SELECT/INSERT sobre "AuditoriaPlataforma"), con la URL de PLATAFORMA_DATABASE_URL.
--
-- Variables (todas obligatorias):
--   slug         el slug de la empresa (ej. stockhneuquen).
--   condicion    RESPONSABLE_INSCRIPTO, MONOTRIBUTO o EXENTO. Cualquier otro valor se frena con un mensaje explícito (la lista sale del CHECK "Empresa_condicionIva_check" de la base, no se repite acá),
--                y si algo lo dejara pasar, el CHECK mismo lo rechaza (23514); en ambos casos no queda nada escrito.
--   admin_email  el email de un AdminPlataforma ACTIVO: es el autor que queda en la auditoría (no hay un administrador anónimo).
--   aplicar      SOLO si se quiere escribir. Sin ella el script SIMULA: muestra la empresa, su condición actual y qué cambiaría, y no escribe nada.
--   ATENCIÓN: el script solo mira si `aplicar` ESTÁ DEFINIDA, no su valor: `-v aplicar=0` TAMBIÉN aplica. Para simular, no pasarla.
--
-- Uso (la URL por entorno, nunca en el repo; siempre `-1`: una sola transacción, o el ejecutor `scripts/operaciones/ejecutar-sql-de-psql.mjs`, también atómico):
--   1) Simular:  psql "$PLATAFORMA_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -v slug=<slug> -v condicion=<CONDICION> -v admin_email=<email> -f scripts/operaciones/m0-iva-condicion-de-la-empresa.sql
--   2) Aplicar:  el mismo comando con `-v aplicar=1`.
--
-- Garantías (las prueba test/operaciones/m0-iva-condicion-de-la-empresa-con-base.test.ts):
--   · ATÓMICO: el cambio y su fila de `AuditoriaPlataforma` salen de UNA sola sentencia; no existe un cambio sin su rastro ni un rastro sin cambio. Antes, una guarda explícita frena (con un
--     mensaje que dice qué falta) una empresa inexistente, una condición que no es de la lista, o un administrador inexistente o inactivo.
--   · IDEMPOTENTE: volver a correrlo con la misma condición no cambia nada y NO suma una auditoría (el UPDATE solo toca la fila si el valor es DISTINTO).
--   · CONCURRENTE: la fila de la empresa se toma con FOR UPDATE; dos corridas a la vez se serializan y la segunda re-evalúa su condición sobre lo que dejó la primera. Con el mismo valor: 1 cambio y
--     1 auditoría. Con valores distintos: 2 cambios y 2 auditorías, y el «antes» de la segunda es el «después» de la primera.
--   · TRAZABLE: el «antes» y el «después» quedan en `AuditoriaPlataforma.detalle` (accion = 'condicion-iva'). No se borra nada.
--   · No toca ninguna otra empresa, ninguna otra columna ni ningún otro dato.
-- Reversa: volver a correrlo con el valor anterior (queda su propia auditoría). Si la empresa no tenía condición (NULL), la reversa es el down.sql de la migración, o un UPDATE a mano como dueño.

\set ON_ERROR_STOP on

-- Guarda: el nombre de lo que falta, antes de tocar nada. Los valores viajan por `set_config(..., true)` (locales a la transacción): hace falta `-1`.
SELECT set_config('m0iva.slug', :'slug', true) AS slug, set_config('m0iva.condicion', :'condicion', true) AS condicion, set_config('m0iva.admin_email', lower(btrim(:'admin_email')), true) AS admin_email;
DO $$
BEGIN
  IF coalesce(current_setting('m0iva.slug', true), '') = '' THEN
    RAISE EXCEPTION 'M0-IVA: falta el slug de la empresa (o se corrio sin -1, que es obligatorio: una sola transaccion). No se escribio nada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Empresa" WHERE "slug" = current_setting('m0iva.slug')) THEN
    RAISE EXCEPTION 'M0-IVA: no existe una empresa con el slug "%". No se escribio nada.', current_setting('m0iva.slug');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''::text', 'g') m
    WHERE c.conrelid = '"Empresa"'::regclass AND c.conname = 'Empresa_condicionIva_check' AND m[1] = current_setting('m0iva.condicion')
  ) THEN
    RAISE EXCEPTION 'M0-IVA: "%" no es una condicion frente al IVA admitida (la lista es la del CHECK Empresa_condicionIva_check). No se escribio nada.', current_setting('m0iva.condicion');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "AdminPlataforma" WHERE "email" = current_setting('m0iva.admin_email') AND "activo") THEN
    RAISE EXCEPTION 'M0-IVA: "%" no es un administrador de plataforma ACTIVO. No se escribio nada.', current_setting('m0iva.admin_email');
  END IF;
END
$$;

\if :{?aplicar}
  WITH admin AS (
    SELECT "id", "email" FROM "AdminPlataforma" WHERE "email" = current_setting('m0iva.admin_email') AND "activo"
  ),
  previa AS (
    SELECT "id", "condicionIva" FROM "Empresa" WHERE "slug" = current_setting('m0iva.slug') FOR UPDATE
  ),
  cambiada AS (
    UPDATE "Empresa" e SET "condicionIva" = :'condicion'
    FROM previa p
    WHERE e."id" = p."id" AND e."condicionIva" IS DISTINCT FROM :'condicion' AND EXISTS (SELECT 1 FROM admin)
    RETURNING e."id"
  ),
  auditada AS (
    INSERT INTO "AuditoriaPlataforma" ("id", "adminId", "adminEmail", "accion", "empresaAfectadaId", "detalle")
    SELECT gen_random_uuid()::text, a."id", a."email", 'condicion-iva', c."id",
           jsonb_build_object('campo', 'condicionIva', 'antes', p."condicionIva", 'despues', :'condicion'::text, 'origen', 'script-sql')
    FROM cambiada c JOIN previa p ON p."id" = c."id" CROSS JOIN admin a
    RETURNING "id"
  )
  SELECT (SELECT count(*) FROM cambiada)::int AS empresas_cambiadas, (SELECT count(*) FROM auditada)::int AS auditorias_escritas;
\else
  SELECT e."id", e."slug", e."condicionIva" AS condicion_actual, :'condicion'::text AS condicion_pedida,
         (e."condicionIva" IS DISTINCT FROM :'condicion') AS cambiaria, 'SIMULACION: no se escribio nada (para aplicar, -v aplicar=1)' AS aviso
  FROM "Empresa" e WHERE e."slug" = current_setting('m0iva.slug');
\endif
