-- INFORME DE SOLO LECTURA (frente 2, etapa A1): pares «materia prima + producto de venta» (la reventa de hoy), candidatos a unirse en un solo producto de reventa.
-- NO escribe nada, NO es una migración, NO cambia ningún dato. Crea UNA tabla temporal, pasa la transacción a SOLO LECTURA y termina con ROLLBACK: no deja nada.
-- Diseño: docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md (§11.3.2 qué es un par, §11.3.9 consulta de recuento) y docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md.
--
-- Un par candidato es un producto de venta (tipo PV, no «se produce») cuya receta VIGENTE central tiene UN SOLO ingrediente, y ese ingrediente es una materia prima (tipo MP, no «se produce»,
-- sin consignación). «Exacto 1 a 1» = ese ingrediente entra con cantidad 1 y merma 0: es la reventa de verdad. Los demás son candidatos que una persona tiene que mirar.
--
-- Qué mide (tres bloques):
--   1. Recuento por empresa: cuántos candidatos y cuántos exactos 1 a 1.
--   2. Detalle por candidato: nombres, unidad, cantidad y merma de la línea, y cuántas recetas de OTROS platos usan la misma materia prima
--      (esas recetas habría que reapuntar al unir el par) y cuántas ventas/movimientos tiene cada lado.
--   3. Controles: materias primas que son ingrediente único de MÁS de un producto de venta (no es un par: una materia prima, varios platos) y productos de venta con varias recetas centrales.
-- Cuántos pares reales hay en una base es un dato de ESA base: este informe se corre en cada una.
--
-- Uso (la URL por entorno, nunca en el repo). Correr SIEMPRE como DUEÑO de la base (ve todas las empresas). Con el rol de la aplicación el aislamiento por empresa y por sucursal (RLS) recorta lo que ve y los conteos dan MENOS: no sirve para este informe.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/operaciones/informe-pares-compra-venta.sql
-- Variable opcional:  -v slug=<slug>  (limita el informe a una empresa).
-- La salida lleva nombres de productos: es PRIVADA, no se pega en el repositorio.

\set ON_ERROR_STOP on
\pset null '·'
\pset footer off
BEGIN;
SET LOCAL statement_timeout = '60s';

\if :{?slug}
\else
  \set slug ''
\endif
SELECT set_config('informe.slug', :'slug', true) AS filtro_de_empresa \gset

-- Los candidatos, una sola vez, en una tabla TEMPORAL (vive solo en esta transacción). Después la transacción pasa a SOLO LECTURA.
CREATE TEMP TABLE cand ON COMMIT DROP AS
WITH vigente AS (
  SELECT DISTINCT ON (r."empresaId", r."productoId") r.id, r."empresaId", r."productoId"
    FROM "RecetaVersion" r
   WHERE r."sucursalId" IS NULL
   ORDER BY r."empresaId", r."productoId", r.version DESC
), un_solo AS (
  SELECT v."empresaId", v."productoId", v.id AS "recetaVersionId", min(i."insumoProductoId") AS "materiaPrimaId",
         min(i.cantidad) AS cantidad, min(i."mermaPorcentaje") AS merma, min(i."unidadId") AS "unidadId"
    FROM vigente v JOIN "RecetaIngrediente" i ON i."recetaVersionId" = v.id AND i."empresaId" = v."empresaId"
   GROUP BY v."empresaId", v."productoId", v.id HAVING count(*) = 1
)
SELECT c.*, (c.cantidad = 1 AND c.merma = 0) AS exacto
  FROM un_solo c
  JOIN "Producto" pv ON pv.id = c."productoId" AND pv."empresaId" = c."empresaId" AND pv.tipo = 'PV' AND NOT pv."seProduce"
  JOIN "Producto" mp ON mp.id = c."materiaPrimaId" AND mp."empresaId" = c."empresaId" AND mp.tipo = 'MP' AND NOT mp."seProduce" AND NOT mp."esConsignacion"
 WHERE current_setting('informe.slug') = '' OR c."empresaId" IN (SELECT id FROM "Empresa" WHERE slug = current_setting('informe.slug'));

SET TRANSACTION READ ONLY;

\echo
\echo '=== 1. RECUENTO POR EMPRESA: candidatos a par y cuántos son exactos 1 a 1 ==='
SELECT e.slug AS empresa, count(c."productoId") AS candidatos, count(c."productoId") FILTER (WHERE c.exacto) AS exactos_1_a_1
  FROM "Empresa" e LEFT JOIN cand c ON c."empresaId" = e.id
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 GROUP BY e.slug ORDER BY e.slug;

\echo
\echo '=== 2. DETALLE POR CANDIDATO ==='
SELECT e.slug AS empresa, pv.nombre AS producto_de_venta, mp.nombre AS materia_prima, u.nombre AS unidad, c.cantidad, c.merma AS merma_pct,
       CASE WHEN c.exacto THEN 'exacto 1 a 1' ELSE 'MIRAR (cantidad o merma distinta)' END AS situacion,
       (SELECT count(DISTINCT x."recetaVersionId") FROM "RecetaIngrediente" x
          JOIN "RecetaVersion" rv ON rv.id = x."recetaVersionId" AND rv."empresaId" = x."empresaId"
         WHERE x."empresaId" = c."empresaId" AND x."insumoProductoId" = c."materiaPrimaId" AND rv."productoId" <> c."productoId") AS recetas_de_otros_platos_que_la_usan,
       (SELECT count(*) FROM "MovimientoStock" m WHERE m."empresaId" = c."empresaId" AND m."productoId" = c."productoId")  AS movimientos_del_producto_de_venta,
       (SELECT count(*) FROM "MovimientoStock" m WHERE m."empresaId" = c."empresaId" AND m."productoId" = c."materiaPrimaId") AS movimientos_de_la_materia_prima
  FROM cand c
  JOIN "Empresa" e ON e.id = c."empresaId"
  JOIN "Producto" pv ON pv.id = c."productoId" AND pv."empresaId" = c."empresaId"
  JOIN "Producto" mp ON mp.id = c."materiaPrimaId" AND mp."empresaId" = c."empresaId"
  LEFT JOIN "Unidad" u ON u.id = c."unidadId" AND u."empresaId" = c."empresaId"
 ORDER BY e.slug, c.exacto DESC, pv.nombre;

\echo
\echo '=== 3. CONTROLES: una materia prima que es el único ingrediente de MÁS de un producto de venta (no es un par, es una materia prima con varios platos) ==='
SELECT e.slug AS empresa, mp.nombre AS materia_prima, count(*) AS productos_de_venta_que_la_usan_sola
  FROM cand c
  JOIN "Empresa" e ON e.id = c."empresaId"
  JOIN "Producto" mp ON mp.id = c."materiaPrimaId" AND mp."empresaId" = c."empresaId"
 GROUP BY e.slug, mp.nombre, c."materiaPrimaId", c."empresaId"
HAVING count(*) > 1
 ORDER BY e.slug, mp.nombre;

ROLLBACK;
