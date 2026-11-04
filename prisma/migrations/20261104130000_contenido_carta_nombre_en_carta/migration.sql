-- «NOMBRE EN LA CARTA» (pedido del dueño, 2026-11-04; docs/diseno-nombre-en-carta-2026-11-04.md; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo y ensayo en una rama de Neon):
-- `ContenidoCartaProducto.nombreEnCarta`: el nombre con que la carta (pública, impresa, vista previa del producto y «Va a mostrar») y el selector del mozo muestran un producto de venta, distinto del nombre INTERNO
-- (`Producto.nombre`). Es POR PRODUCTO Y POR SUCURSAL (la carta es propia de cada sucursal, ADR-009 C3: el contenido ya es de una sola sucursal) y «copiar carta» lo copia. NULL (default) = la carta usa el nombre interno.
-- No entra al precio, al stock, a la receta, a la venta, al ticket, a la comanda ni a los reportes: es solo presentación.
-- CHECK `ContenidoCartaProducto_nombre_en_carta_chk`: NULL, o de 1 a 80 caracteres, que empiezan y terminan con un carácter visible (sin espacios a los costados) y sin saltos de línea.
-- ADITIVA: el código anterior no lee ni escribe la columna (sus `data` son explícitos y los INSERT, también los de «copiar carta», toman NULL). Sin políticas nuevas ni GRANT nuevo: las políticas de `ContenidoCartaProducto`
-- (por empresa y por sucursal) son por fila, y `motor2_app` tiene los privilegios de TABLA (sin privilegios por columna sobre esta tabla), que cubren la columna nueva.
-- ADD COLUMN sin default solo toca el catálogo; validar el CHECK recorre las filas de `ContenidoCartaProducto` (todas en NULL).
-- ÚNICO PARCIAL `ContenidoCartaProducto_sucursal_nombre_en_carta_key` (regla del dueño, 2026-11-04: en la carta de una sucursal no hay dos cosas con el mismo nombre): sin distinguir mayúsculas, dos platos VISIBLES de la
-- misma sucursal no pueden tener el mismo «Nombre en la carta» (uno oculto no molesta; se vuelve a chequear al mostrarlo) (la base lo cuida aunque el código falle). El caso de uso valida además, sin mayúsculas ni tildes, contra el nombre del producto de los demás platos visibles (que no sean bases),
-- los ítems agrupados y las promos (eso no lo puede expresar un índice). Sobre filas todas en NULL: el índice nace vacío.
-- Reversa: down.sql (a mano, como dueño; ABORTA si algún contenido tiene un nombre cargado; después marcar la migración como revertida).

ALTER TABLE "ContenidoCartaProducto" ADD COLUMN "nombreEnCarta" TEXT;

-- `^\S(.*\S)?$`: empieza y termina con un carácter visible (rechaza vacío, solo espacios y cualquier espacio —también un tabulador o un salto— a los costados). `[\r\n]`: ningún salto de línea adentro
-- (en el punto de una expresión regular de Postgres cabe el salto, por eso se pide aparte).
ALTER TABLE "ContenidoCartaProducto" ADD CONSTRAINT "ContenidoCartaProducto_nombre_en_carta_chk"
  CHECK ("nombreEnCarta" IS NULL OR ("nombreEnCarta" ~ '^\S(.*\S)?$' AND "nombreEnCarta" !~ '[\r\n]' AND char_length("nombreEnCarta") <= 80));

CREATE UNIQUE INDEX "ContenidoCartaProducto_sucursal_nombre_en_carta_key" ON "ContenidoCartaProducto" ("sucursalId", lower("nombreEnCarta")) WHERE "nombreEnCarta" IS NOT NULL AND "visibleEnCarta";
