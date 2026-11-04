/**
 * ORÁCULO del «Nombre en la carta» (2026-11-04; `docs/diseno-nombre-en-carta-2026-11-04.md`, §10): lo que DEBE verse como nombre del plato, escrito A MANO y aparte del código (convención de
 * `docs/diseno-arnes-de-matrices-2026-11-03.md`): no importa nada de `src/`, y si el código cambia de opinión este archivo no se entera.
 *
 * LAS DIMENSIONES (las que cambian lo que ve quien mira):
 *  - nombre: el producto no tiene «Nombre en la carta» (NULL), tiene uno, o tiene uno en blanco (no puede guardarse, pero una fila vieja o escrita a mano podría traerlo);
 *  - canal:  carta pública y carta impresa (arman la MISMA carta), vista previa del producto (admin) y «Va a mostrar» (admin, un producto que todavía no está en la carta);
 *  - forma:  producto directo, producto base (se vende por opción) o producto dentro de un ítem agrupado.
 *
 * LAS REGLAS (cada combinación cae en una sola):
 *  1. Con nombre en la carta, la carta pública, la impresa y la vista previa del producto lo muestran en lugar del interno, sea el producto directo o base.
 *  2. Sin nombre (NULL o en blanco), esos canales muestran el nombre interno.
 *  3. «Va a mostrar» describe un producto que todavía NO está en la carta: no tiene contenido, así que usa el nombre interno.
 *  4. Un producto DENTRO de un ítem agrupado no cambia nunca: el ítem se llama como el agrupado y sus opciones, como el producto interno (decisión del dueño: los agrupados no se tocan).
 *  5. (Colisión, abajo) Un nombre que ya usa otra cosa de la MISMA carta —el nombre en la carta de otro plato, el de un producto visible, un agrupado o una promo de la sucursal— se rechaza, sin distinguir mayúsculas ni tildes.
 */
export const NOMBRE = ["sin-nombre", "con-nombre", "en-blanco"] as const;
export const CANAL = ["publica", "impresa", "vista-previa", "va-a-mostrar"] as const;
export const FORMA = ["directo", "base", "agrupado"] as const;

/** Cuántas combinaciones tiene el producto de las dimensiones: 3 × 4 × 3. Si una dimensión gana un valor, este número y el test dejan de coincidir. */
export const TAMANO_DEL_PRODUCTO = 3 * 4 * 3;

export const NOMBRE_INTERNO = "Milanesa napolitana";
export const NOMBRE_DE_CARTA = "La Napo";

export interface Combinacion {
  nombre: (typeof NOMBRE)[number];
  canal: (typeof CANAL)[number];
  forma: (typeof FORMA)[number];
}

/** Lo que DEBE verse como nombre del plato (en el agrupado: como nombre de la opción). */
export function nombreEsperado({ nombre, canal, forma }: Combinacion): string {
  if (forma === "agrupado") return NOMBRE_INTERNO; // regla 4
  if (canal === "va-a-mostrar") return NOMBRE_INTERNO; // regla 3
  return nombre === "con-nombre" ? NOMBRE_DE_CARTA : NOMBRE_INTERNO; // reglas 1 y 2
}

/**
 * LA DIMENSIÓN «COLISIÓN» (regla del dueño, 2026-11-04: en la carta de una sucursal NO puede haber dos cosas con el mismo nombre visible). El nombre que se quiere guardar (o con el que se quiere mostrar un plato)
 * puede coincidir —sin distinguir mayúsculas ni tildes— con:
 *  - nada (sin choque);
 *  - el «Nombre en la carta» de OTRO plato VISIBLE de la sucursal;
 *  - el «Nombre en la carta» de otro plato OCULTO (no sale en la carta: NO es un choque; se vuelve a chequear al mostrarlo);
 *  - el nombre del producto de otro plato VISIBLE de la sucursal que sale con el interno;
 *  - el nombre del producto de otro plato OCULTO sin nombre en la carta (no sale en la carta: NO es un choque);
 *  - el nombre del producto de otra BASE visible (se vende por opción: el cliente lee los rótulos de sus opciones, no el nombre del producto; etapa posterior: NO es un choque en esta etapa);
 *  - un ítem agrupado de la sucursal;
 *  - una promo que se ofrece en la sucursal;
 *  - una promo de OTRA sucursal (no es de esta carta: NO es un choque);
 *  - el nombre en la carta de otro plato en OTRA sucursal (cada carta es propia: NO es un choque).
 */
export const COLISION = [
  "sin-choque",
  "nombre-en-carta-de-otro",
  "nombre-en-carta-de-otro-oculto",
  "interno-de-otro-visible",
  "interno-de-otro-oculto",
  "interno-de-otra-base",
  "agrupado",
  "promo",
  "promo-de-otra-sucursal",
  "nombre-en-carta-de-otra-sucursal",
] as const;
export const VARIANTE_DEL_NOMBRE = ["igual", "otras-mayusculas", "otras-tildes"] as const;

/** Cuántas combinaciones tiene colisión × variante: 10 × 3. */
export const TAMANO_DE_COLISION = 10 * 3;

/** Si el guardado DEBE rechazarse por nombre repetido (regla 5: solo choca lo que se ve en ESTA carta; la variante de mayúsculas o tildes no cambia nada). */
export function debeRechazarse(colision: (typeof COLISION)[number]): boolean {
  return colision === "nombre-en-carta-de-otro" || colision === "interno-de-otro-visible" || colision === "agrupado" || colision === "promo";
}
