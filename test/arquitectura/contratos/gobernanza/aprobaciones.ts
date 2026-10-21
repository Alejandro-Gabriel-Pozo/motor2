import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { arbolMemoizado } from "../indice";
import { MOTIVO_MINIMO, referenciaValida } from "../politica";
import type { Contrato } from "../tipos";
import type { POLITICA_DE_TIPOS } from "./areas";
import type { Exclusion } from "./exclusiones";

/**
 * El REGISTRO DE APROBACIONES del guardián (paso G6, «guardián del guardián»). Decisión del dueño: todo guardián necesita su guardián, y cambiar el MECANISMO tiene que
 * quedar registrado y aprobado. Es el patrón de `test/arquitectura/caracterizaciones-congeladas.test.ts`: cada pieza del mecanismo tiene una HUELLA (el hash de blob de git de su
 * contenido normalizado a LF, o de su forma canónica) y el registro `APROBACIONES` guarda, en orden, cada cambio aprobado: `{ archivo, blob, referencia, motivo }`. La huella
 * vigente de una pieza es la de su ÚLTIMA entrada. Si el repo trae otra huella, el test se pone rojo y dice el archivo, la huella actual y qué entrada agregar. Nunca se edita ni se
 * borra una entrada: el registro es el historial.
 *
 * QUÉ SE HASHEA (las piezas se llaman «claves»; la clave de una pieza que no es un archivo entero lleva `#forma`):
 *  - ENTEROS: `motor.ts`, `tipos.ts`, `politica.ts`, `indice.ts`, `adaptadores/*.ts`, `gobernanza/{clasificacion,usos,cumplimiento}.ts`, `mutaciones/{arnes,operadores}.ts`,
 *    `vitest.config.ts`, `playwright.config.ts` y `.gitignore`.
 *  - LA LÓGICA sin los datos (`#logica`): `gobernanza/areas.ts`, `gobernanza/exclusiones.ts` y este archivo. Sus DATOS (las declaraciones de `AREAS`, los ids de `IDS_DE_CONTRATO`, la
 *    lista `EXCLUSIONES`, el registro `APROBACIONES`) cambian a menudo y se vigilan por su forma canónica o por otro guardián. Solo se sacan del hash las sentencias que son
 *    datos PUROS (literales, listas, objetos, referencias a otra constante); una que tenga una llamada, una función o una cuenta se queda en el hash.
 *  - LA FORMA CANÓNICA (JSON de claves ordenadas) de los campos GOBERNADOS: por cada contrato, `{ id, excepciones, casosLegitimos }` (`<id>.ts#gobernado`: los dos campos que pueden
 *    silenciar un uso); las exclusiones de la clasificación (`exclusiones.ts#exclusiones`); y qué tipos de ruta declaran contratos (`areas.ts#politica-de-tipos`). La deuda NO se
 *    hashea: ya la gobiernan los vencimientos de 60 días.
 *  - `package.json#scripts` (solo la clave `scripts`: Dependabot cambia las dependencias y no tiene que disparar nada) y `ci.yml#sin-sha` (el workflow con las referencias
 *    `uses: dueño/repo@<sha> # versión` reemplazadas por `uses: dueño/repo@SHA`, para que una actualización de Dependabot no ponga rojo cada pull request; los SHA los vigila
 *    `despliegues-y-cadena-de-suministro.test.ts`).
 *
 * QUÉ NO GARANTIZA: un cambio coordinado de guardián + huella + registro en el mismo commit solo lo frena la lectura del diff por el dueño («aprobación independiente» es solo
 * detección: el dueño trabaja solo, sin cuenta aparte ni CODEOWNERS obligatorio); y quien administra la configuración externa de GitHub puede cambiar los controles (ver `LEEME.md`).
 */

const CARPETA = "test/arquitectura/contratos";
export const ARCHIVO_DE_APROBACIONES = `${CARPETA}/gobernanza/aprobaciones.ts`;

/** Marca de una pieza que se retiró a propósito (un archivo borrado, un contrato que sale del manifiesto): la última entrada de esa clave pasa a ser esta. */
export const RETIRADO = "retirado";

/** Un cambio aprobado: la `clave` de la pieza (`archivo` es la ruta, con `#forma` si no es el archivo entero), su huella nueva, quién/dónde lo aprobó y por qué. */
export interface Aprobacion {
  archivo: string;
  blob: string;
  referencia: string;
  motivo: string;
}

