-- Reversa de 20261002100000_descripcion_historial_importes: vuelve a la descripción anterior.
UPDATE "Accion"
SET "descripcion" = 'Ver los importes (precios de compra y de venta) dentro del reporte «Historial de un producto»'
WHERE "clave" = 'reporte_historial_importes';
