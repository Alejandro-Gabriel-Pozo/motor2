import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «mantenimiento de la carta» (CARTA-MANT, prototipo aprobado «Mantenimiento / Parametrización»; ADR-034). Todo se escribe SOLO en la sucursal ACTIVA:
 * el guard compara la sucursal que vio la pantalla con la activa (eco) antes de tocar la base.
 */

/**
 * «Agregar a la carta» un producto que está FUERA de carta (sin contenido de carta en esta sucursal: el POS y el menú del día), de un toque: visible, en la sección elegida y al final de ella.
 * Nunca pisa un contenido que ya exista (para eso está su ficha).
 */
export interface ComandoAgregarProductoALaCarta {
  productoId: string;
  seccionCartaId: string;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO` / `NO_ES_PV` / `ES_ANCLA_DE_ADICIONAL`: el producto no existe (u otra empresa), no es de venta o es el respaldo de un adicional (se vende solo como adicional);
 *  - `SECCION_NO_ENCONTRADA` / `SECCION_APAGADA`: la sección no existe o está apagada (no saldría en la carta);
 *  - `YA_TIENE_CONTENIDO`: el producto ya tiene contenido de carta en esta sucursal en OTRA sección u oculto (no se pisa: se cambia desde su ficha). En la misma sección y visible es éxito sin cambio.
 */
export type ResultadoAgregarProductoALaCarta = ResultadoCaso<
  { huboCambio: boolean },
  "PRODUCTO_NO_ENCONTRADO" | "NO_ES_PV" | "ES_ANCLA_DE_ADICIONAL" | "SECCION_NO_ENCONTRADA" | "SECCION_APAGADA" | "YA_TIENE_CONTENIDO"
>;
