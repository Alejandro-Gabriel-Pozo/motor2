import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import { arbolDe, sinComentarios } from "../../cercos/trinquete";
import { cadenasDeClases, coincidenciasDeClases, coincidenciasPorToken } from "../adaptadores/clases-tsx";
import { colapsar, prueba, type Coincidencia } from "../adaptadores/coincidencia";
import { coincidenciasDeCss, dentroDeLaRegla, leerReglas, posicionDelAncla, reglaDelAncla, variablesDefinidas } from "../adaptadores/css";
import { codigoSolo, coincidenciasDeTs, importaElAncla, posicionDelSimboloExportado } from "../adaptadores/ts";
import { POLITICA_DE_TIPOS, type DeclaracionDeAreas, type IdDeContrato } from "../gobernanza/areas";
import type { ReglaDeRuta } from "../gobernanza/clasificacion";
import { APROBACIONES, type Aprobacion } from "../gobernanza/aprobaciones";
import type { Exclusion } from "../gobernanza/exclusiones";
import { usosDeContratos, type UsoEnArchivo } from "../gobernanza/usos";
import { arbolMemoizado, cadenasMemoizadas, esCss, esTs } from "../indice";
import type { Contrato, Deuda, Detector, Excepcion } from "../tipos";

/**
 * El CATÁLOGO DE OPERADORES de mutación del guardián de contratos (paso G6a). Un operador es una forma de ROMPER algo que un invariante necesita (borrar el ancla, quitar la
 * marca, sacar el contrato del manifiesto, mover una carpeta fuera del alcance…): recibe la base (la copia de lo que el guardián mira) y unos parámetros y devuelve una
 * `Mutacion` concreta —los cambios de archivos, o el manifiesto / las áreas / las reglas alteradas EN MEMORIA, o la fecha corrida— más la línea donde el guardián tiene que
 * señalar el problema, o `{ noAplica }` con su razón. NUNCA toca el repo real: el arnés (`arnes.ts`) aplica los cambios a una copia y los revierte.
 *
 * Los operadores se reusan entre invariantes del mismo tipo: la matriz (`matriz.ts`) los nombra y les da los parámetros; qué hallazgo se espera lo dice la matriz.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Quién emite un hallazgo: el motor de contratos, la clasificación de rutas, las áreas, el manifiesto (lanza), las pruebas del propio guardián (rojas), el cumplimiento del cableado
 * (`gobernanza/cumplimiento.ts`), el registro de aprobaciones del mecanismo (`gobernanza/aprobaciones.ts`) o la evidencia por corrida (`gobernanza/evidencia.ts`: ids distintos del aprobado, alcance de 0
 * archivos, menos archivos leídos que el piso).
 */
export type Verifica = "motor" | "clasificacion" | "areas" | "manifiesto" | "pruebas" | "cumplimiento" | "aprobaciones" | "evidencia";

export type Cambio = { op: "escribir"; ruta: string; contenido: string } | { op: "borrar"; ruta: string } | { op: "mover"; de: string; a: string };

/** Un hallazgo colateral que se acepta (p. ej. sacar un contrato del manifiesto deja además un área que declara un id que ya no existe). */
export interface Tolerado {
  verifica: Verifica;
  tipo: string;
}

export interface Mutacion {
  descripcion: string;
  /** Cambios sobre la COPIA (o sobre el banco de pruebas si `pruebas` no es null). */
  cambios: readonly Cambio[];
  /** El manifiesto alterado en memoria (null = el real). */
  contratos: readonly Contrato[] | null;
  /** Otro `hoy` (null = el de la base). */
  hoy: string | null;
  areas: DeclaracionDeAreas | null;
  reglas: readonly ReglaDeRuta[] | null;
  exclusiones: readonly Exclusion[] | null;
  /** La política de tipos de ruta alterada en memoria (null = la real). */
  politicaDeTipos: typeof POLITICA_DE_TIPOS | null;
  /** El registro de aprobaciones alterado en memoria (null = el real). */
  registro: readonly Aprobacion[] | null;
  /** El piso de archivos leídos de la evidencia alterado en memoria (null = el de la copia, que es mínimo: la copia no tiene los 2.500 archivos del repo). */
  piso: number | null;
  crons: readonly string[] | null;
  ignoradas: readonly string[] | null;
  listadoVacio: boolean;
  /** Archivos de prueba del banco que hay que correr (la verificación es una prueba roja, no un hallazgo); null = se verifica con el motor, la clasificación y las áreas. */
  pruebas: readonly string[] | null;
  /** La línea que el guardián tiene que señalar, calculada sobre el árbol YA mutado (`raiz`). */
  linea: (raiz: string) => number;
  tolerados: readonly Tolerado[];
}

export interface NoAplica {
  noAplica: string;
}

export type ParametrosDeMutacion = Readonly<Record<string, string>>;

/** Los ejemplos que el autor de un contrato da para que el arnés pueda inventar un uso crudo y una definición duplicada (`null` = el contrato no tiene esa señal). */
export interface EjemplosDeContrato {
  /** Un archivo del alcance con un USO crudo (lo que el contrato regula) y sin declarar. */
  uso: string | null;
  /** Un archivo del alcance con una redefinición de lo que la fuente define (declarando el contrato, para que sea lo único que falle). */
  definicion: string | null;
  /**
   * La extensión del archivo nuevo de cada ejemplo, si no es la primera extensión del alcance (`.tsx` para un uso en una clase y `.css` para una redefinición de una variable en el mismo
   * contrato). El ejemplo de `uso` también es el de las mutaciones de gobierno.
   */
  extensiones?: { uso?: string; definicion?: string };
}

/** Lo que un operador mira: la copia base (sin mutar) y los datos REALES del guardián. Solo lectura. */
export interface BaseDeMutacion {
  raiz: string;
  contratos: readonly Contrato[];
  hoy: string;
  /** El listado de archivos del repo (el de git), el que clasifica la clasificación. */
  archivos: readonly string[];
  reglas: readonly ReglaDeRuta[];
  exclusiones: readonly Exclusion[];
  crons: readonly string[];
  areas: DeclaracionDeAreas;
  /** El texto de `gobernanza/areas.ts` (para ubicar la línea de la entrada de un área). */
  textoDeAreas: string;
  /** archivo → área, de la clasificación real. */
  areaDeArchivo: ReadonlyMap<string, string>;
  ejemplos: Readonly<Record<string, EjemplosDeContrato>>;
}

export interface Operador {
  id: string;
  /** A qué tipo de contrato, fuente o declaración aplica (en una frase). */
  aplicaA: string;
  aplicar: (base: BaseDeMutacion, p: ParametrosDeMutacion) => Mutacion | NoAplica;
}

export const esNoAplica = (m: Mutacion | NoAplica): m is NoAplica => "noAplica" in m;

// ---------------------------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------------------------

export const ARCHIVO_DEL_MANIFIESTO = "test/arquitectura/contratos/manifiesto.ts";

const mutacion = (descripcion: string, linea: (raiz: string) => number, resto: Partial<Mutacion> = {}): Mutacion => ({
  descripcion,
  cambios: [],
  contratos: null,
  hoy: null,
  areas: null,
  reglas: null,
  exclusiones: null,
  politicaDeTipos: null,
  registro: null,
  piso: null,
  crons: null,
  ignoradas: null,
  listadoVacio: false,
  pruebas: null,
  linea,
  tolerados: [],
  ...resto,
});

const abs = (raiz: string, ruta: string): string => join(raiz, ...ruta.split("/"));
const leerTexto = (raiz: string, ruta: string): string => readFileSync(abs(raiz, ruta), "utf8").replace(/\r\n/g, "\n");
const lineaDe = (texto: string, pos: number): number => texto.slice(0, pos).split("\n").length;
const escribir = (ruta: string, contenido: string): Cambio => ({ op: "escribir", ruta, contenido });

function masDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

function contratoDe(base: BaseDeMutacion, id: string | undefined): Contrato {
  const c = base.contratos.find((x) => x.id === id);
  if (!c) throw new Error(`el operador pide el contrato «${id ?? ""}» y no está en el manifiesto`);
  return c;
}

function parametro(p: ParametrosDeMutacion, nombre: string): string {
  const v = p[nombre];
  if (v === undefined) throw new Error(`falta el parámetro «${nombre}» del operador`);
  return v;
}

