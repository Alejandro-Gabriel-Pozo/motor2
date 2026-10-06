-- Reversa de 20261001191000_reporte_descuentos_productos.
DELETE FROM "CapacidadSucursal" WHERE "accionClave" = 'reporte_descuentos_productos';
DELETE FROM "PermisoRol" WHERE "accionClave" = 'reporte_descuentos_productos';
DELETE FROM "Accion" WHERE "clave" = 'reporte_descuentos_productos';
