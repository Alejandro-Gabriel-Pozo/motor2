-- Reversa de 20261117119100_permisos_cierre_del_dia (Caja y cobro, cierre del día, etapa A, permisos). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261117119100_permisos_cierre_del_dia/down.sql
-- y después `prisma migrate resolve --rolled-back 20261117119100_permisos_cierre_del_dia`.
-- ABORTA, sin tocar nada, si alguien configuró algo a mano sobre las claves (una capacidad por sucursal, una fila de un rol que no es la semilla, o una de la semilla con Ver o Editar apagado). Si lo único que hay es la semilla
-- de la migración, borra las filas de `PermisoRol` y de `Accion`. Antes de bajarla con configuración a mano, guardar
--   SELECT * FROM "PermisoRol" WHERE "accionClave" IN ('caja_jornada_ver', 'caja_jornada_iniciar_auditoria', 'caja_jornada_cancelar_auditoria', 'caja_jornada_cerrar', 'caja_corregir_medio_de_cobro', 'caja_declarar_total', 'caja_registrar_ajuste');
--   SELECT * FROM "CapacidadSucursal" WHERE "accionClave" IN (…las mismas siete…);
-- IMPORTANTE: revertir el CÓDIGO que consulta estas claves antes (o a la vez). Idempotente.

DO $$
DECLARE
  hay bigint;
BEGIN
  SELECT (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" IN ('caja_jornada_ver', 'caja_jornada_iniciar_auditoria', 'caja_jornada_cancelar_auditoria', 'caja_jornada_cerrar', 'caja_corregir_medio_de_cobro', 'caja_declarar_total', 'caja_registrar_ajuste'))
       + (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
          WHERE p."accionClave" IN ('caja_jornada_ver', 'caja_jornada_iniciar_auditoria', 'caja_jornada_cancelar_auditoria', 'caja_jornada_cerrar', 'caja_corregir_medio_de_cobro', 'caja_declarar_total', 'caja_registrar_ajuste')
            AND (NOT p."puedeVer" OR NOT p."puedeEditar" OR r."clave" IS DISTINCT FROM 'admin'))
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117119100_permisos_cierre_del_dia: hay % fila(s) de configuración de las claves hecha a mano. Resguardalas y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" IN ('caja_jornada_ver', 'caja_jornada_iniciar_auditoria', 'caja_jornada_cancelar_auditoria', 'caja_jornada_cerrar', 'caja_corregir_medio_de_cobro', 'caja_declarar_total', 'caja_registrar_ajuste');
DELETE FROM "Accion" WHERE "clave" IN ('caja_jornada_ver', 'caja_jornada_iniciar_auditoria', 'caja_jornada_cancelar_auditoria', 'caja_jornada_cerrar', 'caja_corregir_medio_de_cobro', 'caja_declarar_total', 'caja_registrar_ajuste');
