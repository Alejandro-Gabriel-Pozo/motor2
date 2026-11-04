import { primeraEnMinuscula, unirConO } from "@/core/opciones/public";

/**
 * Carta «B» (decisión del dueño, 2026-11-04; `docs/diseno-descripcion-de-opciones-y-carta-b-2026-11-04.md`): cómo se lee en la carta lo que se ELIGE SIN COSTO de un plato. Reemplaza la línea de
 * antes («Guarnición: ensalada · papas fritas · puré» debajo de cada plato, y el rótulo «En todos»):
 *  - cada PLATO dice qué grupos incluye: «Incluye guarnición», «Incluye salsa», «Incluye guarnición y salsa»; si admite solo un SUBCONJUNTO de las opciones del bloque, las nombra («Incluye
 *    guarnición: puré o ensalada»);
 *  - al PIE de la sección va un BLOQUE por grupo, con sus opciones en texto (sin chips, separadas por « · »), el título «GUARNICIÓN · elegís 1» y a qué platos va («Con los platos que dicen
 *    «Incluye guarnición»»).
 *
 * UNA SOLA FUNCIÓN (`incluyeDeLaSeccion`) decide todo eso, en el servidor o en el navegador, para los cuatro lugares que muestran la carta: la pública, la impresa, la vista previa del producto y
 * «Va a mostrar». Ninguno arma su propio texto. Puro, sin precios: solo lee los grupos libres (`tipo: "eleccion"` de `aclaracionesDe`, `presentacion-en-carta.ts`); los grupos con precio (recargos,
 * tamaños, adicionales, ejes) conservan su dibujo y no pasan por acá. Un grupo apagado con «Mostrar este grupo en la carta» no llega (lo saca `cartaDeUnProducto`), así que no tiene línea, ni
 * bloque. Las opciones apagadas, agotadas o desactivadas tampoco llegan (las saca la regla de la venta antes de armar la tabla de precios).
 *
 * Qué es el «plato»: un ítem de la sección (un producto con sus aclaraciones). Qué es el bloque: el UNIÓN de las opciones que ofrecen los platos de ESA sección que incluyen el grupo, en el orden del
 * grupo. El mismo grupo en dos secciones da un bloque en cada una. Un plato que ofrece todas las del bloque dice solo la palabra; el que ofrece menos, las nombra.
 *
 * «elegís N» sale de los límites del grupo EN CADA PLATO (`ProductoAdmiteGrupo.cantidadMinima/Maxima` si el plato los sobrescribe, si no los del grupo). Si todos los platos del bloque coinciden, el
 * bloque lo dice en su título; si alguno difiere, el bloque NO dice nada y cada plato lo aclara entre paréntesis (I17). Supuesto declarado: el dueño confirmó «elegís N» para el caso 1:1; para
 * los demás (mínimo 0, rango) se usa «opcional, hasta N» y «elegís de A a B», las mismas palabras de siempre de `textoDeLimites`.
 */

/** Lo que este módulo lee de una aclaración de un plato (estructural: `AclaracionCartaV1` y `AclaracionCartaPublica` cumplen esta forma). Solo las `eleccion` tienen línea y bloque; los extras se ignoran. */
export type AclaracionParaIncluye =
  | { tipo: "eleccion"; rotulo: string; opciones: readonly string[]; cantidadMinima: number; cantidadMaxima: number }
  | { tipo: "extras"; rotulo: string; opciones: readonly { nombre: string; recargo: number }[] };

/** Un grupo dentro de la línea «Incluye …» de UN plato. */
export interface ParteDeIncluye {
  /** El nombre del grupo tal cual está en la empresa («Guarnición»): identifica el bloque de la sección. */
  grupo: string;
  /** «guarnición»: el nombre del grupo con la primera letra en minúscula (lo que dice el plato y lo que se toca en E2). */
  palabra: string;
  /** Las opciones que admite el plato, solo si son un SUBCONJUNTO de las del bloque («puré o ensalada»); `null` = todas. */
  subconjunto: string | null;
  /** «elegís 2», solo si los platos del bloque no coinciden en cuántas se eligen (el plato lo aclara); `null` = lo dice el título del bloque, o ya no hace falta. */
  elegis: string | null;
}

/** El bloque de un grupo al pie de la sección. */
export interface BloqueDeOpciones {
  /** El nombre del grupo tal cual («Guarnición»); en pantalla se escribe en mayúsculas. */
  titulo: string;
  /** «elegís 1», si todos los platos del bloque coinciden; `null` = no se dice (lo aclara cada plato). */
  elegis: string | null;
  /** Todas las opciones del bloque, sin repetir, en el orden del grupo. */
  opciones: string[];
  /** «Con los platos que dicen «Incluye guarnición»». */
  paraLosPlatos: string;
  /** Qué platos de la sección (posición en la lista) lo incluyen: lo usa la marca de «Va con» (E2). */
  platos: number[];
}

interface IncluyeDeLaSeccion {
  /** Una entrada por plato, en el mismo orden que la entrada; vacía si el plato no incluye ningún grupo libre. */
  platos: ParteDeIncluye[][];
  bloques: BloqueDeOpciones[];
}

type Eleccion = Extract<AclaracionParaIncluye, { tipo: "eleccion" }>;

/** «elegís 1», «opcional, hasta 2», «elegís de 1 a 3»: los límites en palabras (los mismos casos que `textoDeLimites`, en la persona de la carta). */
function textoDeElegis(minimo: number, maximo: number): string {
  if (minimo === maximo) return `elegís ${maximo}`;
  if (minimo === 0) return `opcional, hasta ${maximo}`;
  return `elegís de ${minimo} a ${maximo}`;
}

