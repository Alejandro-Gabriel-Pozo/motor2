-- Verificación de 20261117190000_nombres_con_ficha_check (solo lectura). Correr ANTES de aplicar, en cada base: TODAS las cuentas de «fuera de la lista» tienen que dar 0 (si no, la migración aborta). Para el detalle de qué filas y por qué,
-- usar scripts/operaciones/e3-recuento-nombres-viejos.sql. DESPUÉS: existen la función y los diez CHECK.
SELECT 'Producto.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "Producto";
SELECT 'Insumo.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "Insumo";
SELECT 'CategoriaProducto.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "CategoriaProducto";
SELECT 'Proveedor.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "Proveedor";
SELECT 'Cliente.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "Cliente";
SELECT 'SeccionCarta.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "SeccionCarta";
SELECT 'GrupoDeOpciones.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "GrupoDeOpciones";
SELECT 'OpcionDeGrupo.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "OpcionDeGrupo";
SELECT 'Sucursal.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "Sucursal";
SELECT 'Rol.nombre' AS columna, count(*) AS filas, count(*) FILTER (WHERE "nombre" IS NULL OR "nombre" = '') AS vacias FROM "Rol";
SELECT proname::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'nombre_de_ficha_valido';
SELECT conrelid::regclass::text AS tabla, conname::text FROM pg_constraint WHERE conname LIKE '%\_ficha\_chk' ORDER BY 1;
