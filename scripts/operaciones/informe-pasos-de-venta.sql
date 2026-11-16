-- INFORME DE SOLO LECTURA (frente 2, etapa A1): pasos de venta de los productos y qué haría con ellos la conversión a fracciones (½, ¼, ⅛).
-- NO escribe nada, NO es una migración, NO cambia ningún dato. La transacción es READ ONLY (declarada antes de la primera consulta) y termina con ROLLBACK.
-- Diseño: docs/diseno-fracciones-y-peso-como-pedernal-2026-11-15.md (§8, E1b) y docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16-fracciones.md.
-- Es la MISMA regla que `convertirPasoLibre` (src/core/catalogo/conversion-de-paso-libre.ts), escrita en SQL; una prueba de este informe la compara con la función pura caso por caso.
--
-- El «paso de venta» (`Producto.pasoVenta`) es lo menos que se puede vender de un producto (nulo o 1 = de a una unidad entera; 0,5 = media; 0,25…). La conversión propuesta lleva cada paso libre
-- a una de las fracciones permitidas (solo 2, 4 y 8), SIN redondear en silencio:
--   NADA                      el producto ya vende de a una unidad entera (paso nulo o 1): no hay nada que convertir.
--   AUTOMATICA                el paso es EXACTAMENTE 0,5 / 0,25 / 0,125: se completa solo la fracción; el paso no cambia y la venta se comporta igual.
--   PENDIENTE_CON_PROPUESTA   otro paso que la regla vigente admite (por ejemplo 0,2): hay una fracción más cercana (empate → la más fina), pero la confirma una persona, producto por producto.
--   PENDIENTE_SIN_PROPUESTA   un paso que la regla no admite (por ejemplo 0,3), una unidad que no es de conteo (las fracciones son solo de conteo), o un producto de masa o volumen sin paso:
--                             no se propone nada; la persona elige.
-- Solo se miran los productos de venta (tipo PV).
--
-- Qué mide (tres bloques):
--   1. Resumen por empresa según lo que haría la conversión.
--   2. Detalle de todo lo que NO es «NADA» (lo que hay que mirar o confirmar), con el paso actual y el resultante.
--   3. Productos que «se producen» con un paso de venta: su paso no puede ser más fino que los decimales de su unidad de stock (regla R3 vigente); importa para decidir los decimales del stock.
--
-- Uso (la URL por entorno, nunca en el repo). Correr SIEMPRE como DUEÑO de la base (ve todas las empresas). Con el rol de la aplicación el aislamiento por empresa y por sucursal (RLS) recorta lo que ve y los conteos dan MENOS: no sirve para este informe.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/operaciones/informe-pasos-de-venta.sql
-- Variable opcional:  -v slug=<slug>  (limita el informe a una empresa).
-- La salida lleva nombres de productos: es PRIVADA, no se pega en el repositorio.

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
\echo '=== 1. RESUMEN POR EMPRESA: qué haría la conversión con los productos de venta ==='
WITH pv AS (
  SELECT p."empresaId", p.id, p.nombre, p."pasoVenta", p."seProduce", u.magnitud::text AS magnitud, u.decimales,
         CASE WHEN p."pasoVenta" IS NULL THEN NULL ELSE (p."pasoVenta" * 10000)::bigint END AS d   -- diezmilésimos: la columna es Decimal(14,4), exacto
    FROM "Producto" p JOIN "Unidad" u ON u.id = p."unidadStockId" AND u."empresaId" = p."empresaId"
   WHERE p.tipo = 'PV'
), r AS (
  SELECT pv.*,
    CASE
      WHEN d IS NULL AND magnitud = 'CANTIDAD' THEN 'NADA'
      WHEN d IS NULL                           THEN 'PENDIENTE_SIN_PROPUESTA'
      WHEN d = 10000                           THEN 'NADA'
      WHEN magnitud <> 'CANTIDAD'              THEN 'PENDIENTE_SIN_PROPUESTA'
      WHEN d < 1 OR d > 10000 OR 100000000 % d <> 0 THEN 'PENDIENTE_SIN_PROPUESTA'
      WHEN d IN (5000, 2500, 1250)             THEN 'AUTOMATICA'
      ELSE 'PENDIENTE_CON_PROPUESTA'
    END AS resultado
    FROM pv
)
SELECT e.slug AS empresa, count(r.id) AS productos_de_venta,
       count(r.id) FILTER (WHERE r.resultado = 'NADA')                    AS nada,
       count(r.id) FILTER (WHERE r.resultado = 'AUTOMATICA')              AS automatica,
       count(r.id) FILTER (WHERE r.resultado = 'PENDIENTE_CON_PROPUESTA') AS pendiente_con_propuesta,
       count(r.id) FILTER (WHERE r.resultado = 'PENDIENTE_SIN_PROPUESTA') AS pendiente_sin_propuesta
  FROM "Empresa" e LEFT JOIN r ON r."empresaId" = e.id
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 GROUP BY e.slug ORDER BY e.slug;

