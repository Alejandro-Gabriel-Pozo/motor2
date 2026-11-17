-- REVENTA COMO CLASE DE USO (frente 2, «clases de producto como Pedernal», etapa E4-1; docs/diseno-reventa-e4-2026-11-17.md §3, §4 y §6; diseño de clases docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md §6 y §13).
-- Autorización: el orquestador general concedió el turno de schema de E4-1 el 2026-11-17 (aditiva, con down.sql que aborta si hay REVENTA y verificacion-previa.sql), condicionado a que E4-0 estuviera verde (lo está: PR de
-- `capacidadesDelProducto`); respaldo del dueño: «Insumo y Reventa para altas nuevas» (2026-11-15) y «Y la etapa E4, ¿por qué no está?» (2026-11-17). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE; esta migración
-- es REVERSIBLE (down.sql) y NO escribe ninguna fila. Va DESPUÉS de 20261117180000_clase_de_uso_del_producto (E1): relaja uno de sus CHECK.
--
-- Qué hace: una REVENTA (se compra y se vende tal cual, con stock propio) es un producto de venta (tipo PV, modelo R-A del diseño §3) cuya clase es REVENTA y que no se produce. Entonces:
--   1) "Producto_claseDeUso_tipo_chk" se vuelve a escribir: una materia prima (MP) sigue siendo MATERIA_PRIMA, INSUMO o ELABORADO; un producto de venta (PV) es VENDIBLE o REVENTA. REVENTA con tipo MP sigue sin
--      admitirse (lista de permitidos: todo nace cerrado);
--   2) "Producto_claseDeUso_reventa_chk" (nuevo): una REVENTA no se produce ("seProduce" falso). El CHECK de E1 sobre «se produce» deja libre a un PV; sin este, una REVENTA podría llevar receta de producción.
-- NO se toca "tipo" ni ninguna otra columna, NO se agregan columnas, tablas, índices, políticas ni GRANT, y NADA escribe REVENTA todavía (el alta que la ofrece es E4-5): esta migración solo ABRE la puerta en la base.
-- La lista cerrada de clases ("Producto_claseDeUso_chk"), el CHECK de «se produce» de E1 y el disparador de inmutabilidad de la clase quedan TAL CUAL.
-- Compatibilidad hacia atrás: el código anterior no escribe REVENTA (la clase no se ofrece), así que ninguna fila nueva la usa; lo que el CHECK admitía antes lo sigue admitiendo (solo se suma una combinación).
-- Los CHECK se validan recorriendo las filas: hoy ninguna es REVENTA, así que la validación nunca falla. DROP + ADD en la misma transacción: no queda ninguna ventana sin la regla.
-- Reversa: down.sql (a mano, como dueño; ABORTA si algún producto ya es REVENTA, para no perderla en silencio; idempotente).

ALTER TABLE "Producto" DROP CONSTRAINT "Producto_claseDeUso_tipo_chk";

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_claseDeUso_tipo_chk"
  CHECK ("claseDeUso" IS NULL
    OR ("tipo" = 'MP' AND "claseDeUso" IN ('MATERIA_PRIMA', 'INSUMO', 'ELABORADO'))
    OR ("tipo" = 'PV' AND "claseDeUso" IN ('VENDIBLE', 'REVENTA')));

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_claseDeUso_reventa_chk"
  CHECK ("claseDeUso" IS DISTINCT FROM 'REVENTA' OR NOT "seProduce");
