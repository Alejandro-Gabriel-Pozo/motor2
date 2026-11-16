-- Verificación previa de 20261117100000_planes_versionados (planes versionados, M1). SOLO LEE (transacción de solo lectura). Se corre con el rol dueño en CADA base real ANTES de aprobar la migración
-- (y de nuevo DESPUÉS, comparando):
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261117100000_planes_versionados/verificacion-previa.sql
-- Devuelve SOLO cuentas y nombres de módulo (nunca nombres de empresa ni emails). Cómo leerla:
--   1. «empresas»: cuántas empresas recibirán la asignación de transición (una cada una). Tras la migración «asignaciones_de_transicion» tiene que dar el mismo número.
--   2. «modulos_activos_por_modulo»: cuántas empresas tienen hoy cada módulo ACTIVO. El plan «actual» abre LOS 9 vendibles a TODA empresa: si alguna cifra es menor que «empresas», esa empresa recibiría un módulo
--      que hoy NO tiene activo (por eso hay que volver a preguntar al dueño antes de aplicar: ¿«todos los disponibles» o «solo los que cada empresa tiene hoy»?). En M1 el plan no se aplica al guard: no cambia
--      lo que la empresa ve; el riesgo aparece cuando se conecte (M1b).
--   3. «tablas_de_planes_ya_existentes» tiene que dar 0 antes de aplicar.
BEGIN READ ONLY;

SELECT (SELECT count(*) FROM "Empresa") AS empresas,
       (SELECT count(*) FROM "Empresa" WHERE "estado" <> 'ACTIVE') AS empresas_no_activas,
       (SELECT count(*) FROM pg_class WHERE relname IN ('Plan', 'VersionDePlan', 'PlanDeEmpresa') AND relkind = 'r') AS tablas_de_planes_ya_existentes;

SELECT m."modulo", count(*) FILTER (WHERE me."estado" = 'ACTIVO') AS empresas_con_el_modulo_activo
FROM (VALUES ('stock'), ('compras'), ('traspasos'), ('consignacion'), ('recetas'), ('produccion'), ('carta'), ('promociones'), ('salon')) AS m("modulo")
LEFT JOIN "ModuloEmpresa" me ON me."modulo" = m."modulo"
GROUP BY m."modulo" ORDER BY m."modulo";

-- DESPUÉS de aplicar (descomentar): una asignación de transición por empresa y ninguna sin plan.
-- SELECT (SELECT count(*) FROM "PlanDeEmpresa" WHERE "origen" = 'TRANSICION') AS asignaciones_de_transicion,
--        (SELECT count(*) FROM "Empresa" e WHERE NOT EXISTS (SELECT 1 FROM "PlanDeEmpresa" p WHERE p."empresaId" = e."id")) AS empresas_sin_plan;

ROLLBACK;
