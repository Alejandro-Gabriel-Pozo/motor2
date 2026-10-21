import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * Cercos de la ola «precio y carta», Fase 1 (DEC-01: «cercos primero, línea de base que solo baja»; auditoría §19.5).
 *
 * Un cerco cuenta las violaciones de UNA regla, por entrada (casi siempre un archivo, con su ruta relativa a la raíz del repo y
 * `/`) y por tipo de violación, y las compara contra su línea de base congelada en `linea-de-base/<regla>.json`. Es un trinquete:
 *
 *  - Si una cuenta SUBE, o aparece una entrada nueva con violaciones, el test falla (lo nuevo no entra).
 *  - Si una cuenta BAJA (o una entrada desaparece), el test TAMBIÉN falla, pidiendo bajar la línea de base: si no, la mejora dejaría
 *    un margen por el que la cuenta podría volver a subir sin que nadie se entere.
 *  - Se regenera a propósito con `BAJAR_CERCOS=1 npx vitest run <test del cerco>`: escribe la línea de base SOLO si ninguna cuenta subió;
 *    si algo subió, se niega (y el test sigue en rojo). Así la línea de base solo puede bajar sin editarla a mano.
 *  - Una línea de base que no existe todavía se crea con `CREAR_CERCOS=1` (y solo si no existe: nunca pisa una que ya está). Borrar el
 *    JSON para «crearlo de nuevo» más alto es un cambio visible en la revisión, igual que editarlo a mano.
 *
 * Excepciones: por ruta EXACTA y con motivo escrito (mismo criterio que `.dependency-cruiser-excepciones.cjs`). Una ruta exceptuada no
 * entra en la cuenta, y se revisa en las dos direcciones: el archivo tiene que existir y seguir teniendo violaciones (si ya no tiene,
 * la excepción sobra y el test lo pide).
 *
 * Motivos por entrada (opcional, para los cercos cuya línea de base es una lista corta de deuda con nombre propio: modelos con más de
 * un dominio escritor, casos de uso fuera de los guardianes…): si el cerco los declara, toda entrada medida tiene su motivo y no sobra
 * ninguno.
 *
 * Recorrido de archivos: determinista (orden de `readdirSync` ordenado) y portable (rutas con `/`), sin `node_modules` ni `.next`.
 * Los detectores trabajan sobre el texto SIN comentarios (`sinComentarios`): un docstring que cita una clase no es una violación.
 */

export const RAIZ_DEL_REPO = join(__dirname, "../../..");

/** Entrada (ruta relativa a la raíz del repo, con `/`; o un nombre, como un modelo) → tipo de violación → cuenta (> 0). */
export type Cuentas = Record<string, Record<string, number>>;

export interface Excepcion {
  /** Ruta exacta, relativa a la raíz del repo y con `/`. */
  ruta: string;
  motivo: string;
}

export interface Cerco {
  /** Nombre de la regla: también es el nombre del JSON de la línea de base (`linea-de-base/<regla>.json`). */
  regla: string;
  /** Qué tiene que pasar para que la línea de base llegue a su meta (ej. «0 en la Fase 6»). Se escribe en el JSON para quien lo lea. */
  meta: string;
  /** Mide TODO, incluidas las rutas exceptuadas: el trinquete las aparta y comprueba que sigan haciendo falta. */
  medir: (raizDelRepo: string) => Cuentas;
  excepciones?: readonly Excepcion[];
  /** Motivo por entrada de la línea de base (si se declara, cada entrada medida necesita el suyo y no sobra ninguno). */
  motivos?: Readonly<Record<string, string>>;
}

interface LineaDeBase {
  regla: string;
  meta: string;
  total: number;
  entradas: number;
  porTipo: Record<string, number>;
  cuentas: Cuentas;
}

export interface OpcionesDeRevision {
  raizDelRepo: string;
  dirLineaDeBase: string;
  /** `BAJAR_CERCOS=1`: escribir la línea de base si nada subió. */
  bajar: boolean;
  /** `CREAR_CERCOS=1`: crear la línea de base si todavía no existe. */
  crear: boolean;
}