/** Un error del operador (no del guardián): la mutación no se pudo armar, y no se puede dar por «protegida» una mutación que no se aplicó. */
const fallo = (que: string): never => {
  throw new Error(`operador mal aplicado: ${que}`);
};

/** La posición de la marca del contrato (el arroba, la palabra «contrato» y el id) dentro de un comentario del texto, o -1. */
function posicionDeMarca(texto: string, ruta: string, id: string): number {
  const limpia = sinComentarios(texto, ruta);
  for (const m of texto.matchAll(new RegExp(`@contrato[ \\t]+${id}(?![\\w-])`, "g"))) if (limpia[m.index] !== "@") return m.index;
  return -1;
}

/** La posición del ancla de la fuente en el texto, o null. */
function posicionDelAnclaEn(c: Contrato, texto: string): number | null {
  const ruta = c.fuente.archivo;
  return esCss(ruta) ? posicionDelAncla(leerReglas(sinComentarios(texto, ruta)), c.fuente.ancla) : posicionDelSimboloExportado(arbolDe(texto, ruta), c.fuente.ancla);
}

/** Lo que un detector encuentra en el texto de un archivo (mismos adaptadores que el motor). */
function coincidenciasEn(d: Detector, ruta: string, texto: string, prefijoDeNombre: string | null): Coincidencia[] {
  if (d.adaptador === "css") return esCss(ruta) ? coincidenciasDeCss(leerReglas(sinComentarios(texto, ruta)), d) : [];
  if (!esTs(ruta)) return [];
  if (d.adaptador === "clases") return prefijoDeNombre === null ? coincidenciasDeClases(cadenasMemoizadas(ruta, texto), d.token) : coincidenciasPorToken(cadenasMemoizadas(ruta, texto), d.token, prefijoDeNombre);
  const arbol = arbolMemoizado(ruta, texto);
  return coincidenciasDeTs({ fuente: texto, codigo: codigoSolo(sinComentarios(texto, ruta), arbol), arbol }, d);
}

const delContrato = (c: Contrato, ruta: string, texto: string, lista: "senales" | "definicion"): Coincidencia[] =>
  c[lista].flatMap((d) => coincidenciasEn(d, ruta, texto, c.declaracion.tipo === "nombre-definido-en-la-fuente" ? c.declaracion.prefijoDeNombre : null)).sort((a, b) => a.desde - b.desde);

/** La carpeta donde un archivo nuevo cae dentro del alcance del contrato, y la extensión que el alcance admite. */
function lugarEnElAlcance(raiz: string, c: Contrato): { carpeta: string; ext: string } | null {
  const raizDelAlcance = c.alcance.raices[0];
  const ext = c.alcance.extensiones[0];
  if (raizDelAlcance === undefined || ext === undefined) return null;
  const carpeta = existsSync(abs(raiz, raizDelAlcance)) && statSync(abs(raiz, raizDelAlcance)).isDirectory() ? raizDelAlcance : dirname(raizDelAlcance);
  return { carpeta, ext };
}

/** Los archivos del listado que están en el alcance del contrato (sin la fuente), en orden. */
export function archivosDelAlcance(base: Pick<BaseDeMutacion, "archivos">, c: Contrato): string[] {
  return base.archivos.filter((r) => r !== c.fuente.archivo && c.alcance.extensiones.some((e) => r.endsWith(e)) && c.alcance.raices.some((q) => r === q || r.startsWith(`${q.replace(/\/$/, "")}/`)));
}

/** La línea de la entrada de un área en `gobernanza/areas.ts` (1 si no se encuentra). */
function lineaDeEntradaDeArea(base: BaseDeMutacion, nombre: string): number {
  const i = base.textoDeAreas.split("\n").findIndex((l) => l.trimStart().startsWith(`${JSON.stringify(nombre)}:`));
  return i < 0 ? 1 : i + 1;
}

