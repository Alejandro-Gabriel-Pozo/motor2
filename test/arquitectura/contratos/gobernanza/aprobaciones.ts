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
 *  - ENTEROS: `motor.ts`, `tipos.ts`, `politica.ts`, `indice.ts`, `ejecutar.ts` (el ejecutor de evidencia, G5), `adaptadores/*.ts`, `gobernanza/{clasificacion,usos,cumplimiento,evidencia}.ts`,
 *    `mutaciones/{arnes,operadores}.ts`, `vitest.config.ts`, `playwright.config.ts` y `.gitignore`.
 *  - LA LÓGICA sin los datos (`#logica`): `gobernanza/areas.ts`, `gobernanza/exclusiones.ts` y este archivo. Sus DATOS (las declaraciones de `AREAS`, los ids de `IDS_DE_CONTRATO`, la
 *    lista `EXCLUSIONES`, el registro `APROBACIONES`) cambian a menudo y se vigilan por su forma canónica o por otro guardián. Solo se sacan del hash las sentencias que son
 *    datos PUROS (literales, listas, objetos, referencias a otra constante); una que tenga una llamada, una función o una cuenta se queda en el hash.
 *  - LA FORMA CANÓNICA (JSON de claves ordenadas) de la DEFINICIÓN COMPLETA de cada contrato MENOS la deuda (`<id>.ts#gobernado`): `id`, `porQue`, `fuente`, `alcance`, `senales`, `declaracion`,
 *    `definicion`, `consumidores`, `casosLegitimos` y `excepciones` (y todo campo que `Contrato` gane más adelante: se excluye `deuda` por nombre, no se incluye por nombre). Las expresiones
 *    regulares se serializan por su `source` y sus `flags`. Cualquier cambio que pueda silenciar un uso (estrechar el `alcance`, sacar o aflojar una señal, cambiar la `declaracion`, una lista
 *    cerrada de `consumidores`, un caso legítimo, una excepción) pide una aprobación explícita: es la fricción deseada de un guardián fail-closed. El orden de las listas no cuenta. La deuda NO se
 *    hashea: ya la gobiernan los vencimientos de 60 días y el diff de la deuda. Además: las exclusiones de la clasificación (`exclusiones.ts#exclusiones`) y qué tipos de ruta declaran
 *    contratos (`areas.ts#politica-de-tipos`).
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
  // Paso G6, segundo commit (DEC-03): el arnés verifica también el cumplimiento y el registro; los 7 huecos conocidos pasan a mutaciones protegidas.
  { archivo: "test/arquitectura/contratos/gobernanza/cumplimiento.ts", blob: "d554388126eae0b34899fce709ec95c44f05ee46", referencia: "DEC-03", motivo: "G6: los 7 huecos conocidos de la matriz pasan a mutaciones protegidas (el arnés verifica también el cumplimiento y el registro de aprobaciones; los evaluadores memorizan por texto)" },
  { archivo: "test/arquitectura/contratos/mutaciones/arnes.ts", blob: "773e798a0836178844c1e9cd1011181190b6a68c", referencia: "DEC-03", motivo: "G6: los 7 huecos conocidos de la matriz pasan a mutaciones protegidas (el arnés verifica también el cumplimiento y el registro de aprobaciones; los evaluadores memorizan por texto)" },
  { archivo: "test/arquitectura/contratos/mutaciones/operadores.ts", blob: "d65b7bc07dd01c5c9206fab04cb8a2943d2f4c1c", referencia: "DEC-03", motivo: "G6: los 7 huecos conocidos de la matriz pasan a mutaciones protegidas (el arnés verifica también el cumplimiento y el registro de aprobaciones; los evaluadores memorizan por texto)" },
  // Paso F6 6.4 (DEC-03): la carta del panel pasa a los tokens; varios consumidores de un mismo token y de un área que declara `tokens-visuales`
  { archivo: "test/arquitectura/contratos/mutaciones/operadores.ts", blob: "24f843bff00e4112a93605bb8ff5360b722ecd0d", referencia: "DEC-03", motivo: "cambio del paso F6 6.4: quitar-token, extension-no-analizada y reglas toleran los efectos legítimos de que un token tenga varios usos y de que un área declare tokens-visuales (la mutación esperada sigue siendo obligatoria)" },
  // Paso G5 (DEC-03): ejecutor de evidencia por corrida (camino B, tsx, encadenado en npm run arquitectura), su módulo de veredicto, el piso de archivos leídos y el invariante «evidencia no vacía» de la matriz.
  { archivo: "package.json#scripts", blob: "0f83a78fb47af6cee80d68608e491dff85477c17", referencia: "DEC-03", motivo: "G5: ejecutor de evidencia por corrida encadenado en npm run arquitectura; «pasó» no es «no encontró nada» (ids aprobados, alcance > 0, piso de archivos leídos, 0 hallazgos)" },
  { archivo: "test/arquitectura/contratos/ejecutar.ts", blob: "aed3d54625bd3361f1a10a01eded005d1d0a179c", referencia: "DEC-03", motivo: "G5: ejecutor de evidencia por corrida encadenado en npm run arquitectura; «pasó» no es «no encontró nada» (ids aprobados, alcance > 0, piso de archivos leídos, 0 hallazgos)" },
  { archivo: "test/arquitectura/contratos/gobernanza/aprobaciones.ts#logica", blob: "6f756ca6019dba331280d0200810cf8ffcd70114", referencia: "DEC-03", motivo: "G5: ejecutor de evidencia por corrida encadenado en npm run arquitectura; «pasó» no es «no encontró nada» (ids aprobados, alcance > 0, piso de archivos leídos, 0 hallazgos)" },
  { archivo: "test/arquitectura/contratos/gobernanza/cumplimiento.ts", blob: "30c8d213b3a114c2129071c2d69b8cad50eb1d0f", referencia: "DEC-03", motivo: "G5: ejecutor de evidencia por corrida encadenado en npm run arquitectura; «pasó» no es «no encontró nada» (ids aprobados, alcance > 0, piso de archivos leídos, 0 hallazgos)" },
  { archivo: "test/arquitectura/contratos/gobernanza/evidencia.ts", blob: "28bc272be777d0cb937ba71c2d636b648ae89044", referencia: "DEC-03", motivo: "G5: ejecutor de evidencia por corrida encadenado en npm run arquitectura; «pasó» no es «no encontró nada» (ids aprobados, alcance > 0, piso de archivos leídos, 0 hallazgos)" },
  { archivo: "test/arquitectura/contratos/mutaciones/arnes.ts", blob: "61c05fa0d7c47059d06a5cd3250e6994f5a299c8", referencia: "DEC-03", motivo: "G5: ejecutor de evidencia por corrida encadenado en npm run arquitectura; «pasó» no es «no encontró nada» (ids aprobados, alcance > 0, piso de archivos leídos, 0 hallazgos)" },
  { archivo: "test/arquitectura/contratos/mutaciones/operadores.ts", blob: "b966056de369f154e01c0c809d47f33e039c2acf", referencia: "DEC-03", motivo: "G5: ejecutor de evidencia por corrida encadenado en npm run arquitectura; «pasó» no es «no encontró nada» (ids aprobados, alcance > 0, piso de archivos leídos, 0 hallazgos)" },
  { archivo: "test/arquitectura/contratos/politica.ts", blob: "c51c23975238a6d944e6de72846ed288162ac254", referencia: "DEC-03", motivo: "G5: ejecutor de evidencia por corrida encadenado en npm run arquitectura; «pasó» no es «no encontró nada» (ids aprobados, alcance > 0, piso de archivos leídos, 0 hallazgos)" },
  // Paso G7 (DEC-03): el CI sube la evidencia de los contratos como artefacto (ci.yml, autorizado por el dueño), Playwright prohíbe .only en el CI (forbidOnly) y el cumplimiento lo exige (ci-sin-evidencia, playwright-sin-forbidonly).
  { archivo: ".github/workflows/ci.yml#sin-sha", blob: "2866adda4577ce7c5c1ca1afb3850df0e96fd769", referencia: "DEC-03", motivo: "G7: el CI sube resultado-contratos.json como artefacto (if-no-files-found: error) y Playwright prohíbe test.only en el CI (forbidOnly); evaluadores nuevos en cumplimiento.ts" },
  { archivo: "playwright.config.ts", blob: "2be7cbf60124cef9650fc1a49bbed2e8478d0e97", referencia: "DEC-03", motivo: "G7: el CI sube resultado-contratos.json como artefacto (if-no-files-found: error) y Playwright prohíbe test.only en el CI (forbidOnly); evaluadores nuevos en cumplimiento.ts" },
  { archivo: "test/arquitectura/contratos/gobernanza/cumplimiento.ts", blob: "42cb67593016cd4e5a3a612a55810a515a91afcf", referencia: "DEC-03", motivo: "G7: el CI sube resultado-contratos.json como artefacto (if-no-files-found: error) y Playwright prohíbe test.only en el CI (forbidOnly); evaluadores nuevos en cumplimiento.ts" },
  // Línea de base ampliada (DEC-03): el registro hashea la definición COMPLETA de cada contrato (menos la deuda), con las expresiones regulares por source y flags; antes solo { id, excepciones, casosLegitimos }.
  { archivo: "test/arquitectura/contratos/contratos/borde-propio-de-carta.ts#gobernado", blob: "64f0fb1d44cca3ed3b685504654869c28e0226f0", referencia: "DEC-03", motivo: "línea de base ampliada: definición completa del contrato" },
  { archivo: "test/arquitectura/contratos/contratos/separador-de-lista-de-carta.ts#gobernado", blob: "bd2c25ad11c9728c70b91bb2057a3c393ddea1da", referencia: "DEC-03", motivo: "línea de base ampliada: definición completa del contrato" },
  { archivo: "test/arquitectura/contratos/contratos/tokens-visuales.ts#gobernado", blob: "cdd517c6556e4d5861307c70812c38ae5f37a135", referencia: "DEC-03", motivo: "línea de base ampliada: definición completa del contrato" },
  { archivo: "test/arquitectura/contratos/gobernanza/aprobaciones.ts#logica", blob: "a48c1ed5126a6ab55fbdc37563547e81fc6aa6f2", referencia: "DEC-03", motivo: "la huella de cada contrato cubre su definición completa menos la deuda (alcance, señales, declaración, consumidores): lógica del registro y operador contrato-alterado del arnés" },
  { archivo: "test/arquitectura/contratos/mutaciones/operadores.ts", blob: "b43789d581e1167c4fb72f115462ecfc30503f08", referencia: "DEC-03", motivo: "la huella de cada contrato cubre su definición completa menos la deuda (alcance, señales, declaración, consumidores): lógica del registro y operador contrato-alterado del arnés" },
  // Fase 6, paso 6.6 (primitivas de src/ui): un contrato por primitiva.
  { archivo: "test/arquitectura/contratos/contratos/primitiva-boton.ts#gobernado", blob: "f97c4a848345f42e5e7b64a2a03279c682259eb9", referencia: "DEC-03", motivo: "F6 6.6a: contrato de la primitiva Boton (fuente única src/ui/primitivas/boton.tsx; quien dibuja <Boton> la importa de ahí)" },
  { archivo: "test/arquitectura/contratos/mutaciones/operadores.ts", blob: "aca2c30e53f9088d196802be9cc5f9b7cf1eab58", referencia: "DEC-03", motivo: "F6 6.6a: los operadores borrar-fuente y mover toleran los hallazgos que provoca tocar la fuente de una primitiva (src/ui lleva las fuentes y es el único archivo del área ui que usa tokens-visuales)" },
  { archivo: "test/arquitectura/contratos/adaptadores/ts.ts", blob: "e2c7212f6a025aa50c7294afce176b1009cbff12", referencia: "DEC-03", motivo: "F6 6.6a: las declaraciones de un archivo se recorren una vez por AST memorizado (varios contratos de primitivas buscan declaraciones; sin la caché la matriz pasa de 35 s)" },
  { archivo: "test/arquitectura/contratos/indice.ts", blob: "3f394c02d737eba07919c4e294ca16ad7a22b664", referencia: "DEC-03", motivo: "F6 6.6a: el código sin comentarios de un archivo se memoriza entre corridas del motor por texto (el arnés lo recalculaba por corrida y por archivo)" },
  { archivo: "test/arquitectura/contratos/contratos/primitiva-campo.ts#gobernado", blob: "765e085e9f63ebb349a8f856962a92e66cc0b834", referencia: "DEC-03", motivo: "F6 6.6b: contrato de la primitiva Campo (fuente única src/ui/primitivas/campo.tsx; quien dibuja <Campo> la importa de ahí)" },
  { archivo: "test/arquitectura/contratos/gobernanza/usos.ts", blob: "1ca95ef32769677717a7a74adc2f090823e83b3a", referencia: "DEC-03", motivo: "F6 6.6b: el recorrido de archivos de un alcance se hace una vez por alcance distinto en cada consulta (las cuatro primitivas comparten raíces y extensiones); mismo resultado, menos disco en el arnés" },
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
  `${CARPETA}/gobernanza/evidencia.ts`,
  `${CARPETA}/ejecutar.ts`,
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
  // Una expresión regular no tiene claves propias: sin esto `JSON.stringify` la dejaría en `{}` y cambiar un detector no cambiaría ninguna huella.
  if (Object.prototype.toString.call(valor) === "[object RegExp]") return { regexp: (valor as RegExp).source, flags: (valor as RegExp).flags };
  if (Array.isArray(valor)) return valor.map(ordenarClaves);
  if (valor !== null && typeof valor === "object") return Object.fromEntries(Object.entries(valor as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, ordenarClaves(v)]));
  return valor;
}