/** El registro: de la más vieja a la más nueva. Se AGREGA al final; no se edita ni se borra una entrada (la línea de base de abajo es la primera). */
export const APROBACIONES: readonly Aprobacion[] = [
  // Línea de base del mecanismo (DEC-03, Fase 6): el estado en que el dueño recibe el guardián del guardián, pendiente de su ratificación antes del pull request.
  { archivo: ".github/workflows/ci.yml#sin-sha", blob: "e7b1a6a902200cc3b7231e2f817dad746355585c", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: ".gitignore", blob: "97b6310942c709930ef336887a9f7f0e6fb5806f", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "package.json#scripts", blob: "7757a33ca78de3112abb5da404115c5c15077542", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "playwright.config.ts", blob: "ee5d3302ba2d650185a308d6b51226600918b1e2", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/adaptadores/clases-tsx.ts", blob: "b7952e7af7f522f2cf7cc575bdc47745509cd841", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/adaptadores/coincidencia.ts", blob: "860d3353ab1006483a36fdfe1b68e8210d36462d", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/adaptadores/css.ts", blob: "55663ada8b6ac55eb88bbeaf3a53edd2b5bf73d3", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/adaptadores/ts.ts", blob: "1b9664c0268945270e495780d802ab7a906eb431", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/contratos/borde-propio-de-carta.ts#gobernado", blob: "b74df344b3d897b82494d65ecda042130b44e34c", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/contratos/separador-de-lista-de-carta.ts#gobernado", blob: "771acbe624f4cf0fcc8ff0045eb3f0967e1a139f", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/contratos/tokens-visuales.ts#gobernado", blob: "1ce3d044226680f6d89a6a4ee7390ee4c7d66de5", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/gobernanza/aprobaciones.ts#logica", blob: "be162bad8ec84260dbf2c8064935cbdb96c21664", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/gobernanza/areas.ts#logica", blob: "c38001bab2decfb94d28e041e372a2769bbe67ad", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/gobernanza/areas.ts#politica-de-tipos", blob: "82f027ae90bf40808e64002d9833b7580dd9282c", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/gobernanza/clasificacion.ts", blob: "9b166a5a8f93835cb6297f8e66d7d66a3cf72bb9", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/gobernanza/cumplimiento.ts", blob: "d2be88bafb02e33a9d73a021979cf8d82efc0154", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/gobernanza/exclusiones.ts#exclusiones", blob: "74e3ff5cce6a1dc37f085f85e571bd18352b2a29", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/gobernanza/exclusiones.ts#logica", blob: "d2ca737481c16a63bf6f696ae97972a97f135191", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/gobernanza/usos.ts", blob: "65c0bb46e803a6fdfe73ab94664ab245d1f34ef8", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/indice.ts", blob: "67c831813bfba73583630492a6d40e6edac77f58", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/motor.ts", blob: "a6d7cef86718a2cb471ab8efbed28abafaaca505", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/mutaciones/arnes.ts", blob: "1acadf7ac0c39cb84199265a452db4df9770987c", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/mutaciones/operadores.ts", blob: "9fcb7cb8f6de4af6fd08114ebf0155eec5e49a8d", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/politica.ts", blob: "0c27289b1498bad7fd109d9b99594fa715c269b9", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "test/arquitectura/contratos/tipos.ts", blob: "aa18f677245425dc594da6a34d3ccab424b94907", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
  { archivo: "vitest.config.ts", blob: "04ef0a71c2ee0b39cd543c1e3a955add3f67d794", referencia: "DEC-03", motivo: "línea de base del mecanismo, Fase 6; a ratificar por el dueño antes del pull request" },
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Las piezas del mecanismo y sus huellas
// ---------------------------------------------------------------------------------------------------------------------------------

const ARCHIVOS_ENTEROS: readonly string[] = [
  `${CARPETA}/motor.ts`,
  `${CARPETA}/tipos.ts`,
  `${CARPETA}/politica.ts`,
  `${CARPETA}/indice.ts`,
  `${CARPETA}/gobernanza/clasificacion.ts`,
  `${CARPETA}/gobernanza/usos.ts`,
  `${CARPETA}/gobernanza/cumplimiento.ts`,
  `${CARPETA}/mutaciones/arnes.ts`,
  `${CARPETA}/mutaciones/operadores.ts`,
  "vitest.config.ts",
  "playwright.config.ts",
  ".gitignore",
];

const ARCHIVO_DE_AREAS = `${CARPETA}/gobernanza/areas.ts`;
const ARCHIVO_DE_EXCLUSIONES = `${CARPETA}/gobernanza/exclusiones.ts`;
const ARCHIVO_DE_PAQUETE = "package.json";
const ARCHIVO_DE_CI = ".github/workflows/ci.yml";
const CARPETA_DE_ADAPTADORES = `${CARPETA}/adaptadores`;
const RE_CLAVE_DE_CONTRATO = /^test\/arquitectura\/contratos\/contratos\/([a-z0-9-]+)\.ts#gobernado$/;

export const claveDeContrato = (id: string): string => `${CARPETA}/contratos/${id}.ts#gobernado`;

/** La ruta real de una clave (`archivo#forma` → `archivo`). */
const archivoDeClave = (clave: string): string => clave.split("#")[0];

const lf = (texto: string): string => texto.replace(/\r\n/g, "\n");

/** El hash de blob de git de un texto (`git hash-object`): `sha1("blob <bytes>\0" + texto)`. El texto se normaliza a LF antes: el valor coincide con `git rev-parse <commit>:<ruta>`. */
export function huellaDeBlob(texto: string): string {
  const normalizado = lf(texto);
  return createHash("sha1").update(`blob ${Buffer.byteLength(normalizado)}\0`).update(normalizado).digest("hex");
}

function ordenarClaves(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarClaves);
  if (valor !== null && typeof valor === "object") return Object.fromEntries(Object.entries(valor as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, ordenarClaves(v)]));
  return valor;
}

