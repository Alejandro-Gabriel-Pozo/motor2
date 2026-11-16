-- COMPRAS, ORDEN DE COMPRA, etapa OC (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo y ensayo).
-- Diseño: docs/diseno-compras-n3b-n4-etapas-2026-11-16.md §«Etapa OC», CORREGIDO por docs/diseno-compras-contraste-sql-pedernal-2026-11-16.md §3 (contraste con el SQL real de Pedernal).
-- Referencia de forma y resultado: Pedernal, `ZuluHub-docs/11-especificaciones/sql-compras-pendientes/0066_compras_ordenes.sql` (publicada, NO aplicada, puede cambiar hasta su merge).
-- Decisiones del dueño (Pedernal, 2026-11-16, DDD:197 y DDD:5A): una orden de compra NO necesita aprobación de una segunda persona; crear, pedir, cerrar y anular la hace quien administra o gerencia, no el operador (el permiso vive en el
-- catálogo de acciones, no acá). Motor2: «Compras: orden de compra, tres vías y notas de crédito, como las decidió Pedernal, una por vez, en local y sin aplicar nada a ninguna base» (2026-11-16, relatado por el orquestador general).
--
-- QUÉ HACE (ADITIVA: el código anterior no la lee ni la escribe; una compra sin orden sigue exactamente igual): cinco tablas nuevas y tres disparadores sobre tablas existentes.
--   OrdenDeCompra            la orden: BORRADOR -> PEDIDA -> CERRADA | ANULADA (CERRADA y ANULADA son finales). «Recibida parcial» o «recibida» NO se guardan: se calculan del saldo. Sin cierre automático (como Pedernal: cierra a mano).
--   LineaDeOrdenDeCompra     las líneas (producto, cantidad pedida en la unidad de STOCK del producto, precio por unidad de stock opcional >= 0, `retirada`).
--   SaldoDeLineaDeOrden      lo recibido contra cada línea; nace al pedir y SOLO lo mueven disparadores anidados (como Pedernal: tabla, no cálculo).
--   VinculoDeRenglonConOrden «este renglón de la compra pendiente es contra esta línea de la orden» (por renglón, como `linea_de_recepcion_de_orden` de Pedernal) con `confirmoExceso`.
--   NivelDeControl           el nivel (PERMITIR | AVISAR | BLOQUEAR) de un control de la empresa; hoy uno solo: `compras.recepcion_excede_la_orden`. SIN FILA = PERMITIR (como Pedernal).
-- Disparadores sobre tablas existentes: al CONFIRMAR la recepción de una parte (PENDIENTE -> RECIBIDA) se suma lo recibido (sin las líneas RECHAZADAS por el control) al saldo de su línea de orden con UN UPDATE condicionado (el tope
-- viaja en el WHERE cuando el control está en BLOQUEAR, o en AVISAR sin `confirmoExceso`); al ANULAR una factura cuya parte ya estaba recibida se devuelve lo sumado.
--
-- DIFERENCIAS CON PEDERNAL 0066 (cada una con su motivo; todo lo demás es igual de forma y resultado):
--   * Motor2 no tiene `recepcion` propia: la recepción es la parte de la factura (`FacturaProveedorSucursal`) y su renglón; el vínculo cuelga de ellos (motivo: datos existentes y «Toda compra sigue llevando factura», dueño, 2026-11-16).
--   * El momento (`pedidaEn`, `fechaDeNegocio`, `cerradaEn`, `anuladaEn`) lo manda el caso de uso con el reloj inyectado (la ficha `reloj=INYECTADO` del repo); la base exige que vayan juntos con el estado (CHECK) y fija el NÚMERO
--     (candado por empresa + max+1) y el motivo de cierre (COMPLETA | CON_SALDO), que son lo que Pedernal también decide en la base.
--   * La clave de idempotencia es única GLOBAL (como `FacturaProveedor`, ADR-028) y no por empresa; el formato de la clave es el del repo (uuid de la pantalla), con el largo de Pedernal (16 a 128).
--   * El precio por unidad es `Decimal(14,4)` (como `FacturaProveedorRenglon.precioPorUnidadStock`) y no `numeric(18,6)`; las cantidades, `Decimal(14,4)` (como el renglón) y no `numeric(18,4)`. Sin moneda: Motor2 es de un solo peso (NO VERIFICADO el caso multimoneda).
--   * Una sola exigencia de «vínculo en la transacción de su cabecera» se traduce a: la parte debe seguir PENDIENTE al registrar el vínculo (con `FOR SHARE` de la parte, como el control N3-b).
--   * El saldo, el vínculo y la orden no admiten UPDATE/DELETE desde la app salvo lo declarado en los GRANT por columna (la app no tiene DELETE ni TRUNCATE de ninguna).
--   * La sucursal destino (opcional, informativa) se llama `sucursalId` y NULL = toda la empresa: así la RLS por sucursal de Motor2 la trata como «de una sucursal o de la empresa» (`PROPIA_O_EMPRESA`): una orden destinada a una
--     sucursal solo se ve y se usa desde ella (y desde quien tenga esa sucursal en su alcance). Sus líneas y saldos la heredan. Motivo: RLS (el guardián de alcance exige que toda tabla con FK a Sucursal tenga alcance declarado).
--   * `NivelDeControl` no lleva sucursal (Pedernal tiene `sucursal_id` pero solo lee la fila con `sucursal_id IS NULL`; nada de Motor2 lo usaría).
--
-- Forma de tabla nueva (molde E-0): id UUID (lo manda la aplicación), instantes TIMESTAMPTZ(3), sin DELETE. RLS por empresa (`aislamiento_empresa`); el vínculo, además, por sucursal (migración 20261117130100, alcance HEREDADA de su parte).
-- Índices sin CONCURRENTLY (tablas nuevas y vacías). Reversa: down.sql (a mano, como dueño; ABORTA si hay filas).

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['OrdenDeCompra', 'LineaDeOrdenDeCompra', 'SaldoDeLineaDeOrden', 'VinculoDeRenglonConOrden', 'NivelDeControl'] LOOP
    IF to_regclass('public."' || v_tabla || '"') IS NOT NULL THEN
      RAISE EXCEPTION 'compras_orden_de_compra: la tabla "%" ya existe; esta migración solo crea objetos nuevos', v_tabla USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF to_regclass('public."FacturaProveedorSucursal"') IS NULL OR to_regclass('public."FacturaProveedorRenglon"') IS NULL OR to_regclass('public."ControlDeLineaDeRecepcion"') IS NULL
     OR to_regclass('public."Proveedor"') IS NULL OR to_regclass('public."Producto"') IS NULL OR to_regclass('public."Sucursal"') IS NULL OR to_regclass('public."User"') IS NULL
     OR to_regprocedure('public.app_empresa_actual()') IS NULL THEN
    RAISE EXCEPTION 'compras_orden_de_compra: faltan la recepción de compras N3-b ("ControlDeLineaDeRecepcion"), las tablas de la factura de proveedor, Proveedor, Producto, Sucursal, "User" o app_empresa_actual()' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ================================================================================================
