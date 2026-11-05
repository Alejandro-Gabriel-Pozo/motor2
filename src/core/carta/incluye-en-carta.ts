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
 * Carta «B», E3: cada opción puede traer su DESCRIPCIÓN («lechuga, tomate, cebolla»; la escribe el dueño, de cualquier grupo). El bloque la lleva (`descripciones`, alineada con `opciones`) y la carta la muestra en un
 * desplegable «Ver detalle» por bloque, que solo existe si alguna opción del bloque tiene descripción (`detalleDelBloque`); en papel van siempre visibles. Nunca va en el texto del plato.
 *
 * «elegís N» sale de los límites del grupo EN CADA PLATO (`ProductoAdmiteGrupo.cantidadMinima/Maxima` si el plato los sobrescribe, si no los del grupo). Si todos los platos del bloque coinciden, el
 * bloque lo dice en su título; si alguno difiere, el bloque NO dice nada y cada plato lo aclara entre paréntesis (I17). Supuesto declarado: el dueño confirmó «elegís N» para el caso 1:1; para
 * los demás (mínimo 0, rango) se usa «opcional, hasta N» y «elegís de A a B», las mismas palabras de siempre de `textoDeLimites`.
 */

/** Lo que este módulo lee de una aclaración de un plato (estructural: `AclaracionCartaV1` y `AclaracionCartaPublica` cumplen esta forma). Solo las `eleccion` tienen línea y bloque; los extras se ignoran. */
export type AclaracionParaIncluye =
  | { tipo: "eleccion"; rotulo: string; opciones: readonly string[]; descripciones: readonly (string | null)[]; cantidadMinima: number; cantidadMaxima: number }
  | { tipo: "extras"; rotulo: string; opciones: readonly { nombre: string; recargo: number }[] };

/** Un grupo dentro de la línea «Incluye …» de UN plato. */
export interface ParteDeIncluye {
  /** El nombre del grupo tal cual está en la empresa («Guarnición»): identifica el bloque de la sección. */
  grupo: string;
  /** «guarnición»: el nombre del grupo con la primera letra en minúscula (lo que dice el plato y lo que se toca en E2). */
  palabra: string;
  /** Las opciones que admite el plato, solo si son un SUBCONJUNTO de las del bloque («puré o ensalada»); `null` = todas. */
  subconjunto: string | null;
  /** «elegís 2», solo si los platos del bloque no coinciden en cuántas se eligen: lo dice el título del bloque cuando coinciden; el plato ya dice cuántas lleva (`cantidad`). */
  elegis: string | null;
  /** Cuántas lleva ESTE plato (los límites del grupo EN ESE PLATO): «1», «2», «hasta 2» (redacción confirmada por el dueño). */
  cantidad: string;
  /** La palabra como se lee en la línea del plato, con el número que le corresponde: «guarnición» (1), «guarniciones» (2 o más, «hasta 2»). */
  palabraEnLinea: string;
}