\echo
\echo '=== 2. DETALLE: todo lo que NO es «NADA» ==='
WITH pv AS (
  SELECT p."empresaId", p.id, p.nombre, p."pasoVenta", p."seProduce", u.nombre AS unidad, u.magnitud::text AS magnitud,
         CASE WHEN p."pasoVenta" IS NULL THEN NULL ELSE (p."pasoVenta" * 10000)::bigint END AS d
    FROM "Producto" p JOIN "Unidad" u ON u.id = p."unidadStockId" AND u."empresaId" = p."empresaId"
   WHERE p.tipo = 'PV'
), r AS (
  SELECT pv.*,
    CASE
      WHEN d IS NULL AND magnitud = 'CANTIDAD' THEN 'NADA'
      WHEN d IS NULL                           THEN 'PENDIENTE_SIN_PROPUESTA'
      WHEN d = 10000                           THEN 'NADA'
      WHEN magnitud <> 'CANTIDAD'              THEN 'PENDIENTE_SIN_PROPUESTA'
      WHEN d < 1 OR d > 10000 OR 100000000 % d <> 0 THEN 'PENDIENTE_SIN_PROPUESTA'
      WHEN d IN (5000, 2500, 1250)             THEN 'AUTOMATICA'
      ELSE 'PENDIENTE_CON_PROPUESTA'
    END AS resultado
    FROM pv
)
SELECT e.slug AS empresa, r.nombre AS producto, r.unidad AS unidad_de_stock, r."pasoVenta" AS paso_actual, r.resultado,
       CASE WHEN r.resultado IN ('AUTOMATICA', 'PENDIENTE_CON_PROPUESTA') THEN f.porcion END AS fraccion_propuesta,
       CASE WHEN r.resultado IN ('AUTOMATICA', 'PENDIENTE_CON_PROPUESTA') THEN f.paso END    AS paso_resultante,
       CASE WHEN r."seProduce" THEN 'sí' ELSE 'no' END AS se_produce
  FROM r
  JOIN "Empresa" e ON e.id = r."empresaId"
  LEFT JOIN LATERAL (
        SELECT v.porcion, v.paso FROM (VALUES (2, 0.5000), (4, 0.2500), (8, 0.1250)) AS v(porcion, paso)
         ORDER BY abs(r."pasoVenta" - v.paso), v.porcion DESC LIMIT 1) f ON true   -- empate → la más fina (mayor porción)
 WHERE r.resultado <> 'NADA'
   AND (current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug'))
 ORDER BY e.slug, r.resultado, r.nombre;

\echo
\echo '=== 3. PRODUCTOS QUE «SE PRODUCEN» CON PASO DE VENTA: su paso no puede ser más fino que los decimales de su unidad de stock (regla R3 vigente) ==='
SELECT e.slug AS empresa, p.nombre AS producto, u.nombre AS unidad_de_stock, u.decimales AS decimales_de_la_unidad, p."pasoVenta" AS paso_actual,
       scale(trim_scale(p."pasoVenta")) AS decimales_del_paso,
       CASE WHEN scale(trim_scale(p."pasoVenta")) > u.decimales THEN 'EL PASO ES MÁS FINO QUE LA UNIDAD' ELSE 'cabe' END AS resultado
  FROM "Producto" p
  JOIN "Unidad" u ON u.id = p."unidadStockId" AND u."empresaId" = p."empresaId"
  JOIN "Empresa" e ON e.id = p."empresaId"
 WHERE p."seProduce" AND p."pasoVenta" IS NOT NULL
   AND (current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug'))
 ORDER BY e.slug, p.nombre;

ROLLBACK;
