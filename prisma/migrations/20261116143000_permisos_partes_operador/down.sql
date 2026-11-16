-- Reversa de 20261116143000_permisos_partes_operador (Parte, P1: el operador recibe `partes_ver` y `partes_editar`). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261116143000_permisos_partes_operador/down.sql
-- y después `prisma migrate resolve --rolled-back 20261116143000_permisos_partes_operador`.
-- Borra SOLO las filas del rol de clave `operador` para `partes_ver` y `partes_editar` que sigan EXACTAMENTE como las dejó la subida (Ver y Editar en true). ABORTA, sin tocar nada, si el estado ya no es el que dejó la subida:
-- una fila del operador con Ver o Editar apagado, una fila del operador para `partes_desactivar`, o una capacidad por sucursal sobre `partes_ver` o `partes_editar` (alguien configuró a mano). Antes de bajarla con configuración a mano, guardar
--   SELECT * FROM "PermisoRol" WHERE "accionClave" LIKE 'partes\_%'; SELECT * FROM "CapacidadSucursal" WHERE "accionClave" LIKE 'partes\_%';
-- LÍMITE HONESTO: no distingue una fila que el gerente dio a mano ANTES de la subida (la subida la dejó como estaba) de la que sembró la subida, si quedó igual a la semilla: ambas se borran. Respaldar antes.
-- ORDEN: esta se baja ANTES que 20261115152000_permisos_partes. IMPORTANTE: revertir el CÓDIGO (la semilla `rolesEditarSemilla` con operador) antes o a la vez. Idempotente (sin filas del operador no hace nada).

DO $$
DECLARE
  hay bigint;
BEGIN
  SELECT (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" IN ('partes_ver', 'partes_editar'))
       + (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
          WHERE r."clave" = 'operador'
            AND ((p."accionClave" IN ('partes_ver', 'partes_editar') AND (NOT p."puedeVer" OR NOT p."puedeEditar"))
              OR p."accionClave" = 'partes_desactivar'))
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261116143000_permisos_partes_operador: hay % fila(s) de configuración de las claves hecha a mano. Resguardalas y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DELETE FROM "PermisoRol" p USING "Rol" r
WHERE r."id" = p."rolId" AND r."clave" = 'operador'
  AND p."accionClave" IN ('partes_ver', 'partes_editar')
  AND p."puedeVer" AND p."puedeEditar";
