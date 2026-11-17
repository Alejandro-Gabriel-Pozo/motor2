-- COMPRAS, RECEPCIÓN SEPARADA, etapa N3-b «control por línea» (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo y ensayo).
-- Diseño: docs/diseno-compras-n3b-n4-etapas-2026-11-16.md, §«Etapa N3-b»; decisiones del dueño del 2026-11-16 (control por línea: conforme, con observaciones, rechazada; observación obligatoria si no es conforme).
-- Referencia de forma y resultado: Pedernal, `0063_compras_recepcion_separada.sql` (tabla `inspeccion_de_linea_de_recepcion` y su disparador).
--
-- QUÉ HACE (ADITIVA: el código anterior no la lee ni la escribe): una tabla nueva, `ControlDeLineaDeRecepcion`, de SOLO INSERCIÓN: el control que quien recibe registra de cada renglón de una compra pendiente de recibir, ANTES de confirmar.
-- SIN FILA = «no se constató» (nunca un CONFORME por defecto). `condicion` CONFORME | CON_OBSERVACIONES | RECHAZADA; `observacion` obligatoria si no es CONFORME, de 1 a 500 caracteres de una lista de PERMITIDOS (la misma de
-- `src/core/datos/texto-de-catalogo.ts` con los signos de catálogo `¿ ¡ ? ! % $`, sin blancos en los extremos ni `+`/`-` al empezar); `cantidadSegunRemito` opcional y mayor que cero. La temperatura NO entra (nadie la pidió).
-- Único por (parte, renglón): un renglón se controla UNA vez (no hay UPDATE: corregir un control no existe en esta etapa).
--
-- QUÉ DECIDE LA BASE: la parte es de la empresa (FK compuesta) y el renglón es de la MISMA factura que dice la fila (FK compuesta con la factura: `FacturaProveedorRenglon_empresaId_facturaProveedorId_id_key`); el disparador
-- exige además que la parte sea de esa misma factura y siga PENDIENTE (el control solo existe antes de confirmar; `FOR SHARE` de la parte: una confirmación concurrente espera o hace fallar el control); la condición y la
-- observación; el único. La app NO puede cambiar ni borrar (solo SELECT e INSERT; sin UPDATE, DELETE ni TRUNCATE). DIFERENCIA con Pedernal: allá cuelga de su propia `recepcion`/`linea_de_recepcion` (que Motor2 no tiene: la parte de
-- la factura y su renglón son la recepción y la línea) y exige la transacción de su recepción; acá exige la parte PENDIENTE. Pedernal tiene además `temperatura_en_c`: fuera (no pedida).
-- QUÉ DECIDE EL CASO DE USO: que la parte sea de la sucursal activa, que la factura no esté anulada, el permiso (`compra_controlar_recepcion`) y el módulo `recepcion_de_compras`.
--
-- Forma de tabla nueva (molde E-0): id UUID (lo manda la aplicación), instantes TIMESTAMPTZ(3), sin DELETE. RLS por empresa (`aislamiento_empresa`); sin política por sucursal (la parte es de la sucursal: el caso de uso lo verifica y
-- el disparador lee la parte con las políticas de la sucursal del actor). Índices sin CONCURRENTLY (tabla nueva y vacía). Reversa: down.sql (a mano, como dueño; ABORTA si hay filas).

DO $$
BEGIN
  IF to_regclass('public."ControlDeLineaDeRecepcion"') IS NOT NULL THEN
    RAISE EXCEPTION 'compras_control_de_linea_de_recepcion: la tabla "ControlDeLineaDeRecepcion" ya existe; esta migración solo crea objetos nuevos' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public."FacturaProveedorSucursal"') IS NULL OR to_regclass('public."FacturaProveedorRenglon"') IS NULL OR to_regclass('public."User"') IS NULL
     OR to_regprocedure('public.app_empresa_actual()') IS NULL THEN
    RAISE EXCEPTION 'compras_control_de_linea_de_recepcion: faltan las tablas de la factura de proveedor, "User" o app_empresa_actual()' USING ERRCODE = '55000';
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "ControlDeLineaDeRecepcion" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorId" TEXT NOT NULL,
    "facturaProveedorSucursalId" TEXT NOT NULL,
    "facturaProveedorRenglonId" TEXT NOT NULL,
    "condicion" TEXT NOT NULL,
    "observacion" TEXT,
    "cantidadSegunRemito" DECIMAL(14,4),
    "registradoPorId" TEXT NOT NULL,
    "registradoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "ControlDeLineaDeRecepcion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ControlDeLineaDeRecepcion_empresaId_id_key" ON "ControlDeLineaDeRecepcion"("empresaId", "id");

-- CreateIndex: un control por renglón de cada parte.
CREATE UNIQUE INDEX "ControlDeLineaDeRecepcion_parte_renglon_key" ON "ControlDeLineaDeRecepcion"("empresaId", "facturaProveedorSucursalId", "facturaProveedorRenglonId");

-- CreateIndex
CREATE INDEX "ControlDeLineaDeRecepcion_facturaProveedorRenglonId_idx" ON "ControlDeLineaDeRecepcion"("facturaProveedorRenglonId");