export interface Revision {
  /** Lo que hace fallar el test (vacío = verde). */
  problemas: string[];
  /** Qué hizo con el archivo de la línea de base. */
  escritura: "ninguna" | "creada" | "bajada" | "negada";
  /** Lo medido, sin las rutas exceptuadas. */
  medido: Cuentas;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Recorrido y lectura
// ---------------------------------------------------------------------------------------------------------------------------------

const CARPETAS_IGNORADAS = new Set(["node_modules", ".next"]);

/** Ruta relativa a `raiz`, con `/` en cualquier sistema. */
function rutaPortable(raiz: string, ruta: string): string {
  return relative(raiz, ruta).split(sep).join("/");
}

/** Todos los archivos bajo `raices` (relativas a `raizDelRepo`) con alguna de las `extensiones`, en orden determinista y con `/`. */
export function listarArchivos(raizDelRepo: string, raices: readonly string[], extensiones: readonly string[]): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string): void => {
    for (const nombre of readdirSync(dir).sort()) {
      if (CARPETAS_IGNORADAS.has(nombre)) continue;
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (extensiones.some((e) => nombre.endsWith(e))) salida.push(rutaPortable(raizDelRepo, ruta));
    }
  };
  for (const raiz of raices) {
    const absoluta = join(raizDelRepo, raiz);
    if (existsSync(absoluta)) recorrer(absoluta);
  }
  return salida.sort();
}

/** Lee un archivo del repo por su ruta portable. */
export function leer(raizDelRepo: string, ruta: string): string {
  return readFileSync(join(raizDelRepo, ...ruta.split("/")), "utf8");
}

/**
 * Arma `medir` para un cerco que cuenta por archivo: recorre `raices`, filtra con `incluir` y suma lo que `contar` devuelve de cada
 * fuente (ya sin comentarios). Las cuentas en 0 no se guardan.
 */
export function medirPorArchivo(opciones: {
  raices: readonly string[];
  extensiones: readonly string[];
  incluir?: (ruta: string) => boolean;
  contar: (fuenteSinComentarios: string, ruta: string) => Record<string, number>;
}): (raizDelRepo: string) => Cuentas {
  return (raizDelRepo) => {
    const cuentas: Cuentas = {};
    for (const ruta of listarArchivos(raizDelRepo, opciones.raices, opciones.extensiones)) {
      if (opciones.incluir && !opciones.incluir(ruta)) continue;
      const porTipo = sinCeros(opciones.contar(sinComentariosConMemoria(leer(raizDelRepo, ruta), ruta), ruta));
      if (Object.keys(porTipo).length > 0) cuentas[ruta] = porTipo;
    }
    return cuentas;
  };
}

function sinCeros(porTipo: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(porTipo).filter(([, n]) => n > 0));
}

