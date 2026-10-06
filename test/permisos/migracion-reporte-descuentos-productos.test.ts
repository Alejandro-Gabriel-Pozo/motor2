import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración 20261001191000_reporte_descuentos_productos: clave propia del reporte «Descuentos de productos» (una clave por reporte). Es solo de
 * DATOS: cada rol hereda lo que ya tenía en `reporte_descuentos_clientes`, el reporte hermano.
 */
probarMigracionDeParticion({
  directorio: "20261001191000_reporte_descuentos_productos",
  titulo: "clave del reporte de descuentos de productos",
  sentenciasEsperadas: 3,
});