/** El bloque de un grupo al pie de la sección. */
export interface BloqueDeOpciones {
  /** El nombre del grupo tal cual («Guarnición»); en pantalla se escribe en mayúsculas. */
  titulo: string;
  /** «elegís 1», si todos los platos del bloque coinciden; `null` = no se dice (lo aclara cada plato). */
  elegis: string | null;
  /** Todas las opciones del bloque, sin repetir, en el orden del grupo. */
  opciones: string[];
  /** Carta «B», E3: la descripción de cada opción (alineada con `opciones`; `null` = sin descripción). El desplegable «Ver detalle» solo existe si alguna tiene. */
  descripciones: (string | null)[];
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

/** «elegís 1», «elegís hasta 2 (opcional)», «elegís de 1 a 3»: los límites en palabras (siempre el verbo «elegís», decisión del dueño, 2026-11-04) (los mismos casos que `textoDeLimites`, en la persona de la carta). */
function textoDeElegis(minimo: number, maximo: number): string {
  if (minimo === maximo) return `elegís ${maximo}`;
  if (minimo === 0) return `elegís hasta ${maximo} (opcional)`;
  return `elegís de ${minimo} a ${maximo}`;
}

/**
 * El plural de un nombre de grupo para «Incluye 2 guarniciones» (2026-11-04). Reglas del español, sin diccionario: ya termina en «s» o «x» → igual; en vocal → «s»; en «z» → «ces»; en otra consonante → «es», y una
 * palabra aguda en «-ón/-án/-én/-ín/-ún» pierde la tilde («guarnición» → «guarniciones»). De varias palabras se pluraliza la que manda: la anterior a «de/del» («tipo de leche» → «tipos de leche») o, si no hay, la última.
 */
function pluralizar(palabra: string): string {
  const palabras = palabra.split(" ");
  const iDe = palabras.findIndex((p, i) => i > 0 && (p === "de" || p === "del"));
  const k = iDe > 0 ? iDe - 1 : palabras.length - 1;
  const w = palabras[k]!;
  const plural = /[sx]$/i.test(w)
    ? w
    : /[aeiouáéíóú]$/i.test(w)
      ? `${w}s`
      : /z$/i.test(w)
        ? `${w.slice(0, -1)}ces`
        : `${w.replace(/[áéíóú](n)$/i, (_m, n: string, o: number) => `${"aeiou"["áéíóú".indexOf(_m[0]!)]}${n}`)}es`;
  return palabras.map((p, i) => (i === k ? plural : p)).join(" ");
}

/** «1», «2», «hasta 2»: cuántas lleva el plato de un grupo, según SUS límites (redacción confirmada por el dueño: cuando el mínimo y el máximo difieren, «hasta N»). `plural` = si la palabra va en plural. */
function cantidadDelPlato(minimo: number, maximo: number): { texto: string; plural: boolean } {
  if (minimo === maximo) return { texto: String(maximo), plural: maximo !== 1 };
  return { texto: `hasta ${maximo}`, plural: maximo !== 1 };
}

/**
 * Lo que va ANTES de la parte `k` de una lista de `n` partes: nada en la primera, una coma en las del medio y una «y» en la última («e» delante de un sonido «i», no de «ia», «ie», «io», «iu»).
 * Lo comparten el texto plano (`textoDeIncluye`) y la carta con palabras tocables (E2), para que no se desalineen.
 */
export function conectorDeLaParte(textos: readonly string[], k: number): string {
  if (k === 0) return "";
  if (k < textos.length - 1) return ", ";
  return /^h?i(?![aeou])/i.test(textos[k]!) ? " e " : " y ";
}

/** Une una lista con comas y una «y» al final («guarnición, salsa y postre»). */
function unirConY(partes: readonly string[]): string {
  return partes.map((texto, k) => `${conectorDeLaParte(partes, k)}${texto}`).join("");
}

/**
 * Suma al bloque las opciones de un plato conservando el orden relativo del grupo: cada una nueva va justo después de la que la precede en la lista de ese plato. La descripción es de la OPCIÓN (no del plato):
 * si dos platos traen la misma opción, vale la que no sea `null`.
 */
function sumarEnOrden(bloque: string[], descripciones: (string | null)[], delPlato: readonly string[], descDelPlato: readonly (string | null)[]): void {
  delPlato.forEach((nombre, i) => {
    const descripcion = descDelPlato[i] ?? null;
    const ya = bloque.indexOf(nombre);
    if (ya >= 0) {
      descripciones[ya] ??= descripcion;
      return;
    }
    const lugar = i === 0 ? 0 : bloque.indexOf(delPlato[i - 1]!) + 1;
    bloque.splice(lugar, 0, nombre);
    descripciones.splice(lugar, 0, descripcion);
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
    const descripciones: (string | null)[] = [];
    const incluyen: number[] = [];
    libres.forEach((delPlato, i) => {
      const a = delPlato.find((x) => x.rotulo === grupo);
      if (!a) return;
      incluyen.push(i);
      sumarEnOrden(opciones, descripciones, a.opciones, a.descripciones);
    });
    const limites = new Set(incluyen.map((i) => { const a = libres[i]!.find((x) => x.rotulo === grupo)!; return `${a.cantidadMinima}-${a.cantidadMaxima}`; }));
    const coinciden = limites.size === 1;
    const palabra = primeraEnMinuscula(grupo);
    for (const i of incluyen) {
      const a = libres[i]!.find((x) => x.rotulo === grupo)!;
      const lleva = cantidadDelPlato(a.cantidadMinima, a.cantidadMaxima);
      const parte: ParteDeIncluye = {
        grupo,
        palabra,
        subconjunto: a.opciones.length < opciones.length ? unirConO(a.opciones) : null,
        elegis: coinciden ? null : textoDeElegis(a.cantidadMinima, a.cantidadMaxima),
        cantidad: lleva.texto,
        palabraEnLinea: lleva.plural ? pluralizar(palabra) : palabra,
      };
      (partesPorPlato.get(i) ?? partesPorPlato.set(i, new Map()).get(i)!).set(grupo, parte);
    }
    const primero = libres[incluyen[0]!]!.find((x) => x.rotulo === grupo)!;
    bloques.push({
      titulo: grupo,
      elegis: coinciden ? textoDeElegis(primero.cantidadMinima, primero.cantidadMaxima) : null,
      opciones,
      descripciones,
      paraLosPlatos: `Con los platos que incluyen ${palabra}`,
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

/** Lo que sigue a la palabra del grupo en la línea del plato: «» o «: puré o ensalada». (El número ya va antes de la palabra: ya no hace falta «(elegís 2)».) */
export function restoDeLaParte(p: ParteDeIncluye): string {
  return p.subconjunto ? `: ${p.subconjunto}` : "";
}

/** El comienzo de un grupo en la línea del plato, antes de la palabra tocable: «1 », «2 », «hasta 2 », «de 1 a 3 ». */
export function cantidadDeLaParte(p: ParteDeIncluye): string {
  return `${p.cantidad} `;
}

/** Un grupo dentro de la línea del plato: «1 guarnición», «1 guarnición: puré o ensalada», «2 guarniciones». */
function textoDeUnaParte(p: ParteDeIncluye): string {
  return `${cantidadDeLaParte(p)}${p.palabraEnLinea}${restoDeLaParte(p)}`;
}

/** La línea de UN plato: «Incluye 1 guarnición y 1 salsa». `null` si no incluye ningún grupo libre (no hay línea). */
export function textoDeIncluye(partes: readonly ParteDeIncluye[]): string | null {
  return partes.length === 0 ? null : `Incluye ${unirConY(partes.map(textoDeUnaParte))}`;
}

/** Las opciones de un bloque en una línea, separadas por un punto medio (U+00B7): «puré · ensalada · papas fritas». */
export function textoDeLasOpciones(b: BloqueDeOpciones): string {
  return b.opciones.join(" · ");
}

/** Carta «B», E3: lo que lleva el desplegable «Ver detalle» (solo las opciones con descripción, en el orden del bloque). Vacío = no hay desplegable. */
export function detalleDelBloque(b: BloqueDeOpciones): { nombre: string; descripcion: string }[] {
  return b.opciones.flatMap((nombre, i) => (b.descripciones[i] ? [{ nombre, descripcion: b.descripciones[i]! }] : []));
}

/** El título de un bloque: «Guarnición · elegís 1», o solo «Guarnición» si los platos no coinciden. */
export function textoDelTitulo(b: BloqueDeOpciones): string {
  return b.elegis ? `${b.titulo} · ${b.elegis}` : b.titulo;
}

/** Un bloque entero en texto, para donde no hay dibujo («Va a mostrar»): «Guarnición · elegís 1: puré · ensalada. Con los platos que dicen «Incluye guarnición»». */
export function textoDelBloque(b: BloqueDeOpciones): string {
  const detalle = detalleDelBloque(b);
  return `${textoDelTitulo(b)}: ${textoDeLasOpciones(b)}. ${b.paraLosPlatos}${detalle.length > 0 ? `. Ver detalle: ${detalle.map((d) => `${d.nombre}: ${d.descripcion}`).join("; ")}` : ""}`;
}

/**
 * Carta «B», E2 (invitación «5+2»): los platos que lleva un bloque, para el «Va con: …» que se ve mientras el bloque está iluminado. Uno por plato que lo incluye (`BloqueDeOpciones.platos`, en el orden de
 * la sección); el que admite solo algunas opciones lo dice («Pechuga grille (solo puré o ensalada)»). `platos[i]` trae el nombre y lo que dice el plato `i` (`IncluyeDeLaSeccion.platos[i]`). Puro.
 */
export function vaConDelBloque(bloque: BloqueDeOpciones, platos: readonly { nombre: string; nombres?: readonly string[]; partes: readonly ParteDeIncluye[] }[]): string[] {
  return bloque.platos.flatMap((i) => {
    const plato = platos[i];
    if (!plato) return [];
    const subconjunto = plato.partes.find((p) => p.grupo === bloque.titulo)?.subconjunto;
    // Un ítem que la carta dibuja como VARIOS platos (una base con la medida oculta: un renglón por opción) los nombra uno por uno, con lo que dice cada renglón.
    return (plato.nombres ?? [plato.nombre]).map((nombre) => (subconjunto ? `${nombre} (solo ${subconjunto})` : nombre));
  });
}

/**
 * Cómo se llama(n) el/los plato(s) que la carta dibuja para un ítem (2026-11-04, caso del dueño: al tocar «guarnición» el «Va con: …» mostraba el nombre INTERNO de la base, «BIFE-»): lo que el cliente LEE.
 *  - producto directo, o base con el nombre arriba (la tabla con título): el nombre del ítem (`nombreEnCarta ?? nombre`, resuelto al armar la carta);
 *  - base con la medida oculta (la tabla SIN título: «cada opción como un plato»): los rótulos de sus renglones, uno por plato («Bife a criolla», «Bife con chimichurri»).
 * Puro; es la MISMA regla con que la sección decide qué dibuja como título.
 */
export function nombresDeLosPlatosDelItem(item: { nombre: string; presentacion?: { forma: string; titulo?: boolean; filas?: readonly { rotulo: string | null }[] } | null }): string[] {
  const p = item.presentacion;
  if (p && p.forma === "tabla" && p.titulo === false) {
    const rotulos = (p.filas ?? []).flatMap((f) => (f.rotulo ? [f.rotulo] : []));
    if (rotulos.length > 0) return rotulos;
  }
  return [item.nombre];
}

/** «Lo incluyen: Bife a la criolla · Pechuga grille (solo puré o ensalada)»; sin platos, `null`. (Antes «Va con: …»; cambio de texto confirmado por el dueño, 2026-11-04.) */
export function textoDeVaCon(lista: readonly string[]): string | null {
  return lista.length === 0 ? null : `Lo incluyen: ${lista.join(" · ")}`;
}
