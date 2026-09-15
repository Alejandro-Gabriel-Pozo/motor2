-- Índices que Prisma no puede declarar en schema.prisma (ver README,
-- "Pendiente de esta porción", y docs/plan-migracion.md).

-- CapacidadSucursal: como máximo una fila "default" (sucursalId IS NULL)
-- por Accion — @@unique([accionClave, sucursalId]) ya lo hace cumplir
-- cuando sucursalId es un valor real, pero Postgres trata NULL como
-- "distinto de cualquier otro NULL" en un UNIQUE normal, así que sin este
-- índice parcial se podrían insertar dos filas default para la misma
-- Accion.
CREATE UNIQUE INDEX "CapacidadSucursal_accionClave_default_key"
  ON "CapacidadSucursal" ("accionClave")
  WHERE "sucursalId" IS NULL;

-- Unicidad case/espacio-insensible (mismo criterio que mismoTexto_, Apps
-- Script) — porción Catálogo.
CREATE UNIQUE INDEX "Producto_nombre_lower_key" ON "Producto" (lower("nombre"));
CREATE UNIQUE INDEX "Proveedor_nombre_lower_key" ON "Proveedor" (lower("nombre"));
CREATE UNIQUE INDEX "Insumo_nombre_lower_key" ON "Insumo" (lower("nombre"));
CREATE UNIQUE INDEX "CategoriaProducto_nombre_lower_key" ON "CategoriaProducto" (lower("nombre"));
CREATE UNIQUE INDEX "Unidad_nombre_lower_key" ON "Unidad" (lower("nombre"));
CREATE UNIQUE INDEX "Grupo_nombre_lower_key" ON "Grupo" (lower("nombre"));

-- Idem, porción Movimientos — scopeado por sucursal (Seccion no es un
-- catálogo global, cada sucursal tiene el suyo).
CREATE UNIQUE INDEX "Seccion_sucursalId_nombre_lower_key" ON "Seccion" ("sucursalId", lower("nombre"));
