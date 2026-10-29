import type { DiferenciaDePrecio, TipoDeGrupoDeOpciones } from "./tipos";

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
 *  - las FILAS: el segundo grupo que define el precio o, si no hay, el primero de filas (una variante con costo o con prefijo: «De carne», «De pollo»);
 *  - sin columnas pero con filas (un producto directo con «De carne / De pollo»), las filas solas.
 */
export function ejesDeLaCarta<G extends GrupoParaRol & { grupoId: string }>(grupos: readonly G[], esBase: boolean): EjesDeLaCarta {
  // `papel` (y no `rol`): el guardián de acceso trata toda comparación de una propiedad `rol` como una decisión de permisos.
  const conRol = grupos.map((g) => ({ g, papel: rolDelGrupo(g), eje: esDeUnaObligatoria(g) }));
  const definen = conRol.filter((x) => x.eje && x.papel === "define-el-precio").map((x) => x.g.grupoId);
  const enFilas = conRol.filter((x) => x.eje && x.papel === "filas").map((x) => x.g.grupoId);
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

/**
 * «Mostrar este grupo en la carta» (decisión del dueño, 2026-10-29; ADR-035, «Grupo que no se lee en la carta»): la carta deja de leer un grupo de opciones de UN producto cuando el dueño lo apagó
 * (`ProductoAdmiteGrupo.seMuestraEnCarta = false`) Y el grupo no cambia el precio en ese producto. Puro, sin Prisma. Es el ÚNICO lugar que decide qué grupos lee la carta (pública, impresa, vista
 * previa y «Va a mostrar»); el POS, el ticket, el stock y los reportes no lo consultan.
 *
 * La regla (I2: ante la duda, se muestra): solo se oculta una VARIANTE o una INCLUIDA, y solo si NINGUNA opción ofrecida (activa y admitida por el producto) suma, resta o fija un precio. Lo agotado
 * hoy NO cuenta (para que la carta en pantalla y la impresa coincidan). Si después alguien le carga un recargo a una opción, la carta vuelve a mostrar el grupo sola, sin escribir nada.
 */

/** Lo que la regla lee de una opción de un grupo en un producto (estructural: la venta y el comando de admisión la arman desde lo que ya leyeron). */
export interface OpcionParaOcultarEnCarta {
  nombre: string;
  esNinguna: boolean;
  /** La opción se puede ofrecer en este producto: activa para la empresa y admitida (fila activa) por el producto. Lo agotado hoy en la sucursal no cuenta. */
  ofrecida: boolean;
  /** La diferencia que rige en este producto (la del producto si la sobrescribe, si no la de la versión vigente); `null` = ninguna. */
  diferencia: DiferenciaDePrecio | null;
  /** El precio propio de la opción en este producto (solo una medida lo tiene); en cualquier otro tipo de grupo cuenta como un cambio de precio (configuración inválida: nunca se oculta). */
  precioAbsoluto: number | null;
}

/** Las opciones ofrecidas que cambian el precio del producto: una diferencia distinta de 0 (monto o porcentaje) o un precio propio. La «ninguna» nunca cuenta. */
export function opcionesQueCambianElPrecio<O extends OpcionParaOcultarEnCarta>(opciones: readonly O[]): O[] {
  return opciones.filter((o) => {
    if (!o.ofrecida || o.esNinguna) return false;
    if (o.precioAbsoluto !== null) return true;
    if (o.diferencia === null) return false;
    return (o.diferencia.tipo === "MONTO" ? o.diferencia.monto : o.diferencia.porcentaje) !== 0;
  });
}

/** Solo un grupo de variantes o de incluidas puede ocultarse: un tamaño o un adicional cambian el precio. */
const sePuedeOcultarElTipo = (tipo: TipoDeGrupoDeOpciones): boolean => tipo === "VARIANTE" || tipo === "INCLUIDA";

/** Si la carta NO lee este grupo en este producto: interruptor apagado, tipo que se puede ocultar y ninguna opción ofrecida cambia el precio. `seMuestraEnCarta` ausente = se muestra. */
export function seOcultaEnLaCarta(g: { tipo: TipoDeGrupoDeOpciones; seMuestraEnCarta?: boolean; opciones: readonly OpcionParaOcultarEnCarta[] }): boolean {
  return g.seMuestraEnCarta === false && sePuedeOcultarElTipo(g.tipo) && opcionesQueCambianElPrecio(g.opciones).length === 0;
}

export const MENSAJE_OCULTAR_SOLO_VARIANTE_O_INCLUIDA = "Solo un grupo de variantes o de incluidas se puede ocultar en la carta: un tamaño o un adicional cambian el precio.";

/** Los nombres entre comillas, unidos con «y» («Ojo de bife» y «Bife de chorizo»). */
function nombresConY(nombres: readonly string[]): string {
  const entre = nombres.map((n) => `«${n}»`);
  return entre.length <= 1 ? (entre[0] ?? "") : `${entre.slice(0, -1).join(", ")} y ${entre[entre.length - 1]}`;
}

/**
 * Por qué NO se puede dejar apagado «Mostrar este grupo en la carta» con el estado que quedaría (el mensaje, listo para el dueño), o `null` si se puede: el tipo no se oculta, o alguna opción
 * ofrecida cambia el precio. Lo valida el comando de admisión sobre el estado RESULTANTE cada vez que el formulario manda el campo apagado.
 */
export function rechazoParaOcultarEnCarta(e: { tipo: TipoDeGrupoDeOpciones; grupo: string; producto: string; opciones: readonly OpcionParaOcultarEnCarta[] }): string | null {
  if (!sePuedeOcultarElTipo(e.tipo)) return MENSAJE_OCULTAR_SOLO_VARIANTE_O_INCLUIDA;
  const cambian = opcionesQueCambianElPrecio(e.opciones).map((o) => o.nombre);
  if (cambian.length === 0) return null;
  const varias = cambian.length > 1;
  return `Para ocultar «${e.grupo}» en la carta de «${e.producto}», ninguna opción puede cambiar el precio: ${nombresConY(cambian)} ${varias ? "cambian" : "cambia"} el precio. Dejal${varias ? "as" : "a"} sin recargo o mostralo en la carta.`;
}