/** El rango del bloque `{ … }` de la regla CSS que empieza en `desde`. */
function finDeRegla(limpia: string, desde: number): number {
  let profundidad = 0;
  for (let i = limpia.indexOf("{", desde); i >= 0 && i < limpia.length; i++) {
    if (limpia[i] === "{") profundidad++;
    else if (limpia[i] === "}" && --profundidad === 0) return i + 1;
  }
  return limpia.length;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Elegir un consumidor real que declare el contrato y tenga un uso detrás
// ---------------------------------------------------------------------------------------------------------------------------------

export interface Consumidor {
  ruta: string;
  /** Para `clase-companera` con señales de clases: el índice de la cadena que lleva la clase compañera y un uso del contrato. */
  cadena: number;
}

/** Un archivo del alcance cuya declaración se puede quitar sin tocar un caso legítimo, una excepción ni una deuda: el primero por ruta. */
export function elegirConsumidor(base: BaseDeMutacion, c: Contrato): Consumidor | null {
  if (c.declaracion.tipo !== "clase-companera" && c.declaracion.tipo !== "importar-ancla" && c.declaracion.tipo !== "nombre-definido-en-la-fuente") return null;
  const cubiertos = new Set([...c.casosLegitimos, ...c.excepciones, ...c.deuda].map((e) => e.archivo));
  for (const ruta of archivosDelAlcance(base, c)) {
    if (cubiertos.has(ruta) || (c.consumidores !== "descubiertos" && !c.consumidores.includes(ruta))) continue;
    const texto = leerTexto(base.raiz, ruta);
    const d = c.declaracion;
    if (d.tipo === "clase-companera" && esTs(ruta)) {
      const clases = c.senales.filter((s) => s.adaptador === "clases");
      const cadenas = cadenasDeClases(arbolDe(texto, ruta), texto);
      const i = cadenas.findIndex((ch) => ch.tokens.some((t) => t.base === d.clase) && !d.equivalentes.some((q) => ch.tokens.some((t) => t.base === q)) && clases.some((s) => s.adaptador === "clases" && ch.tokens.some((t) => prueba(s.token, t.base))));
      if (i >= 0) return { ruta, cadena: i };
    } else if (d.tipo === "importar-ancla" && esTs(ruta) && importaElAncla(arbolDe(texto, ruta), ruta, c.fuente.archivo, c.fuente.ancla) !== null && delContrato(c, ruta, texto, "senales").length > 0) {
      return { ruta, cadena: -1 };
    } else if (
      d.tipo === "nombre-definido-en-la-fuente" &&
      ((esCss(ruta) && c.senales.some((s) => s.adaptador === "css" && s.tipo === "variable")) || (esTs(ruta) && c.senales.some((s) => s.adaptador === "clases")))
    ) {
      // Un `var(--x)` en un CSS o un token en una clase (`bg-papel`) de un TSX cuyo nombre la fuente define.
      const definidos = nombresDefinidos(base, c);
      if (delContrato(c, ruta, texto, "senales").some((k) => definidos.has(k.nombre))) return { ruta, cadena: -1 };
    }
  }
  return null;
}

function nombresDefinidos(base: BaseDeMutacion, c: Contrato): ReadonlySet<string> {
  const fuente = c.fuente.archivo;
  if (!existsSync(abs(base.raiz, fuente))) return new Set();
  const texto = leerTexto(base.raiz, fuente);
  if (esCss(fuente)) {
    const reglas = leerReglas(sinComentarios(texto, fuente));
    const regla = reglaDelAncla(reglas, c.fuente.ancla);
    return regla === null ? new Set() : new Set(variablesDefinidas(reglas, regla).keys());
  }
  return new Set([...sinComentarios(texto, fuente).matchAll(/--[A-Za-z][\w-]*/g)].map((m) => m[0]));
}

/** El texto sin el token `[desde, desde+largo)` de una cadena de clases, con un espacio vecino. */
function sinToken(texto: string, desde: number, largo: number): string {
  const antes = desde > 0 && texto[desde - 1] === " ";
  return antes ? texto.slice(0, desde - 1) + texto.slice(desde + largo) : texto.slice(0, desde) + texto.slice(desde + largo).replace(/^ /, "");
}

/** El texto sin la declaración del consumidor, o null si no se sabe quitarla. */
function sinDeclaracion(c: Contrato, definidos: ReadonlySet<string>, ruta: string, texto: string, cadena: number): { texto: string; posicion: number } | null {
  const d = c.declaracion;
  if (d.tipo === "clase-companera") {
    const cadenas = cadenasDeClases(arbolDe(texto, ruta), texto);
    const token = cadenas[cadena]?.tokens.find((t) => t.base === d.clase);
    if (!token) return null;
    return { texto: sinToken(texto, token.desde, d.clase.length), posicion: token.desde };
  }
  if (d.tipo === "importar-ancla") {
    const arbol = arbolDe(texto, ruta);
    const imp = importaElAncla(arbol, ruta, c.fuente.archivo, c.fuente.ancla);
    if (imp === null) return null;
    const sentencia = arbol.statements.find((s) => ts.isImportDeclaration(s) && s.getStart(arbol) <= imp.desde && imp.desde < s.end);
    if (!sentencia || !ts.isImportDeclaration(sentencia)) return null;
    const clausula = sentencia.importClause;
    const unico = clausula !== undefined && (clausula.name === undefined ? clausula.namedBindings !== undefined && ts.isNamedImports(clausula.namedBindings) && clausula.namedBindings.elements.length === 1 : clausula.namedBindings === undefined);
    if (unico) return { texto: texto.slice(0, sentencia.getStart(arbol)) + texto.slice(sentencia.end).replace(/^\n/, ""), posicion: 0 };
    const elemento = clausula?.namedBindings && ts.isNamedImports(clausula.namedBindings) ? clausula.namedBindings.elements.find((e) => e.getStart(arbol) === imp.desde) : undefined;
    if (!elemento) return null;
    return { texto: texto.slice(0, elemento.getStart(arbol)) + texto.slice(elemento.end).replace(/^,\s*/, ""), posicion: 0 };
  }
  // nombre-definido-en-la-fuente: el primer uso de un nombre que la fuente define pasa a un nombre que no define.
  const uso = delContrato(c, ruta, texto, "senales").find((k) => definidos.has(k.nombre));
  if (!uso) return null;
  if (esTs(ruta)) {
    // Un token en una clase (`hover:bg-papel/50`): se le agrega un sufijo al nombre, antes de la opacidad (`bg-papel-inexistente/50`); la expresión laxa del contrato lo sigue casando.
    const token = cadenasDeClases(arbolDe(texto, ruta), texto).flatMap((ch) => ch.tokens).find((t) => t.desde === uso.desde);
    if (!token) return null;
    const barra = token.base.lastIndexOf("/");
    const corte = texto.indexOf(token.base, token.desde) + (barra >= 0 ? barra : token.base.length - (token.base.endsWith("!") ? 1 : 0));
    return { texto: `${texto.slice(0, corte)}-inexistente${texto.slice(corte)}`, posicion: uso.desde };
  }
  return { texto: `${texto.slice(0, uso.desde)}${uso.nombre}-inexistente${texto.slice(uso.desde + uso.nombre.length)}`, posicion: uso.desde };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Tokens de una fuente CSS (nombre-definido-en-la-fuente) y entradas de la definición del contrato
// ---------------------------------------------------------------------------------------------------------------------------------

export interface TokenUsado {
  nombre: string;
  /** Posición (0-based) de la declaración del token dentro de la regla ancla de la fuente. */
  desde: number;
  /** El primer archivo del alcance (la fuente incluida, fuera del ancla) que usa el token, con la posición del uso. */
  uso: { ruta: string; desde: number };
}

/** Las coincidencias de las señales del contrato en un texto, sin las que caen dentro de la regla ancla (lo que define la fuente no es un uso). */
function usosFueraDelAncla(c: Contrato, ruta: string, texto: string): Coincidencia[] {
  const regla = ruta === c.fuente.archivo && esCss(ruta) ? reglaDelAncla(leerReglas(sinComentarios(texto, ruta)), c.fuente.ancla) : null;
  return delContrato(c, ruta, texto, "senales").filter((k) => regla === null || !dentroDeLaRegla(regla, k.desde));
}

/**
 * El primer token (en orden de definición) de la regla ancla de una fuente CSS que algún archivo usa —en un `var()` o en una clase—, o null si el contrato no es de nombres, la
 * fuente no es CSS o ningún token tiene un uso. Lo usan `quitar-token` y la matriz (que necesita el archivo del uso para decir dónde tiene que aparecer el hallazgo).
 */
export function elegirTokenUsado(base: BaseDeMutacion, c: Contrato): TokenUsado | null {
  if (c.declaracion.tipo !== "nombre-definido-en-la-fuente" || !esCss(c.fuente.archivo) || !existsSync(abs(base.raiz, c.fuente.archivo))) return null;
  const textoFuente = leerTexto(base.raiz, c.fuente.archivo);
  const reglas = leerReglas(sinComentarios(textoFuente, c.fuente.archivo));
  const regla = reglaDelAncla(reglas, c.fuente.ancla);
  if (regla === null) return null;
  const rutas = [c.fuente.archivo, ...archivosDelAlcance(base, c)];
  const usos = rutas.flatMap((ruta) => usosFueraDelAncla(c, ruta, ruta === c.fuente.archivo ? textoFuente : leerTexto(base.raiz, ruta)).map((k) => ({ ruta, ...k })));
  for (const [nombre, desde] of [...variablesDefinidas(reglas, regla)].sort((a, b) => a[1] - b[1])) {
    const uso = usos.find((u) => u.nombre === nombre);
    if (uso !== undefined) return { nombre, desde, uso: { ruta: uso.ruta, desde: uso.desde } };
  }
  return null;
}

/**
 * Qué hallazgo da una entrada de la definición del contrato (caso legítimo, excepción o deuda) cuando se la saca: si su fragmento es el de una REDEFINICIÓN (lo que detectan
 * `definicion`), `definicion-duplicada`; si no, un uso sin declarar. El mensaje es un trozo de lo que dice el motor en cada caso.
 */
export function hallazgoDeEntrada(base: BaseDeMutacion, c: Contrato, entrada: { archivo: string; fragmento: string }): { tipo: "uso-sin-declarar" | "definicion-duplicada"; mensaje: string } {
  const texto = leerTexto(base.raiz, entrada.archivo);
  const fragmento = colapsar(entrada.fragmento);
  if (delContrato(c, entrada.archivo, texto, "definicion").some((k) => k.fragmento === fragmento)) return { tipo: "definicion-duplicada", mensaje: "fuera de la fuente" };
  return { tipo: "uso-sin-declarar", mensaje: c.declaracion.tipo === "nombre-definido-en-la-fuente" ? "que la fuente no define" : "sin declarar el contrato" };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// El catálogo
// ---------------------------------------------------------------------------------------------------------------------------------

/** El primer archivo (por ruta) del área que usa el contrato —declarándolo o con lo que regula—, tal como lo cuenta la comparación de áreas. */
export function primerUsoDelArea(base: BaseDeMutacion, raiz: string, c: Contrato, nombre: string): UsoEnArchivo {
  const uso = usosDeContratos(raiz, [c])[0].archivos.find((f) => base.areaDeArchivo.get(f.ruta) === nombre);
  return uso ?? fallo(`el área «${nombre}» no tiene ningún archivo que use «${c.id}»`);
}

const ancla: Operador = {
  id: "ancla",
  aplicaA: "toda fuente: una regla CSS (selector) o un símbolo exportado de TypeScript. Parámetro `modo`: borrar | renombrar",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const modo = parametro(p, "modo");
    const ruta = c.fuente.archivo;
    const texto = leerTexto(base.raiz, ruta);
    const inicio = posicionDelAnclaEn(c, texto);
    if (inicio === null) return fallo(`«${c.id}» ya no tiene su ancla en la copia base`);
    let nuevo: string;
    if (esCss(ruta)) {
      const limpia = sinComentarios(texto, ruta);
      if (modo === "borrar") nuevo = texto.slice(0, inicio) + texto.slice(finDeRegla(limpia, inicio));
      else {
        const llave = limpia.indexOf("{", inicio);
        const selector = texto.slice(inicio, llave).replace(/[A-Za-z_][\w-]*/, "$&-mutada");
        nuevo = texto.slice(0, inicio) + selector + texto.slice(llave);
      }
    } else {
      const arbol = arbolDe(texto, ruta);
      const sentencia = arbol.statements.find((s) => s.getStart(arbol) === inicio);
      if (!sentencia) return fallo(`no se ubicó la declaración de «${c.fuente.ancla}»`);
      if (modo === "borrar") nuevo = texto.slice(0, inicio) + texto.slice(sentencia.end);
      else if (c.fuente.ancla === "default") return { noAplica: "el ancla `default` no se puede renombrar" };
      else nuevo = texto.slice(0, inicio) + texto.slice(inicio, sentencia.end).replace(new RegExp(`\\b${c.fuente.ancla}\\b`), `${c.fuente.ancla}Mutada`) + texto.slice(sentencia.end);
    }
    if (posicionDelAnclaEn(c, nuevo) !== null) return fallo(`«${c.id}» sigue teniendo su ancla después de ${modo}`);
    return mutacion(
      `${modo === "borrar" ? "borra" : "renombra"} el ancla «${c.fuente.ancla}» de ${ruta}`,
      (raiz) => {
        const m = posicionDeMarca(leerTexto(raiz, ruta), ruta, c.id);
        return m < 0 ? 1 : lineaDe(leerTexto(raiz, ruta), m);
      },
      {
        cambios: [escribir(ruta, nuevo)],
        // Sin la fuente, lo que se declaraba contra ella (los nombres que define) queda suelto; y en una fuente CSS con regla ancla, los tokens que definía el ancla pasan a ser definiciones fuera de ella.
        tolerados: [
          { verifica: "motor", tipo: "fuente-ausente" },
          { verifica: "motor", tipo: "uso-sin-declarar" },
          { verifica: "motor", tipo: "declaracion-sin-uso" },
          { verifica: "motor", tipo: "consumidor-fantasma" },
          { verifica: "motor", tipo: "definicion-duplicada" },
        ],
      }
    );
  },
};

const marca: Operador = {
  id: "marca",
  aplicaA: "toda fuente. Parámetro `modo`: quitar | renombrar | copiar | copiar-desconocida (estos dos con `destino`: el archivo donde se copia)",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const modo = parametro(p, "modo");
    const ruta = c.fuente.archivo;
    const texto = leerTexto(base.raiz, ruta);
    const pos = posicionDeMarca(texto, ruta, c.id);
    if (pos < 0) return fallo(`«${c.id}» ya no tiene su marca en la copia base`);
    const marcaTexto = `@contrato ${c.id}`;
    const largo = texto.slice(pos).match(new RegExp(`^@contrato[ \\t]+${c.id}`))?.[0].length ?? marcaTexto.length;
    if (modo === "quitar") {
      const nuevo = texto.slice(0, pos) + texto.slice(pos + largo);
      return mutacion(
        `quita la marca «${marcaTexto}» de ${ruta}`,
        (raiz) => {
          const t = leerTexto(raiz, ruta);
          const a = posicionDelAnclaEn(c, t);
          return a === null ? 1 : lineaDe(t, a);
        },
        { cambios: [escribir(ruta, nuevo)] }
      );
    }
    if (modo === "renombrar") {
      const nuevo = `${texto.slice(0, pos)}@contrato ${c.id}-renombrada${texto.slice(pos + largo)}`;
      return mutacion(`renombra la marca de «${c.id}» a «${c.id}-renombrada» en ${ruta}`, () => lineaDe(nuevo, pos), {
        cambios: [escribir(ruta, nuevo)],
        tolerados: [{ verifica: "motor", tipo: "fuente-ausente" }],
      });
    }
    const destino = parametro(p, "destino");
    const copiada = modo === "copiar-desconocida" ? "@contrato contrato-desconocido-zz" : marcaTexto;
    const contenido = destino.endsWith(".css") ? `/* ${copiada} */\n` : `// ${copiada}\n`;
    return mutacion(`copia la marca «${copiada}» a ${destino}`, () => 1, { cambios: [escribir(destino, contenido)] });
  },
};

const borrarFuente: Operador = {
  id: "borrar-fuente",
  aplicaA: "toda fuente: se borra el archivo entero",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    return mutacion(`borra el archivo de la fuente ${c.fuente.archivo}`, () => 1, {
      cambios: [{ op: "borrar", ruta: c.fuente.archivo }],
      // Otro contrato que comparta la fuente también la echa de menos.
      tolerados: [{ verifica: "motor", tipo: "fuente-ausente" }],
    });
  },
};

