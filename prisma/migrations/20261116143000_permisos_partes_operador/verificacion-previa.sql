-- Verificación previa de 20261116143000_permisos_partes_operador (datos: el operador recibe `partes_ver` y `partes_editar`). SOLO LEE (transacción de solo lectura). Se corre con el rol dueño en CADA base real ANTES de aprobar
-- la migración (y de nuevo DESPUÉS, para comparar):
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261116143000_permisos_partes_operador/verificacion-previa.sql
-- Devuelve SOLO cuentas (nunca nombres ni emails). Cómo leerla:
--   1. «roles_operador» es cuántas empresas tienen su rol de sistema `operador`: tras la migración cada clave (`partes_ver`, `partes_editar`) suma como mucho esa cantidad de filas del operador.
--   2. «empresas_sin_rol_operador» son las empresas SIN rol `operador` de sistema: no recibirían nada.
--   3. «filas_operador_ya_existentes» tiene que dar 0 antes de aplicar (si da más, el gerente ya las cargó a mano: la migración no pisa nada, pero hay que mirar quién).
--   4. «claves_partes_en_accion» tiene que dar 3 (la migración 20261115152000 ya aplicada: si da menos, aplicarla antes).
BEGIN READ ONLY;

SELECT (SELECT count(*) FROM "Empresa") AS empresas,
       (SELECT count(*) FROM "Rol" WHERE "clave" = 'operador') AS roles_operador,
       (SELECT count(*) FROM "Empresa" e WHERE NOT EXISTS (SELECT 1 FROM "Rol" r WHERE r."empresaId" = e."id" AND r."clave" = 'operador')) AS empresas_sin_rol_operador,
       (SELECT count(*) FROM "Accion" WHERE "clave" IN ('partes_ver', 'partes_editar', 'partes_desactivar')) AS claves_partes_en_accion,
       (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
         WHERE r."clave" = 'operador' AND p."accionClave" IN ('partes_ver', 'partes_editar', 'partes_desactivar')) AS filas_operador_ya_existentes;

-- DESPUÉS de aplicar (descomentar): filas del operador por clave (`partes_ver` y `partes_editar` = «roles_operador»; `partes_desactivar` = 0).
-- SELECT p."accionClave", count(*) AS filas_del_operador
--   FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE r."clave" = 'operador' AND p."accionClave" LIKE 'partes\_%' GROUP BY 1 ORDER BY 1;

ROLLBACK;