-- Tablas
-- ================================================================================================

-- La observación/motivo: lista de PERMITIDOS (la misma de `ControlDeLineaDeRecepcion_observacion_chk`), de 1 a 500, sin blancos en los extremos y sin empezar con `+` ni `-`.

-- CreateTable
CREATE TABLE "OrdenDeCompra" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "numero" INTEGER,
    "proveedorId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "fechaDeEntregaPrevista" DATE,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "cierreMotivo" TEXT,
    "claveIdempotencia" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "pedidaPorId" TEXT,
    "pedidaEn" TIMESTAMPTZ(3),
    "fechaDeNegocio" DATE,
    "cerradaPorId" TEXT,
    "cerradaEn" TIMESTAMPTZ(3),
    "anuladaPorId" TEXT,
    "anuladaEn" TIMESTAMPTZ(3),
    "motivoDeAnulacion" TEXT,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OrdenDeCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineaDeOrdenDeCompra" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "ordenId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidadPedida" DECIMAL(14,4) NOT NULL,
    "precioPorUnidadStock" DECIMAL(14,4),
    "retirada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LineaDeOrdenDeCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaldoDeLineaDeOrden" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "ordenId" UUID NOT NULL,
    "linea" INTEGER NOT NULL,
    "cantidadPedida" DECIMAL(14,4) NOT NULL,
    "cantidadRecibida" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "SaldoDeLineaDeOrden_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VinculoDeRenglonConOrden" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorId" TEXT NOT NULL,
    "facturaProveedorSucursalId" TEXT NOT NULL,
    "facturaProveedorRenglonId" TEXT NOT NULL,
    "ordenId" UUID NOT NULL,
    "lineaDeOrden" INTEGER NOT NULL,
    "confirmoExceso" BOOLEAN NOT NULL DEFAULT false,
    "registradoPorId" TEXT NOT NULL,
    "registradoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "VinculoDeRenglonConOrden_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NivelDeControl" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "control" TEXT NOT NULL,
    "nivel" TEXT NOT NULL,
    "actualizadoPorId" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NivelDeControl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrdenDeCompra_empresaId_id_key" ON "OrdenDeCompra"("empresaId", "id");
CREATE UNIQUE INDEX "OrdenDeCompra_empresaId_numero_key" ON "OrdenDeCompra"("empresaId", "numero");
CREATE UNIQUE INDEX "OrdenDeCompra_claveIdempotencia_key" ON "OrdenDeCompra"("claveIdempotencia");
CREATE INDEX "OrdenDeCompra_empresaId_proveedorId_estado_idx" ON "OrdenDeCompra"("empresaId", "proveedorId", "estado");
CREATE UNIQUE INDEX "LineaDeOrdenDeCompra_empresaId_id_key" ON "LineaDeOrdenDeCompra"("empresaId", "id");
CREATE UNIQUE INDEX "LineaDeOrdenDeCompra_empresaId_ordenId_numero_key" ON "LineaDeOrdenDeCompra"("empresaId", "ordenId", "numero");
CREATE INDEX "LineaDeOrdenDeCompra_productoId_idx" ON "LineaDeOrdenDeCompra"("productoId");
CREATE UNIQUE INDEX "SaldoDeLineaDeOrden_empresaId_id_key" ON "SaldoDeLineaDeOrden"("empresaId", "id");
CREATE UNIQUE INDEX "SaldoDeLineaDeOrden_empresaId_ordenId_linea_key" ON "SaldoDeLineaDeOrden"("empresaId", "ordenId", "linea");
CREATE UNIQUE INDEX "VinculoDeRenglonConOrden_empresaId_id_key" ON "VinculoDeRenglonConOrden"("empresaId", "id");
CREATE UNIQUE INDEX "VinculoDeRenglonConOrden_parte_renglon_key" ON "VinculoDeRenglonConOrden"("empresaId", "facturaProveedorSucursalId", "facturaProveedorRenglonId");
CREATE INDEX "VinculoDeRenglonConOrden_empresaId_ordenId_lineaDeOrden_idx" ON "VinculoDeRenglonConOrden"("empresaId", "ordenId", "lineaDeOrden");
CREATE INDEX "VinculoDeRenglonConOrden_facturaProveedorRenglonId_idx" ON "VinculoDeRenglonConOrden"("facturaProveedorRenglonId");
CREATE UNIQUE INDEX "NivelDeControl_empresaId_id_key" ON "NivelDeControl"("empresaId", "id");
CREATE UNIQUE INDEX "NivelDeControl_empresaId_control_key" ON "NivelDeControl"("empresaId", "control");

