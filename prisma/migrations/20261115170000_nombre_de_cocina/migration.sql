-- «NOMBRE DE COCINA» (el nombre con el que sale el producto en la comanda), igual que Pedernal (diseño docs/diseno-nombre-de-cocina-como-pedernal-2026-11-15.md, §8 etapas E1 + E2; decisiones del dueño del 2026-11-15
-- relatadas en el pedido: «Solo del producto, como Pedernal», «Sí, es el nombre interno del producto» y «Y mientras las autorizaciones tengan down.sql, vamos…»; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo y ensayo):
--  - "Producto"."nombreDeCocina": cómo nombra la cocina un producto de venta («Medallón de bife de chorizo»). NULL = no tiene: la comanda usa el nombre interno, como hasta hoy (toda fila existente queda en NULL; nada se rellena).
--  - "CuentaItem"."nombreDeCocina": el mismo nombre CONGELADO al agregar la línea (molde: "CuentaItem"."nombreEnTicket"). NULL = la comanda usa el nombre interno del producto (toda línea anterior). Solo lo lee la comanda
--    (y su reimpresión y el aviso de anulación): el precio, el stock, la receta, el ticket del cliente y los reportes no lo usan.
-- ADITIVA: el código anterior no lee ni escribe las columnas (sus `data` son explícitos y los INSERT toman NULL). Sin políticas ni GRANT nuevos: las dos tablas ya tienen los permisos y la política por empresa de TABLA, que cubren las
-- columnas nuevas. ADD COLUMN NULL no reescribe la tabla; validar cada CHECK recorre las filas (todas en NULL).
-- CHECK "Producto_nombre_de_cocina_chk": NULL, o un producto de venta (tipo PV) con un nombre de 1 a 80 caracteres que empieza y termina con un carácter visible y sin saltos de línea.
-- CHECK "CuentaItem_nombre_de_cocina_chk": lo mismo, sin la condición de tipo (la línea ya es de un producto de venta).
-- Límite honesto: Postgres no tiene `\p{L}`; el conjunto de caracteres permitido (una letra al menos, sin invisibles) lo impone el servidor con la ficha de texto; la base cubre largo, bordes, saltos de línea y el tipo.
-- Reversa: down.sql (a mano, como dueño; ABORTA si algún producto o alguna línea tiene un nombre de cocina, para no perderlo en silencio; idempotente).

ALTER TABLE "Producto" ADD COLUMN "nombreDeCocina" TEXT;
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_nombre_de_cocina_chk"
  CHECK ("nombreDeCocina" IS NULL OR ("tipo" = 'PV' AND "nombreDeCocina" ~ '^\S(.*\S)?$' AND "nombreDeCocina" !~ '[\r\n]' AND char_length("nombreDeCocina") <= 80));

ALTER TABLE "CuentaItem" ADD COLUMN "nombreDeCocina" TEXT;
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_nombre_de_cocina_chk"
  CHECK ("nombreDeCocina" IS NULL OR ("nombreDeCocina" ~ '^\S(.*\S)?$' AND "nombreDeCocina" !~ '[\r\n]' AND char_length("nombreDeCocina") <= 80));
