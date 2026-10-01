import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración de datos 20261001140000_particion_permisos_motivos_traspasos: los Motivos de merma y los Destinos de consumo dejan de compartir
 * `motivos_movimiento`, y los traspasos dejan de colgar de `proceso_transferencia_sucursal` (una clave por acción más la de ver la bandeja).
 * Los dos padres se retiraron del catálogo del código en la misma partición.
 */
probarMigracionDeParticion({
  directorio: "20261001140000_particion_permisos_motivos_traspasos",
  titulo: "partición de las claves de motivos de merma/destinos de consumo y traspasos",
  sentenciasEsperadas: 3,
  contextoDePadresRetirados: { motivos_movimiento: "empresa", proceso_transferencia_sucursal: "sucursal" },
});
