-- Verificación de SOLO LECTURA antes del RETIRO DE GO-3a (ola «precio y carta», Fase 3, paso 3.7; ADR-032, «Fase 3: retiro de GO-3a»). Se corre ANTES de pedir el OK para aplicar
-- 20261022100000_retiro_go3a_rls y 20261022101000_retiro_go3a, una vez por base (por ahora, solo la de producción), y otra vez en el ensayo. Mira lo mismo que el bloque que ABORTA la migración de
-- esquema, para saberlo antes: filas en las seis tablas de GO-3a, ejes declarados en `ProductoAdmiteGrupo` y configuración de la clave `grupos_de_precio_definir` que no puso la migración de GO-3a.
-- Solo SELECT, SET y un bloque DO que lee (lo exige test/operaciones/verificar-retiro-go3a.test.ts, que además lo corre dentro de BEGIN READ ONLY): no escribe nada, no crea nada, no cambia
-- ningún rol. Las tablas se cuentan solo si existen (`to_regclass`): sirve antes y después del retiro (después, todo da 0 y las tablas figuran como inexistentes).
-- Uso (como el dueño o como cualquier rol que pueda leer las tablas; con psql o con el ejecutor, en modo simular):
--   psql <conexión a la base> -f scripts/operaciones/verificar-retiro-go3a.sql
--   node scripts/operaciones/ejecutar-sql-de-psql.mjs <archivo.env> scripts/operaciones/verificar-retiro-go3a.sql --simular --host-esperado <host>
-- Resultado esperado en producción: todo en 0 y el bloque final dice «verificación del retiro de GO-3a: nada bloquea». Si algo bloquea, el bloque final ABORTA con el detalle y NO se pide el OK.

-- 1) Estado de las migraciones de GO-3a y de su retiro (informativo): nombre, si terminó y si se bajó, como XML (sin la tabla de Prisma, lo dice).
SELECT CASE WHEN to_regclass('_prisma_migrations') IS NULL THEN 'no hay tabla _prisma_migrations'
            ELSE query_to_xml('SELECT migration_name, finished_at IS NOT NULL AS aplicada, rolled_back_at IS NOT NULL AS bajada FROM _prisma_migrations WHERE migration_name LIKE ''%go3a%'' ORDER BY migration_name, started_at', false, true, '')::text
       END AS migraciones_de_go3a;

-- 2) Filas de cada una de las seis tablas de GO-3a (BLOQUEA si alguna es mayor que 0). `existe = false`: la tabla ya no está (retiro aplicado o GO-3a nunca aplicada).
SELECT t AS tabla,
       to_regclass(format('%I', t)) IS NOT NULL AS existe,
       CASE WHEN to_regclass(format('%I', t)) IS NULL THEN 0
            ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', t), false, true, '')))[1]::text::bigint
       END AS filas
FROM unnest(ARRAY['GrupoDePrecio', 'CombinacionDeProducto', 'PrecioLocalDeCombinacion', 'RecetaDeCombinacionVersion', 'RecetaDeCombinacionIngrediente', 'CombinacionEnLinea']) AS t
ORDER BY t;

-- 3) Ejes de combinación declarados (BLOQUEA si es mayor que 0). `existe = false`: la columna ya no está.
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ProductoAdmiteGrupo' AND column_name = 'ejeDeCombinacion') AS existe,
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ProductoAdmiteGrupo' AND column_name = 'ejeDeCombinacion') THEN 0
            ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM "ProductoAdmiteGrupo" WHERE "ejeDeCombinacion" IS NOT NULL', false, true, '')))[1]::text::bigint
       END AS ejes_declarados;

-- 4) La clave `grupos_de_precio_definir`: su fila en `Accion`, las de `PermisoRol` (la semilla es el rol `admin` de cada empresa con Ver y Editar) y la configuración que NO es la semilla, que BLOQUEA.
SELECT count(*) AS en_accion FROM "Accion" WHERE "clave" = 'grupos_de_precio_definir';
SELECT count(*) AS filas_en_permiso_rol,
       count(*) FILTER (WHERE r."clave" IS DISTINCT FROM 'admin' OR NOT p."puedeVer" OR NOT p."puedeEditar") AS no_semilla_bloquea
FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
WHERE p."accionClave" = 'grupos_de_precio_definir';
SELECT count(*) AS capacidades_bloquea FROM "CapacidadSucursal" WHERE "accionClave" = 'grupos_de_precio_definir';

-- 5) Informativo (NO bloquea): auditoría de las entidades retiradas (las filas quedan; la pantalla de auditoría deja de ofrecerlas como filtro) y el total de líneas del POS.
SELECT "entidad", count(*) AS filas_de_auditoria
FROM "RegistroAuditoria"
WHERE "entidad" IN ('GrupoDePrecio', 'CombinacionDeProducto', 'PrecioLocalDeCombinacion', 'RecetaDeCombinacionVersion')
GROUP BY "entidad"
ORDER BY "entidad";
SELECT count(*) AS lineas_de_cuenta FROM "CuentaItem";

-- 6) El veredicto: ABORTA (RAISE EXCEPTION) si algo de lo que bloquea es mayor que 0; si no, avisa que nada bloquea. Solo lee.
DO $$
DECLARE
  filas bigint := 0;
  ejes bigint := 0;
  configuracion bigint := 0;
  n bigint;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['GrupoDePrecio', 'CombinacionDeProducto', 'PrecioLocalDeCombinacion', 'RecetaDeCombinacionVersion', 'RecetaDeCombinacionIngrediente', 'CombinacionEnLinea'] LOOP
    IF to_regclass(format('%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      filas := filas + n;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ProductoAdmiteGrupo' AND column_name = 'ejeDeCombinacion') THEN
    EXECUTE 'SELECT count(*) FROM "ProductoAdmiteGrupo" WHERE "ejeDeCombinacion" IS NOT NULL' INTO ejes;
  END IF;
  SELECT (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
           WHERE p."accionClave" = 'grupos_de_precio_definir' AND (r."clave" IS DISTINCT FROM 'admin' OR NOT p."puedeVer" OR NOT p."puedeEditar"))
       + (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" = 'grupos_de_precio_definir')
  INTO configuracion;
  IF filas + ejes + configuracion > 0 THEN
    RAISE EXCEPTION 'verificación del retiro de GO-3a: BLOQUEA (% fila(s) en las tablas de GO-3a, % eje(s) declarado(s), % fila(s) de configuración de la clave que no es la semilla). No pedir el OK: resguardar y decidir antes.', filas, ejes, configuracion;
  END IF;
  RAISE NOTICE 'verificación del retiro de GO-3a: nada bloquea (0 filas, 0 ejes, la clave solo con la semilla).';
END
$$;
