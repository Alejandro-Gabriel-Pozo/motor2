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
 *  - `aclaracion`: lo que se elige sin costo (una INCLUIDA, una VARIANTE sin costo y sin prefijo): una línea debajo del plato («Preparación: solo, cortado o con leche»). Excepción, que decide
 *    `ejesDeLaCarta` y no este papel (el POS ordena con él): en un producto DIRECTO con un tamaño que define el precio, esa VARIANTE obligatoria es la fila de la grilla (Solo / Cortado / Lágrima × Chico / Mediano / Grande);
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
    .map((g, i) => ({ g, i, papel: ORDEN_DEL_ROL[rolDe(g)], opcional: g.cantidadMinima > 0 ? 0 : 1 }))
    .sort((a, b) => a.papel - b.papel || a.opcional - b.opcional || a.i - b.i)
    .map((x) => x.g);
}

/** Los ejes de la carta de un producto: el grupo de las COLUMNAS, el de las FILAS (sus `grupoId`) y los que cambian el precio y no caben en dos ejes. */
export interface EjesDeLaCarta {
  columnas: string | null;
  filas: string | null;
  /**
   * Los grupos que CAMBIAN el precio (definen el precio, o van en filas con costo) y no son un eje: un tercer eje, o un tamaño que no es de elegir uno. La carta no puede leerlos con el precio exacto de
   * cada combinación: el producto sale como antes (sin forma nueva) y queda en el diagnóstico. Un grupo de filas SIN costo (solo con prefijo) que no es eje no está acá: se lee como aclaración.
   */
  sinLugar: string[];
}

/**
 * Qué grupos son los EJES de la carta de un producto (Fase 5, «carta pareja»; DEC-06, DEC-10, DEC-11), siempre por sus papeles (`rolDelGrupo`) y su orden en el producto, nunca por nombres:
 *  - las COLUMNAS: el primer grupo de elegir uno que define el precio (un tamaño con precios distintos). En un producto BASE («se vende por opción»), si ningún tamaño tiene precios distintos, su primer
 *    tamaño de elegir uno igual hace de eje: es lo que nombra cada configuración;
 *  - las FILAS: el segundo grupo que define el precio o, si no hay, el primero de filas (una variante con costo o con prefijo: «De carne», «De pollo») o, en un producto DIRECTO con un tamaño que define
 *    el precio, la primera VARIANTE obligatoria de elegir una aunque no tenga costo ni prefijo (decisión del dueño, 2026-10-29: la grilla del café sin un prefijo artificial). Una base no la lleva: sale
 *    de un eje y esa variante queda como aclaración;
 *  - sin columnas pero con filas (un producto directo con «De carne / De pollo»), las filas solas.
 */
export function ejesDeLaCarta<G extends GrupoParaRol & { grupoId: string }>(grupos: readonly G[], esBase: boolean): EjesDeLaCarta {
  // `papel` (y no `rol`): el guardián de acceso trata toda comparación de una propiedad `rol` como una decisión de permisos.
  const conRol = grupos.map((g) => ({ g, papel: rolDelGrupo(g), eje: esDeUnaObligatoria(g) }));
  const definen = conRol.filter((x) => x.eje && x.papel === "define-el-precio").map((x) => x.g.grupoId);
  // La variante obligatoria sin costo ni prefijo (papel `aclaracion`) también puede ser la fila cuando hay un tamaño que define el precio en un producto directo, detrás de las que ya lo eran por su papel.
  const conTamano = !esBase && definen.length > 0;
  const enFilas = conRol.filter((x) => x.eje && (x.papel === "filas" || (conTamano && x.papel === "aclaracion" && x.g.tipo === "VARIANTE"))).sort((a, b) => Number(b.papel === "filas") - Number(a.papel === "filas")).map((x) => x.g.grupoId);
  const deRespaldo = esBase && definen.length === 0 ? conRol.find((x) => x.eje && x.g.tipo === "MEDIDA")?.g.grupoId : undefined;
  const columnas = definen[0] ?? deRespaldo ?? null;
  const filas = definen[1] ?? enFilas[0] ?? null;
  const cambiaElPrecio = (x: (typeof conRol)[number]) => x.papel === "define-el-precio" || (x.papel === "filas" && x.g.opciones.some((o) => o.diferencia !== 0));
  const sinLugar = conRol.filter((x) => cambiaElPrecio(x) && x.g.grupoId !== columnas && x.g.grupoId !== filas).map((x) => x.g.grupoId);
  return { columnas, filas, sinLugar };
}

/** Las opciones de un eje, en el orden del grupo: cada una es una columna o una fila (sin la «ninguna» de un tamaño, que no es un precio). Lo comparten la tabla de precios y la carta. */
export function opcionesDelEje<O extends { esNinguna: boolean }>(g: { tipo: TipoDeGrupoDeOpciones; opciones: readonly O[] }): O[] {
  return g.tipo === "MEDIDA" ? g.opciones.filter((o) => !o.esNinguna) : [...g.opciones];
}

/** El tope de «se lee en la carta como» (CHECK `GrupoDeOpciones_prefijo_en_carta_chk`). */
export const LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA = 20;

/** Solo un grupo de VARIANTES o de MEDIDA se lee con prefijo (decisión del dueño): en una INCLUIDA o un ADICIONAL la carta lleva un rótulo («Guarnición:», «Extras:»), que es otra cosa. */
export function admitePrefijoEnCarta(tipo: TipoDeGrupoDeOpciones): boolean {
  return tipo === "VARIANTE" || tipo === "MEDIDA";
}

export const MENSAJE_PREFIJO_SOLO_VARIANTE_O_MEDIDA =
  "«Se lee en la carta como» solo va en un grupo de variantes o de tamaños: en lo incluido y en los adicionales la carta usa el nombre del grupo como rótulo.";