/** JSON estable: las claves de los objetos van ordenadas; el orden de las listas lo decide quien la arma. */
const jsonCanonico = (valor: unknown): string => JSON.stringify(ordenarClaves(valor));

const ordenadas = <T>(lista: readonly T[]): T[] => [...lista].sort((a, b) => (jsonCanonico(a) < jsonCanonico(b) ? -1 : jsonCanonico(a) > jsonCanonico(b) ? 1 : 0));

const textosOrdenados = (lista: readonly string[]): string[] => [...lista].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * La forma canónica de la definición gobernada de un contrato: TODA su definición MENOS la deuda (`deuda`, que ya gobiernan los vencimientos). Se arma desde los campos del propio objeto, sacando `deuda` por
 * nombre: un campo nuevo de `Contrato` queda gobernado sin tocar esto (fail-closed). Las listas cuyo orden no cambia nada (señales, definiciones, excepciones, casos legítimos, raíces, extensiones,
 * equivalentes y una lista cerrada de consumidores) se ordenan; las expresiones regulares van por `source` y `flags` (`ordenarClaves`).
 */
function formaGobernadaDeContrato(c: Contrato): string {
  const definicion: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(c)) if (campo !== "deuda") definicion[campo] = valor;
  definicion.senales = ordenadas(c.senales);
  definicion.definicion = ordenadas(c.definicion);
  definicion.excepciones = ordenadas(c.excepciones);
  definicion.casosLegitimos = ordenadas(c.casosLegitimos);
  definicion.alcance = { raices: textosOrdenados(c.alcance.raices), extensiones: textosOrdenados(c.alcance.extensiones) };
  definicion.consumidores = c.consumidores === "descubiertos" ? c.consumidores : textosOrdenados(c.consumidores);
  definicion.declaracion = c.declaracion.tipo === "clase-companera" ? { ...c.declaracion, equivalentes: textosOrdenados(c.declaracion.equivalentes) } : c.declaracion;
  return jsonCanonico(definicion);
}

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
  for (const c of entrada.contratos) poner(claveDeContrato(c.id), huellaDeBlob(formaGobernadaDeContrato(c)), `la definición completa de «${c.id}» (todo menos la deuda: fuente, alcance, señales, declaración, consumidores, casos legítimos y excepciones)`);
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
