-- Paquete 4, M5 (C26; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): la RECLASIFICACIÓN versionada de un renglón SIN STOCK de la factura de proveedor (`ReclasificacionRenglon`): corrige el
-- concepto de gasto y el tipo de costo del renglón (cada versión es la foto completa de los dos). No toca importes (no tiene ninguna columna de dinero), ni `Operacion`, ni el Kardex: solo cambia en qué tipo de costo cae el importe cuando se lee (Etapa C).
--
-- DE LA EMPRESA (sin `sucursalId`, solo RLS por empresa): el renglón y su tipo de costo son UNA copia para toda la empresa, y el árbitro de la concurrencia (el único de abajo) tiene que ver las versiones de todas las sucursales; con una política por sucursal,
-- quien ve una sola sucursal no vería las versiones hechas desde otra y elegiría un número viejo. La autorización por sucursal (la clave `gasto_reclasificar` en cada sucursal con imputación del renglón) la valida el servidor en la Etapa C.
--
-- VERSIONES SIN NINGÚN UPDATE: la versión 0 es el propio renglón (no se escribe fila; la app no tiene UPDATE sobre el renglón). Cada reclasificación agrega `numero` = vigente + 1 con el concepto y el tipo de costo completos. La vigente es SIEMPRE la fila de
-- `numero` mayor y, si no hay ninguna, el renglón: derivado, nunca un flag. La versión rige desde `creadoEn` (instante UTC) y vale para el período original del gasto (`FacturaProveedor.fecha`): no hay fecha de vigencia propia.
--
-- UNA GANADORA: `UNIQUE (facturaProveedorRenglonId, numero)` decide entre reclasificaciones simultáneas del mismo renglón (23505 para las perdedoras), y sirve el índice de «la vigente». La clave de idempotencia es única GLOBAL (ADR-028) y se guarda con la
-- huella y el mensaje devuelto, para reproducirlo en un reintento (I3).
--
-- LA BASE IMPIDE RECLASIFICAR MERCADERÍA: la clave foránea es de TRES columnas — (empresaId, facturaProveedorRenglonId, naturalezaRenglon) → FacturaProveedorRenglon(empresaId, id, naturaleza) — y `naturalezaRenglon` es siempre 'SIN_STOCK' (CHECK y default). Reutiliza
-- el índice único de M4.2; la naturaleza de un renglón reclasificado no se puede cambiar (ON UPDATE RESTRICT) y el renglón no se puede borrar (ON DELETE RESTRICT). Ni siquiera el dueño puede violarlo.
--
-- SOLO SE AGREGA: `motor2_app` tiene SELECT e INSERT, NUNCA UPDATE ni DELETE; `motor2_plataforma` no toca nada. Sin disparador (regla de la etapa): el dueño, como dueño, sí puede hacer UPDATE (limitación declarada en el ADR-029).
--
-- ADITIVA: tabla nueva y vacía; índices sin CONCURRENTLY, en la misma transacción (Prisma corre el archivo entero en una): caen sobre 0 filas. Aplicar con SET lock_timeout = '5s' (las claves foráneas toman un instante SHARE ROW EXCLUSIVE sobre
-- FacturaProveedorRenglon, ConceptoDeGasto, User y Empresa).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261017100000_reclasificacion_renglon`). ABORTA si hay filas. Con esta migración subida, los down de M4.2 y de M4.1 fallan por dependencia, a propósito: bajar ANTES esta.

CREATE TABLE "ReclasificacionRenglon" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorRenglonId" TEXT NOT NULL,
    "naturalezaRenglon" TEXT NOT NULL DEFAULT 'SIN_STOCK',
    "numero" INTEGER NOT NULL,
    "conceptoGastoId" TEXT NOT NULL,
    "tipoDeCosto" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultadoMensaje" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReclasificacionRenglon_pkey" PRIMARY KEY ("id")
);

-- (empresaId, id): destino de futuras claves foráneas compuestas, por convención.
CREATE UNIQUE INDEX "ReclasificacionRenglon_empresaId_id_key" ON "ReclasificacionRenglon"("empresaId", "id");
-- Una sola versión por (renglón, número): el árbitro de la concurrencia.
CREATE UNIQUE INDEX "ReclasificacionRenglon_facturaProveedorRenglonId_numero_key" ON "ReclasificacionRenglon"("facturaProveedorRenglonId", "numero");
-- La clave de idempotencia, única global (ADR-028).
CREATE UNIQUE INDEX "ReclasificacionRenglon_claveIdempotencia_key" ON "ReclasificacionRenglon"("claveIdempotencia");
CREATE INDEX "ReclasificacionRenglon_conceptoGastoId_idx" ON "ReclasificacionRenglon"("conceptoGastoId");

ALTER TABLE "ReclasificacionRenglon" ADD CONSTRAINT "ReclasificacionRenglon_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- La clave foránea CON DISCRIMINADOR (el nombre, el que Prisma deriva y trunca a 63 caracteres): solo un renglón SIN_STOCK se puede reclasificar, y su naturaleza no se puede cambiar mientras tenga reclasificaciones.
ALTER TABLE "ReclasificacionRenglon" ADD CONSTRAINT "ReclasificacionRenglon_empresaId_facturaProveedorRenglonId_fkey"
  FOREIGN KEY ("empresaId", "facturaProveedorRenglonId", "naturalezaRenglon") REFERENCES "FacturaProveedorRenglon"("empresaId", "id", "naturaleza") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ReclasificacionRenglon" ADD CONSTRAINT "ReclasificacionRenglon_empresaId_conceptoGastoId_fkey" FOREIGN KEY ("empresaId", "conceptoGastoId") REFERENCES "ConceptoDeGasto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReclasificacionRenglon" ADD CONSTRAINT "ReclasificacionRenglon_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReclasificacionRenglon" ADD CONSTRAINT "ReclasificacionRenglon_naturaleza_chk" CHECK ("naturalezaRenglon" = 'SIN_STOCK');
ALTER TABLE "ReclasificacionRenglon" ADD CONSTRAINT "ReclasificacionRenglon_numero_chk" CHECK ("numero" >= 1);
ALTER TABLE "ReclasificacionRenglon" ADD CONSTRAINT "ReclasificacionRenglon_tipo_de_costo_chk"
  CHECK ("tipoDeCosto" IN ('COSTO_DE_VENTAS', 'GASTO_OPERATIVO', 'EXTRAORDINARIO', 'INVERSION', 'RESULTADO_FINANCIERO'));
-- El motivo: obligatorio, con al menos un carácter visible y hasta 200 (el mismo largo que el motivo de anulación).
ALTER TABLE "ReclasificacionRenglon" ADD CONSTRAINT "ReclasificacionRenglon_motivo_chk" CHECK ("motivo" ~ '\S' AND char_length("motivo") <= 200);

ALTER TABLE "ReclasificacionRenglon" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ReclasificacionRenglon"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen: en una base de test o recién creada pueden no estar). Los privilegios por defecto le dan DML completo a `motor2_app` sobre las tablas nuevas: se le quitan TODOS y se le devuelve lo mínimo (solo agregar).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "ReclasificacionRenglon" FROM motor2_app;
    GRANT SELECT, INSERT ON "ReclasificacionRenglon" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "ReclasificacionRenglon" FROM motor2_plataforma;
  END IF;
END
$$;