/** Cuántas veces aparece `patron` (con la bandera `g`) en `texto`. */
export function contarCoincidencias(texto: string, patron: RegExp): number {
  return [...texto.matchAll(patron)].length;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Comentarios
// ---------------------------------------------------------------------------------------------------------------------------------

/** Reemplaza `[desde, hasta)` por espacios, conservando los saltos de línea (las posiciones y los números de línea no cambian). */
function blanquear(texto: string, rangos: readonly [number, number][]): string {
  if (rangos.length === 0) return texto;
  let salida = "";
  let cursor = 0;
  for (const [desde, hasta] of [...rangos].sort((a, b) => a[0] - b[0])) {
    if (desde < cursor) continue;
    salida += texto.slice(cursor, desde) + texto.slice(desde, hasta).replace(/[^\n]/g, " ");
    cursor = hasta;
  }
  return salida + texto.slice(cursor);
}

/**
 * La fuente con los comentarios en blanco (mismas posiciones). CSS: `/* … *\/`. TS/TSX: `//` y `/* … *\/` fuera de los literales; los
 * literales (strings, plantillas, expresiones regulares y el texto de JSX) se ubican con el AST de TypeScript, así un `//` dentro de una
 * URL o de un texto no se toma por comentario. Otros formatos se devuelven tal cual.
 */
export function sinComentarios(fuente: string, ruta: string): string {
  const texto = fuente.replace(/\r\n/g, "\n");
  if (ruta.endsWith(".css")) return blanquear(texto, [...texto.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => [m.index, m.index + m[0].length]));
  if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(ruta)) return texto;

  const tipo = /\.(tsx|jsx)$/.test(ruta) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const archivo = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, false, tipo);
  const literales: [number, number][] = [];
  const visitar = (nodo: ts.Node): void => {
    switch (nodo.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.RegularExpressionLiteral:
      case ts.SyntaxKind.JsxText:
        literales.push([nodo.getStart(archivo), nodo.end]);
        return;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(archivo);
  literales.sort((a, b) => a[0] - b[0]);

  const comentarios: [number, number][] = [];
  let i = 0;
  let l = 0;
  while (i < texto.length) {
    while (l < literales.length && literales[l][1] <= i) l++;
    if (l < literales.length && literales[l][0] <= i) {
      i = literales[l][1];
      continue;
    }
    if (texto[i] === "/" && texto[i + 1] === "/") {
      const fin = texto.indexOf("\n", i);
      const hasta = fin === -1 ? texto.length : fin;
      comentarios.push([i, hasta]);
      i = hasta;
    } else if (texto[i] === "/" && texto[i + 1] === "*") {
      const fin = texto.indexOf("*/", i + 2);
      const hasta = fin === -1 ? texto.length : fin + 2;
      comentarios.push([i, hasta]);
      i = hasta;
    } else i++;
  }
  return blanquear(texto, comentarios);
}

/** El AST de TypeScript de una fuente (TSX si la ruta termina en `x`), para los detectores que miran elementos y atributos de JSX. */
export function arbolDe(fuente: string, ruta: string): ts.SourceFile {
  return ts.createSourceFile(ruta, fuente, ts.ScriptTarget.Latest, true, /x$/.test(ruta) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** Varios cercos del mismo archivo de test recorren los mismos archivos: el texto sin comentarios se reusa mientras la fuente no cambie. */
const memoria = new Map<string, { fuente: string; limpia: string }>();
function sinComentariosConMemoria(fuente: string, ruta: string): string {
  const previa = memoria.get(ruta);
  if (previa?.fuente === fuente) return previa.limpia;
  const limpia = sinComentarios(fuente, ruta);
  memoria.set(ruta, { fuente, limpia });
  return limpia;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Trinquete
// ---------------------------------------------------------------------------------------------------------------------------------

function ordenadas(cuentas: Cuentas): Cuentas {
  return Object.fromEntries(
    Object.keys(cuentas)
      .sort()
      .map((clave) => [clave, Object.fromEntries(Object.keys(cuentas[clave]).sort().map((t) => [t, cuentas[clave][t]]))])
  );
}

function armarLineaDeBase(cerco: Cerco, cuentas: Cuentas): LineaDeBase {
  const porTipo: Record<string, number> = {};
  let total = 0;
  for (const tipos of Object.values(cuentas)) {
    for (const [tipo, n] of Object.entries(tipos)) {
      porTipo[tipo] = (porTipo[tipo] ?? 0) + n;
      total += n;
    }
  }
  const tiposOrdenados = Object.fromEntries(Object.keys(porTipo).sort().map((t) => [t, porTipo[t]]));
  return { regla: cerco.regla, meta: cerco.meta, total, entradas: Object.keys(cuentas).length, porTipo: tiposOrdenados, cuentas: ordenadas(cuentas) };
}

/** El texto exacto del JSON (claves ordenadas, dos espacios, salto de línea final): regenerar dos veces da el mismo archivo. */
export function serializarLineaDeBase(cerco: Cerco, cuentas: Cuentas): string {
  return `${JSON.stringify(armarLineaDeBase(cerco, cuentas), null, 2)}\n`;
}

interface Diferencia {
  entrada: string;
  tipo: string;
  antes: number;
  ahora: number;
}

function comparar(base: Cuentas, ahora: Cuentas): { subidas: Diferencia[]; bajadas: Diferencia[] } {
  const subidas: Diferencia[] = [];
  const bajadas: Diferencia[] = [];
  const entradas = [...new Set([...Object.keys(base), ...Object.keys(ahora)])].sort();
  for (const entrada of entradas) {
    const tipos = [...new Set([...Object.keys(base[entrada] ?? {}), ...Object.keys(ahora[entrada] ?? {})])].sort();
    for (const tipo of tipos) {
      const antes = base[entrada]?.[tipo] ?? 0;
      const despues = ahora[entrada]?.[tipo] ?? 0;
      if (despues > antes) subidas.push({ entrada, tipo, antes, ahora: despues });
      else if (despues < antes) bajadas.push({ entrada, tipo, antes, ahora: despues });
    }
  }
  return { subidas, bajadas };
}

function describir(d: Diferencia, base: Cuentas): string {
  const delta = d.ahora - d.antes;
  const nota = d.antes === 0 && !(d.entrada in base) ? ", entrada nueva" : "";
  return `  ${d.entrada} [${d.tipo}]: ${d.antes} → ${d.ahora} (${delta > 0 ? "+" : ""}${delta}${nota})`;
}

/** Revisa las excepciones: motivo, que la ruta exista y que siga teniendo violaciones. */
function revisarExcepciones(cerco: Cerco, raizDelRepo: string, medidoCompleto: Cuentas): string[] {
  const problemas: string[] = [];
  const vistas = new Set<string>();
  for (const { ruta, motivo } of cerco.excepciones ?? []) {
    if (vistas.has(ruta)) problemas.push(`Excepción repetida: ${ruta}`);
    vistas.add(ruta);
    if (!motivo || motivo.trim().length < 20) problemas.push(`Excepción sin motivo (o con uno de menos de 20 caracteres): ${ruta}`);
    if (!existsSync(join(raizDelRepo, ...ruta.split("/")))) problemas.push(`Excepción a un archivo que ya no existe (sacala): ${ruta}`);
    else if (!(ruta in medidoCompleto)) problemas.push(`Excepción que sobra: ${ruta} ya no tiene violaciones de «${cerco.regla}» (sacala de la lista)`);
  }
  return problemas;
}

function revisarMotivos(cerco: Cerco, medido: Cuentas): string[] {
  if (!cerco.motivos) return [];
  const faltan = Object.keys(medido).filter((e) => !cerco.motivos![e]?.trim());
  const sobran = Object.keys(cerco.motivos).filter((e) => !(e in medido));
  return [
    ...faltan.map((e) => `Entrada sin motivo en la línea de base de «${cerco.regla}»: ${e} (escribí por qué existe en \`motivos\`)`),
    ...sobran.map((e) => `Motivo que sobra en «${cerco.regla}»: ${e} ya no se mide (sacalo de \`motivos\`)`),
  ];
}

/** La revisión completa de un cerco (pura salvo por leer el árbol y, si corresponde, escribir el JSON). La usa `probarCerco` y su propio test. */
export function revisarCerco(cerco: Cerco, opciones: OpcionesDeRevision): Revision {
  const medidoCompleto = cerco.medir(opciones.raizDelRepo);
  const exceptuadas = new Set((cerco.excepciones ?? []).map((e) => e.ruta));
  const medido = Object.fromEntries(Object.entries(medidoCompleto).filter(([e]) => !exceptuadas.has(e)));
  const problemas = [...revisarExcepciones(cerco, opciones.raizDelRepo, medidoCompleto), ...revisarMotivos(cerco, medido)];
  const archivo = join(opciones.dirLineaDeBase, `${cerco.regla}.json`);
  const comando = `npx vitest run <el test del cerco «${cerco.regla}»>`;

  if (!existsSync(archivo)) {
    if (opciones.crear) {
      mkdirSync(dirname(archivo), { recursive: true });
      writeFileSync(archivo, serializarLineaDeBase(cerco, medido));
      return { problemas, escritura: "creada", medido };
    }
    return { problemas: [...problemas, `Falta la línea de base de «${cerco.regla}» (${archivo}). Se crea una sola vez con CREAR_CERCOS=1 ${comando}.`], escritura: "ninguna", medido };
  }

  const base = JSON.parse(readFileSync(archivo, "utf8")) as LineaDeBase;
  if (base.regla !== cerco.regla) problemas.push(`El JSON ${archivo} dice ser de la regla «${base.regla}», no de «${cerco.regla}».`);
  const { subidas, bajadas } = comparar(base.cuentas ?? {}, medido);

  if (subidas.length > 0) {
    problemas.push(
      `«${cerco.regla}» SUBIÓ (lo nuevo no entra: corregilo o, si es legítimo, declaralo como excepción con motivo):\n${subidas.map((d) => describir(d, base.cuentas)).join("\n")}`
    );
    if (opciones.bajar) problemas.push(`BAJAR_CERCOS=1 se niega a escribir la línea de base de «${cerco.regla}»: algo subió (ver arriba). La línea de base solo baja.`);
    if (bajadas.length > 0) problemas.push(`Además bajó (bien; se fija cuando no suba nada):\n${bajadas.map((d) => describir(d, base.cuentas)).join("\n")}`);
    return { problemas, escritura: opciones.bajar ? "negada" : "ninguna", medido };
  }

  const resumenDesactualizado = serializarLineaDeBase(cerco, base.cuentas ?? {}) !== readFileSync(archivo, "utf8").replace(/\r\n/g, "\n");
  if (bajadas.length > 0 || resumenDesactualizado) {
    if (opciones.bajar) {
      writeFileSync(archivo, serializarLineaDeBase(cerco, medido));
      return { problemas, escritura: "bajada", medido };
    }
    if (bajadas.length > 0)
      problemas.push(
        `«${cerco.regla}» BAJÓ (bien): fijá la mejora en la línea de base para que no pueda volver a subir — BAJAR_CERCOS=1 ${comando}:\n${bajadas.map((d) => describir(d, base.cuentas)).join("\n")}`
      );
    else problemas.push(`El JSON de «${cerco.regla}» no está en su forma canónica (totales, orden o meta desactualizados): regeneralo con BAJAR_CERCOS=1 ${comando}.`);
  }
  return { problemas, escritura: "ninguna", medido };
}