const quitarDeclaracion: Operador = {
  id: "quitar-declaracion",
  aplicaA: "clase-companera con señales de clases; importar-ancla con señales ts; nombre-definido-en-la-fuente con señales css/variable (un consumidor real deja de declarar)",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const ruta = parametro(p, "ruta");
    const texto = leerTexto(base.raiz, ruta);
    const consumidor = elegirConsumidor(base, c);
    if (consumidor === null || consumidor.ruta !== ruta) return { noAplica: `no hay un consumidor real con la declaración «${c.declaracion.tipo}» y un uso detrás que este operador sepa mutar` };
    const quitada = sinDeclaracion(c, nombresDefinidos(base, c), ruta, texto, consumidor.cadena);
    if (quitada === null) return { noAplica: `no se sabe quitar la declaración «${c.declaracion.tipo}» de ${ruta}` };
    const nuevo = quitada.texto;
    return mutacion(
      `${ruta} deja de declarar el contrato (${c.declaracion.tipo})`,
      (raiz) => {
        const t = leerTexto(raiz, ruta);
        if (c.declaracion.tipo === "clase-companera") {
          const ch = cadenasDeClases(arbolDe(t, ruta), t)[consumidor.cadena];
          const uso = c.senales.flatMap((s) => (s.adaptador === "clases" && ch ? coincidenciasDeClases([ch], s.token) : []));
          return lineaDe(t, Math.min(...uso.map((k) => k.desde)));
        }
        if (c.declaracion.tipo === "importar-ancla") return lineaDe(t, delContrato(c, ruta, t, "senales")[0].desde);
        return lineaDe(t, quitada.posicion);
      },
      {
        cambios: [escribir(ruta, nuevo)],
        tolerados: [
          { verifica: "motor", tipo: "declaracion-sin-uso" },
          { verifica: "motor", tipo: "consumidor-fantasma" },
        ],
      }
    );
  },
};

const quitarToken: Operador = {
  id: "quitar-token",
  aplicaA: "nombre-definido-en-la-fuente con fuente CSS: se borra de la regla ancla la definición de un token que algo usa (en un `var()` o en una clase) y ese uso queda sin definir",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const elegido = elegirTokenUsado(base, c);
    if (elegido === null) return { noAplica: "el contrato no es de nombres con una fuente CSS, o ningún token de la regla ancla tiene un uso" };
    const ruta = c.fuente.archivo;
    const texto = leerTexto(base.raiz, ruta);
    const limpia = sinComentarios(texto, ruta);
    // La declaración entera: desde el principio de su línea hasta el `;` y el salto de línea que lo sigue.
    const fin = limpia.indexOf(";", elegido.desde);
    if (fin < 0) return fallo(`no se ubicó el fin de la declaración de ${elegido.nombre} en ${ruta}`);
    const principio = texto.lastIndexOf("\n", elegido.desde) + 1;
    const nuevo = texto.slice(0, principio) + texto.slice(fin + 1).replace(/^[ \t]*\n/, "");
    const reglas = leerReglas(sinComentarios(nuevo, ruta));
    const regla = reglaDelAncla(reglas, c.fuente.ancla);
    if (regla === null || variablesDefinidas(reglas, regla).has(elegido.nombre)) return fallo(`${elegido.nombre} sigue definido en el ancla después de borrarlo`);
    return mutacion(
      `borra la definición de «${elegido.nombre}» de la regla ancla «${c.fuente.ancla}» de ${ruta} (lo usa ${elegido.uso.ruta})`,
      (raiz) => {
        const t = leerTexto(raiz, elegido.uso.ruta);
        const uso = usosFueraDelAncla(c, elegido.uso.ruta, t).find((k) => k.nombre === elegido.nombre);
        return uso === undefined ? fallo(`el uso de ${elegido.nombre} ya no está en ${elegido.uso.ruta}`) : lineaDe(t, uso.desde);
      },
      // Si era el único uso que declaraba el contrato, el contrato se queda sin consumidores. Y el token puede tener más usos en OTROS archivos (`--color-papel` lo leen `globals.css` y la carta del
      // panel): todos quedan sin definir. El hallazgo esperado (el uso elegido, con su archivo y línea) sigue siendo obligatorio; los demás usos son el mismo hallazgo en otro lugar.
      { cambios: [escribir(ruta, nuevo)], tolerados: [{ verifica: "motor", tipo: "consumidor-fantasma" }, { verifica: "motor", tipo: "uso-sin-declarar" }] }
    );
  },
};

