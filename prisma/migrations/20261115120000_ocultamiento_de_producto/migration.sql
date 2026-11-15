-- «Ocultar» como Pedernal, etapa E3a (docs/diseno-ocultar-como-pedernal-2026-11-15.md, nivel 6). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar, con backup y ensayo).
--
-- QUÉ: UNA tabla nueva, `OcultamientoProducto`: una fila por (producto, alcance). `sucursalId` NULL = toda la empresa; con valor = solo esa sucursal. SIN FILA = VISIBLE. Independiente de `DisponibilidadProducto`
-- («Desactivar», sentido contrario: sin fila = no disponible): ninguna toca a la otra. Nombre distinto a propósito (diferencia D-1 del diseño). Nunca se borra: «volver a mostrar» pone `oculto = false`.
--
-- QUÉ DECIDE LA BASE (no depende de que el caso de uso se acuerde): una marca de empresa por producto y una por sucursal (dos índices únicos PARCIALES: así dos personas que ocultan a la vez nunca dejan dos filas, la
-- escritura es INSERT … ON CONFLICT); el producto y la sucursal son de la MISMA empresa (clave foránea compuesta; con `sucursalId` NULL la FK de sucursal no se evalúa, como RecetaVersion); `version >= 1`; `id` no vacío;
-- quién cambió y cuándo no pueden faltar. La app NO puede borrar (sin DELETE ni TRUNCATE) ni cambiar a qué producto o alcance apunta una fila: solo UPDATE de `oculto`, `actualizadoPorId`, `actualizadoEn`, `version`.
-- QUÉ DECIDE EL CASO DE USO (etapas siguientes): quién puede ocultar en toda la empresa (solo administración, O-10), que no haya existencia distinta de cero, «ya estaba», la auditoría y el control de versión.
-- Las políticas de alcance de sucursal (RLS por sucursal) van en la migración siguiente (20261115121000), salida exacta del generador, como el resto de las tablas con `sucursalId`.
--
-- ADITIVA: solo agrega una tabla, sus índices, claves, reglas, política de empresa y privilegios; no toca ninguna fila ni columna existentes. El código anterior no la lee ni la escribe, así que se puede aplicar por
-- adelantado y el Instant Rollback de Vercel sigue siendo seguro. Índices sin CONCURRENTLY (tabla nueva y vacía, ADR-029 §8).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261115120000_ocultamiento_de_producto`). Bajar ANTES la de políticas (20261115121000).
-- La reversa ABORTA si hay filas (se perderían las marcas cargadas); con la tabla vacía el estado resultante es el de antes: todo visible.

-- CreateTable
CREATE TABLE "OcultamientoProducto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "productoId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "oculto" BOOLEAN NOT NULL,
    "actualizadoPorId" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcultamientoProducto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcultamientoProducto_productoId_idx" ON "OcultamientoProducto"("productoId");

-- CreateIndex
CREATE UNIQUE INDEX "OcultamientoProducto_empresaId_id_key" ON "OcultamientoProducto"("empresaId", "id");

-- CreateIndex (a mano: Prisma no declara índices únicos parciales). Una marca de empresa por producto…
CREATE UNIQUE INDEX "OcultamientoProducto_producto_empresa_key" ON "OcultamientoProducto"("empresaId", "productoId") WHERE "sucursalId" IS NULL;

-- CreateIndex (a mano)… y una por sucursal.
CREATE UNIQUE INDEX "OcultamientoProducto_producto_sucursal_key" ON "OcultamientoProducto"("empresaId", "productoId", "sucursalId") WHERE "sucursalId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "OcultamientoProducto" ADD CONSTRAINT "OcultamientoProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcultamientoProducto" ADD CONSTRAINT "OcultamientoProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcultamientoProducto" ADD CONSTRAINT "OcultamientoProducto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcultamientoProducto" ADD CONSTRAINT "OcultamientoProducto_actualizadoPorId_fkey" FOREIGN KEY ("actualizadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas (CHECK con nombre)
ALTER TABLE "OcultamientoProducto" ADD CONSTRAINT "OcultamientoProducto_version_chk" CHECK ("version" >= 1);
ALTER TABLE "OcultamientoProducto" ADD CONSTRAINT "OcultamientoProducto_id_no_vacio_chk" CHECK (length(btrim("id")) > 0);

-- RLS por empresa (las políticas por sucursal van en 20261115121000)
ALTER TABLE "OcultamientoProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "OcultamientoProducto"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen): leer, agregar y cambiar SOLO el estado; nunca borrar. La consola de plataforma no la toca.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "OcultamientoProducto" FROM motor2_app;
    GRANT SELECT, INSERT ON "OcultamientoProducto" TO motor2_app;
    GRANT UPDATE ("oculto", "actualizadoPorId", "actualizadoEn", "version") ON "OcultamientoProducto" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "OcultamientoProducto" FROM motor2_plataforma;
  END IF;
END
$$;