-- AddForeignKey: todas entre tablas de empresa son COMPUESTAS (la fila referida es de la misma empresa).
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_proveedor_fkey" FOREIGN KEY ("empresaId", "proveedorId") REFERENCES "Proveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_sucursal_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_pedidaPorId_fkey" FOREIGN KEY ("pedidaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_cerradaPorId_fkey" FOREIGN KEY ("cerradaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_anuladaPorId_fkey" FOREIGN KEY ("anuladaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineaDeOrdenDeCompra" ADD CONSTRAINT "LineaDeOrdenDeCompra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineaDeOrdenDeCompra" ADD CONSTRAINT "LineaDeOrdenDeCompra_orden_fkey" FOREIGN KEY ("empresaId", "ordenId") REFERENCES "OrdenDeCompra"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineaDeOrdenDeCompra" ADD CONSTRAINT "LineaDeOrdenDeCompra_producto_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaldoDeLineaDeOrden" ADD CONSTRAINT "SaldoDeLineaDeOrden_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaldoDeLineaDeOrden" ADD CONSTRAINT "SaldoDeLineaDeOrden_orden_fkey" FOREIGN KEY ("empresaId", "ordenId") REFERENCES "OrdenDeCompra"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaldoDeLineaDeOrden" ADD CONSTRAINT "SaldoDeLineaDeOrden_linea_fkey" FOREIGN KEY ("empresaId", "ordenId", "linea") REFERENCES "LineaDeOrdenDeCompra"("empresaId", "ordenId", "numero") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VinculoDeRenglonConOrden" ADD CONSTRAINT "VinculoDeRenglonConOrden_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- El renglón es de LA factura que dice la fila (y de la empresa); la parte es de la empresa (que sea de la misma factura y siga PENDIENTE lo exige el disparador).
ALTER TABLE "VinculoDeRenglonConOrden" ADD CONSTRAINT "VinculoDeRenglonConOrden_renglon_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId", "facturaProveedorRenglonId") REFERENCES "FacturaProveedorRenglon"("empresaId", "facturaProveedorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VinculoDeRenglonConOrden" ADD CONSTRAINT "VinculoDeRenglonConOrden_parte_fkey" FOREIGN KEY ("empresaId", "facturaProveedorSucursalId") REFERENCES "FacturaProveedorSucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VinculoDeRenglonConOrden" ADD CONSTRAINT "VinculoDeRenglonConOrden_orden_fkey" FOREIGN KEY ("empresaId", "ordenId") REFERENCES "OrdenDeCompra"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VinculoDeRenglonConOrden" ADD CONSTRAINT "VinculoDeRenglonConOrden_lineaDeOrden_fkey" FOREIGN KEY ("empresaId", "ordenId", "lineaDeOrden") REFERENCES "LineaDeOrdenDeCompra"("empresaId", "ordenId", "numero") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VinculoDeRenglonConOrden" ADD CONSTRAINT "VinculoDeRenglonConOrden_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NivelDeControl" ADD CONSTRAINT "NivelDeControl_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NivelDeControl" ADD CONSTRAINT "NivelDeControl_actualizadoPorId_fkey" FOREIGN KEY ("actualizadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas (CHECK con nombre). Todo CHECK compuesto va envuelto en coalesce(..., false): un NULL en una rama haría pasar la fila.
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_numero_chk" CHECK ("numero" IS NULL OR "numero" > 0);
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_estado_chk" CHECK ("estado" IN ('BORRADOR', 'PEDIDA', 'CERRADA', 'ANULADA'));
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_cierreMotivo_chk" CHECK ("cierreMotivo" IS NULL OR "cierreMotivo" IN ('COMPLETA', 'CON_SALDO'));
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_clave_chk" CHECK ("claveIdempotencia" ~ '^[A-Za-z0-9_-]{16,128}$');
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_payloadHash_chk" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_motivoDeAnulacion_chk" CHECK ("motivoDeAnulacion" IS NULL OR coalesce(
    char_length("motivoDeAnulacion") BETWEEN 1 AND 500
    AND "motivoDeAnulacion" = btrim("motivoDeAnulacion")
    AND "motivoDeAnulacion" ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°:;"#ºª’“”–—«»®™¿¡?!%$''][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°+:;"#ºª’“”–—«»®™¿¡?!%$'' -]*$', false));
-- Número y momento de pedido van juntos; un borrador no los tiene; pedida y cerrada sí.
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_pedido_chk" CHECK (coalesce(
    ("numero" IS NULL) = ("pedidaEn" IS NULL) AND ("numero" IS NULL) = ("pedidaPorId" IS NULL) AND ("numero" IS NULL) = ("fechaDeNegocio" IS NULL)
    AND ("estado" NOT IN ('PEDIDA', 'CERRADA') OR "numero" IS NOT NULL) AND ("estado" <> 'BORRADOR' OR "numero" IS NULL), false));
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_cierre_chk" CHECK (coalesce(
    ("estado" = 'CERRADA') = ("cierreMotivo" IS NOT NULL AND "cerradaPorId" IS NOT NULL AND "cerradaEn" IS NOT NULL), false));
