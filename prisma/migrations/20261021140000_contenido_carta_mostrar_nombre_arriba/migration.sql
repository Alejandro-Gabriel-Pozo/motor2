-- FASE 5 de la ola «precio y carta» («carta pareja», DEC-11; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): «Mostrar el nombre arriba».
-- `ContenidoCartaProducto.mostrarNombreArriba`: el interruptor por producto Y por sucursal (la carta es propia de cada sucursal, ADR-009 C3) de un producto BASE («se vende por opción») con UN SOLO
-- eje en la carta. Apagado (default, decisión del dueño): la base sale OCULTA, cada opción es una fila con su nombre completo («Pizza muzzarella $18.000»). Prendido: el nombre del producto va arriba,
-- como encabezado, y las opciones debajo. No decide nada en un producto directo ni en una base de dos ejes (que sale siempre como tabla con el nombre arriba): ahí se ignora. No entra al precio.
-- ADITIVA: el default constante (`false`) solo toca el catálogo (PG >= 11) y deja cada fila existente como se ve hoy con la Fase 5 (oculta); el código anterior no lee ni escribe la columna (sus
-- `data` son explícitos y los INSERT, también los de «copiar carta», toman el default). Sin políticas nuevas ni GRANT nuevo: las políticas de `ContenidoCartaProducto` (por empresa y por sucursal)
-- son por fila, y `motor2_app` tiene los privilegios de TABLA (sin privilegios por columna), que cubren la columna nueva.
-- Reversa: down.sql (a mano, como dueño; ABORTA si algún producto tiene el interruptor prendido; después marcarla revertida en `_prisma_migrations`: ver el pie de down.sql).

ALTER TABLE "ContenidoCartaProducto" ADD COLUMN "mostrarNombreArriba" BOOLEAN NOT NULL DEFAULT false;
