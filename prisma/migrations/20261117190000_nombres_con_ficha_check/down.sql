-- Reversa de 20261117190000_nombres_con_ficha_check: saca los CHECK y la función. No toca datos. Se puede correr dos veces.
ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_nombre_ficha_chk";
ALTER TABLE "Insumo" DROP CONSTRAINT IF EXISTS "Insumo_nombre_ficha_chk";
ALTER TABLE "CategoriaProducto" DROP CONSTRAINT IF EXISTS "CategoriaProducto_nombre_ficha_chk";
ALTER TABLE "Proveedor" DROP CONSTRAINT IF EXISTS "Proveedor_nombre_ficha_chk";
ALTER TABLE "Cliente" DROP CONSTRAINT IF EXISTS "Cliente_nombre_ficha_chk";
ALTER TABLE "SeccionCarta" DROP CONSTRAINT IF EXISTS "SeccionCarta_nombre_ficha_chk";
ALTER TABLE "GrupoDeOpciones" DROP CONSTRAINT IF EXISTS "GrupoDeOpciones_nombre_ficha_chk";
ALTER TABLE "OpcionDeGrupo" DROP CONSTRAINT IF EXISTS "OpcionDeGrupo_nombre_ficha_chk";
ALTER TABLE "Sucursal" DROP CONSTRAINT IF EXISTS "Sucursal_nombre_ficha_chk";
ALTER TABLE "Rol" DROP CONSTRAINT IF EXISTS "Rol_nombre_ficha_chk";
DROP FUNCTION IF EXISTS nombre_de_ficha_valido(text, integer, boolean, boolean);
