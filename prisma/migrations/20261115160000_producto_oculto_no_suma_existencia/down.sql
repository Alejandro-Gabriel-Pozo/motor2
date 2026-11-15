-- Reversa de 20261115160000_producto_oculto_no_suma_existencia («Ocultar» E3c3). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261115160000_producto_oculto_no_suma_existencia`.
-- No es destructiva: solo saca el control (a partir de ahí un producto oculto puede volver a recibir existencia, que es lo que pasaba antes de la migración). No toca ninguna fila. Bajarla dos veces no falla.
DROP TRIGGER IF EXISTS "MovimientoStock_producto_oculto_trg" ON "MovimientoStock";
DROP FUNCTION IF EXISTS rechazar_suma_a_producto_oculto();
