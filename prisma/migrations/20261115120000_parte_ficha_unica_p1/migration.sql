-- PARTE (ficha única de personas y empresas), etapa P1 «Ficha del proveedor» (docs/diseno-parte-ficha-unica-2026-11-15.md §5.2 y docs/diseno-parte-2026-11-12.md §5;
-- REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE REAL, con respaldo y ensayo en una copia: el dueño autorizó escribir migraciones ADITIVAS con down.sql el 2026-11-15, aplicar en bases reales sigue congelado).
--
-- Necesidad (dueño, 2026-11-12, D1 y D2 del diseño): «tabla única» y «Si ficha de parte si, igual a la de Pedernal»; el CUIT del cliente no se agrega a `Cliente` (2026-11-14, «Esperar a Parte (ficha única como Pedernal)»).
--
-- QUÉ HACE (ADITIVA: el código anterior sigue andando; nunca lee ni escribe lo nuevo):
--  1. Funciones `cuit_valido(text)` (módulo 11, SIN lista de prefijos, igual a Pedernal y a `cuit-estricto.ts`) y `texto_de_ficha_valido(text, int)` (la lista de PERMITIDOS de un nombre de razón social: la misma de
--     `src/core/datos/texto-de-catalogo.ts` para la ficha RAZON_SOCIAL, sin los signos `¿ ¡ ? ! % $`), inmutables y con `search_path` fijo.
--  2. Tabla "Parte": persona o empresa de UNA empresa (tenant). El id lo manda la aplicación (uuid); la clave de alta ("idempotenciaAlta", uuid) es única por empresa; un documento = una parte por empresa, también entre
--     las inactivas ("Parte_documento_uk"); CHECK de naturaleza, documento por tipo, domicilio, correo, teléfono, nota y largos; versión y fecha de cambio las fija la base; la identidad no cambia.
--     Las columnas de búsqueda ("nombreBusqueda", "documentoNormalizado", "telefonoDigitos") las calcula la base: el código no las puede falsear.
--  3. "Proveedor"."parteId" (uuid, NULL) + FK compuesta ("empresaId","parteId") + único ("empresaId","parteId"): un proveedor a lo sumo una ficha y una ficha a lo sumo un proveedor.
--  4. RELLENO sin pérdida: cada proveedor de hoy recibe su ficha copiando lo que ya tiene (nunca se inventa un dato; regla de copia §5.5 del 11-12):
--       nombre → nombre (si no pasa la regla, la migración se DETIENE con los ids: nunca se recorta ni se corrige solo);
--       CUIT con módulo 11 válido → documento CUIT; naturaleza por prefijo 20/23/24/27 = HUMANA y 30/33/34 = JURIDICA; cualquier otro caso → naturaleza vacía, «pendiente de completar» ("migradaDe" = 'PROVEEDOR');
--       correo (en minúsculas y recortado), teléfono y notas solo si pasan la regla de la ficha (si no, quedan en "Proveedor" y la ficha los deja vacíos); "contacto" NO se copia; el dato viejo NO se toca ni se borra.
--     Es idempotente: solo toma proveedores con "parteId" NULL, así que correrlo de nuevo no duplica.
--  5. Verificación final dentro de la misma transacción: ningún proveedor sin ficha y tantas fichas migradas como proveedores había; si no, aborta y no queda nada.
--
-- QUÉ NO HACE: no toca "Cliente" (su ficha es la etapa P3), no crea roles aparte de «tener la ficha del rol» (D18), no borra ni reemplaza ninguna columna de "Proveedor" (el retiro es P4), no agrega vínculos (P2),
-- no incluye ANONIMIZADA ni «alta rápida» (supuestos S1 y S3, CONFIRMADOS).
--
-- RLS por empresa (`aislamiento_empresa`) como el resto (sin FORCE: ver T-5 del diseño; los scripts de operación leen con el rol dueño). Sin DELETE ni TRUNCATE para la app; INSERT y UPDATE por columna.
-- Reversa: down.sql (a mano, como dueño, `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `prisma migrate resolve --rolled-back 20261115120000_parte_ficha_unica_p1`). Se NIEGA si hay fichas que no vienen de la migración
-- (o editadas); `SET LOCAL motor2.confirmar_reversion = 'SI'` solo con aviso al dueño. Verificación previa de conteos: verificacion-previa.sql (solo lectura).

DO $$
BEGIN
  IF to_regclass('public."Parte"') IS NOT NULL THEN
    RAISE EXCEPTION 'parte_ficha_unica_p1: la tabla "Parte" ya existe; esta migración solo crea objetos nuevos' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public."Proveedor"') IS NULL OR to_regclass('public."User"') IS NULL OR to_regclass('public."Empresa"') IS NULL
     OR to_regprocedure('public.app_empresa_actual()') IS NULL THEN
    RAISE EXCEPTION 'parte_ficha_unica_p1: faltan "Empresa", "User", "Proveedor" o app_empresa_actual()' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Proveedor' AND column_name = 'parteId') THEN
    RAISE EXCEPTION 'parte_ficha_unica_p1: "Proveedor"."parteId" ya existe' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.cuit_valido(text)') IS NOT NULL OR to_regprocedure('public.texto_de_ficha_valido(text, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'parte_ficha_unica_p1: ya existe cuit_valido o texto_de_ficha_valido' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ================================================================================================
-- Funciones de regla (iguales a las de código; un test de paridad las compara)
-- ================================================================================================

-- CUIT, CUIL o CDI: 11 dígitos y dígito verificador por módulo 11 (pesos 5,4,3,2,7,6,5,4,3,2; resto 11 da 0; resto 10 no tiene dígito válido y se rechaza). NO valida el prefijo (como Pedernal y `cuit-estricto.ts`).
CREATE FUNCTION cuit_valido(c text) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN c IS NULL OR c !~ '^[0-9]{11}$' THEN false
    ELSE (
      SELECT CASE r WHEN 11 THEN 0 WHEN 10 THEN -1 ELSE r END
      FROM (
        SELECT 11 - (sum(substr(c, i, 1)::int * (ARRAY[5,4,3,2,7,6,5,4,3,2])[i]) % 11) AS r
        FROM generate_series(1, 10) AS i
      ) AS calculo
    ) = substr(c, 11, 1)::int
  END
$$;

-- Texto de una línea de una ficha (razón social, apellido, alias, calle…): lista de PERMITIDOS (letras latinas con tilde, dígitos, espacio y . , & - ' / ( ) ° + : ; " # º ª ’ “ ” – — « » ® ™), sin signos de catálogo
-- (`¿ ¡ ? ! % $`), sin blancos en los extremos, sin empezar con `+` ni `-`, de 1 a `p_maximo` caracteres. La forma canónica (espacios repetidos colapsados) la produce el código; la base solo cierra lo que no es de la lista.
CREATE FUNCTION texto_de_ficha_valido(t text, p_maximo integer) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR p_maximo IS NULL OR char_length(t) NOT BETWEEN 1 AND p_maximo THEN false
    ELSE t = btrim(t)
      AND t ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°:;"#ºª’“”–—«»®™''][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°+:;"#ºª’“”–—«»®™'' -]*$'
  END
$$;

-- ================================================================================================
-- "Parte"
-- ================================================================================================
CREATE TABLE "Parte" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "idempotenciaAlta" UUID NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "naturaleza" TEXT,
    "migradaDe" TEXT,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT,
    "alias" TEXT,
    "documentoTipo" TEXT,
    "documentoPais" CHAR(2),
    "documentoNumero" TEXT,
    "condicionIva" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "domPais" CHAR(2),
    "domCalle" TEXT,
    "domNumero" TEXT,
    "domPiso" TEXT,
    "domDepartamento" TEXT,
    "domLocalidad" TEXT,
    "domProvincia" TEXT,
    "domCodigoPostal" TEXT,
    "domTexto" TEXT,
    "nota" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVA',
    "creadoPorId" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "version" INTEGER NOT NULL DEFAULT 1,
    -- Columnas de búsqueda: las calcula la base (el código no las puede falsear). translate() antes de lower() para no depender del locale.
    "nombreBusqueda" TEXT GENERATED ALWAYS AS (lower(translate(
        coalesce("apellido" || ' ', '') || "nombre" || coalesce(' ' || "alias", ''),
        'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
        'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'))) STORED,
    "documentoNormalizado" TEXT GENERATED ALWAYS AS (CASE
        WHEN "documentoTipo" IN ('CUIT', 'CUIL', 'CDI') THEN 'T' || "documentoNumero"
        WHEN "documentoTipo" = 'DNI' THEN 'D' || "documentoNumero"
        WHEN "documentoTipo" IN ('PASAPORTE', 'ID_EXTRANJERO') THEN left("documentoTipo", 1) || "documentoPais" || ':' || "documentoNumero"
      END) STORED,
    "telefonoDigitos" TEXT GENERATED ALWAYS AS (regexp_replace("telefono", '[^0-9]', '', 'g')) STORED,

    CONSTRAINT "Parte_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Parte_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Parte_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Parte_empresaId_id_key" UNIQUE ("empresaId", "id"),
    CONSTRAINT "Parte_idempotenciaAlta_uk" UNIQUE ("empresaId", "idempotenciaAlta"),
    CONSTRAINT "Parte_naturaleza_chk" CHECK ("naturaleza" IN ('HUMANA', 'JURIDICA')),
    CONSTRAINT "Parte_migradaDe_chk" CHECK ("migradaDe" IN ('PROVEEDOR')),
    -- Sin naturaleza («pendiente de completar») solo si la ficha vino de la migración; un alta nueva siempre la trae (I19, regla R-1).
    CONSTRAINT "Parte_naturaleza_o_migrada_chk" CHECK ("naturaleza" IS NOT NULL OR "migradaDe" IS NOT NULL),
    CONSTRAINT "Parte_nombre_chk" CHECK (texto_de_ficha_valido("nombre", 200) AND "nombre" ~ '[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ]'),
    CONSTRAINT "Parte_apellido_chk" CHECK ("apellido" IS NULL OR ("naturaleza" = 'HUMANA' AND texto_de_ficha_valido("apellido", 100))),
    CONSTRAINT "Parte_alias_chk" CHECK ("alias" IS NULL OR texto_de_ficha_valido("alias", 100)),
    CONSTRAINT "Parte_documentoTipo_chk" CHECK ("documentoTipo" IN ('CUIT', 'CUIL', 'CDI', 'DNI', 'PASAPORTE', 'ID_EXTRANJERO')),
    -- Todo CHECK compuesto va envuelto en coalesce(..., false): un NULL en una rama haría pasar la fila (una comparación con NULL no falla).
    CONSTRAINT "Parte_documento_chk" CHECK (coalesce(
        ("documentoTipo" IS NULL AND "documentoNumero" IS NULL AND "documentoPais" IS NULL)
        OR ("documentoTipo" IN ('CUIT', 'CUIL', 'CDI') AND cuit_valido("documentoNumero") AND "documentoPais" IS NULL)
        OR ("documentoTipo" = 'DNI' AND "documentoNumero" ~ '^[1-9][0-9]{5,8}$' AND "documentoPais" IS NULL)
        OR ("documentoTipo" IN ('PASAPORTE', 'ID_EXTRANJERO') AND "documentoPais" ~ '^[A-Z]{2}$'
            AND (("documentoTipo" = 'PASAPORTE' AND "documentoNumero" ~ '^[A-Z0-9]{6,9}$')
              OR ("documentoTipo" = 'ID_EXTRANJERO' AND "documentoNumero" ~ '^[A-Z0-9]{3,20}$'))), false)),
    -- Una empresa (JURIDICA) solo admite CUIT o ID extranjero; una ficha sin naturaleza (migrada) solo admite CUIT o ninguno (nunca un tipo que dependa de la naturaleza).
    CONSTRAINT "Parte_naturaleza_documento_chk" CHECK (coalesce(
        "documentoTipo" IS NULL
        OR "naturaleza" = 'HUMANA'
        OR ("naturaleza" = 'JURIDICA' AND "documentoTipo" IN ('CUIT', 'ID_EXTRANJERO'))
        OR ("naturaleza" IS NULL AND "documentoTipo" = 'CUIT'), false)),
    CONSTRAINT "Parte_condicionIva_chk" CHECK ("condicionIva" IN (
        'RESPONSABLE_INSCRIPTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'MONOTRIBUTO', 'NO_CATEGORIZADO', 'PROVEEDOR_DEL_EXTERIOR', 'CLIENTE_DEL_EXTERIOR',
        'IVA_LIBERADO_LEY_19640', 'MONOTRIBUTISTA_SOCIAL', 'IVA_NO_ALCANZADO', 'MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO')),
    CONSTRAINT "Parte_email_chk" CHECK ("email" IS NULL OR ("email" = lower(btrim("email")) AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND "email" ~ '^[[:graph:]]+$' AND char_length("email") <= 254)),
    CONSTRAINT "Parte_telefono_chk" CHECK ("telefono" IS NULL OR ("telefono" = btrim("telefono") AND char_length("telefono") BETWEEN 1 AND 40 AND "telefono" ~ '^[[:print:]]+$')),
    CONSTRAINT "Parte_domProvincia_chk" CHECK ("domProvincia" IN (
        'AR-A', 'AR-B', 'AR-C', 'AR-D', 'AR-E', 'AR-F', 'AR-G', 'AR-H', 'AR-J', 'AR-K', 'AR-L', 'AR-M',
        'AR-N', 'AR-P', 'AR-Q', 'AR-R', 'AR-S', 'AR-T', 'AR-U', 'AR-V', 'AR-W', 'AR-X', 'AR-Y', 'AR-Z')),
    -- Domicilio: nada, o argentino estructurado, o del exterior en UNA línea; nunca las dos cosas.
    CONSTRAINT "Parte_domicilio_chk" CHECK (coalesce(
        ("domPais" IS NULL AND num_nonnulls("domCalle", "domNumero", "domPiso", "domDepartamento", "domLocalidad", "domProvincia", "domCodigoPostal", "domTexto") = 0)
        OR ("domPais" = 'AR' AND "domTexto" IS NULL AND texto_de_ficha_valido("domCalle", 100)
            AND ("domNumero" ~ '^[0-9]{1,6}$' OR "domNumero" = 'S/N')
            AND ("domPiso" IS NULL OR texto_de_ficha_valido("domPiso", 20))
            AND ("domDepartamento" IS NULL OR texto_de_ficha_valido("domDepartamento", 20))
            AND texto_de_ficha_valido("domLocalidad", 100) AND "domProvincia" IS NOT NULL
            AND ("domCodigoPostal" IS NULL OR "domCodigoPostal" ~ '^[A-Z0-9]{4,8}$'))
        OR ("domPais" <> 'AR' AND "domPais" ~ '^[A-Z]{2}$' AND texto_de_ficha_valido("domTexto", 300)
            AND num_nonnulls("domCalle", "domNumero", "domPiso", "domDepartamento", "domLocalidad", "domProvincia", "domCodigoPostal") = 0), false)),
    -- Nota: de 1 a 2.000 caracteres; sin caracteres de control (salvo el salto de línea) ni de formato invisibles o de dirección de texto (la lista de permitidos completa la aplica el código; R-2).
    CONSTRAINT "Parte_nota_chk" CHECK ("nota" IS NULL OR ("nota" <> '' AND char_length("nota") <= 2000
        AND "nota" !~ '[\x01-\x09\x0B-\x1F\x7F-\x9F­​-‏ -‮⁠-⁯﻿￹-￼]')),
    CONSTRAINT "Parte_estado_chk" CHECK ("estado" IN ('ACTIVA', 'INACTIVA')),
    CONSTRAINT "Parte_version_chk" CHECK ("version" >= 1)
);

-- Un documento, una parte por empresa, INCLUSO entre las inactivas (se reactiva, no se duplica). CUIT, CUIL y CDI del mismo número son la misma clave.
CREATE UNIQUE INDEX "Parte_documento_uk" ON "Parte" ("empresaId", "documentoNormalizado") WHERE "documentoNormalizado" IS NOT NULL;
CREATE INDEX "Parte_nombre_idx" ON "Parte" ("empresaId", "nombreBusqueda" text_pattern_ops, "id");
CREATE INDEX "Parte_email_idx" ON "Parte" ("empresaId", "email" text_pattern_ops) WHERE "email" IS NOT NULL;
CREATE INDEX "Parte_telefono_idx" ON "Parte" ("empresaId", "telefonoDigitos") WHERE "telefonoDigitos" IS NOT NULL;
-- «Pendientes de completar»: las fichas migradas sin naturaleza.
CREATE INDEX "Parte_pendientes_idx" ON "Parte" ("empresaId", "creadoEn", "id") WHERE "naturaleza" IS NULL;

-- La identidad no cambia; la versión y la fecha de cambio las fija la base (la aplicación solo condiciona su UPDATE por la versión que leyó); una ficha con naturaleza no vuelve a quedar sin ella.
CREATE FUNCTION "Parte_proteger"() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."empresaId" <> OLD."empresaId" OR NEW."idempotenciaAlta" <> OLD."idempotenciaAlta" OR NEW."payloadHash" <> OLD."payloadHash"
     OR NEW."creadoPorId" IS DISTINCT FROM OLD."creadoPorId" OR NEW."migradaDe" IS DISTINCT FROM OLD."migradaDe" OR NEW."creadoEn" <> OLD."creadoEn" THEN
    RAISE EXCEPTION 'la identidad de una parte no cambia (id, empresa, clave de alta, huella, autor, origen y fecha de alta)'
      USING ERRCODE = '23514', CONSTRAINT = 'Parte_identidad_inmutable';
  END IF;
  IF OLD."naturaleza" IS NOT NULL AND NEW."naturaleza" IS NULL THEN
    RAISE EXCEPTION 'una parte con naturaleza declarada no vuelve a quedar sin ella'
      USING ERRCODE = '23514', CONSTRAINT = 'Parte_naturaleza_no_se_borra';
  END IF;
  NEW."version" := OLD."version" + 1;
  NEW."actualizadoEn" := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER "Parte_proteger" BEFORE UPDATE ON "Parte" FOR EACH ROW EXECUTE FUNCTION "Parte_proteger"();

-- ================================================================================================
-- "Proveedor"."parteId"
-- ================================================================================================
ALTER TABLE "Proveedor" ADD COLUMN "parteId" UUID;
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_parte_fkey" FOREIGN KEY ("empresaId", "parteId") REFERENCES "Parte"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Un proveedor a lo sumo una ficha y una ficha a lo sumo un proveedor (varios NULL no chocan entre sí).
CREATE UNIQUE INDEX "Proveedor_empresaId_parteId_key" ON "Proveedor" ("empresaId", "parteId");

-- ================================================================================================
-- RLS y privilegios (si los roles existen)
-- ================================================================================================
ALTER TABLE "Parte" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Parte"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "Parte" FROM motor2_app;
    GRANT SELECT ON "Parte" TO motor2_app;
    -- Sin "migradaDe", "estado" (nace ACTIVA), "creadoEn", "actualizadoEn", "version" ni las tres calculadas: las fija la base.
    GRANT INSERT ("id", "empresaId", "idempotenciaAlta", "payloadHash", "naturaleza", "nombre", "apellido", "alias", "documentoTipo", "documentoPais", "documentoNumero", "condicionIva",
                  "email", "telefono", "domPais", "domCalle", "domNumero", "domPiso", "domDepartamento", "domLocalidad", "domProvincia", "domCodigoPostal", "domTexto", "nota", "creadoPorId") ON "Parte" TO motor2_app;
    GRANT UPDATE ("naturaleza", "nombre", "apellido", "alias", "documentoTipo", "documentoPais", "documentoNumero", "condicionIva", "email", "telefono",
                  "domPais", "domCalle", "domNumero", "domPiso", "domDepartamento", "domLocalidad", "domProvincia", "domCodigoPostal", "domTexto", "nota", "estado") ON "Parte" TO motor2_app;
    GRANT UPDATE ("parteId") ON "Proveedor" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "Parte" FROM motor2_plataforma;
  END IF;
END
$$;

-- ================================================================================================
-- RELLENO sin pérdida: una ficha por proveedor existente (solo los que no tienen ficha: idempotente)
-- Concurrencia: el ALTER TABLE "Proveedor" de arriba toma ACCESS EXCLUSIVE y lo conserva hasta el final de esta transacción: nadie crea ni cambia un proveedor mientras se copia (y si una fila
-- quedara sin ficha, la verificación del final aborta todo). No hace falta otro LOCK.
-- ================================================================================================
DO $$
DECLARE
  v_sin_ficha bigint;
  v_invalidos text;
  v_creadas bigint;
BEGIN
  SELECT count(*) INTO v_sin_ficha FROM "Proveedor" WHERE "parteId" IS NULL;

  -- Un nombre que la regla de la ficha no acepta DETIENE la migración (nunca se recorta ni se corrige solo): se informan los ids, no los nombres.
  SELECT string_agg("id", ', ' ORDER BY "id") INTO v_invalidos FROM "Proveedor"
   WHERE "parteId" IS NULL AND NOT (texto_de_ficha_valido("nombre", 200) AND "nombre" ~ '[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ]');
  IF v_invalidos IS NOT NULL THEN
    RAISE EXCEPTION 'parte_ficha_unica_p1: hay proveedores cuyo nombre no cumple la regla de la ficha (ids: %). Corregirlos antes de migrar (verificacion-previa.sql los lista).', v_invalidos USING ERRCODE = '23514';
  END IF;

  CREATE TEMP TABLE _parte_migrada ON COMMIT DROP AS
    SELECT p."id" AS proveedor_id, gen_random_uuid() AS parte_id FROM "Proveedor" p WHERE p."parteId" IS NULL;

  INSERT INTO "Parte" ("id", "empresaId", "idempotenciaAlta", "payloadHash", "naturaleza", "migradaDe", "nombre", "documentoTipo", "documentoNumero", "condicionIva", "email", "telefono", "nota")
  SELECT m.parte_id, p."empresaId", gen_random_uuid(), encode(sha256(convert_to('migracion:Proveedor:' || p."id", 'UTF8')), 'hex'),
         CASE WHEN cuit_valido(p."cuit") AND left(p."cuit", 2) IN ('20', '23', '24', '27') THEN 'HUMANA'
              WHEN cuit_valido(p."cuit") AND left(p."cuit", 2) IN ('30', '33', '34') THEN 'JURIDICA' END,
         'PROVEEDOR',
         p."nombre",
         CASE WHEN cuit_valido(p."cuit") THEN 'CUIT' END,
         CASE WHEN cuit_valido(p."cuit") THEN p."cuit" END,
         -- Los tres valores de emisor de "Proveedor"."condicionIva" existen entre los once de la ficha; si no estuviera, queda vacío (nunca se inventa).
         CASE WHEN p."condicionIva" IN ('RESPONSABLE_INSCRIPTO', 'EXENTO', 'MONOTRIBUTO') THEN p."condicionIva" END,
         CASE WHEN lower(btrim(p."email")) ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND lower(btrim(p."email")) ~ '^[[:graph:]]+$' AND char_length(lower(btrim(p."email"))) <= 254
              THEN lower(btrim(p."email")) END,
         CASE WHEN btrim(p."telefono") ~ '^[[:print:]]+$' AND char_length(btrim(p."telefono")) BETWEEN 1 AND 40 THEN btrim(p."telefono") END,
         CASE WHEN p."notas" <> '' AND char_length(p."notas") <= 2000
                   AND p."notas" !~ '[\x01-\x09\x0B-\x1F\x7F-\x9F­​-‏ -‮⁠-⁯﻿￹-￼]' THEN p."notas" END
    FROM "Proveedor" p JOIN _parte_migrada m ON m.proveedor_id = p."id";
  GET DIAGNOSTICS v_creadas = ROW_COUNT;

  UPDATE "Proveedor" p SET "parteId" = m.parte_id FROM _parte_migrada m WHERE p."id" = m.proveedor_id AND p."parteId" IS NULL;

  -- Verificación: ninguna sin ficha, tantas fichas como proveedores había, y el nombre idéntico (ningún dato se perdió ni se cambió).
  IF v_creadas <> v_sin_ficha OR EXISTS (SELECT 1 FROM "Proveedor" WHERE "parteId" IS NULL) THEN
    RAISE EXCEPTION 'parte_ficha_unica_p1: el relleno no coincide (proveedores sin ficha: %, fichas creadas: %)', v_sin_ficha, v_creadas USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "Proveedor" p JOIN "Parte" a ON a."empresaId" = p."empresaId" AND a."id" = p."parteId" WHERE a."nombre" <> p."nombre") THEN
    RAISE EXCEPTION 'parte_ficha_unica_p1: algún nombre de la ficha no coincide con el del proveedor' USING ERRCODE = '23514';
  END IF;
END
$$;