/** Une una lista con comas y una «y» al final («guarnición, salsa y postre»); «e» delante de un sonido «i» (no de «ia», «ie», «io», «iu»). */
function unirConY(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  const ultimo = partes[partes.length - 1]!;
  return `${partes.slice(0, -1).join(", ")} ${/^h?i(?![aeou])/i.test(ultimo) ? "e" : "y"} ${ultimo}`;
}

/** Suma al bloque las opciones de un plato conservando el orden relativo del grupo: cada una nueva va justo después de la que la precede en la lista de ese plato. */
function sumarEnOrden(bloque: string[], delPlato: readonly string[]): void {
  delPlato.forEach((nombre, i) => {
    if (bloque.includes(nombre)) return;
    bloque.splice(i === 0 ? 0 : bloque.indexOf(delPlato[i - 1]!) + 1, 0, nombre);
  });
}

/**
 * Lo que dicen los platos de UNA sección y los bloques de su pie. `platos[i]` son las aclaraciones del plato `i` (vacías si no tiene opciones). Con un solo plato (la vista previa de un producto,
 * «Va a mostrar») es una sección de uno: el bloque lista las opciones de ese plato.
 */
export function incluyeDeLaSeccion(platos: readonly (readonly AclaracionParaIncluye[])[]): IncluyeDeLaSeccion {
  const libres = platos.map((aclaraciones) => aclaraciones.filter((a): a is Eleccion => a.tipo === "eleccion" && a.opciones.length > 0));
  // Los grupos, en el orden en que aparecen por primera vez (la sección se lee de arriba abajo).
  const grupos = [...new Set(libres.flatMap((delPlato) => delPlato.map((a) => a.rotulo)))];
  const bloques: BloqueDeOpciones[] = [];
  const dichoPorPlato: ParteDeIncluye[][] = platos.map(() => []);
  const partesPorPlato = new Map<number, Map<string, ParteDeIncluye>>();

  for (const grupo of grupos) {
    const opciones: string[] = [];
    const incluyen: number[] = [];
    libres.forEach((delPlato, i) => {
      const a = delPlato.find((x) => x.rotulo === grupo);
      if (!a) return;
      incluyen.push(i);
      sumarEnOrden(opciones, a.opciones);
    });
    const limites = new Set(incluyen.map((i) => { const a = libres[i]!.find((x) => x.rotulo === grupo)!; return `${a.cantidadMinima}-${a.cantidadMaxima}`; }));
    const coinciden = limites.size === 1;
    const palabra = primeraEnMinuscula(grupo);
    for (const i of incluyen) {
      const a = libres[i]!.find((x) => x.rotulo === grupo)!;
      const parte: ParteDeIncluye = {
        grupo,
        palabra,
        subconjunto: a.opciones.length < opciones.length ? unirConO(a.opciones) : null,
        elegis: coinciden ? null : textoDeElegis(a.cantidadMinima, a.cantidadMaxima),
      };
      (partesPorPlato.get(i) ?? partesPorPlato.set(i, new Map()).get(i)!).set(grupo, parte);
    }
    const primero = libres[incluyen[0]!]!.find((x) => x.rotulo === grupo)!;
    bloques.push({
      titulo: grupo,
      elegis: coinciden ? textoDeElegis(primero.cantidadMinima, primero.cantidadMaxima) : null,
      opciones,
      paraLosPlatos: `Con los platos que dicen «Incluye ${palabra}»`,
      platos: incluyen,
    });
  }
  // Las partes de cada plato, en el orden de sus aclaraciones (el del producto).
  libres.forEach((delPlato, i) => {
    for (const a of delPlato) {
      const parte = partesPorPlato.get(i)?.get(a.rotulo);
      if (parte) dichoPorPlato[i]!.push(parte);
    }
  });
  return { platos: dichoPorPlato, bloques };
}

/** Un grupo dentro de la línea del plato: «guarnición», «guarnición: puré o ensalada», «guarnición (elegís 2)». */
function textoDeUnaParte(p: ParteDeIncluye): string {
  return `${p.palabra}${p.subconjunto ? `: ${p.subconjunto}` : ""}${p.elegis ? ` (${p.elegis})` : ""}`;
}

/** La línea de UN plato: «Incluye guarnición y salsa». `null` si no incluye ningún grupo libre (no hay línea). */
export function textoDeIncluye(partes: readonly ParteDeIncluye[]): string | null {
  return partes.length === 0 ? null : `Incluye ${unirConY(partes.map(textoDeUnaParte))}`;
}

/** Las opciones de un bloque en una línea, separadas por un punto medio (U+00B7): «puré · ensalada · papas fritas». */
export function textoDeLasOpciones(b: BloqueDeOpciones): string {
  return b.opciones.join(" · ");
}

/** El título de un bloque: «Guarnición · elegís 1», o solo «Guarnición» si los platos no coinciden. */
export function textoDelTitulo(b: BloqueDeOpciones): string {
  return b.elegis ? `${b.titulo} · ${b.elegis}` : b.titulo;
}

/** Un bloque entero en texto, para donde no hay dibujo («Va a mostrar»): «Guarnición · elegís 1: puré · ensalada. Con los platos que dicen «Incluye guarnición»». */
export function textoDelBloque(b: BloqueDeOpciones): string {
  return `${textoDelTitulo(b)}: ${textoDeLasOpciones(b)}. ${b.paraLosPlatos}`;
}
