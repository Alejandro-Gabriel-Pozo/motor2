-- Verificación previa de 20261117120200_compras_permiso_controlar_recepcion (datos: clave compra_controlar_recepcion). SOLO LEE (transacción de solo lectura). Se corre con el rol dueño en CADA base real ANTES de aprobar la migración
-- (y de nuevo DESPUÉS, para comparar):
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261117120200_compras_permiso_controlar_recepcion/verificacion-previa.sql
-- Devuelve SOLO cuentas (nunca nombres ni emails). Cómo leerla:
--   1. «roles_semilla» es cuántos roles de clave `admin` u `operador` hay: tras la migración la clave tiene exactamente esa cantidad de filas.
--   2. «clave_ya_existente» tiene que dar 0 antes de aplicar (si da 1, alguien ya la cargó a mano: la migración no pisa nada, pero hay que mirar quién).
BEGIN READ ONLY;

SELECT (SELECT count(*) FROM "Empresa") AS empresas,
       (SELECT count(*) FROM "Rol" WHERE "clave" IN ('admin', 'operador')) AS roles_semilla,
       (SELECT count(*) FROM "Accion" WHERE "clave" = 'compra_controlar_recepcion') AS clave_ya_existente,
       (SELECT count(*) FROM "PermisoRol" WHERE "accionClave" = 'compra_controlar_recepcion') AS filas_de_permiso_ya_existentes;

-- DESPUÉS de aplicar (descomentar): filas y quién más la tiene (debe dar 0).
-- SELECT count(*) AS filas, count(*) FILTER (WHERE r."clave" IS NULL OR r."clave" NOT IN ('admin', 'operador')) AS de_otro_rol
--   FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = 'compra_controlar_recepcion';

ROLLBACK;
