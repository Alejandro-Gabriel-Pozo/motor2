import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración de datos 20261001170000_particion_permisos_producto: la clave `editar_producto` (la última «mixta») se parte en `producto_editar`,
 * `producto_asignar_insumo` y `producto_sincronizar_precio_carta`, las tres de empresa. El padre se retiró del catálogo del código en la misma partición.
 */
probarMigracionDeParticion({
  directorio: "20261001170000_particion_permisos_producto",
  titulo: "partición de la clave de edición de productos",
  sentenciasEsperadas: 3,
  contextoDePadres: { editar_producto: "mixto" },
});
