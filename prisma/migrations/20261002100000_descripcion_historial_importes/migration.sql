-- La clave `reporte_historial_importes` ahora también oculta el proveedor y el N.º de factura del «Historial de un producto» (decisión del dueño,
-- 2026-10-02, S-15): la descripción de la acción tiene que decirlo, porque es lo que ve quien la asigna a un rol. Solo datos de catálogo de
-- permisos (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR); no cambia `schema.prisma` ni los permisos concedidos. Reversa: down.sql.
UPDATE "Accion"
SET "descripcion" = 'Ver los datos comerciales (precios de compra y de venta, proveedor y N.º de factura) dentro del reporte «Historial de un producto»'
WHERE "clave" = 'reporte_historial_importes';
