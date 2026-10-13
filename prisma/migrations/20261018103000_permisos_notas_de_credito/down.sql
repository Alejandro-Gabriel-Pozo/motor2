-- Reversa del alta de las tres claves de la nota de crédito de proveedor (Paquete 4, M6.4): `nota_credito_proveedor`, `gasto_nota_credito` y `anular_nota_credito_proveedor`. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261018103000_permisos_notas_de_credito/down.sql
-- y después `prisma migrate resolve --rolled-back 20261018103000_permisos_notas_de_credito`.
-- Es una variante DELIBERADA de la reversa de M4.5 (que borra todo): esta ABORTA, sin tocar nada, si alguien configuró algo a mano sobre las tres claves (una capacidad por sucursal, o una fila de un rol que no es `admin`, o una del admin con Ver o Editar apagado). Si lo único que hay es
-- la semilla de la migración (el rol `admin` de cada empresa, con Ver y Editar), borra las filas de `PermisoRol` y de `Accion` en ese orden. Antes de bajarla con configuración a mano, guardar
--   SELECT * FROM "PermisoRol" WHERE "accionClave" IN ('nota_credito_proveedor','gasto_nota_credito','anular_nota_credito_proveedor');
--   SELECT * FROM "CapacidadSucursal" WHERE "accionClave" IN ('nota_credito_proveedor','gasto_nota_credito','anular_nota_credito_proveedor');
-- Orden de la reversa del Paquete 4: M6.4, M6.3, M6.2, M6.1, M5, M4.5, M4.4, M4.3, M4.2 y M4.1. IMPORTANTE: revertir el CÓDIGO de la Etapa C antes (o a la vez). Idempotente.

DO $$
DECLARE
  hay bigint;
BEGIN
  SELECT (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" IN ('nota_credito_proveedor', 'gasto_nota_credito', 'anular_nota_credito_proveedor'))
       + (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
          WHERE p."accionClave" IN ('nota_credito_proveedor', 'gasto_nota_credito', 'anular_nota_credito_proveedor')
            AND (r."clave" IS DISTINCT FROM 'admin' OR NOT p."puedeVer" OR NOT p."puedeEditar"))
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar M6.4: hay % fila(s) de configuración de las claves de notas de crédito hecha a mano. Resguardalas y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" IN ('nota_credito_proveedor', 'gasto_nota_credito', 'anular_nota_credito_proveedor');
DELETE FROM "Accion" WHERE "clave" IN ('nota_credito_proveedor', 'gasto_nota_credito', 'anular_nota_credito_proveedor');
