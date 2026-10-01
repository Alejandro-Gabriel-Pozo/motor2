import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración de datos 20261001150000_particion_permisos_carta: la clave única `carta` se parte en una por bloque de administración de la carta
 * pública (ver, secciones, géneros, contenido de cada producto, ítems agrupados, portal, promos y tema). El padre se retiró del catálogo del
 * código en la misma partición.
 */
probarMigracionDeParticion({
  directorio: "20261001150000_particion_permisos_carta",
  titulo: "partición de la clave de la carta pública",
  sentenciasEsperadas: 3,
  contextoDePadres: { carta: "mixto" },
});
