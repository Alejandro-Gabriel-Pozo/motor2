-- M2 (frente 2, merma sobre el bruto como Pedernal; docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md §6.1 y docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md, etapa A2).
-- Autorización: la «autorización permanente del 2026-11-15» que cita el diseño (M2 aditiva y reversible).
-- REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN (congelamiento vigente); esta migración es ADITIVA y reversible (down.sql).
--
-- Qué hace: marca en qué BASE están escritas las cantidades de cada versión de receta ("RecetaVersion") y de cada versión de opción ("VersionDeOpcion"):
--   NETA  = lo que llega al plato (lo único que existe hoy: TODO lo ya cargado es NETA, el valor por defecto);
--   BRUTA = lo que sale del stock (Pedernal). Una versión no mezcla bases: la marca es de la versión, nace con ella y no cambia.
-- NO se escribe ninguna fila (el valor por defecto es solo metadato en Postgres 11 o posterior), NO cambia ninguna cantidad, merma, costo ni venta; NADA lee la columna todavía (el código
-- de M3 en adelante). "RendimientoLocalIngrediente" no lleva marca: hereda la de la versión de su línea. La tabla de combinaciones (GO-3a) está retirada y no entra.
-- CHECK de dos valores (texto + CHECK, no enum: un valor de enum no se puede sacar después). La regla «en BRUTA la merma es menor que 100» no es un CHECK de fila (mira otra tabla): la impone
-- la aplicación (M3), como dice el diseño (DT-M11).
-- Compatibilidad hacia atrás: un binario viejo que inserta una versión sin nombrar la columna recibe NETA, que es justo lo que ese binario entiende. Por eso M2 va ANTES que el código.
-- Reversa: down.sql (a mano, como dueño; ABORTA si ya existe alguna versión BRUTA, para que quitar la marca no las haga leer como NETA; idempotente).

ALTER TABLE "RecetaVersion" ADD COLUMN "baseDeCantidad" TEXT NOT NULL DEFAULT 'NETA';
ALTER TABLE "RecetaVersion" ADD CONSTRAINT "RecetaVersion_baseDeCantidad_chk" CHECK ("baseDeCantidad" IN ('NETA', 'BRUTA'));

ALTER TABLE "VersionDeOpcion" ADD COLUMN "baseDeCantidad" TEXT NOT NULL DEFAULT 'NETA';
ALTER TABLE "VersionDeOpcion" ADD CONSTRAINT "VersionDeOpcion_baseDeCantidad_chk" CHECK ("baseDeCantidad" IN ('NETA', 'BRUTA'));