ALTER TABLE "OrdenDeCompra" ADD CONSTRAINT "OrdenDeCompra_anulacion_chk" CHECK (coalesce(
    ("estado" = 'ANULADA') = ("anuladaPorId" IS NOT NULL AND "anuladaEn" IS NOT NULL AND "motivoDeAnulacion" IS NOT NULL), false));
ALTER TABLE "LineaDeOrdenDeCompra" ADD CONSTRAINT "LineaDeOrdenDeCompra_numero_chk" CHECK ("numero" >= 1);
ALTER TABLE "LineaDeOrdenDeCompra" ADD CONSTRAINT "LineaDeOrdenDeCompra_cantidadPedida_chk" CHECK ("cantidadPedida" > 0 AND "cantidadPedida" < 100000000000);
ALTER TABLE "LineaDeOrdenDeCompra" ADD CONSTRAINT "LineaDeOrdenDeCompra_precio_chk" CHECK ("precioPorUnidadStock" IS NULL OR ("precioPorUnidadStock" >= 0 AND "precioPorUnidadStock" < 10000000000));
ALTER TABLE "SaldoDeLineaDeOrden" ADD CONSTRAINT "SaldoDeLineaDeOrden_cantidadPedida_chk" CHECK ("cantidadPedida" > 0);
ALTER TABLE "SaldoDeLineaDeOrden" ADD CONSTRAINT "SaldoDeLineaDeOrden_cantidadRecibida_chk" CHECK ("cantidadRecibida" >= 0);
ALTER TABLE "VinculoDeRenglonConOrden" ADD CONSTRAINT "VinculoDeRenglonConOrden_lineaDeOrden_chk" CHECK ("lineaDeOrden" >= 1);
ALTER TABLE "NivelDeControl" ADD CONSTRAINT "NivelDeControl_control_chk" CHECK ("control" IN ('compras.recepcion_excede_la_orden'));
ALTER TABLE "NivelDeControl" ADD CONSTRAINT "NivelDeControl_nivel_chk" CHECK ("nivel" IN ('PERMITIR', 'AVISAR', 'BLOQUEAR'));

-- ================================================================================================
-- Disparadores
-- ================================================================================================

-- Cambio de la orden: en BORRADOR se editan proveedor, sucursal y entrega; desde PEDIDA solo cambia de estado. Transiciones impuestas: BORRADOR -> PEDIDA | ANULADA; PEDIDA -> CERRADA | ANULADA.
-- Al pasar a PEDIDA la base fija el NÚMERO (max+1 de la empresa bajo un candado por empresa: dos pedidos a la vez no repiten número); al pasar a CERRADA, el motivo de cierre.
CREATE FUNCTION compras_orden_cambia() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_libres text[] := ARRAY['estado', 'cierreMotivo', 'pedidaPorId', 'pedidaEn', 'numero', 'fechaDeNegocio', 'cerradaPorId', 'cerradaEn', 'anuladaPorId', 'anuladaEn',
                           'motivoDeAnulacion', 'version', 'actualizadoEn'];
  v_incompletas bigint;
