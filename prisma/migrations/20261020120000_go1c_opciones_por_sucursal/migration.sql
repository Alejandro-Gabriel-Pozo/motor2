-- GO-1c (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): lo que una SUCURSAL decide sobre las opciones de venta: dos tablas nuevas, ambas PROPIAS de la sucursal (`sucursalId` NOT NULL con clave foránea).
--   PrecioLocalDeOpcion       el precio de una opción de un producto en la sucursal (la grilla local; ADR-009, familia `override`: sin fila habilitada rige el precio de la empresa)
--   OpcionApagadaEnSucursal   si una opción está apagada en la sucursal (ADR-009, familia `optout`: SIN FILA = PRENDIDA)
-- No toca ninguna tabla existente, no cambia importes y no siembra nada. Nada de `src/` las escribe todavía (GO-2). Dinero DECIMAL exacto (`numeric(14,2)`), nunca float; el precio es de 0,01 o más (CHECK).
-- Las políticas de alcance por sucursal de estas dos tablas llegan en la migración siguiente (GO-1c-rls, 20261020121000), que es la salida exacta del generador: esta migración NO las crea y se aplica siempre ANTES que ella.
-- La app solo cambia `precio`, `habilitado` y `actualizadoEn` del precio local, y `apagada`, `actualizadoPorId` y `actualizadoEn` del apagado (UPDATE por columna, para el `ON CONFLICT DO UPDATE`); no borra nada. Es configuración de lista: se edita en el lugar con
-- auditoría del antes y el después; lo cobrado queda congelado en la foto de la línea (GO-1d). Sin CONCURRENTLY (las tablas nacen vacías); al aplicar conviene `SET lock_timeout = '5s'`.
-- Requiere GO-1b (las opciones), el rol motor2_app si existe (los GRANT son condicionales) y la función app_empresa_actual() (default de empresaId).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back`). NO destructiva: ABORTA si hay filas. Se baja DESPUÉS de GO-1c-rls y ANTES que GO-1b.

CREATE TABLE "PrecioLocalDeOpcion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "opcionId" TEXT NOT NULL,
    "precio" DECIMAL(14,2) NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrecioLocalDeOpcion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrecioLocalDeOpcion_sucursalId_productoId_opcionId_key" ON "PrecioLocalDeOpcion"("sucursalId", "productoId", "opcionId");
CREATE UNIQUE INDEX "PrecioLocalDeOpcion_empresaId_id_key" ON "PrecioLocalDeOpcion"("empresaId", "id");
ALTER TABLE "PrecioLocalDeOpcion" ADD CONSTRAINT "PrecioLocalDeOpcion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalDeOpcion" ADD CONSTRAINT "PrecioLocalDeOpcion_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalDeOpcion" ADD CONSTRAINT "PrecioLocalDeOpcion_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalDeOpcion" ADD CONSTRAINT "PrecioLocalDeOpcion_empresaId_opcionId_fkey" FOREIGN KEY ("empresaId", "opcionId") REFERENCES "OpcionDeGrupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalDeOpcion" ADD CONSTRAINT "PrecioLocalDeOpcion_precio_chk" CHECK ("precio" >= 0.01);

CREATE TABLE "OpcionApagadaEnSucursal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "opcionId" TEXT NOT NULL,
    "apagada" BOOLEAN NOT NULL,
    "actualizadoPorId" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpcionApagadaEnSucursal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OpcionApagadaEnSucursal_sucursalId_opcionId_key" ON "OpcionApagadaEnSucursal"("sucursalId", "opcionId");
CREATE UNIQUE INDEX "OpcionApagadaEnSucursal_empresaId_id_key" ON "OpcionApagadaEnSucursal"("empresaId", "id");
ALTER TABLE "OpcionApagadaEnSucursal" ADD CONSTRAINT "OpcionApagadaEnSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionApagadaEnSucursal" ADD CONSTRAINT "OpcionApagadaEnSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionApagadaEnSucursal" ADD CONSTRAINT "OpcionApagadaEnSucursal_empresaId_opcionId_fkey" FOREIGN KEY ("empresaId", "opcionId") REFERENCES "OpcionDeGrupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionApagadaEnSucursal" ADD CONSTRAINT "OpcionApagadaEnSucursal_actualizadoPorId_fkey" FOREIGN KEY ("actualizadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrecioLocalDeOpcion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PrecioLocalDeOpcion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "OpcionApagadaEnSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "OpcionApagadaEnSucursal"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "PrecioLocalDeOpcion", "OpcionApagadaEnSucursal" FROM motor2_app;
    GRANT SELECT, INSERT ON "PrecioLocalDeOpcion", "OpcionApagadaEnSucursal" TO motor2_app;
    GRANT UPDATE ("precio", "habilitado", "actualizadoEn") ON "PrecioLocalDeOpcion" TO motor2_app;
    GRANT UPDATE ("apagada", "actualizadoPorId", "actualizadoEn") ON "OpcionApagadaEnSucursal" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "PrecioLocalDeOpcion", "OpcionApagadaEnSucursal" FROM motor2_plataforma;
  END IF;
END
$$;
