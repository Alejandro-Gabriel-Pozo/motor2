-- Verificación previa de 20261117130200_compras_permisos_orden_de_compra (datos: claves orden_de_compra_gestionar, compras_configurar y orden_de_compra_ver). SOLO LEE (transacción de solo lectura). Se corre con el rol dueño en CADA base real
-- ANTES de aprobar la migración (y de nuevo DESPUÉS, para comparar):
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261117130200_compras_permisos_orden_de_compra/verificacion-previa.sql
-- Devuelve SOLO cuentas (nunca nombres ni emails). Cómo leerla:
--   1. «roles_admin» y «roles_operador» son cuántos roles de clave `admin` y `operador` hay: tras la migración cada clave de gestión tiene `roles_admin` filas y `orden_de_compra_ver`, `roles_admin + roles_operador`.
--   2. «claves_ya_existentes» tiene que dar 0 antes de aplicar (si da más, alguien ya las cargó a mano: la migración no pisa nada, pero hay que mirar quién).
BEGIN READ ONLY;

SELECT (SELECT count(*) FROM "Empresa") AS empresas,
       (SELECT count(*) FROM "Rol" WHERE "clave" = 'admin') AS roles_admin,
       (SELECT count(*) FROM "Rol" WHERE "clave" = 'operador') AS roles_operador,
       (SELECT count(*) FROM "Accion" WHERE "clave" IN ('orden_de_compra_gestionar', 'compras_configurar', 'orden_de_compra_ver')) AS claves_ya_existentes,
       (SELECT count(*) FROM "PermisoRol" WHERE "accionClave" IN ('orden_de_compra_gestionar', 'compras_configurar', 'orden_de_compra_ver')) AS filas_de_permiso_ya_existentes;

-- DESPUÉS de aplicar (descomentar): filas por clave y quién más las tiene (debe dar 0 en «de_otro_rol»).
-- SELECT p."accionClave", count(*) AS filas, count(*) FILTER (WHERE r."clave" IS NULL OR r."clave" NOT IN ('admin', 'operador')) AS de_otro_rol
--   FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" IN ('orden_de_compra_gestionar', 'compras_configurar', 'orden_de_compra_ver') GROUP BY 1 ORDER BY 1;

ROLLBACK;