BEGIN
  IF OLD."estado" = 'BORRADOR' THEN
    v_libres := v_libres || ARRAY['proveedorId', 'sucursalId', 'fechaDeEntregaPrevista'];
  END IF;
  IF (to_jsonb(NEW) - v_libres) IS DISTINCT FROM (to_jsonb(OLD) - v_libres) THEN
    RAISE EXCEPTION 'una orden pedida solo cambia de estado: el resto es inmutable' USING ERRCODE = '23514', CONSTRAINT = 'orden_inmutable';
  END IF;
  NEW."version" := OLD."version" + 1;
  NEW."actualizadoEn" := now();
  IF NEW."estado" = OLD."estado" THEN
    IF (NEW."numero" IS DISTINCT FROM OLD."numero" OR NEW."pedidaEn" IS DISTINCT FROM OLD."pedidaEn" OR NEW."cierreMotivo" IS DISTINCT FROM OLD."cierreMotivo"
        OR NEW."cerradaEn" IS DISTINCT FROM OLD."cerradaEn" OR NEW."anuladaEn" IS DISTINCT FROM OLD."anuladaEn" OR NEW."fechaDeNegocio" IS DISTINCT FROM OLD."fechaDeNegocio") THEN
      RAISE EXCEPTION 'el número, la fecha y el motivo de cierre solo se fijan al cambiar de estado' USING ERRCODE = '23514', CONSTRAINT = 'orden_inmutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD."estado" = 'BORRADOR' AND NEW."estado" IN ('PEDIDA', 'ANULADA')) OR (OLD."estado" = 'PEDIDA' AND NEW."estado" IN ('CERRADA', 'ANULADA'))) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD."estado", NEW."estado" USING ERRCODE = '23514', CONSTRAINT = 'orden_transicion_invalida';
  END IF;
  -- Lo que la base fija al cambiar de estado no lo manda la aplicación.
  NEW."numero" := OLD."numero";
  NEW."cierreMotivo" := NULL;
  IF NEW."estado" = 'PEDIDA' THEN
    IF NEW."fechaDeEntregaPrevista" IS NOT NULL AND NEW."fechaDeNegocio" IS NOT NULL AND NEW."fechaDeEntregaPrevista" < NEW."fechaDeNegocio" THEN
      RAISE EXCEPTION 'la entrega prevista es anterior al día del pedido' USING ERRCODE = '23514', CONSTRAINT = 'orden_entrega_anterior_al_pedido';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public."LineaDeOrdenDeCompra" l WHERE l."ordenId" = NEW."id" AND l."empresaId" = NEW."empresaId" AND NOT l."retirada") THEN
      RAISE EXCEPTION 'una orden sin líneas no se pide' USING ERRCODE = '23514', CONSTRAINT = 'orden_sin_lineas';
    END IF;
    -- Un candado por empresa serializa la numeración: dos pedidos a la vez no toman el mismo número.
    PERFORM pg_advisory_xact_lock(hashtextextended('OrdenDeCompra:' || NEW."empresaId", 0));
    SELECT coalesce(max(o."numero"), 0) + 1 INTO NEW."numero" FROM public."OrdenDeCompra" o WHERE o."empresaId" = NEW."empresaId";
  ELSIF NEW."estado" = 'CERRADA' THEN
    IF EXISTS (SELECT 1 FROM public."VinculoDeRenglonConOrden" v
                 JOIN public."FacturaProveedorSucursal" p ON p."id" = v."facturaProveedorSucursalId" AND p."empresaId" = v."empresaId"
                 JOIN public."FacturaProveedor" f ON f."id" = p."facturaProveedorId" AND f."empresaId" = p."empresaId"
                WHERE v."ordenId" = NEW."id" AND v."empresaId" = NEW."empresaId" AND f."anuladaEn" IS NULL AND p."estadoRecepcion" = 'PENDIENTE') THEN
      RAISE EXCEPTION 'la orden tiene recepciones pendientes de confirmar' USING ERRCODE = '23514', CONSTRAINT = 'orden_con_recepciones_pendientes';
    END IF;
    SELECT count(*) INTO v_incompletas FROM public."SaldoDeLineaDeOrden" s
     WHERE s."ordenId" = NEW."id" AND s."empresaId" = NEW."empresaId" AND s."cantidadRecibida" < s."cantidadPedida";
    NEW."cierreMotivo" := CASE WHEN v_incompletas = 0 THEN 'COMPLETA' ELSE 'CON_SALDO' END;
  ELSE
    IF EXISTS (SELECT 1 FROM public."VinculoDeRenglonConOrden" v
                 JOIN public."FacturaProveedorSucursal" p ON p."id" = v."facturaProveedorSucursalId" AND p."empresaId" = v."empresaId"
                 JOIN public."FacturaProveedor" f ON f."id" = p."facturaProveedorId" AND f."empresaId" = p."empresaId"
                WHERE v."ordenId" = NEW."id" AND v."empresaId" = NEW."empresaId" AND f."anuladaEn" IS NULL) THEN
      RAISE EXCEPTION 'la orden tiene recepciones vigentes' USING ERRCODE = '23514', CONSTRAINT = 'orden_con_recepciones';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "OrdenDeCompra_1_cambio" BEFORE UPDATE ON "OrdenDeCompra" FOR EACH ROW EXECUTE FUNCTION compras_orden_cambia();

-- Al pedir nace el saldo de cada línea que no se retiró.
CREATE FUNCTION compras_orden_abre_saldos() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  INSERT INTO public."SaldoDeLineaDeOrden" ("id", "empresaId", "ordenId", "linea", "cantidadPedida")
  SELECT gen_random_uuid(), l."empresaId", l."ordenId", l."numero", l."cantidadPedida" FROM public."LineaDeOrdenDeCompra" l
   WHERE l."ordenId" = NEW."id" AND l."empresaId" = NEW."empresaId" AND NOT l."retirada";
  RETURN NULL;
END
$$;
CREATE TRIGGER "OrdenDeCompra_abre_saldos" AFTER UPDATE OF "estado" ON "OrdenDeCompra" FOR EACH ROW WHEN (OLD."estado" = 'BORRADOR' AND NEW."estado" = 'PEDIDA')
  EXECUTE FUNCTION compras_orden_abre_saldos();

