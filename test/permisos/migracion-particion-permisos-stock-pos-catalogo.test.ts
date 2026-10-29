import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración de datos 20261001130000_particion_permisos_stock_pos_catalogo: 19 acciones de stock, conteo, promociones, POS y catálogo
 * dejan de colgar de la clave de otra y pasan a tener la suya (ver el banco de pruebas para lo que se comprueba).
 *
 * `pos_limite_mesas_abiertas` figura como retirada: la migración la creó, pero el código la sacó de `ACCIONES` el 2026-10-29 (decisión del dueño: se quitó el límite de mesas abiertas por sucursal); la base la conserva.
 */
probarMigracionDeParticion({
  directorio: "20261001130000_particion_permisos_stock_pos_catalogo",
  titulo: "partición de las claves de stock, conteo, promociones, POS y catálogo",
  sentenciasEsperadas: 7,
  contextoDePadres: { editar_producto: "mixto", promociones_config: "sucursal" },
  retiradasDespues: ["promociones_config", "promociones_activar", "promociones_marcar_combo", "pos_emitir_boleta_corregida", "pos_limite_mesas_abiertas"],
});