const agregarToken: Operador = {
  id: "agregar-token",
  aplicaA: "nombre-definido-en-la-fuente con fuente CSS: se agrega a la regla ancla un token que nadie usa",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    if (c.declaracion.tipo !== "nombre-definido-en-la-fuente" || !esCss(c.fuente.archivo)) return { noAplica: "solo un contrato de nombres con una fuente CSS define tokens en una regla ancla" };
    const ruta = c.fuente.archivo;
    const texto = leerTexto(base.raiz, ruta);
    const regla = reglaDelAncla(leerReglas(sinComentarios(texto, ruta)), c.fuente.ancla);
    if (regla === null) return fallo(`«${c.id}» ya no tiene su ancla en la copia base`);
    const nombre = `--${c.declaracion.prefijoDeNombre.replace(/^--/, "")}zz-token-sin-uso`;
    const nuevo = `${texto.slice(0, regla.hasta)}  ${nombre}: #000000;\n${texto.slice(regla.hasta)}`;
    return mutacion(`agrega a la regla ancla «${c.fuente.ancla}» de ${ruta} el token «${nombre}», que nadie usa`, (raiz) => lineaDe(leerTexto(raiz, ruta), leerTexto(raiz, ruta).indexOf(nombre)), { cambios: [escribir(ruta, nuevo)] });
  },
};

const quitarTodasLasDeclaraciones: Operador = {
  id: "quitar-todas-las-declaraciones",
  aplicaA: "clase-companera con señales de clases: ningún archivo del alcance declara el contrato (consumidores descubiertos queda vacío)",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const d = c.declaracion;
    if (d.tipo !== "clase-companera" || c.consumidores !== "descubiertos") return { noAplica: "solo se sabe quitar a la vez la clase compañera de todos los consumidores de un contrato con consumidores descubiertos" };
    const cambios: Cambio[] = [];
    for (const ruta of archivosDelAlcance(base, c)) {
      let texto = leerTexto(base.raiz, ruta);
      const tokens = cadenasDeClases(arbolDe(texto, ruta), texto).flatMap((ch) => ch.tokens.filter((t) => t.base === d.clase));
      if (tokens.length === 0) continue;
      for (const t of tokens.sort((a, b) => b.desde - a.desde)) texto = sinToken(texto, t.desde, d.clase.length);
      cambios.push(escribir(ruta, texto));
    }
    if (cambios.length === 0) return { noAplica: "ningún archivo del alcance lleva la clase compañera" };
    return mutacion(`ningún archivo del alcance de «${c.id}» lleva ya la clase \`${d.clase}\``, () => 1, {
      cambios,
      tolerados: [
        { verifica: "motor", tipo: "uso-sin-declarar" },
        { verifica: "motor", tipo: "declaracion-sin-uso" },
      ],
    });
  },
};

/** La ruta del archivo nuevo que un operador mete en el alcance del contrato. */
export function rutaNuevaEnElAlcance(base: BaseDeMutacion, c: Contrato, nombre: string): string | null {
  const lugar = lugarEnElAlcance(base.raiz, c);
  if (lugar === null) return null;
  const ejemplo = nombre === "definicion" ? "definicion" : nombre === "uso" || nombre === "gobierno" ? "uso" : null;
  return `${lugar.carpeta}/zz-mutacion-${nombre}${(ejemplo === null ? undefined : base.ejemplos[c.id]?.extensiones?.[ejemplo]) ?? lugar.ext}`;
}

const insertar: Operador = {
  id: "insertar",
  aplicaA: "todo contrato con un ejemplo en la matriz. Parámetro `que`: uso | definicion | declaracion-sin-uso (clase-companera o importar-ancla)",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const que = parametro(p, "que");
    const ruta = rutaNuevaEnElAlcance(base, c, que);
    if (ruta === null) return { noAplica: "el alcance del contrato no tiene raíz ni extensión" };
    let texto: string | null;
    if (que === "uso" || que === "definicion") texto = base.ejemplos[c.id]?.[que] ?? null;
    else if (c.declaracion.tipo === "clase-companera") texto = `export const ZzDeclaracionSinUso = "${c.declaracion.clase}";\n`;
    else if (c.declaracion.tipo === "importar-ancla" && c.fuente.archivo.startsWith("src/")) texto = `import { ${c.fuente.ancla} } from "@/${c.fuente.archivo.slice(4).replace(/\.tsx?$/, "")}";\n`;
    else texto = null;
    if (texto === null) return { noAplica: que === "declaracion-sin-uso" ? `no se sabe armar una declaración sin uso para «${c.declaracion.tipo}»` : `el contrato no tiene ejemplo de ${que} en la matriz` };
    const contenido = texto.endsWith("\n") ? texto : `${texto}\n`;
    if ((que === "uso" || que === "definicion") && delContrato(c, ruta, contenido, que === "uso" ? "senales" : "definicion").length === 0) return fallo(`el ejemplo de ${que} de «${c.id}» no dispara ningún detector`);
    return mutacion(`mete ${que} en ${ruta}`, () => (que === "declaracion-sin-uso" ? 1 : lineaDe(contenido, delContrato(c, ruta, contenido, que === "uso" ? "senales" : "definicion")[0].desde)), { cambios: [escribir(ruta, contenido)] });
  },
};

const quitarEntrada: Operador = {
  id: "quitar-entrada",
  aplicaA: "todo contrato con casos legítimos, excepciones o deuda: se saca una entrada de la definición. Parámetros `lista` (casos | excepciones | deuda) e `indice`",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const lista = parametro(p, "lista");
    const i = Number(parametro(p, "indice"));
    const entrada = lista === "casos" ? c.casosLegitimos[i] : lista === "excepciones" ? c.excepciones[i] : c.deuda[i];
    if (!entrada) return { noAplica: `el contrato no tiene la entrada ${i} de ${lista}` };
    const nuevo: Contrato = {
      ...c,
      casosLegitimos: lista === "casos" ? c.casosLegitimos.filter((_, k) => k !== i) : c.casosLegitimos,
      excepciones: lista === "excepciones" ? c.excepciones.filter((_, k) => k !== i) : c.excepciones,
      deuda: lista === "deuda" ? c.deuda.filter((_, k) => k !== i) : c.deuda,
    };
    return mutacion(
      `saca ${lista}[${i}] (${entrada.archivo}) de la definición de «${c.id}»`,
      (raiz) => {
        const t = leerTexto(raiz, entrada.archivo);
        const k = [...delContrato(c, entrada.archivo, t, "senales"), ...delContrato(c, entrada.archivo, t, "definicion")].find((x) => x.fragmento === colapsar(entrada.fragmento));
        return k ? lineaDe(t, k.desde) : fallo(`el fragmento de ${lista}[${i}] ya no está en ${entrada.archivo}`);
      },
      // Sacar un caso legítimo o una excepción cambia los campos gobernados de la definición (huella del registro de aprobaciones); la deuda no se hashea.
      { contratos: base.contratos.map((x) => (x.id === c.id ? nuevo : x)), tolerados: lista === "deuda" ? [] : [{ verifica: "aprobaciones", tipo: "huella-distinta" }] }
    );
  },
};

const fueraDelManifiesto: Operador = {
  id: "fuera-del-manifiesto",
  aplicaA: "todo contrato: el contrato sigue en el repo (fuente y marca) pero ya no está en el manifiesto",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const texto = leerTexto(base.raiz, c.fuente.archivo);
    return mutacion(`saca «${c.id}» del manifiesto (la marca queda en ${c.fuente.archivo})`, () => lineaDe(texto, posicionDeMarca(texto, c.fuente.archivo, c.id)), {
      contratos: base.contratos.filter((x) => x.id !== c.id),
      // Las áreas que declaraban el id ahora declaran un contrato que no existe, y el registro de aprobaciones tiene aprobado un contrato que el manifiesto ya no trae.
      tolerados: [
        { verifica: "areas", tipo: "dependencia-falsa" },
        { verifica: "aprobaciones", tipo: "archivo-ausente" },
        { verifica: "cumplimiento", tipo: "aprobado-ausente-del-manifiesto" },
        // La evidencia por corrida también lo dice: el conjunto de contratos ya no es el aprobado.
        { verifica: "evidencia", tipo: "ids-distintos-del-aprobado" },
      ],
    });
  },
};