-- Las líneas entran y se editan solo mientras la orden es BORRADOR; de una línea solo cambian la cantidad, el precio y si se retiró.
CREATE FUNCTION compras_linea_de_orden_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
BEGIN
  SELECT o."estado" INTO v_estado FROM public."OrdenDeCompra" o WHERE o."id" = NEW."ordenId" AND o."empresaId" = NEW."empresaId" FOR SHARE;
  IF v_estado IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'las líneas de una orden pedida no se tocan' USING ERRCODE = '23514', CONSTRAINT = 'linea_de_orden_orden_pedida';
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['cantidadPedida', 'precioPorUnidadStock', 'retirada']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['cantidadPedida', 'precioPorUnidadStock', 'retirada']) THEN
    RAISE EXCEPTION 'de una línea solo cambian la cantidad, el precio y si se retiró' USING ERRCODE = '23514', CONSTRAINT = 'linea_de_orden_inmutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "LineaDeOrdenDeCompra_valida" BEFORE INSERT OR UPDATE ON "LineaDeOrdenDeCompra" FOR EACH ROW EXECUTE FUNCTION compras_linea_de_orden_valida();

-- El saldo lo escribe solo un disparador anidado (el de abrir saldos, el de confirmar la recepción o el de anular la factura).
CREATE FUNCTION compras_saldo_de_orden_solo_por_disparadores() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'el saldo de una línea de la orden lo escriben solo los disparadores' USING ERRCODE = '42501', CONSTRAINT = 'saldo_de_orden_solo_por_disparadores';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "SaldoDeLineaDeOrden_solo_por_disparadores" BEFORE INSERT OR UPDATE ON "SaldoDeLineaDeOrden" FOR EACH ROW EXECUTE FUNCTION compras_saldo_de_orden_solo_por_disparadores();

-- Registrar un renglón de una compra pendiente contra una línea de orden: la orden está PEDIDA (la fila se bloquea en modo compartido contra un cierre o una anulación simultáneos), mismo proveedor, mismo producto, línea no retirada,
-- la parte sigue PENDIENTE y es de la factura del renglón. Si el renglón no quedó RECHAZADO por el control (el control solo existe ANTES de confirmar, así que acá todavía no hay) y ya se pasa del tope (con lo ya sumado), avisa desde acá
-- (aviso temprano: el tope firme se impone al confirmar).
CREATE FUNCTION compras_vinculo_de_orden_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_prov_orden text;
  v_factura text;
  v_estado_parte text;
  v_prov_factura text;
  v_retirada boolean;
  v_producto_orden text;
  v_producto_renglon text;
  v_cantidad numeric;
  v_nivel text;
  v_exige boolean;
BEGIN
  SELECT o."estado", o."proveedorId" INTO v_estado, v_prov_orden FROM public."OrdenDeCompra" o WHERE o."id" = NEW."ordenId" AND o."empresaId" = NEW."empresaId" FOR SHARE;
  IF v_estado IS DISTINCT FROM 'PEDIDA' THEN
    RAISE EXCEPTION 'se recibe contra una orden pedida' USING ERRCODE = '23514', CONSTRAINT = 'orden_no_pedida';
  END IF;
  SELECT p."facturaProveedorId", p."estadoRecepcion" INTO v_factura, v_estado_parte
    FROM public."FacturaProveedorSucursal" p WHERE p."id" = NEW."facturaProveedorSucursalId" AND p."empresaId" = NEW."empresaId" FOR SHARE;
  IF v_factura IS NULL THEN
    RAISE EXCEPTION 'la parte de la compra no existe o no es de esta sucursal' USING ERRCODE = '23514', CONSTRAINT = 'VinculoDeRenglonConOrden_parte_existe';
  END IF;
  IF v_factura IS DISTINCT FROM NEW."facturaProveedorId" THEN
    RAISE EXCEPTION 'el renglón no es de la factura de la parte' USING ERRCODE = '23514', CONSTRAINT = 'VinculoDeRenglonConOrden_misma_factura';
  END IF;
  IF v_estado_parte IS DISTINCT FROM 'PENDIENTE' THEN
    RAISE EXCEPTION 'el vínculo con la orden solo se registra mientras la compra está pendiente de recibir' USING ERRCODE = '23514', CONSTRAINT = 'VinculoDeRenglonConOrden_parte_pendiente';
  END IF;
  SELECT f."proveedorId" INTO v_prov_factura FROM public."FacturaProveedor" f WHERE f."id" = NEW."facturaProveedorId" AND f."empresaId" = NEW."empresaId";
  IF v_prov_factura IS DISTINCT FROM v_prov_orden THEN
    RAISE EXCEPTION 'el proveedor de la compra no es el de la orden' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_de_orden_proveedor_distinto';
  END IF;
  SELECT l."retirada", l."productoId" INTO v_retirada, v_producto_orden FROM public."LineaDeOrdenDeCompra" l
   WHERE l."empresaId" = NEW."empresaId" AND l."ordenId" = NEW."ordenId" AND l."numero" = NEW."lineaDeOrden";
  IF v_retirada THEN
    RAISE EXCEPTION 'la línea de la orden se retiró' USING ERRCODE = '23514', CONSTRAINT = 'linea_de_orden_retirada';
  END IF;
  SELECT r."cantidadStock", r."productoId" INTO v_cantidad, v_producto_renglon FROM public."FacturaProveedorRenglon" r
   WHERE r."empresaId" = NEW."empresaId" AND r."facturaProveedorId" = NEW."facturaProveedorId" AND r."id" = NEW."facturaProveedorRenglonId";
  IF v_producto_renglon IS DISTINCT FROM v_producto_orden THEN
    RAISE EXCEPTION 'el producto del renglón no es el de la línea de la orden' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_de_orden_producto_distinto';
  END IF;
  v_nivel := coalesce((SELECT n."nivel" FROM public."NivelDeControl" n WHERE n."empresaId" = NEW."empresaId" AND n."control" = 'compras.recepcion_excede_la_orden'), 'PERMITIR');
  v_exige := v_nivel = 'BLOQUEAR' OR (v_nivel = 'AVISAR' AND NOT NEW."confirmoExceso");
  IF v_exige AND EXISTS (SELECT 1 FROM public."SaldoDeLineaDeOrden" s WHERE s."empresaId" = NEW."empresaId" AND s."ordenId" = NEW."ordenId" AND s."linea" = NEW."lineaDeOrden"
                          AND s."cantidadRecibida" + v_cantidad > s."cantidadPedida") THEN
    IF v_nivel = 'BLOQUEAR' THEN
      RAISE EXCEPTION 'la recepción supera lo pedido' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_bloqueada';
    END IF;
    RAISE EXCEPTION 'la recepción supera lo pedido y no se confirmó' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_sin_confirmar';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "VinculoDeRenglonConOrden_valida" BEFORE INSERT ON "VinculoDeRenglonConOrden" FOR EACH ROW EXECUTE FUNCTION compras_vinculo_de_orden_valida();

