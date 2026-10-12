-- Comprobante de "agregar al pedido" del salón (P3, I3; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Hasta hoy `agregarItems` no tiene clave de idempotencia: un doble clic o un reintento tras un corte de red agrega dos veces el mismo pedido a la cuenta. La pantalla manda ahora una
-- clave (UUID) y el servidor guarda acá UN comprobante por pedido agregado: la clave, la huella del pedido y el mensaje que se devolvió. Un reintento con la misma clave y la misma
-- huella devuelve ese mensaje sin escribir nada; con otra huella, el conflicto de idempotencia.
--
-- Por qué una tabla aparte y no columnas en `CuentaItem`: quitar un ítem sin enviar BORRA filas; si se borra la que llevaba la clave, un reintento volvería a agregar las demás. El
-- comprobante sobrevive a esos borrados.
--
-- La tabla es de empresa (RLS `aislamiento_empresa`) y solo se agrega: `motor2_app` tiene SELECT e INSERT, nunca UPDATE ni DELETE; `motor2_plataforma` no la toca. La unicidad de la clave
-- es GLOBAL, igual que `Operacion`, `ConteoFisico` y `PagoConsignante` (ADR-028). Por sucursal hereda de `Cuenta` (las políticas de alcance las agrega la migración B4).
-- ADITIVA: el código anterior nunca la lee ni la escribe.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261014100000_i3_agregado_de_cuenta`). DESTRUCTIVA: se pierden los comprobantes.

CREATE TABLE "AgregadoDeCuenta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "cuentaId" TEXT NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultadoMensaje" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgregadoDeCuenta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgregadoDeCuenta_claveIdempotencia_key" ON "AgregadoDeCuenta"("claveIdempotencia");
CREATE UNIQUE INDEX "AgregadoDeCuenta_empresaId_id_key" ON "AgregadoDeCuenta"("empresaId", "id");
CREATE INDEX "AgregadoDeCuenta_cuentaId_idx" ON "AgregadoDeCuenta"("cuentaId");

ALTER TABLE "AgregadoDeCuenta" ADD CONSTRAINT "AgregadoDeCuenta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgregadoDeCuenta" ADD CONSTRAINT "AgregadoDeCuenta_empresaId_cuentaId_fkey" FOREIGN KEY ("empresaId", "cuentaId") REFERENCES "Cuenta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgregadoDeCuenta" ADD CONSTRAINT "AgregadoDeCuenta_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgregadoDeCuenta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "AgregadoDeCuenta"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen: en una base de test o recién creada pueden no estar). Solo se agrega: sin UPDATE ni DELETE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "AgregadoDeCuenta" FROM motor2_app;
    GRANT SELECT, INSERT ON "AgregadoDeCuenta" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "AgregadoDeCuenta" FROM motor2_plataforma;
  END IF;
END
$$;