const vaciarManifiesto: Operador = {
  id: "vaciar-manifiesto",
  aplicaA: "el manifiesto entero: queda `[]` y todas las marcas quedan sueltas",
  aplicar(base) {
    const c = base.contratos[0];
    if (c === undefined) return { noAplica: "el manifiesto ya está vacío" };
    const texto = leerTexto(base.raiz, c.fuente.archivo);
    return mutacion("vacía el manifiesto", () => lineaDe(texto, posicionDeMarca(texto, c.fuente.archivo, c.id)), {
      contratos: [],
      tolerados: [
        { verifica: "motor", tipo: "marca-desconocida" },
        { verifica: "areas", tipo: "dependencia-falsa" },
        { verifica: "aprobaciones", tipo: "archivo-ausente" },
        { verifica: "cumplimiento", tipo: "aprobado-ausente-del-manifiesto" },
        { verifica: "evidencia", tipo: "ids-distintos-del-aprobado" },
      ],
    });
  },
};

const manifiestoRoto: Operador = {
  id: "manifiesto-roto",
  aplicaA: "el manifiesto: se arma mal (id repetido, id que no es kebab-case, contrato sin señales) y el motor lo lanza. Parámetro `modo`: duplicar | id-malo | sin-senales",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const modo = parametro(p, "modo");
    const roto: Contrato[] =
      modo === "duplicar" ? [...base.contratos, c] : modo === "id-malo" ? base.contratos.map((x) => (x.id === c.id ? { ...x, id: "NoKebab" } : x)) : base.contratos.map((x) => (x.id === c.id ? { ...x, senales: [] } : x));
    return mutacion(`rompe el manifiesto (${modo}) con «${c.id}»`, () => 1, { contratos: roto });
  },
};

const sacarAlcance: Operador = {
  id: "sacar-alcance",
  aplicaA: "todo contrato: las carpetas del alcance se mueven a otro nombre (el código sigue en el repo, pero fuera de lo que el contrato mira)",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const cambios: Cambio[] = [];
    for (const r of c.alcance.raices) {
      const dir = r.replace(/\/$/, "");
      if (base.archivos.some((a) => a.startsWith(`${dir}/`))) cambios.push({ op: "mover", de: dir, a: `${dir}-movida` });
      else if (base.archivos.includes(r)) return { noAplica: `la raíz «${r}» del alcance es un archivo suelto` };
    }
    if (cambios.length === 0) return { noAplica: "el alcance no tiene ninguna carpeta que mover" };
    return mutacion(`mueve ${c.alcance.raices.join(", ")} fuera del alcance de «${c.id}»`, () => 1, {
      cambios,
      tolerados: [
        { verifica: "motor", tipo: "alcance-vacio" },
        { verifica: "areas", tipo: "area-fantasma" },
        { verifica: "areas", tipo: "area-sin-declaracion" },
        // Los contratos que comparten la carpeta quedan con alcance 0 todos: la evidencia lo dice de cada uno.
        { verifica: "evidencia", tipo: "alcance-cero" },
      ],
    });
  },
};

const extensionNoAnalizada: Operador = {
  id: "extension-no-analizada",
  aplicaA: "todo contrato con un consumidor real: ese archivo cambia de extensión (.tsx → .jsx) y el contrato deja de verlo",
  aplicar(base, p) {
    const ruta = parametro(p, "ruta");
    const c = contratoDe(base, p.contrato);
    const ext = c.alcance.extensiones.find((e) => ruta.endsWith(e));
    if (ext === undefined) return { noAplica: `«${ruta}» no tiene una extensión del alcance` };
    return mutacion(`${ruta} pasa a una extensión que el alcance no analiza`, () => 1, {
      cambios: [{ op: "mover", de: ruta, a: `${ruta.slice(0, -ext.length)}.jsx` }],
      // Si era el único consumidor, el contrato se queda sin ninguno, y lo que se apoyaba en ese archivo (un caso legítimo, la declaración del área) queda suelto. Si era el único que usaba
      // un token (`--color-borde-control` solo lo lee la carta del panel), ese token queda sin uso.
      tolerados: [
        { verifica: "motor", tipo: "consumidor-fantasma" },
        { verifica: "motor", tipo: "declaracion-sin-uso" },
        { verifica: "motor", tipo: "caso-legitimo-sobrante" },
        { verifica: "areas", tipo: "dependencia-falsa" },
      ],
    });
  },
};

const area: Operador = {
  id: "area",
  aplicaA: "la declaración de áreas (`AREAS`). Parámetro `modo`: vaciar (con `contrato`) | quitar-entrada | id-sin-uso | id-repetido | id-fantasma (con `id`)",
  aplicar(base, p) {
    const nombre = parametro(p, "area");
    const modo = parametro(p, "modo");
    const actual = base.areas[nombre];
    if (actual === undefined) return fallo(`el área «${nombre}» no está en AREAS`);
    const entrada = (ids: readonly string[]): DeclaracionDeAreas => ({ ...base.areas, [nombre]: ids as readonly IdDeContrato[] });
    const lineaDeEntrada = (): number => lineaDeEntradaDeArea(base, nombre);
    if (modo === "quitar-entrada") {
      const { [nombre]: _fuera, ...resto } = base.areas;
      void _fuera;
      return mutacion(`saca el área «${nombre}» de AREAS`, () => 1, { areas: resto });
    }
    if (modo === "vaciar") {
      const id = parametro(p, "contrato");
      if (!actual.includes(id as IdDeContrato)) return { noAplica: `el área «${nombre}» no declara «${id}»` };
      return mutacion(
        `el área «${nombre}» deja de declarar «${id}»`,
        (raiz) => primerUsoDelArea(base, raiz, contratoDe(base, id), nombre).linea,
        { areas: entrada(actual.filter((x) => x !== id)) }
      );
    }
    if (modo === "id-sin-uso") return mutacion(`el área «${nombre}» declara «${parametro(p, "id")}», que no usa`, lineaDeEntrada, { areas: entrada([...actual, parametro(p, "id")]) });
    if (modo === "id-repetido") return mutacion(`el área «${nombre}» declara «${parametro(p, "id")}» dos veces`, lineaDeEntrada, { areas: entrada([...actual, parametro(p, "id"), parametro(p, "id")]) });
    return mutacion(`el área «${nombre}» declara un contrato que no existe`, lineaDeEntrada, { areas: entrada([...actual, "contrato-que-no-existe"]) });
  },
};

const reglas: Operador = {
  id: "reglas",
  aplicaA: "las reglas de clasificación de rutas (`REGLAS_DE_RUTA`). Parámetro `modo`: quitar | extension | duplicar-otro-tipo (con `prefijo`) | frontend-sin-area",
  aplicar(base, p) {
    const modo = parametro(p, "modo");
    const comunes = [
      { verifica: "clasificacion", tipo: "ruta-sin-clasificar" },
      { verifica: "clasificacion", tipo: "clasificacion-ambigua" },
      { verifica: "areas", tipo: "area-fantasma" },
      // Un área que declara un contrato (hoy `app/(app)/carta` declara `tokens-visuales`) y se queda sin ningún archivo clasificado por la mutación ya no usa nada.
      { verifica: "areas", tipo: "dependencia-falsa" },
    ] as const;
    if (modo === "frontend-sin-area") {
      const regla: ReglaDeRuta = { tipo: "frontend", prefijo: "src/zz-sin-area/", profundidad: "recursiva", extensiones: [".ts"], nombres: [], motivo: "regla de prueba del arnés de mutaciones: frontend sin área" };
      return mutacion("agrega una regla de frontend en una carpeta que ninguna área sabe derivar", () => 1, { reglas: [...base.reglas, regla], cambios: [escribir("src/zz-sin-area/x.ts", "export const ZZ = 1;\n")] });
    }
    const prefijo = parametro(p, "prefijo");
    const regla = base.reglas.find((r) => r.prefijo === prefijo);
    if (!regla) return fallo(`no hay una regla con el prefijo «${prefijo}»`);
    if (modo === "quitar") return mutacion(`quita la regla «${prefijo}»`, () => 1, { reglas: base.reglas.filter((r) => r !== regla), tolerados: comunes });
    if (modo === "extension") {
      const ext = regla.extensiones[regla.extensiones.length - 1];
      if (ext === undefined || regla.extensiones.length < 2) return { noAplica: `la regla «${prefijo}» no tiene dos extensiones para recortar` };
      return mutacion(`la regla «${prefijo}» deja de aceptar ${ext}`, () => 1, { reglas: base.reglas.map((r) => (r === regla ? { ...r, extensiones: r.extensiones.slice(0, -1) } : r)), tolerados: comunes });
    }
    return mutacion(`agrega otra regla de otro tipo para «${prefijo}»`, () => 1, { reglas: [...base.reglas, { ...regla, tipo: "nucleo" }], tolerados: comunes });
  },
};