-- AddForeignKey
ALTER TABLE "ControlDeLineaDeRecepcion" ADD CONSTRAINT "ControlDeLineaDeRecepcion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: el renglón es de LA factura que dice la fila (y de la empresa).
ALTER TABLE "ControlDeLineaDeRecepcion" ADD CONSTRAINT "ControlDeLineaDeRecepcion_renglon_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId", "facturaProveedorRenglonId") REFERENCES "FacturaProveedorRenglon"("empresaId", "facturaProveedorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: la parte es de la empresa (que sea de la misma factura lo exige el disparador).
ALTER TABLE "ControlDeLineaDeRecepcion" ADD CONSTRAINT "ControlDeLineaDeRecepcion_parte_fkey" FOREIGN KEY ("empresaId", "facturaProveedorSucursalId") REFERENCES "FacturaProveedorSucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlDeLineaDeRecepcion" ADD CONSTRAINT "ControlDeLineaDeRecepcion_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas (CHECK con nombre). Todo CHECK compuesto va envuelto en coalesce(..., false): un NULL en una rama haría pasar la fila.
ALTER TABLE "ControlDeLineaDeRecepcion" ADD CONSTRAINT "ControlDeLineaDeRecepcion_condicion_chk" CHECK ("condicion" IN ('CONFORME', 'CON_OBSERVACIONES', 'RECHAZADA'));
ALTER TABLE "ControlDeLineaDeRecepcion" ADD CONSTRAINT "ControlDeLineaDeRecepcion_cantidadSegunRemito_chk" CHECK ("cantidadSegunRemito" IS NULL OR ("cantidadSegunRemito" > 0 AND "cantidadSegunRemito" < 100000000000));
-- La observación: lista de PERMITIDOS (letras latinas con tilde, dígitos, espacio y . , & - ' / ( ) ° + : ; " # º ª ’ “ ” – — « » ® ™ ¿ ¡ ? ! % $), de 1 a 500, sin blancos en los extremos y sin empezar con `+` ni `-`.
ALTER TABLE "ControlDeLineaDeRecepcion" ADD CONSTRAINT "ControlDeLineaDeRecepcion_observacion_chk" CHECK ("observacion" IS NULL OR coalesce(
    char_length("observacion") BETWEEN 1 AND 500
    AND "observacion" = btrim("observacion")
    AND "observacion" ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°:;"#ºª’“”–—«»®™¿¡?!%$''][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°+:;"#ºª’“”–—«»®™¿¡?!%$'' -]*$', false));
-- Observación obligatoria si no es conforme.
ALTER TABLE "ControlDeLineaDeRecepcion" ADD CONSTRAINT "ControlDeLineaDeRecepcion_observacion_requerida_chk" CHECK ("condicion" = 'CONFORME' OR "observacion" IS NOT NULL);

-- El control solo existe ANTES de confirmar: la parte es de la factura que dice la fila y sigue PENDIENTE. `FOR SHARE`: una confirmación concurrente (UPDATE de la parte) espera a este INSERT, y un INSERT que llega
-- después de confirmar ve RECIBIDA y falla. Sin SECURITY DEFINER: lee la parte con las políticas de la sucursal del actor (si no la ve, falla cerrado).
CREATE FUNCTION compras_control_de_linea_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_factura text;
  v_estado text;
BEGIN
  SELECT p."facturaProveedorId", p."estadoRecepcion" INTO v_factura, v_estado
    FROM public."FacturaProveedorSucursal" p WHERE p."id" = NEW."facturaProveedorSucursalId" AND p."empresaId" = NEW."empresaId" FOR SHARE;
  IF v_factura IS NULL THEN
    RAISE EXCEPTION 'la parte de la compra no existe o no es de esta sucursal' USING ERRCODE = '23514', CONSTRAINT = 'ControlDeLineaDeRecepcion_parte_existe';
  END IF;
  IF v_factura IS DISTINCT FROM NEW."facturaProveedorId" THEN
    RAISE EXCEPTION 'el renglón no es de la factura de la parte' USING ERRCODE = '23514', CONSTRAINT = 'ControlDeLineaDeRecepcion_misma_factura';
  END IF;
  IF v_estado IS DISTINCT FROM 'PENDIENTE' THEN
    RAISE EXCEPTION 'el control solo se registra mientras la compra está pendiente de recibir' USING ERRCODE = '23514', CONSTRAINT = 'ControlDeLineaDeRecepcion_parte_pendiente';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "ControlDeLineaDeRecepcion_validar" BEFORE INSERT ON "ControlDeLineaDeRecepcion" FOR EACH ROW EXECUTE FUNCTION compras_control_de_linea_validar();

-- RLS por empresa
ALTER TABLE "ControlDeLineaDeRecepcion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ControlDeLineaDeRecepcion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen): solo se agrega. Sin UPDATE, DELETE ni TRUNCATE. La consola de plataforma no la toca.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "ControlDeLineaDeRecepcion" FROM motor2_app;
    GRANT SELECT, INSERT ON "ControlDeLineaDeRecepcion" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "ControlDeLineaDeRecepcion" FROM motor2_plataforma;
  END IF;
END
$$;
