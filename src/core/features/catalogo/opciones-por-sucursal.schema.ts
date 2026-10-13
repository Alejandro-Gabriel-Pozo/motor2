
/**
 * Tipos de la feature «opciones de venta en la sucursal» (GO-2a; ADR-030 §5): apagar o prender una opción en la sucursal ACTIVA (`opcion_apagar_en_sucursal`, ADR-009 familia `optout`:
 * sin fila = prendida) y la grilla del precio de una MEDIDA en modo ABSOLUTO para un producto en la sucursal ACTIVA (`precio_local`, familia `override`: sin fila habilitada rige el
 * precio de la empresa). Las dos se escriben SOLO en la sucursal activa: el guard compara la sucursal que vio la pantalla con la activa (eco) antes de tocar la base.
 */

/** «Llevar la opción al estado `apagada`» en la sucursal activa. Si ya está así, no se escribe ni se audita. */
export interface ComandoApagarOpcionEnSucursal {
  opcionId: string;
  apagada: boolean;
}


/** Lo que la pantalla veía de la grilla de esa opción en la sucursal: el precio y si regía; `null` = no había fila. */
export interface PrecioLocalVisto {
  precio: number;
  habilitado: boolean;
}

/** El precio de la opción para el producto en la sucursal activa; `precio: null` = dar de baja la grilla (vuelve a regir el de la empresa: `habilitado = false`). */
export interface ComandoFijarPrecioLocalDeOpcion {
  productoId: string;
  opcionId: string;
  esperado: PrecioLocalVisto | null;
  precio: number | null;
}