/** JSON estable: las claves de los objetos van ordenadas; el orden de las listas lo decide quien la arma. */
const jsonCanonico = (valor: unknown): string => JSON.stringify(ordenarClaves(valor));

const ordenadas = <T>(lista: readonly T[]): T[] => [...lista].sort((a, b) => (jsonCanonico(a) < jsonCanonico(b) ? -1 : jsonCanonico(a) > jsonCanonico(b) ? 1 : 0));

/** La forma canónica de la definición gobernada de un contrato: sus excepciones y sus casos legítimos (lo que puede silenciar un uso), sin importar el orden. */
const formaGobernadaDeContrato = (c: Contrato): string => jsonCanonico({ id: c.id, excepciones: ordenadas(c.excepciones), casosLegitimos: ordenadas(c.casosLegitimos) });

/** La forma canónica de las exclusiones de la clasificación (cada una, entera), sin importar el orden. */
const formaGobernadaDeExclusiones = (exclusiones: readonly Exclusion[]): string => jsonCanonico(ordenadas(exclusiones));

/** La forma canónica de la política de tipos de ruta: cuáles declaran contratos (el motivo de los que no declaran es texto). */
const formaGobernadaDeLaPoliticaDeTipos = (politica: typeof POLITICA_DE_TIPOS): string =>
  jsonCanonico(Object.fromEntries(Object.entries(politica).map(([tipo, p]) => [tipo, p.declara])));

