-- Reversa de la migración 20261001160000_particion_permisos_administracion. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261001160000_particion_permisos_administracion/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- Borra las claves nuevas y todo lo configurado sobre ellas desde la migración (los padres quedaron intactos en la fase expandir) y restituye
-- las descripciones anteriores de los padres.

DELETE FROM "CapacidadSucursal" WHERE "accionClave" IN (
  'gestion_roles',
  'activar_usuario_sucursal',
  'notas_usuario_sucursal',
  'apagar_cuenta_empresa',
  'activar_sucursal',
  'renombrar_sucursal',
  'ver_auditoria_empresa'
);
DELETE FROM "PermisoRol" WHERE "accionClave" IN (
  'gestion_roles',
  'activar_usuario_sucursal',
  'notas_usuario_sucursal',
  'apagar_cuenta_empresa',
  'activar_sucursal',
  'renombrar_sucursal',
  'ver_auditoria_empresa'
);
DELETE FROM "Accion" WHERE "clave" IN (
  'gestion_roles',
  'activar_usuario_sucursal',
  'notas_usuario_sucursal',
  'apagar_cuenta_empresa',
  'activar_sucursal',
  'renombrar_sucursal',
  'ver_auditoria_empresa'
);

UPDATE "Accion" SET "descripcion" = 'Gestionar usuarios y roles' WHERE "clave" = 'gestion_usuarios';
UPDATE "Accion" SET "descripcion" = 'Gestionar qué rol puede hacer cada acción' WHERE "clave" = 'gestion_permisos';
UPDATE "Accion" SET "descripcion" = 'Ver el registro de auditoría administrativa (precios y permisos)' WHERE "clave" = 'ver_auditoria';
