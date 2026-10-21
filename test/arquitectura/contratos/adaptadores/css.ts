import { colapsar, prueba, type Coincidencia } from "./coincidencia";

/**
 * Adaptador de CSS: un lector de reglas propio sobre el texto SIN comentarios (sin `postcss` ni dependencias nuevas). Entiende lo que tiene el CSS de este repo:
 * reglas anidadas en `@media`/`@layer`, `@theme { --x: … }` (un bloque de declaraciones), cadenas y `url(…)` con `;` o `}` adentro, y la última declaración sin `;`.
 * No interpreta selectores ni valores: solo los separa. `@apply a b;` (sin `:`) no es una declaración.
 */
export interface DeclaracionCss {
  propiedad: string;
  valor: string;
  /** El valor tal cual está en el archivo (sin colapsar), a partir de `valorDesde`. */
  valorCrudo: string;
  /** Posición (0-based) del principio de la declaración. */
  desde: number;
  /** Posición del principio del valor. */
  valorDesde: number;
}

export interface ReglaCss {
  /** Lo que va antes de `{`, con los espacios colapsados (`.a > .b`, `@theme static`, `@media (min-width: 40rem)`). */
  selector: string;
  desde: number;
  declaraciones: DeclaracionCss[];
}

/** Las reglas de un CSS ya sin comentarios (mismas posiciones que el original). */
export function leerReglas(limpia: string): ReglaCss[] {
  const reglas: ReglaCss[] = [];
  const abiertas: ReglaCss[] = [];
  let inicio = 0;
  let parentesis = 0;

  const cerrarDeclaracion = (hasta: number): void => {
    const actual = abiertas[abiertas.length - 1];
    const crudo = limpia.slice(inicio, hasta);
    const base = inicio;
    inicio = hasta + 1;
    if (!actual) return;
    const dosPuntos = crudo.indexOf(":");
    if (dosPuntos < 0) return;
    const propiedad = crudo.slice(0, dosPuntos).trim();
    if (!propiedad || propiedad.startsWith("@")) return;
    const resto = crudo.slice(dosPuntos + 1);
    actual.declaraciones.push({
      propiedad,
      valor: colapsar(resto),
      valorCrudo: resto.trimStart(),
      desde: base + (crudo.length - crudo.trimStart().length),
      valorDesde: base + dosPuntos + 1 + (resto.length - resto.trimStart().length),
    });
  };

  for (let i = 0; i < limpia.length; i++) {
    const c = limpia[i];
    if (c === '"' || c === "'") {
      for (i++; i < limpia.length && limpia[i] !== c; i++) if (limpia[i] === "\\") i++;
      continue;
    }
    if (c === "(") parentesis++;
    else if (c === ")") parentesis = Math.max(0, parentesis - 1);
    else if (parentesis > 0) continue;
    else if (c === "{") {
      const previo = limpia.slice(inicio, i);
      const regla: ReglaCss = { selector: colapsar(previo), desde: inicio + (previo.length - previo.trimStart().length), declaraciones: [] };
      reglas.push(regla);
      abiertas.push(regla);
      inicio = i + 1;
    } else if (c === ";") cerrarDeclaracion(i);
    else if (c === "}") {
      cerrarDeclaracion(i);
      abiertas.pop();
    }
  }
  return reglas;
}

/** El selector en una forma comparable: combinadores con un espacio a cada lado, sin espacios de más. */
function normalizarSelector(selector: string): string {
  return colapsar(selector.replace(/\s*([>+~,])\s*/g, " $1 "));
}

/** Los selectores de una lista separada por comas (respetando los paréntesis de `:is(a, b)`), normalizados. */
function partesDelSelector(selector: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let desde = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === "(" || c === "[") profundidad++;
    else if (c === ")" || c === "]") profundidad = Math.max(0, profundidad - 1);
    else if (c === "," && profundidad === 0) {
      partes.push(selector.slice(desde, i));
      desde = i + 1;
    }
  }
  partes.push(selector.slice(desde));
  return partes.map(normalizarSelector).filter(Boolean);
}

/** La posición de la regla cuyo selector (algún elemento de su lista) es EXACTAMENTE `ancla`, o null. */
export function posicionDelAncla(reglas: readonly ReglaCss[], ancla: string): number | null {
  const buscada = normalizarSelector(ancla);
  const regla = reglas.find((r) => partesDelSelector(r.selector).includes(buscada));
  return regla ? regla.desde : null;
}

/** Las clases (`.nombre`) que nombra un selector. */
function clasesDelSelector(selector: string): string[] {
  return [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

/** La posición de la primera regla cuyo selector nombra la clase, o null. */
export function primeraReglaConClase(reglas: readonly ReglaCss[], clase: string): number | null {
  const regla = reglas.find((r) => clasesDelSelector(r.selector).includes(clase));
  return regla ? regla.desde : null;
}

/** Los nombres `--x` que definen las declaraciones de las reglas, con la posición de la primera definición. */
export function variablesDefinidas(reglas: readonly ReglaCss[]): Map<string, number> {
  const nombres = new Map<string, number>();
  for (const regla of reglas) for (const d of regla.declaraciones) if (d.propiedad.startsWith("--") && !nombres.has(d.propiedad)) nombres.set(d.propiedad, d.desde);
  return nombres;
}

export type DetectorCss =
  | { tipo: "declaracion"; propiedad: RegExp; valor: RegExp }
  | { tipo: "variable"; nombre: RegExp }
  | { tipo: "define-variable"; nombre: RegExp };

export function coincidenciasDeCss(reglas: readonly ReglaCss[], detector: DetectorCss): Coincidencia[] {
  const salida: Coincidencia[] = [];
  for (const regla of reglas) {
    const companeras = clasesDelSelector(regla.selector);
    for (const d of regla.declaraciones) {
      if (detector.tipo === "declaracion") {
        if (prueba(detector.propiedad, d.propiedad) && prueba(detector.valor, d.valor)) salida.push({ desde: d.desde, fragmento: colapsar(`${d.propiedad}: ${d.valor}`), nombre: d.propiedad, companeras });
      } else if (detector.tipo === "define-variable") {
        if (d.propiedad.startsWith("--") && prueba(detector.nombre, d.propiedad)) salida.push({ desde: d.desde, fragmento: colapsar(`${d.propiedad}: ${d.valor}`), nombre: d.propiedad, companeras });
      } else {
        for (const m of d.valorCrudo.matchAll(/var\(\s*(--[\w-]+)/g)) {
          if (!prueba(detector.nombre, m[1])) continue;
          salida.push({ desde: d.valorDesde + m.index + m[0].indexOf("--"), fragmento: colapsar(`${d.propiedad}: ${d.valor}`), nombre: m[1], companeras });
        }
      }
    }
  }
  return salida;
}
