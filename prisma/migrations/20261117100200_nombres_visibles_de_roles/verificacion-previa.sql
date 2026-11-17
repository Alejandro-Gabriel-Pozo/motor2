-- Verificación previa de 20261117100200_nombres_visibles_de_roles. SOLO LEE (transacción de solo lectura). Se corre con el rol dueño en CADA base real ANTES de aprobar la migración (y de nuevo DESPUÉS):
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261117100200_nombres_visibles_de_roles/verificacion-previa.sql
-- Devuelve SOLO cuentas (nunca nombres de empresa ni de persona). Cómo leerla:
--   «con_nombre_de_fabrica»: roles de fábrica que se van a renombrar (antes de aplicar: los de nombre 'operador'/'admin' menos los que se saltean; después: tiene que dar 0 salvo los salteados).
--   «renombrados_a_mano»: roles de fábrica con otro nombre: no se tocan.
--   «empresas_con_rol_empleado_o_administrador»: empresas que ya tienen OTRO rol con ese nombre: su rol de fábrica se saltea.
BEGIN READ ONLY;

SELECT count(*) FILTER (WHERE "clave" = 'operador' AND "nombre" = 'operador') AS operador_con_nombre_de_fabrica,
       count(*) FILTER (WHERE "clave" = 'admin' AND "nombre" = 'admin') AS admin_con_nombre_de_fabrica,
       count(*) FILTER (WHERE "clave" = 'operador' AND "nombre" NOT IN ('operador', 'empleado')) AS operador_renombrados_a_mano,
       count(*) FILTER (WHERE "clave" = 'admin' AND "nombre" NOT IN ('admin', 'administrador')) AS admin_renombrados_a_mano
FROM "Rol";

SELECT (SELECT count(DISTINCT "empresaId") FROM "Rol" WHERE lower("nombre") = 'empleado' AND "clave" IS DISTINCT FROM 'operador') AS empresas_con_otro_rol_empleado,
       (SELECT count(DISTINCT "empresaId") FROM "Rol" WHERE lower("nombre") = 'administrador' AND "clave" IS DISTINCT FROM 'admin') AS empresas_con_otro_rol_administrador;

ROLLBACK;
