import type { AjusteDePrecio } from "@/core/carta/public";
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
 *  - `YA_TIENE_CONTENIDO`: el producto ya tiene contenido de carta en esta sucursal en OTRA sección u oculto (no se pisa: se cambia desde su ficha). En la misma sección y visible es éxito sin cambio;
 *  - `ES_MIEMBRO_DE_AGRUPADO`: el producto ya sale en la carta DENTRO de un ítem agrupado de esta sucursal (D3: un PV agrupado nunca sale suelto); agregarlo suelto no lo mostraría y lo duplicaría.
 */
export type ResultadoAgregarProductoALaCarta = ResultadoCaso<
  { huboCambio: boolean },
  "PRODUCTO_NO_ENCONTRADO" | "NO_ES_PV" | "ES_ANCLA_DE_ADICIONAL" | "SECCION_NO_ENCONTRADA" | "SECCION_APAGADA" | "YA_TIENE_CONTENIDO" | "ES_MIEMBRO_DE_AGRUPADO"
>;

/**
 * «Quitar de la carta»: el producto vuelve a «Fuera de carta» (se BORRA su contenido de carta de esta sucursal, con la auditoría de cada dato que tenía). Decisión del dueño (2026-10-14): es el
 * «Deshacer» de «Agregar a la carta» y la salida de un producto que no tiene que estar en la carta. Si el contenido tiene algo cargado a mano (descripción, tags, ★ o género), se pierde: hace falta
 * `confirmado` (la pantalla lo pregunta); uno «virgen» (recién agregado) se quita sin preguntar.
 */
export interface ComandoQuitarProductoDeLaCarta {
  productoId: string;
  confirmado: boolean;
}

/** `HAY_DATOS_CARGADOS`: falta confirmar que se pierde lo cargado (no se borró nada). `PRODUCTO_NO_ENCONTRADO`: no existe (u otra empresa). Sin contenido: éxito sin cambio. */
export type ResultadoQuitarProductoDeLaCarta = ResultadoCaso<{ huboCambio: boolean }, "PRODUCTO_NO_ENCONTRADO" | "HAY_DATOS_CARGADOS">;

/** Tope de productos en UN pedido de «Hoy» (una sección entera o su «Deshacer»): lo valida el guard. */
export const MAXIMO_DE_CAMBIOS_DE_HOY = 200;

/**
 * «Hoy»: dejar disponibles o sin stock HOY varios productos de la sucursal activa (una sección entera, un producto o el «Deshacer» de lo anterior), TODO O NADA. Reusa la disponibilidad por
 * producto y sucursal que ya existe (`DisponibilidadProducto`, clave `producto_disponibilidad`) con sus mismas reglas, sin campo nuevo: «sin stock hoy» es «no disponible en esta sucursal» y queda
 * así hasta que alguien lo vuelva a prender (no se prende solo al terminar el día: hacerlo cambiaría el esquema).
 */
export interface ComandoFijarDisponibilidadDeHoy {
  /** Sin productos repetidos, de 1 a `MAXIMO_DE_CAMBIOS_DE_HOY`. */
  cambios: { productoId: string; disponible: boolean }[];
  /** D4: activar un PV a $0 exige `producto_campos_sensibles` (la calcula la Server Action con el gate, solo si alguno se activa). */
  puedeEditarCamposSensibles: boolean;
}

/** Si UNO no se puede (no existe, es el ancla de un adicional, está a $0 sin la clave fina o tiene dependencias al apagarlo), no se escribe NINGUNO y el mensaje dice cuál y por qué. */
export type ResultadoFijarDisponibilidadDeHoy = ResultadoCaso<
  { cambiados: number },
  "PRODUCTO_NO_ENCONTRADO" | "TIENE_DEPENDENCIAS" | "SIN_PERMISO_CAMPOS_SENSIBLES" | "ES_ANCLA_DE_ADICIONAL" | "BASE_INVALIDA"
>;

/** Tope de productos en UN ajuste de precios (una sección entera): lo valida el guard. */
export const MAXIMO_DE_PRECIOS_POR_AJUSTE = 200;

/**
 * F4 «Precios» (decisión del dueño, 2026-10-14): por defecto cambia el PRECIO LOCAL de ESTA sucursal (`PrecioLocalProducto`, clave `precio_local`); ajustar una sección entera (o un producto) con
 * la regla de `precioAjustado`, TODO O NADA. `precioVisto` es el precio de esta sucursal que mostró la vista previa: si alguno ya no es ese, no se aplica ninguno
 * (control de concurrencia sin columna de versión, como la grilla de las opciones).
 */
export interface ComandoAjustarPreciosDeLaCarta {
  ajuste: AjusteDePrecio;
  /** Sin productos repetidos, de 1 a `MAXIMO_DE_PRECIOS_POR_AJUSTE`. `precioVisto` con dos decimales («14900.00»). */
  items: { productoId: string; precioVisto: string }[];
}

/**
 *  - `PRECIO_LOCAL_APAGADO`: la sucursal no tiene prendido el precio local (lo que rige es el de lista de la empresa, que se cambia en Catálogo);
 *  - `PRODUCTO_NO_ENCONTRADO` / `NO_ES_PV`: un producto no existe (u otra empresa) o no es de venta;
 *  - `PRECIO_DESACTUALIZADO`: el precio de un producto cambió desde la vista previa (no se aplicó ninguno: hay que volver a mirarla).
 */
export type ResultadoAjustarPreciosDeLaCarta = ResultadoCaso<{ cambiados: number }, "PRECIO_LOCAL_APAGADO" | "PRODUCTO_NO_ENCONTRADO" | "NO_ES_PV" | "PRECIO_DESACTUALIZADO">;

/**
 * F4 «Precios», variante «En toda la empresa» (decisión del dueño): cambia el precio de LISTA de la empresa (`Producto.precioVenta`), que rige en todas las sucursales que no tienen un precio local
 * propio. Exige `producto_editar` y `producto_campos_sensibles` (como editar el precio en Catálogo) y la CONFIRMACIÓN explícita en el comando (la pantalla la pide con una casilla; el servidor la vuelve
 * a exigir). `precioVisto` es el precio de LISTA que mostró la vista previa.
 */
export interface ComandoAjustarPreciosDeLaEmpresa extends ComandoAjustarPreciosDeLaCarta {
  confirmado: boolean;
  /** Lo calcula la Server Action con el gate (`producto_campos_sensibles`). */
  puedeEditarCamposSensibles: boolean;
}

export type ResultadoAjustarPreciosDeLaEmpresa = ResultadoCaso<
  { cambiados: number },
  "SIN_PERMISO_CAMPOS_SENSIBLES" | "FALTA_CONFIRMAR" | "PRODUCTO_NO_ENCONTRADO" | "NO_ES_PV" | "PRECIO_DESACTUALIZADO"
>;
