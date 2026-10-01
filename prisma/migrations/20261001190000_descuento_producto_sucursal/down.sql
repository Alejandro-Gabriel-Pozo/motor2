-- Reversa de 20261001190000_descuento_producto_sucursal: se pierden los descuentos cargados (es dato nuevo de esta fase).
DELETE FROM "CapacidadSucursal" WHERE "accionClave" = 'carta_producto_descuento';
DELETE FROM "PermisoRol" WHERE "accionClave" = 'carta_producto_descuento';
DELETE FROM "Accion" WHERE "clave" = 'carta_producto_descuento';

DROP POLICY IF EXISTS aislamiento_empresa ON "DescuentoProductoSucursal";
DROP TABLE "DescuentoProductoSucursal";
