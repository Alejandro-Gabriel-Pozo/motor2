-- Verificación previa de 20261117119200_permisos_cuentas_y_medios (datos: las ocho claves de administración de la caja (cuentas de cobro y medios de pago)). SOLO LEE (transacción de solo lectura). Se corre con el rol dueño en CADA base real ANTES de aprobar la migración
-- (y de nuevo DESPUÉS, para comparar):
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261117119200_permisos_cuentas_y_medios/verificacion-previa.sql
-- Devuelve SOLO cuentas (nunca nombres ni emails). Cómo leerla:
--   1. «roles_admin» es cuántas empresas tienen su rol de sistema `admin`: tras la migración cada clave tiene exactamente esa cantidad de filas.
--   2. «claves_ya_existentes» tiene que dar 0 antes de aplicar (si da más, alguien ya las cargó a mano: la migración no pisa nada, pero hay que mirar quién).
--   3. «roles_sin_clave_admin» son las empresas SIN rol `admin` de sistema: no recibirían nada (nadie podría usar el cierre del día hasta que el gerente asigne las claves en la matriz).
BEGIN READ ONLY;

SELECT (SELECT count(*) FROM "Empresa") AS empresas,
       (SELECT count(*) FROM "Rol" WHERE "clave" = 'admin') AS roles_admin,
       (SELECT count(*) FROM "Empresa" e WHERE NOT EXISTS (SELECT 1 FROM "Rol" r WHERE r."empresaId" = e."id" AND r."clave" = 'admin')) AS roles_sin_clave_admin,
       (SELECT count(*) FROM "Accion" WHERE "clave" IN ('caja_medio_de_pago_crear', 'caja_medio_de_pago_editar', 'caja_medio_de_pago_reactivar', 'caja_medio_de_pago_desactivar', 'caja_cuenta_de_cobro_crear', 'caja_cuenta_de_cobro_editar', 'caja_cuenta_de_cobro_reactivar', 'caja_cuenta_de_cobro_desactivar')) AS claves_ya_existentes,
       (SELECT count(*) FROM "PermisoRol" WHERE "accionClave" IN ('caja_medio_de_pago_crear', 'caja_medio_de_pago_editar', 'caja_medio_de_pago_reactivar', 'caja_medio_de_pago_desactivar', 'caja_cuenta_de_cobro_crear', 'caja_cuenta_de_cobro_editar', 'caja_cuenta_de_cobro_reactivar', 'caja_cuenta_de_cobro_desactivar')) AS filas_de_permiso_ya_existentes;

-- DESPUÉS de aplicar (descomentar): filas por clave (cada una debe igualar a «roles_admin») y quién más la tiene (debe dar 0).
-- SELECT p."accionClave", count(*) AS filas, count(*) FILTER (WHERE r."clave" IS DISTINCT FROM 'admin') AS de_otro_rol
--   FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
--  WHERE p."accionClave" IN ('caja_medio_de_pago_crear', 'caja_medio_de_pago_editar', 'caja_medio_de_pago_reactivar', 'caja_medio_de_pago_desactivar', 'caja_cuenta_de_cobro_crear', 'caja_cuenta_de_cobro_editar', 'caja_cuenta_de_cobro_reactivar', 'caja_cuenta_de_cobro_desactivar') GROUP BY 1 ORDER BY 1;

ROLLBACK;