-- Confirmar la recepción suma lo aceptado (los renglones NO RECHAZADOS por el control) al saldo de la orden, con UN UPDATE condicionado por vínculo: el tope viaja en el WHERE (como el saldo de stock). Los renglones se toman en un orden
-- fijo (orden y línea) para que dos confirmaciones simultáneas no se bloqueen entre sí. Sin margen: la tolerancia llega con la etapa de tres vías.
CREATE FUNCTION compras_recepcion_confirmada_suma_a_la_orden() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_nivel text;
  v_exige boolean;
  v_estado text;
  v_nueva numeric;
  r record;
BEGIN
  v_nivel := coalesce((SELECT n."nivel" FROM public."NivelDeControl" n WHERE n."empresaId" = NEW."empresaId" AND n."control" = 'compras.recepcion_excede_la_orden'), 'PERMITIR');
  FOR r IN
    SELECT v."ordenId", v."lineaDeOrden", v."confirmoExceso", g."cantidadStock" AS cantidad
      FROM public."VinculoDeRenglonConOrden" v
      JOIN public."FacturaProveedorRenglon" g ON g."empresaId" = v."empresaId" AND g."facturaProveedorId" = v."facturaProveedorId" AND g."id" = v."facturaProveedorRenglonId"
     WHERE v."empresaId" = NEW."empresaId" AND v."facturaProveedorSucursalId" = NEW."id"
       AND NOT EXISTS (SELECT 1 FROM public."ControlDeLineaDeRecepcion" c WHERE c."empresaId" = v."empresaId" AND c."facturaProveedorSucursalId" = v."facturaProveedorSucursalId"
                        AND c."facturaProveedorRenglonId" = v."facturaProveedorRenglonId" AND c."condicion" = 'RECHAZADA')
     ORDER BY v."ordenId", v."lineaDeOrden"
  LOOP
    SELECT o."estado" INTO v_estado FROM public."OrdenDeCompra" o WHERE o."id" = r."ordenId" AND o."empresaId" = NEW."empresaId" FOR SHARE;
    IF v_estado IS DISTINCT FROM 'PEDIDA' THEN
      RAISE EXCEPTION 'se recibe contra una orden pedida' USING ERRCODE = '23514', CONSTRAINT = 'orden_no_pedida';
    END IF;
    v_exige := v_nivel = 'BLOQUEAR' OR (v_nivel = 'AVISAR' AND NOT r."confirmoExceso");
    UPDATE public."SaldoDeLineaDeOrden" s SET "cantidadRecibida" = s."cantidadRecibida" + r."cantidad", "actualizadoEn" = now()
     WHERE s."empresaId" = NEW."empresaId" AND s."ordenId" = r."ordenId" AND s."linea" = r."lineaDeOrden"
       AND (NOT v_exige OR s."cantidadRecibida" + r."cantidad" <= s."cantidadPedida")
    RETURNING s."cantidadRecibida" INTO v_nueva;
    IF v_nueva IS NULL THEN
      IF v_nivel = 'BLOQUEAR' THEN
        RAISE EXCEPTION 'la recepción supera lo pedido' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_bloqueada';
      END IF;
      RAISE EXCEPTION 'la recepción supera lo pedido y no se confirmó' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_sin_confirmar';
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
CREATE TRIGGER "FacturaProveedorSucursal_suma_a_la_orden" AFTER UPDATE OF "estadoRecepcion" ON "FacturaProveedorSucursal" FOR EACH ROW
  WHEN (OLD."estadoRecepcion" = 'PENDIENTE' AND NEW."estadoRecepcion" = 'RECIBIDA')
  EXECUTE FUNCTION compras_recepcion_confirmada_suma_a_la_orden();

