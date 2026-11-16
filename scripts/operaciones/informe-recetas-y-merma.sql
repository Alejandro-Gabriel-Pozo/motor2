-- INFORME DE SOLO LECTURA (frente 2, etapa A1): recetas y merma de cada empresa.
-- NO escribe nada, NO es una migración, NO cambia ningún dato. La transacción es READ ONLY (declarada antes de la primera consulta) y termina con ROLLBACK.
-- Diseño: docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md (§9, consultas M1) y docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md (etapa A1).
--
-- Qué mide (cinco bloques):
--   1. Recetas: cuántas versiones y líneas hay por empresa, cuántas líneas llevan merma y cuántas tendrían una merma que en Pedernal es inválida (100 % o más).
--   2. Solo las VIGENTES (la de mayor versión de cada producto + sucursal): lo que hoy se vende y se costea. Es lo que convertiría la etapa M3b al editar.
--   3. Calibraciones por sucursal con cantidad o merma propias (se arrastran a la versión nueva).
--   4. Opciones con merma (la misma regla que las recetas, Q-M2). Las combinaciones por producto (GO-3a) están retiradas y no se miran.
--   5. Productos que «se producen» (los que tienen stock propio y receta).
-- Como la merma hoy se guarda con 2 decimales, lo que se convierta de neto a bruto puede diferir en el cuarto decimal del neto de hoy: este informe cuenta CUÁNTAS líneas hay,
-- no calcula esa diferencia (la calcula la vista previa de la etapa M3b, antes de guardar).
--
-- Uso (la URL por entorno, nunca en el repo). Correr SIEMPRE como DUEÑO de la base (ve todas las empresas). Con el rol de la aplicación el aislamiento por empresa y por sucursal (RLS) recorta lo que ve y los conteos dan MENOS: no sirve para este informe.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/operaciones/informe-recetas-y-merma.sql
-- Variable opcional:  -v slug=<slug>  (limita el informe a una empresa).

\set ON_ERROR_STOP on
\pset null '·'
\pset footer off
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

\if :{?slug}
\else
  \set slug ''
\endif
SELECT set_config('informe.slug', :'slug', true) AS filtro_de_empresa \gset

\echo
\echo '=== 1. RECETAS: versiones, líneas y merma (todas las versiones, incluida la historia) ==='
SELECT e.slug AS empresa,
       count(DISTINCT rv.id)                                       AS versiones,
       count(ri.id)                                                AS lineas,
       count(ri.id) FILTER (WHERE ri."mermaPorcentaje" > 0)        AS lineas_con_merma,
       count(ri.id) FILTER (WHERE ri."mermaPorcentaje" >= 100)     AS lineas_con_merma_100_o_mas,
       coalesce(max(ri."mermaPorcentaje"), 0)                      AS merma_maxima
  FROM "Empresa" e
  LEFT JOIN "RecetaVersion" rv ON rv."empresaId" = e.id
  LEFT JOIN "RecetaIngrediente" ri ON ri."empresaId" = rv."empresaId" AND ri."recetaVersionId" = rv.id
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 GROUP BY e.slug ORDER BY e.slug;

\echo
\echo '=== 2. RECETAS VIGENTES: la de mayor versión de cada producto y sucursal (central o propia) ==='
WITH vig AS (
  SELECT DISTINCT ON (rv."empresaId", rv."productoId", COALESCE(rv."sucursalId", ''))
         rv.id, rv."empresaId", rv."sucursalId"
    FROM "RecetaVersion" rv
   ORDER BY rv."empresaId", rv."productoId", COALESCE(rv."sucursalId", ''), rv.version DESC
)
SELECT e.slug AS empresa,
       count(DISTINCT vig.id)                                                   AS recetas_vigentes,
       count(DISTINCT vig.id) FILTER (WHERE vig."sucursalId" IS NOT NULL)       AS de_ellas_propias_de_sucursal,
       count(ri.id)                                                             AS lineas_vigentes,
       count(ri.id) FILTER (WHERE ri."mermaPorcentaje" > 0)                     AS vigentes_con_merma,
       count(ri.id) FILTER (WHERE ri."mermaPorcentaje" >= 100)                  AS vigentes_con_merma_100_o_mas
  FROM "Empresa" e
  LEFT JOIN vig ON vig."empresaId" = e.id
  LEFT JOIN "RecetaIngrediente" ri ON ri."empresaId" = vig."empresaId" AND ri."recetaVersionId" = vig.id
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 GROUP BY e.slug ORDER BY e.slug;

\echo
\echo '=== 3. CALIBRACIONES POR SUCURSAL con valor propio ==='
SELECT e.slug AS empresa,
       count(r.id)                                                AS calibraciones,
       count(r.id) FILTER (WHERE r.cantidad IS NOT NULL)          AS con_cantidad_propia,
       count(r.id) FILTER (WHERE r."mermaPorcentaje" IS NOT NULL) AS con_merma_propia
  FROM "Empresa" e LEFT JOIN "RendimientoLocalIngrediente" r ON r."empresaId" = e.id
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 GROUP BY e.slug ORDER BY e.slug;

\echo
\echo '=== 4. OPCIONES con merma (líneas que habría que convertir con la misma regla) ==='
SELECT e.slug AS empresa, count(c.id) AS lineas, count(c.id) FILTER (WHERE c."mermaPorcentaje" > 0) AS con_merma,
       count(c.id) FILTER (WHERE c."mermaPorcentaje" >= 100) AS con_merma_100_o_mas
  FROM "Empresa" e LEFT JOIN "ConsumoDeOpcion" c ON c."empresaId" = e.id
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 GROUP BY e.slug ORDER BY e.slug;
-- Las combinaciones por producto (GO-3a) se retiraron del código: este informe no las mira.

\echo
\echo '=== 5. PRODUCTOS QUE «SE PRODUCEN» (stock propio) ==='
SELECT e.slug AS empresa,
       count(p.id)                                            AS productos_que_se_producen,
       count(p.id) FILTER (WHERE p."pasoVenta" IS NOT NULL)   AS de_ellos_con_paso_de_venta
  FROM "Empresa" e LEFT JOIN "Producto" p ON p."empresaId" = e.id AND p."seProduce"
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 GROUP BY e.slug ORDER BY e.slug;

ROLLBACK;
