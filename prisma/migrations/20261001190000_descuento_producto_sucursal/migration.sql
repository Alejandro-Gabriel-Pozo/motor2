-- Producto con descuento (decisión del dueño, 2026-10-01; Fase 2 de "promociones, un solo concepto"): un producto de venta puede tener, en UNA
-- sucursal, un descuento en PORCENTAJE sobre su precio vigente ahí. No es una promoción. Fila ausente = sin descuento. Reversa: down.sql.
--
-- 1) Tabla nueva `DescuentoProductoSucursal` (multiempresa como el resto: "empresaId" con default app_empresa_actual() y política aislamiento_empresa).
-- 2) Permisos (datos): clave nueva `carta_producto_descuento` (contexto sucursal). Expandir: a cada rol se le copia lo que ya tenía en
--    `carta_contenido_producto` (el padre sigue en el catálogo, no se retira).

-- CreateTable
CREATE TABLE "DescuentoProductoSucursal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "productoId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "DescuentoProductoSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DescuentoProductoSucursal_empresaId_id_key" ON "DescuentoProductoSucursal"("empresaId", "id");
CREATE UNIQUE INDEX "DescuentoProductoSucursal_productoId_sucursalId_key" ON "DescuentoProductoSucursal"("productoId", "sucursalId");
CREATE INDEX "DescuentoProductoSucursal_sucursalId_idx" ON "DescuentoProductoSucursal"("sucursalId");

-- AddForeignKey
ALTER TABLE "DescuentoProductoSucursal" ADD CONSTRAINT "DescuentoProductoSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DescuentoProductoSucursal" ADD CONSTRAINT "DescuentoProductoSucursal_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DescuentoProductoSucursal" ADD CONSTRAINT "DescuentoProductoSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Aislamiento por empresa (RLS)
ALTER TABLE "DescuentoProductoSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "DescuentoProductoSucursal" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Permisos para el rol de ejecución, si existe (los default privileges del dueño ya lo cubren; esto lo deja explícito).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "DescuentoProductoSucursal" TO motor2_app;
  END IF;
END
$$;

-- Permisos (datos): clave nueva `carta_producto_descuento`.
INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('carta_producto_descuento', 'Fijar o sacar el descuento en porcentaje de un producto en la sucursal')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('carta_contenido_producto', 'carta_producto_descuento')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('carta_contenido_producto', 'carta_producto_descuento')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);