-- Anular una factura cuya parte YA estaba recibida devuelve a la orden lo que había sumado (solo lo aceptado); si la parte seguía pendiente no devuelve nada porque nunca sumó.
CREATE FUNCTION compras_factura_anulada_devuelve_a_la_orden() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  UPDATE public."SaldoDeLineaDeOrden" s SET "cantidadRecibida" = s."cantidadRecibida" - x."cantidad", "actualizadoEn" = now()
    FROM (
      SELECT v."ordenId", v."lineaDeOrden", sum(g."cantidadStock") AS cantidad
        FROM public."VinculoDeRenglonConOrden" v
        JOIN public."FacturaProveedorSucursal" p ON p."id" = v."facturaProveedorSucursalId" AND p."empresaId" = v."empresaId"
        JOIN public."FacturaProveedorRenglon" g ON g."empresaId" = v."empresaId" AND g."facturaProveedorId" = v."facturaProveedorId" AND g."id" = v."facturaProveedorRenglonId"
       WHERE v."empresaId" = NEW."empresaId" AND v."facturaProveedorId" = NEW."id" AND p."estadoRecepcion" = 'RECIBIDA'
         AND NOT EXISTS (SELECT 1 FROM public."ControlDeLineaDeRecepcion" c WHERE c."empresaId" = v."empresaId" AND c."facturaProveedorSucursalId" = v."facturaProveedorSucursalId"
                          AND c."facturaProveedorRenglonId" = v."facturaProveedorRenglonId" AND c."condicion" = 'RECHAZADA')
       GROUP BY v."ordenId", v."lineaDeOrden"
    ) x
   WHERE s."empresaId" = NEW."empresaId" AND s."ordenId" = x."ordenId" AND s."linea" = x."lineaDeOrden";
  RETURN NULL;
END
$$;
CREATE TRIGGER "FacturaProveedor_devuelve_a_la_orden" AFTER UPDATE OF "anuladaEn" ON "FacturaProveedor" FOR EACH ROW
  WHEN (OLD."anuladaEn" IS NULL AND NEW."anuladaEn" IS NOT NULL)
  EXECUTE FUNCTION compras_factura_anulada_devuelve_a_la_orden();

-- ================================================================================================
-- RLS por empresa
-- ================================================================================================
ALTER TABLE "OrdenDeCompra" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineaDeOrdenDeCompra" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaldoDeLineaDeOrden" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VinculoDeRenglonConOrden" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NivelDeControl" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "OrdenDeCompra" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
CREATE POLICY aislamiento_empresa ON "LineaDeOrdenDeCompra" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
CREATE POLICY aislamiento_empresa ON "SaldoDeLineaDeOrden" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
CREATE POLICY aislamiento_empresa ON "VinculoDeRenglonConOrden" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
CREATE POLICY aislamiento_empresa ON "NivelDeControl" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen): solo se agrega, por columna. Sin DELETE ni TRUNCATE en ninguna. La consola de plataforma no las toca.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "OrdenDeCompra", "LineaDeOrdenDeCompra", "SaldoDeLineaDeOrden", "VinculoDeRenglonConOrden", "NivelDeControl" FROM motor2_app;
    GRANT SELECT ON "OrdenDeCompra", "LineaDeOrdenDeCompra", "SaldoDeLineaDeOrden", "VinculoDeRenglonConOrden", "NivelDeControl" TO motor2_app;
    GRANT INSERT ("id", "empresaId", "proveedorId", "sucursalId", "fechaDeEntregaPrevista", "claveIdempotencia", "payloadHash", "creadoPorId", "creadoEn") ON "OrdenDeCompra" TO motor2_app;
    GRANT UPDATE ("proveedorId", "sucursalId", "fechaDeEntregaPrevista", "estado", "pedidaPorId", "pedidaEn", "fechaDeNegocio", "cerradaPorId", "cerradaEn", "anuladaPorId", "anuladaEn", "motivoDeAnulacion") ON "OrdenDeCompra" TO motor2_app;
    GRANT INSERT ("id", "empresaId", "ordenId", "numero", "productoId", "cantidadPedida", "precioPorUnidadStock") ON "LineaDeOrdenDeCompra" TO motor2_app;
    GRANT UPDATE ("cantidadPedida", "precioPorUnidadStock", "retirada") ON "LineaDeOrdenDeCompra" TO motor2_app;
    GRANT INSERT ("id", "empresaId", "ordenId", "linea", "cantidadPedida") ON "SaldoDeLineaDeOrden" TO motor2_app;
    GRANT UPDATE ("cantidadRecibida", "actualizadoEn") ON "SaldoDeLineaDeOrden" TO motor2_app;
    GRANT INSERT ("id", "empresaId", "facturaProveedorId", "facturaProveedorSucursalId", "facturaProveedorRenglonId", "ordenId", "lineaDeOrden", "confirmoExceso", "registradoPorId", "registradoEn") ON "VinculoDeRenglonConOrden" TO motor2_app;
    GRANT INSERT ("id", "empresaId", "control", "nivel", "actualizadoPorId", "actualizadoEn") ON "NivelDeControl" TO motor2_app;
    GRANT UPDATE ("nivel", "actualizadoPorId", "actualizadoEn", "version") ON "NivelDeControl" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "OrdenDeCompra", "LineaDeOrdenDeCompra", "SaldoDeLineaDeOrden", "VinculoDeRenglonConOrden", "NivelDeControl" FROM motor2_plataforma;
  END IF;
END
$$;
