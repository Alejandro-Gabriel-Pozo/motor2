-- Reversa de la migración 20261001140000_particion_permisos_motivos_traspasos. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261001140000_particion_permisos_motivos_traspasos/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- Borra las claves nuevas y todo lo configurado sobre ellas desde la migración (los padres quedaron intactos en la fase expandir).

DELETE FROM "CapacidadSucursal" WHERE "accionClave" IN (
  'motivos_merma',
  'motivos_destino_consumo',
  'traspaso_ver_bandeja',
  'traspaso_solicitar',
  'traspaso_enviar_directo',
  'traspaso_aprobar',
  'traspaso_cancelar_solicitud',
  'traspaso_rechazar_solicitud',
  'traspaso_aceptar',
  'traspaso_rechazar_envio',
  'traspaso_confirmar_reingreso'
);
DELETE FROM "PermisoRol" WHERE "accionClave" IN (
  'motivos_merma',
  'motivos_destino_consumo',
  'traspaso_ver_bandeja',
  'traspaso_solicitar',
  'traspaso_enviar_directo',
  'traspaso_aprobar',
  'traspaso_cancelar_solicitud',
  'traspaso_rechazar_solicitud',
  'traspaso_aceptar',
  'traspaso_rechazar_envio',
  'traspaso_confirmar_reingreso'
);
DELETE FROM "Accion" WHERE "clave" IN (
  'motivos_merma',
  'motivos_destino_consumo',
  'traspaso_ver_bandeja',
  'traspaso_solicitar',
  'traspaso_enviar_directo',
  'traspaso_aprobar',
  'traspaso_cancelar_solicitud',
  'traspaso_rechazar_solicitud',
  'traspaso_aceptar',
  'traspaso_rechazar_envio',
  'traspaso_confirmar_reingreso'
);

