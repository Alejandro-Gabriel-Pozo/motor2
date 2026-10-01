-- Reversa de la migración 20261001130000_particion_permisos_stock_pos_catalogo. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261001130000_particion_permisos_stock_pos_catalogo/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- Borra las claves nuevas y todo lo configurado sobre ellas desde la migración (los padres quedaron intactos en la fase expandir).

DELETE FROM "CapacidadSucursal" WHERE "accionClave" IN (
  'stock_seccion_habitual',
  'pos_emitir_boleta_corregida',
  'insumo_renombrar_fusionar',
  'conteo_resolver_pendiente',
  'stock_reclasificar',
  'conteo_frecuencia',
  'promociones_activar',
  'promociones_marcar_combo',
  'producto_ver_catalogo',
  'producto_presentaciones',
  'insumo_alta',
  'categoria_alta',
  'proveedor_alta',
  'producto_disponibilidad',
  'pos_alta_mesa',
  'pos_limite_mesas_abiertas',
  'pos_abrir_cuenta',
  'pos_enviar_a_cocina',
  'pos_liberar_mesa'
);
DELETE FROM "PermisoRol" WHERE "accionClave" IN (
  'stock_seccion_habitual',
  'pos_emitir_boleta_corregida',
  'insumo_renombrar_fusionar',
  'conteo_resolver_pendiente',
  'stock_reclasificar',
  'conteo_frecuencia',
  'promociones_activar',
  'promociones_marcar_combo',
  'producto_ver_catalogo',
  'producto_presentaciones',
  'insumo_alta',
  'categoria_alta',
  'proveedor_alta',
  'producto_disponibilidad',
  'pos_alta_mesa',
  'pos_limite_mesas_abiertas',
  'pos_abrir_cuenta',
  'pos_enviar_a_cocina',
  'pos_liberar_mesa'
);
DELETE FROM "Accion" WHERE "clave" IN (
  'stock_seccion_habitual',
  'pos_emitir_boleta_corregida',
  'insumo_renombrar_fusionar',
  'conteo_resolver_pendiente',
  'stock_reclasificar',
  'conteo_frecuencia',
  'promociones_activar',
  'promociones_marcar_combo',
  'producto_ver_catalogo',
  'producto_presentaciones',
  'insumo_alta',
  'categoria_alta',
  'proveedor_alta',
  'producto_disponibilidad',
  'pos_alta_mesa',
  'pos_limite_mesas_abiertas',
  'pos_abrir_cuenta',
  'pos_enviar_a_cocina',
  'pos_liberar_mesa'
);
UPDATE "Accion" SET "descripcion" = 'Renombrar/fusionar Familias y asignar Grupos' WHERE "clave" = 'grupos_familia';
UPDATE "Accion" SET "descripcion" = 'Activar Promociones y marcar productos como Combo' WHERE "clave" = 'promociones_config';
UPDATE "Accion" SET "descripcion" = 'Ver el mapa de mesas del salón y dar de alta mesas (POS)' WHERE "clave" = 'pos_mesas';
UPDATE "Accion" SET "descripcion" = 'Tomar pedidos en el salón: abrir la cuenta de una mesa, agregar y quitar ítems sin enviar, enviarlos a cocina y liberar una mesa sin consumo (POS)' WHERE "clave" = 'pos_tomar_pedido';