/** El `workflow` con cada `uses: dueño/repo@<sha de 40> # versión` reducido a `uses: dueño/repo@SHA`: una actualización de Dependabot no cambia la huella. */
export const normalizarWorkflow = (texto: string): string => lf(texto).replace(/^(\s*-?\s*uses:\s*[^\s@#]+)@[0-9a-f]{40}(?:[ \t]+#[^\n]*)?[ \t]*$/gm, "$1@SHA");

/** `package.json` reducido a su clave `scripts` en JSON canónico; si no se puede leer, un texto que no coincide con ninguna huella aprobada. */
function formaGobernadaDeLosScripts(texto: string): string {
  try {
    const scripts = (JSON.parse(texto) as { scripts?: unknown }).scripts;
    return jsonCanonico({ scripts: scripts ?? null });
  } catch {
    return `package.json ilegible\n${lf(texto)}`;
  }
}

/** ¿Es un literal de datos puro? Objetos y listas de literales o de referencias a otra constante; nada que se ejecute. */
function esDatoPuro(e: ts.Expression): boolean {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e) || ts.isIdentifier(e)) return true;
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return esDatoPuro(e.expression);
  if (ts.isPrefixUnaryExpression(e)) return esDatoPuro(e.operand);
  if (ts.isArrayLiteralExpression(e)) return e.elements.every(esDatoPuro);
  if (ts.isObjectLiteralExpression(e)) return e.properties.every((p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && esDatoPuro(p.initializer));
  return false;
}

/** El archivo sin las sentencias `const NOMBRE = …` de los datos indicados (con los comentarios que las preceden), si lo que asignan es un dato puro. */
export function sinDatos(texto: string, ruta: string, nombres: readonly string[]): string {
  const fuente = lf(texto);
  const arbol = arbolMemoizado(ruta, fuente);
  const cortes: [number, number][] = [];
  for (const s of arbol.statements) {
    if (!ts.isVariableStatement(s)) continue;
    const todas = s.declarationList.declarations;
    if (todas.length > 0 && todas.every((d) => ts.isIdentifier(d.name) && nombres.includes(d.name.text) && d.initializer !== undefined && esDatoPuro(d.initializer))) cortes.push([s.getFullStart(), s.end]);
  }
  let salida = "";
  let cursor = 0;
  for (const [desde, hasta] of cortes) {
    salida += fuente.slice(cursor, desde);
    cursor = hasta;
  }
  return salida + fuente.slice(cursor);
}

export interface HuellaActual {
  /** La clave de la pieza (la ruta, con `#forma` si no es el archivo entero). */
  clave: string;
  /** La ruta real del archivo (para el hallazgo). */
  archivo: string;
  huella: string;
  /** Qué es, en una frase. */
  que: string;
}

export interface EntradaDeAprobaciones {
  /** La raíz del repo (o de una copia). */
  raiz: string;
  /** El manifiesto en uso. */
  contratos: readonly Contrato[];
  exclusiones: readonly Exclusion[];
  politicaDeTipos: typeof POLITICA_DE_TIPOS;
  registro: readonly Aprobacion[];
}

const leerONulo = (raiz: string, ruta: string): string | null => {
  const absoluta = join(raiz, ...ruta.split("/"));
  return existsSync(absoluta) ? lf(readFileSync(absoluta, "utf8")) : null;
};

/** Las rutas de archivo que el mecanismo congela entero (más las que lee en forma parcial); sirve para armar una copia del mecanismo. */
export function rutasDelMecanismo(raiz: string): string[] {
  const carpeta = join(raiz, ...CARPETA_DE_ADAPTADORES.split("/"));
  const adaptadores = existsSync(carpeta) ? readdirSync(carpeta).filter((n) => n.endsWith(".ts")).sort() : [];
  return [...ARCHIVOS_ENTEROS, ...adaptadores.map((n) => `${CARPETA_DE_ADAPTADORES}/${n}`), ARCHIVO_DE_AREAS, ARCHIVO_DE_EXCLUSIONES, ARCHIVO_DE_APROBACIONES, ARCHIVO_DE_PAQUETE, ARCHIVO_DE_CI];
}

/** Las huellas ACTUALES de todas las piezas del mecanismo que existen. */
export function huellasActuales(entrada: Omit<EntradaDeAprobaciones, "registro">): ReadonlyMap<string, HuellaActual> {
  const mapa = new Map<string, HuellaActual>();
  const poner = (clave: string, huella: string, que: string): void => void mapa.set(clave, { clave, archivo: archivoDeClave(clave), huella, que });
  const carpeta = join(entrada.raiz, ...CARPETA_DE_ADAPTADORES.split("/"));
  const adaptadores = existsSync(carpeta) ? readdirSync(carpeta).filter((n) => n.endsWith(".ts")).sort() : [];
  for (const ruta of [...ARCHIVOS_ENTEROS, ...adaptadores.map((n) => `${CARPETA_DE_ADAPTADORES}/${n}`)]) {
    const texto = leerONulo(entrada.raiz, ruta);
    if (texto !== null) poner(ruta, huellaDeBlob(texto), "archivo del mecanismo, entero");
  }
  const areas = leerONulo(entrada.raiz, ARCHIVO_DE_AREAS);
  if (areas !== null) {
    poner(`${ARCHIVO_DE_AREAS}#logica`, huellaDeBlob(sinDatos(areas, ARCHIVO_DE_AREAS, ["AREAS", "IDS_DE_CONTRATO", "CARTA", "POLITICA_DE_TIPOS"])), "la lógica de las áreas (sin las declaraciones de AREAS ni los ids)");
  }
  poner(`${ARCHIVO_DE_AREAS}#politica-de-tipos`, huellaDeBlob(formaGobernadaDeLaPoliticaDeTipos(entrada.politicaDeTipos)), "qué tipos de ruta declaran contratos (POLITICA_DE_TIPOS)");
  const exclusiones = leerONulo(entrada.raiz, ARCHIVO_DE_EXCLUSIONES);
  if (exclusiones !== null) poner(`${ARCHIVO_DE_EXCLUSIONES}#logica`, huellaDeBlob(sinDatos(exclusiones, ARCHIVO_DE_EXCLUSIONES, ["EXCLUSIONES"])), "la lógica de las exclusiones (sin la lista EXCLUSIONES)");
  poner(`${ARCHIVO_DE_EXCLUSIONES}#exclusiones`, huellaDeBlob(formaGobernadaDeExclusiones(entrada.exclusiones)), "las exclusiones de la clasificación de rutas (EXCLUSIONES)");
  const aprobaciones = leerONulo(entrada.raiz, ARCHIVO_DE_APROBACIONES);
  if (aprobaciones !== null) poner(`${ARCHIVO_DE_APROBACIONES}#logica`, huellaDeBlob(sinDatos(aprobaciones, ARCHIVO_DE_APROBACIONES, ["APROBACIONES"])), "la lógica del registro de aprobaciones (sin los datos de APROBACIONES)");
  const paquete = leerONulo(entrada.raiz, ARCHIVO_DE_PAQUETE);
  if (paquete !== null) poner(`${ARCHIVO_DE_PAQUETE}#scripts`, huellaDeBlob(formaGobernadaDeLosScripts(paquete)), "la clave `scripts` de package.json");
  const ci = leerONulo(entrada.raiz, ARCHIVO_DE_CI);
  if (ci !== null) poner(`${ARCHIVO_DE_CI}#sin-sha`, huellaDeBlob(normalizarWorkflow(ci)), "el workflow de CI con las actions sin su SHA");
  for (const c of entrada.contratos) poner(claveDeContrato(c.id), huellaDeBlob(formaGobernadaDeContrato(c)), `la definición gobernada de «${c.id}» (id, excepciones y casos legítimos)`);
  return mapa;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La revisión
// ---------------------------------------------------------------------------------------------------------------------------------

export type TipoDeHallazgoDeAprobacion = "huella-distinta" | "sin-aprobacion" | "archivo-ausente" | "aprobacion-invalida";

export interface HallazgoDeAprobacion {
  tipo: TipoDeHallazgoDeAprobacion;
  /** La ruta del archivo (o, en una aprobación inválida, la del registro). */
  archivo: string;
  /** 1-based. */
  linea: number;
  columna: number;
  clave: string;
  /** La huella que tiene la pieza hoy (vacía si no existe). */
  huella: string;
  /** La huella aprobada (vacía si no hay). */
  aprobada: string;
  que: string;
  como: string;
}

export interface ResultadoDeAprobaciones {
  hallazgos: HallazgoDeAprobacion[];
  /** Cuántas piezas vigila el registro hoy, y cuántas entradas tiene (el historial). */
  piezas: number;
  entradas: number;
}

const RE_BLOB = /^[0-9a-f]{40}$/;

/** La entrada que hay que pegar al final de `APROBACIONES`. */
const entradaParaPegar = (clave: string, huella: string): string => `{ archivo: "${clave}", blob: "${huella}", referencia: "DEC-nn | PR #n | commit <sha>", motivo: "por qué cambia (20 caracteres o más)" },`;

/** Lo que está mal en las entradas del registro mismo (forma de la huella, referencia, motivo). */
function validarRegistro(registro: readonly Aprobacion[], textoDelRegistro: string | null): HallazgoDeAprobacion[] {
  const out: HallazgoDeAprobacion[] = [];
  for (const a of registro) {
    const problemas: string[] = [];
    if (a.archivo.trim() === "") problemas.push("no dice a qué pieza corresponde (`archivo`)");
    if (a.blob !== RETIRADO && !RE_BLOB.test(a.blob)) problemas.push(`la huella «${a.blob}» no es un hash de blob de git (40 hexadecimales en minúscula) ni «${RETIRADO}»`);
    if (!referenciaValida(a.referencia)) problemas.push(`la referencia «${a.referencia}» no es \`PR #n\`, \`commit <sha>\` ni \`DEC-nn\``);
    if (a.motivo.trim().length < MOTIVO_MINIMO) problemas.push(`el motivo tiene menos de ${MOTIVO_MINIMO} caracteres`);
    if (problemas.length === 0) continue;
    const donde = textoDelRegistro === null ? -1 : textoDelRegistro.indexOf(`"${a.blob}"`);
    const linea = donde < 0 || textoDelRegistro === null ? 1 : textoDelRegistro.slice(0, donde).split("\n").length;
    out.push({
      tipo: "aprobacion-invalida",
      archivo: ARCHIVO_DE_APROBACIONES,
      linea,
      columna: 1,
      clave: a.archivo,
      huella: "",
      aprobada: a.blob,
      que: `una aprobación de «${a.archivo}» está mal armada: ${problemas.join("; ")}`,
      como: "corregí la entrada del registro APROBACIONES (huella de 40 hexadecimales, referencia válida y motivo de 20 caracteres o más)",
    });
  }
  return out;
}

/** Compara la huella actual de cada pieza con la última aprobada; una pieza nueva sin aprobación, un cambio sin aprobar y una pieza aprobada que ya no existe son hallazgos. */
export function revisarAprobaciones(entrada: EntradaDeAprobaciones): ResultadoDeAprobaciones {
  const hallazgos = validarRegistro(entrada.registro, leerONulo(entrada.raiz, ARCHIVO_DE_APROBACIONES));
  const actuales = huellasActuales(entrada);
  const vigentes = new Map<string, Aprobacion>();
  for (const a of entrada.registro) vigentes.set(a.archivo, a);
  for (const clave of [...new Set([...actuales.keys(), ...vigentes.keys()])].sort()) {
    const actual = actuales.get(clave);
    const aprobada = vigentes.get(clave);
    const base = { archivo: archivoDeClave(clave), linea: 1, columna: 1, clave };
    if (actual !== undefined && aprobada === undefined) {
      hallazgos.push({ ...base, tipo: "sin-aprobacion", huella: actual.huella, aprobada: "", que: `«${clave}» (${actual.que}) no tiene ninguna aprobación: huella actual ${actual.huella}`, como: `agregá la aprobación (referencia + motivo) al registro APROBACIONES de ${ARCHIVO_DE_APROBACIONES}. Entrada para pegar al final: ${entradaParaPegar(clave, actual.huella)}` });
    } else if (actual !== undefined && aprobada !== undefined && aprobada.blob !== actual.huella) {
      const estado = aprobada.blob === RETIRADO ? `estaba retirada y volvió a existir` : `cambió`;
      hallazgos.push({
        ...base,
        tipo: "huella-distinta",
        huella: actual.huella,
        aprobada: aprobada.blob,
        que: `«${clave}» (${actual.que}) ${estado}: huella actual ${actual.huella}, aprobada ${aprobada.blob}`,
        como: `si el cambio es a propósito, agregá la aprobación (referencia + motivo) al registro APROBACIONES de ${ARCHIVO_DE_APROBACIONES}; si no, revertí el cambio. Entrada para pegar al final: ${entradaParaPegar(clave, actual.huella)}`,
      });
    } else if (actual === undefined && aprobada !== undefined && aprobada.blob !== RETIRADO) {
      hallazgos.push({
        ...base,
        tipo: "archivo-ausente",
        huella: "",
        aprobada: aprobada.blob,
        que: `«${clave}» tiene una aprobación (${aprobada.blob}) y ya no existe`,
        como: `si se retiró a propósito, agregá la aprobación del retiro al registro APROBACIONES de ${ARCHIVO_DE_APROBACIONES}; si no, restauralo. Entrada para pegar al final: { archivo: "${clave}", blob: "${RETIRADO}", referencia: "DEC-nn | PR #n | commit <sha>", motivo: "por qué se retira (20 caracteres o más)" },`,
      });
    }
  }
  return { hallazgos, piezas: actuales.size, entradas: entrada.registro.length };
}

/** Los ids de contrato con una aprobación vigente (no retirada) en el registro. */
export function idsDeContratosAprobados(registro: readonly Aprobacion[]): string[] {
  const vigentes = new Map<string, Aprobacion>();
  for (const a of registro) vigentes.set(a.archivo, a);
  return [...vigentes.values()].flatMap((a) => (a.blob === RETIRADO ? [] : [RE_CLAVE_DE_CONTRATO.exec(a.archivo)?.[1] ?? ""])).filter((id) => id !== "").sort();
}

export const formatearHallazgoDeAprobacion = (h: HallazgoDeAprobacion): string => `${h.archivo}:${h.linea}:${h.columna}  [aprobaciones · ${h.tipo}]\n  ${h.que} → ${h.como}`;

export const resumirAprobaciones = (r: ResultadoDeAprobaciones): string => `${r.piezas} piezas del mecanismo vigiladas por huella, ${r.entradas} aprobaciones en el registro, ${r.hallazgos.length} hallazgos`;

export const formatearReporteDeAprobaciones = (r: ResultadoDeAprobaciones): string => [...r.hallazgos.map(formatearHallazgoDeAprobacion), resumirAprobaciones(r)].join("\n");
