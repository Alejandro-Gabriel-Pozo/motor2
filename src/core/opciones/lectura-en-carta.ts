import type { TipoDeGrupoDeOpciones } from "./tipos";

/**
 * «Se lee en la carta como» (Fase 4 de la ola «precio y carta», ADR-035, DEC-34): cómo lee la CARTA una opción de un grupo que tiene prefijo (`GrupoDeOpciones.prefijoEnCarta`). Puro, sin Prisma.
 *
 * Con prefijo, la opción se lee «prefijo + opción con la PRIMERA LETRA en minúscula» («De» + «Carne» → «De carne»). La minúscula es la de la primera letra Unicode (el primer punto de código) con las
 * reglas de `es-AR`, sin excepción para siglas («BBQ» → «bBQ», decisión del dueño: si hace falta, se agrega). Sin prefijo, la opción se lee con su nombre tal cual. La opción «ninguna» se lee siempre
 * tal cual (nunca lleva el prefijo ni la minúscula). Solo la usa la carta (en esta fase, la lectura en vivo del formulario del grupo); el POS y el ticket muestran grupo y opción tal cual.
 */
export function leerOpcionEnCarta(prefijo: string | null, opcion: { nombre: string; esNinguna: boolean }): string {
  if (!tienePrefijo(prefijo) || opcion.esNinguna) return opcion.nombre;
  return `${prefijo} ${primeraEnMinuscula(opcion.nombre)}`;
}

const tienePrefijo = (prefijo: string | null): prefijo is string => prefijo !== null && prefijo !== "";

/**
 * La primera letra Unicode (el primer punto de código) en minúscula con las reglas de `es-AR`, sin excepción para siglas («BBQ» → «bBQ», decisión del dueño): la usan la lectura con prefijo y las
 * aclaraciones de la carta («Guarnición: ensalada, papas fritas o puré», Fase 5).
 */
export function primeraEnMinuscula(texto: string): string {
  const [primera = "", ...resto] = Array.from(texto);
  return `${primera.toLocaleLowerCase("es-AR")}${resto.join("")}`;
}

/**
 * Una lista en palabras, unida con «o» («ensalada, papas fritas o puré»): «u» delante de una palabra que empieza con el sonido «o» («o»/«ho»: «carne u hongos», «pollo u orégano»). Una sola
 * opción va sola; ninguna, vacío. Puro: la usa quien dibuja las aclaraciones de la carta (Fase 5).
 */
export function unirConO(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? "";
  const ultimo = nombres[nombres.length - 1]!;
  const conjuncion = /^h?o/i.test(ultimo) ? "u" : "o";
  return `${nombres.slice(0, -1).join(", ")} ${conjuncion} ${ultimo}`;
}

/**
 * El PAPEL de un grupo en la carta (Fase 5 de la ola «precio y carta», «carta pareja»; ADR-035), siempre desde datos DECLARADOS (el tipo, los límites, el prefijo) y los precios que ya calculó la
 * regla de la venta (`resumenDePrecios`), nunca comparando nombres:
 *  - `define-el-precio`: un TAMAÑO (`MEDIDA`) cuyos precios finales disponibles son distintos (si son todos iguales, el tamaño no cambia nada para el cliente: va como aclaración);
 *  - `filas`: una VARIANTE obligatoria de una sola elección que suma o resta algo, o que tiene prefijo («De carne», «De pollo»: DEC-10): una fila por opción;
 *  - `aclaracion`: lo que se elige sin costo (una INCLUIDA, una VARIANTE sin costo y sin prefijo): una línea debajo del plato («Preparación: solo, cortado o con leche»);
 *  - `adicional`: un ADICIONAL, o lo opcional que suma o resta algo: la línea «Extras: …» con su recargo.
 * Lo comparten la carta (qué forma toma el producto) y el diálogo del POS (en qué orden se eligen los grupos: `ordenarPorRol`). El POS no lee el prefijo (muestra grupo y opción tal cual): le pasa `null`.
 */
export type RolDelGrupoEnCarta = "define-el-precio" | "filas" | "aclaracion" | "adicional";

/** Lo que el rol lee de un grupo (estructural: un grupo del resumen de precios con su prefijo cumple esta forma). */
export interface GrupoParaRol {
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
  prefijoEnCarta: string | null;
  /** Las opciones disponibles hoy, con lo que calculó la regla de la venta: el precio final en un tamaño, lo que suma o resta en los demás. */
  opciones: readonly { esNinguna: boolean; precioFinal: number | null; diferencia: number }[];
}

export function rolDelGrupo(g: GrupoParaRol): RolDelGrupoEnCarta {
  if (g.tipo === "ADICIONAL") return "adicional";
  if (g.tipo === "MEDIDA") {
    const precios = new Set(g.opciones.flatMap((o) => (o.esNinguna || o.precioFinal === null ? [] : [o.precioFinal])));
    return precios.size > 1 ? "define-el-precio" : "aclaracion";
  }
  const conCosto = g.opciones.some((o) => o.diferencia !== 0);
  if (g.tipo === "VARIANTE" && esDeUnaObligatoria(g) && (conCosto || tienePrefijo(g.prefijoEnCarta))) return "filas";
  return conCosto ? "adicional" : "aclaracion";
}

/** Si el grupo obliga a elegir exactamente una opción (lo único que puede ser un eje de la carta: una fila o una columna por opción). */
function esDeUnaObligatoria(g: { cantidadMinima: number; cantidadMaxima: number }): boolean {
  return g.cantidadMinima >= 1 && g.cantidadMaxima === 1;
}

const ORDEN_DEL_ROL: Readonly<Record<RolDelGrupoEnCarta, number>> = { "define-el-precio": 0, filas: 1, aclaracion: 2, adicional: 3 };

/**
 * El orden en que se leen (y se eligen) los grupos: primero el que define el precio, después las filas, las aclaraciones y por último los adicionales; dentro de cada rol, los obligatorios primero y
 * después el orden del producto. Estable: dos grupos del mismo rol y la misma obligatoriedad quedan como vinieron.
 */
export function ordenarPorRol<G extends { cantidadMinima: number }>(grupos: readonly G[], rolDe: (g: G) => RolDelGrupoEnCarta): G[] {
  return grupos
    .map((g, i) => ({ g, i, rol: ORDEN_DEL_ROL[rolDe(g)], opcional: g.cantidadMinima > 0 ? 0 : 1 }))
    .sort((a, b) => a.rol - b.rol || a.opcional - b.opcional || a.i - b.i)
    .map((x) => x.g);
}

/** El tope de «se lee en la carta como» (CHECK `GrupoDeOpciones_prefijo_en_carta_chk`). */
export const LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA = 20;

/** Solo un grupo de VARIANTES o de MEDIDA se lee con prefijo (decisión del dueño): en una INCLUIDA o un ADICIONAL la carta lleva un rótulo («Guarnición:», «Extras:»), que es otra cosa. */
export function admitePrefijoEnCarta(tipo: TipoDeGrupoDeOpciones): boolean {
  return tipo === "VARIANTE" || tipo === "MEDIDA";
}

export const MENSAJE_PREFIJO_SOLO_VARIANTE_O_MEDIDA =
  "«Se lee en la carta como» solo va en un grupo de variantes o de tamaños: en lo incluido y en los adicionales la carta usa el nombre del grupo como rótulo.";