const listado: Operador = {
  id: "listado",
  aplicaA: "el listado de archivos y lo que lo rodea. Parámetro `modo`: ts-en-docs | ignorado | vacio | cron-fantasma",
  aplicar(base, p) {
    const modo = parametro(p, "modo");
    if (modo === "ts-en-docs") return mutacion("un .ts escondido en docs/", () => 1, { cambios: [escribir("docs/zz-codigo-escondido.ts", "export const Escondido = 1;\n")] });
    if (modo === "ignorado") return mutacion("git ignora código bajo src/", () => 1, { ignoradas: ["src/zz-oculto.ts"] });
    if (modo === "vacio") return mutacion("el listado de git viene vacío", () => 1, {
      listadoVacio: true,
      tolerados: [
        { verifica: "clasificacion", tipo: "exclusion-sin-uso" },
        { verifica: "clasificacion", tipo: "cron-mal-clasificado" },
        { verifica: "areas", tipo: "area-fantasma" },
      ],
    });
    return mutacion("un cron de vercel.json sin archivo", () => 1, { crons: [...base.crons, "/api/cron/zz-fantasma"] });
  },
};

const exclusion: Operador = {
  id: "exclusion",
  aplicaA: "las exclusiones de la clasificación (`EXCLUSIONES`). Parámetro `modo`: sin-motivo | sin-responsable | sin-aprobacion | vencida | lejana | ampliada | sin-uso | sobre-codigo (este con `area`: la entrada de áreas que queda sin archivos)",
  aplicar(base, p) {
    const modo = parametro(p, "modo");
    const primera = base.exclusiones[0];
    if (primera === undefined) return { noAplica: "no hay ninguna exclusión real" };
    // Cambiar el motivo, el responsable, la aprobación o el vencimiento de una exclusión cambia su huella en el registro de aprobaciones (las exclusiones se hashean enteras).
    const huellaDeExclusiones = [{ verifica: "aprobaciones", tipo: "huella-distinta" }] as const;
    if (modo === "sin-motivo") return mutacion("la exclusión real pierde su motivo", () => 1, { exclusiones: base.exclusiones.map((e, i) => (i === 0 ? { ...e, motivo: "corto" } : e)), tolerados: huellaDeExclusiones });
    if (modo === "sin-responsable") return mutacion("la exclusión real tiene un responsable fuera de la lista", () => 1, { exclusiones: base.exclusiones.map((e, i) => (i === 0 ? { ...e, responsable: "tercero" as never } : e)), tolerados: huellaDeExclusiones });
    if (modo === "sin-aprobacion") return mutacion("la exclusión real pierde su aprobación", () => 1, { exclusiones: base.exclusiones.map((e, i) => (i === 0 ? { ...e, aprobacion: { por: "dueño", referencia: "nada" } } : e)), tolerados: huellaDeExclusiones });
    // Al correr el reloj también vencen la deuda y las excepciones de los contratos que vencen ese mismo día: es lo que tiene que pasar, no un hueco.
    if (modo === "vencida") {
      return mutacion("pasa el día de vencimiento de la exclusión real", () => 1, {
        hoy: masDias(primera.vence, 1),
        tolerados: [
          { verifica: "motor", tipo: "deuda-vencida" },
          { verifica: "motor", tipo: "excepcion-vencida" },
        ],
      });
    }
    if (modo === "lejana") return mutacion("la exclusión real vence en 2099", () => 1, { exclusiones: base.exclusiones.map((e, i) => (i === 0 ? { ...e, vence: "2099-12-31" } : e)), tolerados: huellaDeExclusiones });
    if (modo === "ampliada") return mutacion("un archivo más bajo la exclusión real", () => 1, { cambios: [escribir(`${primera.ruta.replace(/\/$/, "")}/zz-codigo-nuevo.ts`, "export const Nuevo = 1;\n")] });
    if (modo === "sin-uso") {
      const uno = base.archivos.find((a) => a.startsWith(primera.ruta));
      if (uno === undefined) return fallo("la exclusión real no cubre ningún archivo");
      return mutacion("un archivo menos bajo la exclusión real", () => 1, { cambios: [{ op: "borrar", ruta: uno }] });
    }
    const carpeta = "src/ui/";
    const n = base.archivos.filter((a) => a.startsWith(carpeta)).length;
    const nueva: Exclusion = { ...primera, ruta: carpeta, archivos: n, vence: masDias(base.hoy, 59) };
    return mutacion(`una exclusión nueva (bien gobernada) sobre ${carpeta}`, () => lineaDeEntradaDeArea(base, p.area ?? "ui"), { exclusiones: [...base.exclusiones, nueva] });
  },
};

const GOBIERNO_VALIDO = { responsable: "dueño", aprobacion: { por: "dueño", referencia: "PR #12" }, renovaciones: [] } as const;
const MOTIVO_VALIDO = "un motivo escrito con más de veinte caracteres";

const gobierno: Operador = {
  id: "gobierno",
  aplicaA: "todo contrato con un ejemplo de uso: se crea un uso crudo y una entrada (excepción, deuda o caso legítimo) bien gobernada que lo cubre, y se le rompe algo. Parámetro `defecto`",
  aplicar(base, p) {
    const c = contratoDe(base, p.contrato);
    const defecto = parametro(p, "defecto");
    const ruta = rutaNuevaEnElAlcance(base, c, "gobierno");
    const texto = base.ejemplos[c.id]?.uso;
    if (ruta === null || texto === null || texto === undefined) return { noAplica: "el contrato no tiene ejemplo de uso en la matriz" };
    const contenido = texto.endsWith("\n") ? texto : `${texto}\n`;
    const uso = delContrato(c, ruta, contenido, "senales")[0];
    if (uso === undefined) return fallo(`el ejemplo de uso de «${c.id}» no dispara ningún detector`);
    const base0 = { archivo: ruta, fragmento: uso.fragmento, motivo: MOTIVO_VALIDO, ...GOBIERNO_VALIDO, creada: base.hoy, vence: masDias(base.hoy, 59) };
    const excepcion: Excepcion = { ...base0 };
    const deuda: Deuda = { ...base0, resuelveEn: "G6" };
    const caso = { archivo: ruta, fragmento: uso.fragmento, motivo: MOTIVO_VALIDO };
    const con = (x: Partial<Contrato>): Contrato[] => base.contratos.map((k) => (k.id === c.id ? { ...k, ...x } : k));
    // Agregar o repetir una excepción o un caso legítimo cambia la definición gobernada del contrato (huella del registro de aprobaciones). El caso que silencia un uso lo espera la matriz: no se tolera.
    const m = (descripcion: string, x: Partial<Contrato>, resto: Partial<Mutacion> = {}, linea: (raiz: string) => number = () => 1): Mutacion => {
      const { tolerados: propios = [], ...demas } = resto;
      const cambiaLoGobernado = (x.excepciones !== undefined || x.casosLegitimos !== undefined) && defecto !== "caso-que-silencia";
      return mutacion(`${descripcion} (${ruta})`, linea, {
        cambios: [escribir(ruta, contenido)],
        contratos: con(x),
        tolerados: [...propios, ...(cambiaLoGobernado ? ([{ verifica: "aprobaciones", tipo: "huella-distinta" }] as const) : [])],
        ...demas,
      });
    };
    const lineaDelUso = (): number => lineaDe(contenido, uso.desde);
    switch (defecto) {
      case "excepcion-valida":
        return m("excepción bien gobernada", { excepciones: [...c.excepciones, excepcion] });
      case "motivo-corto-excepcion":
        return m("excepción con motivo de 5 caracteres", { excepciones: [...c.excepciones, { ...excepcion, motivo: "corto" }] });
      case "responsable-ajeno":
        return m("excepción con un responsable fuera de la lista", { excepciones: [...c.excepciones, { ...excepcion, responsable: "tercero" as never }] });
      case "aprobacion-sin-referencia":
        return m("excepción con una aprobación sin referencia válida", { excepciones: [...c.excepciones, { ...excepcion, aprobacion: { por: "dueño", referencia: "sin referencia" } }] });
      case "motivo-corto-deuda":
        return m("deuda con motivo de 5 caracteres", { deuda: [...c.deuda, { ...deuda, motivo: "corto" }] });
      case "motivo-corto-caso":
        return m("caso legítimo con motivo de 5 caracteres", { casosLegitimos: [...c.casosLegitimos, { ...caso, motivo: "corto" }] });
      case "vencida-excepcion":
        return m("la excepción vence ayer", { excepciones: [...c.excepciones, excepcion] }, { hoy: masDias(excepcion.vence, 1) });
      case "vencida-deuda":
        return m("la deuda vence ayer", { deuda: [...c.deuda, deuda] }, { hoy: masDias(deuda.vence, 1) });
      case "plazo-excedido-excepcion":
        return m("la excepción vence a 365 días", { excepciones: [...c.excepciones, { ...excepcion, vence: masDias(base.hoy, 365) }] });
      case "plazo-excedido-deuda":
        return m("la deuda vence a 365 días", { deuda: [...c.deuda, { ...deuda, vence: masDias(base.hoy, 365) }] });
      case "excepcion-duplicada":
        return m("la misma excepción dos veces", { excepciones: [...c.excepciones, excepcion, excepcion] });
      case "deuda-duplicada":
        return m("la misma deuda dos veces", { deuda: [...c.deuda, deuda, deuda] });
      case "caso-duplicado":
        return m("el mismo caso legítimo dos veces", { casosLegitimos: [...c.casosLegitimos, caso, caso] });
      case "excepcion-de-otro-fragmento":
        return m("la excepción apunta a otro fragmento: el uso queda sin cubrir", { excepciones: [...c.excepciones, { ...excepcion, fragmento: "otro fragmento que no existe en el archivo" }] }, { tolerados: [{ verifica: "motor", tipo: "excepcion-sobrante" }] }, lineaDelUso);
      case "caso-que-silencia":
        return m("un caso legítimo nuevo tapa un uso crudo", { casosLegitimos: [...c.casosLegitimos, caso] });
      default:
        return fallo(`defecto desconocido «${defecto}»`);
    }
  },
};

