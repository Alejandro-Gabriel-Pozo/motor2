-- U1 (frente 2, unidades de medida como Pedernal; docs/diseno-unidades-de-medida-como-pedernal-2026-11-15.md §6.1 y docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md, etapa A2).
-- Pedido del dueño: «Igual a pedernal» y «Convertir cada una a la más parecida» (2026-11-15, relatadas en el diseño) y «unidades» (2026-11-16: «Planes versionados (M1) y unidades (informes)» + orden de avanzar en paralelo con lo confirmado).
-- REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN (congelamiento vigente); esta migración es ADITIVA y reversible (down.sql).
--
-- Qué hace: agrega a cada unidad de la empresa una anotación OPCIONAL de cuál de las 14 unidades fijas de Pedernal es: "Unidad"."codigoFijo". NULL = «pendiente de completar» (estado de toda unidad
-- existente): la unidad sigue funcionando EXACTAMENTE como hoy. NO se rellena nada acá (rellenar es la etapa U1b, un paso de DATOS con autorización expresa por base y ensayo), NO se tocan nombres,
-- decimales, ids ni ninguna fila que apunte a la unidad.
-- CHECK "Unidad_codigoFijo_chk": NULL o uno de los 14 códigos (la lista cerrada de `src/core/catalogo/unidades-de-medida.ts`, que una prueba compara con este CHECK). Nace cerrado: un valor fuera de la lista se rechaza.
-- Sin índice único a propósito: dos unidades de una empresa pueden ser equivalentes a la misma («kg» y «Kilo»); fusionarlas es otra etapa que nadie pidió.
-- ADITIVA: el código anterior ni lee ni escribe la columna (sus `data` son explícitos y los INSERT toman NULL). Sin políticas ni GRANT nuevos: la tabla ya tiene los de empresa. ADD COLUMN sin valor por
-- defecto no reescribe la tabla; el CHECK recorre las filas (todas en NULL).
-- Reversa: down.sql (a mano, como dueño; ABORTA si alguna unidad ya tiene un código, para no perder una equivalencia en silencio; idempotente).

ALTER TABLE "Unidad" ADD COLUMN "codigoFijo" TEXT;
ALTER TABLE "Unidad" ADD CONSTRAINT "Unidad_codigoFijo_chk" CHECK ("codigoFijo" IS NULL OR "codigoFijo" IN
  ('UNIDAD','GRAMO','KILOGRAMO','TONELADA','MILILITRO','LITRO','METRO_CUBICO','MILIMETRO','CENTIMETRO','METRO',
   'CENTIMETRO_CUADRADO','METRO_CUADRADO','MINUTO','HORA'));
