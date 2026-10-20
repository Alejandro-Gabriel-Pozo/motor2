-- FASE 4 de la ola «precio y carta», C1 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): el MODO DE VENTA del producto (ADR-035).
-- `Producto.modoDeVenta`: DIRECTO (tiene su precio: el de siempre) o BASE_CONFIGURABLE (se vende por opción: el precio final está en cada opción de su grupo de medida en ABSOLUTO; el
-- `precioVenta` guardado se CONSERVA pero se bloquea y no se cobra). Lista cerrada en la base (TEXT + CHECK, como `GrupoDeOpciones_tipo_chk` y M0-IVA), espejo de `MODOS_DE_VENTA`
-- (src/core/opciones/tipos.ts): ampliar la lista es ampliar el CHECK. Un segundo CHECK repite en la base lo que ninguna escritura puede saltear: solo un producto de VENTA que NO se produce
-- puede ser base (las demás reglas —grupo de precio, sin porcentajes, ni consignación, ni ancla, ni ítem agrupado— dependen de otras tablas y las aplica el caso de uso).
-- ADITIVA: el default constante (`DIRECTO`) solo toca el catálogo (PG >= 11): toda fila existente queda DIRECTO, que es lo que ya hacía; el código anterior no lee ni escribe la columna (sus
-- `data` son explícitos y los INSERT toman el default). Sin políticas de RLS nuevas ni GRANT nuevo: las políticas de `Producto` son por fila y `motor2_app` tiene los privilegios de TABLA,
-- que cubren la columna nueva. Validar los dos CHECK recorre las filas de `Producto` (todas DIRECTO): aplicar sin tráfico y con `lock_timeout` corto.
-- Reversa: down.sql (a mano, como dueño; ABORTA si hay alguna base; después `prisma migrate resolve --rolled-back 20261021130000_producto_modo_de_venta`).

ALTER TABLE "Producto" ADD COLUMN "modoDeVenta" TEXT NOT NULL DEFAULT 'DIRECTO';

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_modoDeVenta_check" CHECK ("modoDeVenta" IN ('DIRECTO', 'BASE_CONFIGURABLE'));
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_modoDeVenta_base_check" CHECK ("modoDeVenta" = 'DIRECTO' OR ("tipo" = 'PV' AND NOT "seProduce"));
