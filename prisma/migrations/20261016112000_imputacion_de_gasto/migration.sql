-- Paquete 3, M4.3 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): la IMPUTACIÓN POR SUCURSAL de un gasto (`ImputacionDeGasto`): cuánto del importe de un renglón SIN STOCK de la factura de proveedor
-- le toca a cada sucursal, y cuánto de ese importe es IVA computable. No toca `Operacion` ni el Kardex: un gasto no mueve stock. La parte de cada sucursal en la FACTURA (`FacturaProveedorSucursal`, M3) sigue siendo la que dice qué sucursales participan; esta tabla
-- dice cuánto dinero del renglón es de cada una.
--
-- DE LA SUCURSAL (`PROPIA`): lleva `sucursalId` NOT NULL con clave foránea compuesta (empresaId, sucursalId) → Sucursal. Sus políticas de RLS por sucursal van en la migración siguiente (M4.4, salida EXACTA del generador). Hasta entonces la tabla solo tiene la
-- RLS por empresa; la ventana no tiene consecuencias porque ningún código la lee ni la escribe hasta la Etapa C.
--
-- LA BASE IMPIDE IMPUTAR MERCADERÍA: la clave foránea es de TRES columnas — (empresaId, facturaProveedorRenglonId, naturalezaRenglon) → FacturaProveedorRenglon(empresaId, id, naturaleza) — y `naturalezaRenglon` es siempre 'SIN_STOCK' (CHECK y default). Así solo
-- se puede imputar un renglón SIN_STOCK (el índice único que lo permite lo creó M4.2), y la naturaleza de un renglón ya imputado no se puede cambiar (ON UPDATE RESTRICT; además la app no tiene UPDATE sobre el renglón). Ni siquiera el dueño puede violarlo.
--
-- UNA PARTE POR SUCURSAL: `UNIQUE (facturaProveedorRenglonId, sucursalId)`. La carga repetida o simultánea de la misma imputación no la duplica: la decide la base (23505), no una lectura previa.
--
-- DINERO (todo CON IVA incluido, DECIMAL(14,2), nunca float): `importe` MAYOR que cero (una sucursal sin parte no tiene fila) e `importeIvaComputable` entre 0 y el importe (D3 del dueño: el IVA computable por sucursal SE GUARDA, no se deriva al leer; con la perilla
-- de IVA apagada o sin IVA discriminado vale 0). Lo reparte la Etapa C en DOS pasos con `repartirImporte` (src/core/moneda.ts): primero el importe del renglón con los pesos del reparto y después el computable con pesos = los importes en centavos, con las sucursales
-- ordenadas por id; así nunca queda un computable mayor que su importe. Que Σ de los importes sea el `precioTotal` del renglón, que Σ de los computables sea el `importeIvaComputable` del renglón y que cada sucursal imputada tenga su `FacturaProveedorSucursal`
-- NO se pueden expresar en un CHECK (cruzan filas): los valida el caso de uso (Etapa C) y una consulta de coherencia del chequeo posterior (docs/deploy-con-migraciones.md).
--
-- SOLO SE AGREGA: `motor2_app` tiene SELECT e INSERT, NUNCA UPDATE ni DELETE (un error se corrige anulando la factura —`FacturaProveedor.anuladaEn`— y cargando de nuevo; el período sale de `FacturaProveedor.fecha`, así que esta tabla no tiene fecha propia). `motor2_plataforma` no
-- toca nada. Sin `porcentajeDeclaradoBp` (es de la parte de la factura) ni centro de costo (es de M7, que se apoya en `ImputacionDeGasto (empresaId, id)`).
--
-- ADITIVA: tabla nueva y vacía; índices sin CONCURRENTLY, en la misma transacción (Prisma corre el archivo entero en una): caen sobre 0 filas.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261016112000_imputacion_de_gasto`). DESTRUCTIVA si ya hay imputaciones. Bajar ANTES M4.4 (las políticas) y antes que M4.2.

CREATE TABLE "ImputacionDeGasto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorRenglonId" TEXT NOT NULL,
    "naturalezaRenglon" TEXT NOT NULL DEFAULT 'SIN_STOCK',
    "sucursalId" TEXT NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,
    "importeIvaComputable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImputacionDeGasto_pkey" PRIMARY KEY ("id")
);

-- (empresaId, id): destino de las claves foráneas compuestas (el centro de costo de M7).
CREATE UNIQUE INDEX "ImputacionDeGasto_empresaId_id_key" ON "ImputacionDeGasto"("empresaId", "id");
-- Una sola parte por (renglón, sucursal).
CREATE UNIQUE INDEX "ImputacionDeGasto_facturaProveedorRenglonId_sucursalId_key" ON "ImputacionDeGasto"("facturaProveedorRenglonId", "sucursalId");
CREATE INDEX "ImputacionDeGasto_sucursalId_idx" ON "ImputacionDeGasto"("sucursalId");

ALTER TABLE "ImputacionDeGasto" ADD CONSTRAINT "ImputacionDeGasto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- La clave foránea CON DISCRIMINADOR (el nombre, el que Prisma deriva y trunca a 63 caracteres): solo un renglón SIN_STOCK se puede imputar, y su naturaleza no se puede cambiar mientras tenga imputaciones.
ALTER TABLE "ImputacionDeGasto" ADD CONSTRAINT "ImputacionDeGasto_empresaId_facturaProveedorRenglonId_natu_fkey"
  FOREIGN KEY ("empresaId", "facturaProveedorRenglonId", "naturalezaRenglon") REFERENCES "FacturaProveedorRenglon"("empresaId", "id", "naturaleza") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ImputacionDeGasto" ADD CONSTRAINT "ImputacionDeGasto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImputacionDeGasto" ADD CONSTRAINT "ImputacionDeGasto_naturaleza_chk" CHECK ("naturalezaRenglon" = 'SIN_STOCK');
ALTER TABLE "ImputacionDeGasto" ADD CONSTRAINT "ImputacionDeGasto_importe_positivo_chk" CHECK ("importe" > 0);
ALTER TABLE "ImputacionDeGasto" ADD CONSTRAINT "ImputacionDeGasto_iva_computable_chk" CHECK ("importeIvaComputable" >= 0 AND "importeIvaComputable" <= "importe");

ALTER TABLE "ImputacionDeGasto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ImputacionDeGasto"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen: en una base de test o recién creada pueden no estar). Los privilegios por defecto le dan DML completo a `motor2_app` sobre las tablas nuevas: se le quitan TODOS y se le devuelve lo mínimo (solo agregar).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "ImputacionDeGasto" FROM motor2_app;
    GRANT SELECT, INSERT ON "ImputacionDeGasto" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "ImputacionDeGasto" FROM motor2_plataforma;
  END IF;
END
$$;
