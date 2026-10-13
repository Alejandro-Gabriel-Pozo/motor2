-- GO-1d (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): la LÍNEA CON OPCIONES y la FOTO de lo elegido. TOCA DOS TABLAS CON DATOS (`CuentaItem` y `Operacion`), solo con columnas nuevas NULABLES, y crea `OpcionElegidaEnLinea`.
--   CuentaItem.huellaOpciones   la huella (SHA-256, 64 caracteres hexadecimales) de las opciones que van dentro del precio de la línea; NULL = sin opciones (todas las de hoy)
--   CuentaItem.lineaPadreId     la línea padre de un ADICIONAL (otra línea de la misma cuenta); NULL en toda línea que no es un adicional
--   Operacion.operacionPadreId  la operación de venta padre de la de un adicional; NULL en toda operación de hoy
--   OpcionElegidaEnLinea        la FOTO de cada opción elegida en una línea: tipo y nombre del grupo, nombre de la opción, cantidad, modo de precio, diferencia (porcentaje DECIMAL(7,4)), importe unitario DECIMAL(14,2), factor de escala. SOLO se agrega.
--
-- ADITIVA y SIN RELLENO: las columnas nacen en NULL, ningún código de `src/` las lee ni las escribe todavía (GO-2) y el código anterior sigue andando sobre la base nueva (Instant Rollback seguro). Con todo en NULL ningún CHECK ni clave foránea puede fallar. Estilo idempotente (IF NOT EXISTS / DROP IF EXISTS) en
-- lo que toca tablas con datos. Sin `NOT VALID` + `VALIDATE`: en una sola transacción no reduce ningún bloqueo y las columnas nacen en NULL.
--
-- LOS TRES DISPARADORES (SECURITY INVOKER, alcanzan también al dueño; sus errores salen con 23514 y el nombre de la restricción):
--   CuentaItem_opciones_chk  (BEFORE INSERT OR UPDATE OF huellaOpciones, lineaPadreId, cuentaId): la huella y el padre no cambian nunca; una línea que es adicional, o que tiene adicionales, no se mueve de cuenta; un adicional va con un padre que existe, se ve, es de la MISMA
--                            cuenta y no es adicional ni espejo (un solo nivel); el espejo repite la huella y el padre del original. Una línea sin padre y sin `anulaAItemId` (todas las de hoy) sale por el camino corto, sin leer nada. Un `UPDATE` de `numeroEnvio` u `operacionId` no lo dispara.
--   OpcionElegidaEnLinea_coherente_chk (BEFORE INSERT): la opción es del grupo y el tipo es el del grupo; la versión es de la opción; la línea existe, se ve y no es un espejo; un ADICIONAL va en una línea con padre y con el producto ANCLA de la opción; las demás en una línea sin padre y con huella.
--   Operacion_padre_inmutable_chk (BEFORE UPDATE OF operacionPadreId): el padre de una operación no cambia nunca. No corre en ningún UPDATE de hoy.
-- Las claves foráneas son compuestas `(empresaId, x)` de dos columnas (no hay claves de tres: lo que depende del tipo de grupo se compara contra otra tabla y se controla con el disparador). La foto se borra con el borrador de su línea (ON DELETE CASCADE, que corre como dueño); un padre con adicionales no se borra (RESTRICT).
-- Que el padre de una operación sea de la misma sucursal y de la misma venta lo controla la aplicación (GO-2), igual que `ventaId`.
--
-- AL APLICAR: toma ACCESS EXCLUSIVE sobre `CuentaItem` y `Operacion` hasta el COMMIT. Hacerlo con `SET lock_timeout = '5s'` y sin tráfico del POS. GUARDA DE VOLUMEN: si `SELECT count(*) FROM "CuentaItem"` o `FROM "Operacion"` pasa de 500.000, NO aplicar: hay que replanear los índices (acá no se usa CONCURRENTLY).
-- Requiere GO-1b (las opciones y sus versiones), el rol motor2_app si existe (los GRANT son condicionales) y la función app_empresa_actual() (default de empresaId).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back`). NO destructiva: ABORTA si hay una foto, una línea con huella o con padre, o una operación con padre. Se baja DESPUÉS de GO-1d-rls y ANTES que GO-1b.

ALTER TABLE "CuentaItem" ADD COLUMN IF NOT EXISTS "huellaOpciones" TEXT, ADD COLUMN IF NOT EXISTS "lineaPadreId" TEXT;
CREATE INDEX IF NOT EXISTS "CuentaItem_lineaPadreId_idx" ON "CuentaItem"("lineaPadreId");
ALTER TABLE "CuentaItem" DROP CONSTRAINT IF EXISTS "CuentaItem_empresaId_lineaPadreId_fkey";
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_empresaId_lineaPadreId_fkey" FOREIGN KEY ("empresaId", "lineaPadreId") REFERENCES "CuentaItem"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaItem" DROP CONSTRAINT IF EXISTS "CuentaItem_huella_opciones_chk";
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_huella_opciones_chk" CHECK ("huellaOpciones" IS NULL OR "huellaOpciones" ~ '^[0-9a-f]{64}$');
-- Un adicional no es su propia línea padre, no lleva promo ni precio de carta (sin descuento de producto) ni huella, y nunca cuesta $0.
ALTER TABLE "CuentaItem" DROP CONSTRAINT IF EXISTS "CuentaItem_adicional_chk";
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_adicional_chk" CHECK ("lineaPadreId" IS NULL OR ("lineaPadreId" <> "id" AND "promoCuentaId" IS NULL AND "huellaOpciones" IS NULL AND "precioCartaUnitario" IS NULL AND "precioUnitario" >= 0.01));

ALTER TABLE "Operacion" ADD COLUMN IF NOT EXISTS "operacionPadreId" TEXT;
CREATE INDEX IF NOT EXISTS "Operacion_operacionPadreId_idx" ON "Operacion"("operacionPadreId");
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_empresaId_operacionPadreId_fkey";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_operacionPadreId_fkey" FOREIGN KEY ("empresaId", "operacionPadreId") REFERENCES "Operacion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_padre_solo_venta_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_padre_solo_venta_chk" CHECK ("operacionPadreId" IS NULL OR (proceso = 'VENTA' AND "operacionPadreId" <> id AND "promoCuentaId" IS NULL));

CREATE TABLE "OpcionElegidaEnLinea" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "cuentaItemId" TEXT NOT NULL,
    "grupoId" TEXT NOT NULL,
    "opcionId" TEXT NOT NULL,
    "versionDeOpcionId" TEXT NOT NULL,
    "tipoGrupo" TEXT NOT NULL,
    "nombreGrupo" TEXT NOT NULL,
    "nombreOpcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "modoPrecio" TEXT,
    "tipoDeDiferencia" TEXT,
    "porcentaje" DECIMAL(7,4),
    "importeUnitario" DECIMAL(14,2) NOT NULL,
    "precioDeSucursal" BOOLEAN NOT NULL DEFAULT false,
    "factorEscala" DECIMAL(8,4),
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpcionElegidaEnLinea_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OpcionElegidaEnLinea_opcionId_idx" ON "OpcionElegidaEnLinea"("opcionId");
CREATE INDEX "OpcionElegidaEnLinea_versionDeOpcionId_idx" ON "OpcionElegidaEnLinea"("versionDeOpcionId");
CREATE UNIQUE INDEX "OpcionElegidaEnLinea_empresaId_id_key" ON "OpcionElegidaEnLinea"("empresaId", "id");
CREATE UNIQUE INDEX "OpcionElegidaEnLinea_cuentaItemId_opcionId_key" ON "OpcionElegidaEnLinea"("cuentaItemId", "opcionId");
CREATE UNIQUE INDEX "OpcionElegidaEnLinea_un_adicional_por_linea_key" ON "OpcionElegidaEnLinea" ("cuentaItemId") WHERE "tipoGrupo" = 'ADICIONAL';
CREATE UNIQUE INDEX "OpcionElegidaEnLinea_una_medida_por_linea_key" ON "OpcionElegidaEnLinea" ("cuentaItemId") WHERE "tipoGrupo" = 'MEDIDA';
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_empresaId_cuentaItemId_fkey" FOREIGN KEY ("empresaId", "cuentaItemId") REFERENCES "CuentaItem"("empresaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_empresaId_grupoId_fkey" FOREIGN KEY ("empresaId", "grupoId") REFERENCES "GrupoDeOpciones"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_empresaId_opcionId_fkey" FOREIGN KEY ("empresaId", "opcionId") REFERENCES "OpcionDeGrupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_empresaId_versionDeOpcionId_fkey" FOREIGN KEY ("empresaId", "versionDeOpcionId") REFERENCES "VersionDeOpcion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_tipo_grupo_chk" CHECK ("tipoGrupo" IN ('MEDIDA', 'VARIANTE', 'INCLUIDA', 'ADICIONAL'));
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_modo_precio_chk" CHECK ("modoPrecio" IS NULL OR "modoPrecio" IN ('ABSOLUTO', 'DIFERENCIA'));
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_tipo_de_diferencia_chk" CHECK ("tipoDeDiferencia" IS NULL OR "tipoDeDiferencia" IN ('MONTO', 'PORCENTAJE'));
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_nombres_chk" CHECK ("nombreGrupo" ~ '\S' AND char_length("nombreGrupo") <= 80 AND "nombreOpcion" ~ '\S' AND char_length("nombreOpcion") <= 80);
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_cantidad_chk" CHECK ("cantidad" BETWEEN 1 AND 10);
-- Solo la MEDIDA lleva modo de precio y factor de escala, y se elige una sola vez.
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_medida_chk" CHECK (
  ("tipoGrupo" = 'MEDIDA') = ("modoPrecio" IS NOT NULL)
  AND ("tipoGrupo" = 'MEDIDA' OR "factorEscala" IS NULL)
  AND ("tipoGrupo" <> 'MEDIDA' OR "cantidad" = 1));
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_absoluto_chk" CHECK ("modoPrecio" IS DISTINCT FROM 'ABSOLUTO' OR ("tipoDeDiferencia" IS NULL AND "importeUnitario" >= 0.01));
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_diferencia_de_medida_chk" CHECK ("modoPrecio" IS DISTINCT FROM 'DIFERENCIA' OR "tipoDeDiferencia" IS NOT NULL);
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_incluida_chk" CHECK ("tipoGrupo" <> 'INCLUIDA' OR ("importeUnitario" = 0 AND "tipoDeDiferencia" IS NULL));
-- `IS NOT DISTINCT FROM` y no `=`: con el tipo NULL, `tipo = 'MONTO'` da NULL y un CHECK que da NULL PASA (un adicional sin tipo se colaría).
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_adicional_chk" CHECK ("tipoGrupo" <> 'ADICIONAL' OR ("importeUnitario" >= 0.01 AND "tipoDeDiferencia" IS NOT DISTINCT FROM 'MONTO'));
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_porcentaje_solo_medida_variante_chk" CHECK ("tipoDeDiferencia" IS DISTINCT FROM 'PORCENTAJE' OR "tipoGrupo" IN ('MEDIDA', 'VARIANTE'));
-- Con el tipo NULL, `=` dejaría pasar cualquier porcentaje: por eso `IS NOT DISTINCT FROM`.
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_diferencia_chk" CHECK (("tipoDeDiferencia" IS NOT DISTINCT FROM 'PORCENTAJE') = ("porcentaje" IS NOT NULL));
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_porcentaje_chk" CHECK ("porcentaje" IS NULL OR ("porcentaje" > -100 AND "porcentaje" <= 999.9999));
ALTER TABLE "OpcionElegidaEnLinea" ADD CONSTRAINT "OpcionElegidaEnLinea_factor_chk" CHECK ("factorEscala" IS NULL OR ("factorEscala" > 0 AND "factorEscala" <= 10));

ALTER TABLE "OpcionElegidaEnLinea" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "OpcionElegidaEnLinea"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- T1: las reglas de las líneas con opciones. Camino corto: una línea sin padre y sin `anulaAItemId` (todas las de hoy) sale sin leer nada.
CREATE FUNCTION "CuentaItem_reglas_de_opciones"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original RECORD;
  padre RECORD;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."huellaOpciones" IS DISTINCT FROM OLD."huellaOpciones" OR NEW."lineaPadreId" IS DISTINCT FROM OLD."lineaPadreId" THEN
      RAISE EXCEPTION 'la huella de las opciones y la línea padre de un ítem no cambian nunca'
        USING ERRCODE = '23514', CONSTRAINT = 'CuentaItem_opciones_inmutables_chk', TABLE = 'CuentaItem';
    END IF;
    IF NEW."cuentaId" IS DISTINCT FROM OLD."cuentaId"
       AND (OLD."lineaPadreId" IS NOT NULL OR EXISTS (SELECT 1 FROM "CuentaItem" h WHERE h."empresaId" = OLD."empresaId" AND h."lineaPadreId" = OLD."id")) THEN
      RAISE EXCEPTION 'un adicional, o una línea con adicionales, no se mueve de cuenta'
        USING ERRCODE = '23514', CONSTRAINT = 'CuentaItem_padre_misma_cuenta_chk', TABLE = 'CuentaItem';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."lineaPadreId" IS NULL AND NEW."anulaAItemId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."anulaAItemId" IS NOT NULL THEN
    SELECT o."huellaOpciones", o."lineaPadreId" INTO original FROM "CuentaItem" o WHERE o."empresaId" = NEW."empresaId" AND o."id" = NEW."anulaAItemId";
    IF FOUND AND (NEW."huellaOpciones" IS DISTINCT FROM original."huellaOpciones" OR NEW."lineaPadreId" IS DISTINCT FROM original."lineaPadreId") THEN
      RAISE EXCEPTION 'el espejo de un ítem repite la huella de las opciones y la línea padre del original'
        USING ERRCODE = '23514', CONSTRAINT = 'CuentaItem_espejo_coherente_chk', TABLE = 'CuentaItem';
    END IF;
  END IF;

  IF NEW."lineaPadreId" IS NOT NULL THEN
    SELECT p."cuentaId", p."lineaPadreId", p."anulaAItemId" INTO padre FROM "CuentaItem" p WHERE p."empresaId" = NEW."empresaId" AND p."id" = NEW."lineaPadreId";
    IF NOT FOUND OR padre."cuentaId" <> NEW."cuentaId" THEN
      RAISE EXCEPTION 'la línea padre de un adicional tiene que existir y ser de la misma cuenta'
        USING ERRCODE = '23514', CONSTRAINT = 'CuentaItem_padre_misma_cuenta_chk', TABLE = 'CuentaItem';
    END IF;
    IF padre."lineaPadreId" IS NOT NULL OR padre."anulaAItemId" IS NOT NULL THEN
      RAISE EXCEPTION 'la línea padre de un adicional no puede ser otro adicional ni un espejo (un solo nivel)'
        USING ERRCODE = '23514', CONSTRAINT = 'CuentaItem_padre_un_nivel_chk', TABLE = 'CuentaItem';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "CuentaItem_opciones_chk"
  BEFORE INSERT OR UPDATE OF "huellaOpciones", "lineaPadreId", "cuentaId" ON "CuentaItem"
  FOR EACH ROW EXECUTE FUNCTION "CuentaItem_reglas_de_opciones"();

-- T2: la foto es coherente con su opción, su versión y su línea.
CREATE FUNCTION "OpcionElegidaEnLinea_coherente_con_su_linea"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  opcion RECORD;
  linea RECORD;
BEGIN
  SELECT o."grupoId", g."tipo", o."productoId" INTO opcion
    FROM "OpcionDeGrupo" o JOIN "GrupoDeOpciones" g ON g."empresaId" = o."empresaId" AND g."id" = o."grupoId"
   WHERE o."empresaId" = NEW."empresaId" AND o."id" = NEW."opcionId";
  IF NOT FOUND OR opcion."grupoId" <> NEW."grupoId" OR opcion."tipo" <> NEW."tipoGrupo" THEN
    RAISE EXCEPTION 'la opción tiene que ser del grupo y el tipo, el del grupo'
      USING ERRCODE = '23514', CONSTRAINT = 'OpcionElegidaEnLinea_opcion_del_grupo_chk', TABLE = 'OpcionElegidaEnLinea';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "VersionDeOpcion" v WHERE v."empresaId" = NEW."empresaId" AND v."id" = NEW."versionDeOpcionId" AND v."opcionId" = NEW."opcionId") THEN
    RAISE EXCEPTION 'la versión tiene que ser de la opción elegida'
      USING ERRCODE = '23514', CONSTRAINT = 'OpcionElegidaEnLinea_version_de_la_opcion_chk', TABLE = 'OpcionElegidaEnLinea';
  END IF;

  SELECT c."lineaPadreId", c."productoId", c."huellaOpciones", c."anulaAItemId" INTO linea FROM "CuentaItem" c WHERE c."empresaId" = NEW."empresaId" AND c."id" = NEW."cuentaItemId";
  IF NOT FOUND OR linea."anulaAItemId" IS NOT NULL THEN
    RAISE EXCEPTION 'la línea tiene que existir y no ser un espejo de anulación'
      USING ERRCODE = '23514', CONSTRAINT = 'OpcionElegidaEnLinea_linea_valida_chk', TABLE = 'OpcionElegidaEnLinea';
  END IF;

  IF NEW."tipoGrupo" = 'ADICIONAL' THEN
    IF linea."lineaPadreId" IS NULL OR linea."productoId" IS DISTINCT FROM opcion."productoId" THEN
      RAISE EXCEPTION 'un adicional va en una línea con padre y con el producto ancla de la opción'
        USING ERRCODE = '23514', CONSTRAINT = 'OpcionElegidaEnLinea_adicional_en_su_linea_chk', TABLE = 'OpcionElegidaEnLinea';
    END IF;
  ELSIF linea."lineaPadreId" IS NOT NULL OR linea."huellaOpciones" IS NULL THEN
    RAISE EXCEPTION 'una opción que no es adicional va en una línea sin padre y con la huella de las opciones'
      USING ERRCODE = '23514', CONSTRAINT = 'OpcionElegidaEnLinea_opcion_en_su_linea_chk', TABLE = 'OpcionElegidaEnLinea';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "OpcionElegidaEnLinea_coherente_chk"
  BEFORE INSERT ON "OpcionElegidaEnLinea"
  FOR EACH ROW EXECUTE FUNCTION "OpcionElegidaEnLinea_coherente_con_su_linea"();

-- T3: el padre de una operación no cambia nunca.
CREATE FUNCTION "Operacion_padre_inmutable"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."operacionPadreId" IS DISTINCT FROM OLD."operacionPadreId" THEN
    RAISE EXCEPTION 'la operación padre de una operación no cambia nunca'
      USING ERRCODE = '23514', CONSTRAINT = 'Operacion_padre_inmutable_chk', TABLE = 'Operacion';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "Operacion_padre_inmutable_chk"
  BEFORE UPDATE OF "operacionPadreId" ON "Operacion"
  FOR EACH ROW EXECUTE FUNCTION "Operacion_padre_inmutable"();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "OpcionElegidaEnLinea" FROM motor2_app;
    GRANT SELECT, INSERT ON "OpcionElegidaEnLinea" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "OpcionElegidaEnLinea" FROM motor2_plataforma;
  END IF;
END
$$;