const texto: Operador = {
  id: "texto",
  aplicaA: "cualquier archivo de la copia o del banco de pruebas: se reemplaza la primera aparición de `de` por `a`. Con `pruebas` (archivos separados por coma) la verificación son las pruebas del banco; con `donde`, la línea esperada es la de ese texto en el archivo ya mutado",
  aplicar(base, p) {
    const ruta = parametro(p, "ruta");
    const de = parametro(p, "de");
    const a = parametro(p, "a");
    const original = leerTexto(base.raiz, ruta);
    const i = original.indexOf(de);
    if (i < 0) return fallo(`«${ruta}» no contiene el texto «${de}»`);
    const nuevo = original.slice(0, i) + a + original.slice(i + de.length);
    const pruebas = p.pruebas === undefined ? null : p.pruebas.split(",");
    // `donde`: el texto, ya mutado, cuya línea tiene que señalar el hallazgo (por defecto, la del propio cambio).
    const donde = p.donde === undefined ? i : nuevo.indexOf(p.donde);
    if (donde < 0) return fallo(`«${ruta}» mutado no contiene «${p.donde ?? ""}»`);
    return mutacion(`en ${ruta}: «${de}» → «${a}»`, () => lineaDe(nuevo, donde), { cambios: [escribir(ruta, nuevo)], pruebas });
  },
};

const mover: Operador = {
  id: "mover",
  aplicaA: "cualquier archivo o carpeta del listado: se renombra o se mueve. Con `area`, la línea esperada es la de esa entrada de `AREAS`",
  aplicar(base, p) {
    const de = parametro(p, "de");
    if (!existsSync(abs(base.raiz, de)) && !base.archivos.some((a) => a === de || a.startsWith(`${de}/`))) return fallo(`«${de}» no existe`);
    // Una carpeta entera deja muchos archivos sin clasificar: el esperado es uno de ellos y los demás son lo mismo.
    const esCarpeta = base.archivos.some((a) => a.startsWith(`${de}/`));
    return mutacion(`mueve ${de} a ${parametro(p, "a")}`, () => (p.area === undefined ? 1 : lineaDeEntradaDeArea(base, p.area)), {
      cambios: [{ op: "mover", de, a: parametro(p, "a") }],
      tolerados: [
        { verifica: "areas", tipo: "area-fantasma" },
        { verifica: "areas", tipo: "area-sin-declaracion" },
        // Mover una pieza del mecanismo o un guardián deja al registro de aprobaciones y a la lista de guardianes sin lo que esperaban.
        { verifica: "aprobaciones", tipo: "archivo-ausente" },
        { verifica: "cumplimiento", tipo: "guardian-ausente" },
        ...(esCarpeta ? [{ verifica: "clasificacion", tipo: "ruta-sin-clasificar" } as const] : []),
      ],
    });
  },
};

const archivo: Operador = {
  id: "archivo",
  aplicaA: "cualquier archivo de la copia. Parámetros `ruta` y `modo`: un-byte (un espacio al final) | borrar | copiar (con `destino`: el archivo donde queda la copia)",
  aplicar(base, p) {
    const ruta = parametro(p, "ruta");
    const modo = parametro(p, "modo");
    const original = leerTexto(base.raiz, ruta);
    if (modo === "un-byte") return mutacion(`agrega un byte (un espacio) al final de ${ruta}`, () => 1, { cambios: [escribir(ruta, `${original} `)] });
    if (modo === "borrar") return mutacion(`borra ${ruta}`, () => 1, { cambios: [{ op: "borrar", ruta }] });
    const destino = parametro(p, "destino");
    return mutacion(`copia ${ruta} a ${destino}`, () => 1, { cambios: [escribir(destino, original)] });
  },
};

const registro: Operador = {
  id: "registro",
  aplicaA: "el registro de aprobaciones (`APROBACIONES`). Parámetros `modo` y `clave`: quitar-aprobacion (se borran las entradas de esa pieza) | huella-vieja (su última entrada pasa a una huella que no es la actual)",
  aplicar(_base, p) {
    const clave = parametro(p, "clave");
    const modo = parametro(p, "modo");
    const propias = APROBACIONES.filter((a) => a.archivo === clave);
    if (propias.length === 0) return fallo(`el registro no tiene entradas de «${clave}»`);
    if (modo === "quitar-aprobacion") return mutacion(`se borran del registro las aprobaciones de «${clave}»`, () => 1, { registro: APROBACIONES.filter((a) => a.archivo !== clave) });
    const ultima = propias[propias.length - 1];
    const vieja: Aprobacion = { ...ultima, blob: ultima.blob.replace(/^./, (c) => (c === "0" ? "1" : "0")) };
    return mutacion(`la última aprobación de «${clave}» queda con una huella que no es la actual`, () => 1, { registro: APROBACIONES.map((a) => (a === ultima ? vieja : a)) });
  },
};

const politicaDeTipos: Operador = {
  id: "politica-de-tipos",
  aplicaA: "la política de tipos de ruta (`POLITICA_DE_TIPOS`). Parámetro `tipo`: un tipo que declaraba contratos pasa a no declararlos",
  aplicar(_base, p) {
    const tipo = parametro(p, "tipo") as keyof typeof POLITICA_DE_TIPOS;
    if (POLITICA_DE_TIPOS[tipo]?.declara !== true) return fallo(`el tipo de ruta «${tipo}» no declara contratos en la política real`);
    return mutacion(`el tipo de ruta «${tipo}» pasa a no declarar contratos`, () => 1, { politicaDeTipos: { ...POLITICA_DE_TIPOS, [tipo]: { declara: false, motivo: "eximido por la mutación del arnés" } } });
  },
};

const pisoDeEvidencia: Operador = {
  id: "piso-de-evidencia",
  aplicaA: "el piso de archivos leídos de la evidencia por corrida (`PISO_DE_ARCHIVOS_LEIDOS`): se sube por encima de lo que el motor lee, en memoria. El motor lee lo mismo y el piso es mayor",
  aplicar() {
    return mutacion("el piso de archivos leídos queda por encima de lo que el motor lee", () => 1, { piso: Number.MAX_SAFE_INTEGER });
  },
};

export const OPERADORES: Readonly<Record<string, Operador>> = Object.fromEntries(
  [ancla, marca, borrarFuente, quitarDeclaracion, quitarToken, agregarToken, quitarTodasLasDeclaraciones, insertar, quitarEntrada, fueraDelManifiesto, vaciarManifiesto, manifiestoRoto, sacarAlcance, extensionNoAnalizada, area, reglas, listado, exclusion, gobierno, texto, mover, archivo, registro, politicaDeTipos, pisoDeEvidencia].map((o) => [o.id, o])
);
