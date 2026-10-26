import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { RAIZ_DEL_REPO } from "../cercos/trinquete";
import { armarEvidencia, markdownDeEvidencia, resumirMatriz, textoDeEvidencia, type Evidencia, type ResumenDeMatriz } from "./gobernanza/evidencia";
import { MANIFIESTO } from "./manifiesto";
import { ejecutarMatriz, falla, tablaComoJson, tablaComoTexto } from "./mutaciones/arnes";
import { EJEMPLOS_DE_CONTRATOS } from "./mutaciones/matriz";
import { fechaUtcDeHoy } from "./politica";

/**
 * El EJECUTOR de evidencia del guardián de contratos (paso G5): el CAMINO B, que corre el motor, la clasificación de rutas, las áreas, el cumplimiento del cableado, el registro de aprobaciones y la
 * matriz de mutaciones SIN Vitest, con `tsx`, sobre el repo real. Está encadenado en `npm run arquitectura` (`depcruise … && tsx test/arquitectura/contratos/ejecutar.ts`): corre en el job `estatico` del CI
 * (sin base de datos) y en el gate local, sin un noveno comando. Si Vitest dejara de correr los guardianes (un `exclude`, un test renombrado, `npm test` reemplazado), este camino sigue corriéndolos
 * y el cumplimiento del cableado lo dice.
 *
 * Imprime un resumen legible de lo que corrió y lo que cubrió (ver `gobernanza/evidencia.ts`) y sale con código 1 si algo falla: «pasó» no es «no encontró nada» (ids de contratos distintos del aprobado,
 * un alcance de 0 archivos, menos archivos leídos que el piso aprobado, cualquier hallazgo o un hueco en la matriz).
 *
 * Salidas, ambas opcionales y NINGUNA cambia lo que hace ningún guardián (son solo adonde se escribe lo que ya se calculó):
 *  - `CONTRATOS_EVIDENCIA=<ruta>`: escribe ahí `resultado-contratos.json` (la evidencia entera, con la matriz) al terminar, aunque falle. Sin la variable, no escribe nada. Si la ruta no se puede escribir,
 *    FALLA con un mensaje claro y antes de hacer nada: una evidencia que se pierde en silencio no es evidencia. En el CI la sube como artefacto el paso que sigue a `npm run arquitectura` (`ci.yml`).
 *  - `GITHUB_STEP_SUMMARY`: el resumen en Markdown que GitHub Actions muestra en la corrida.
 */

export const VARIABLE_DE_EVIDENCIA = "CONTRATOS_EVIDENCIA";
export const VARIABLE_DE_RESUMEN = "GITHUB_STEP_SUMMARY";

/** Un destino de salida que no se puede escribir: es un error del entorno, no un hallazgo de contratos. */
export class ErrorDeSalida extends Error {}

export interface Salidas {
  /** Dónde va `resultado-contratos.json` (null = no se escribe). */
  json: string | null;
  /** El archivo del resumen de GitHub Actions (null = no se escribe). */
  resumen: string | null;
}

export type Entorno = Readonly<Record<string, string | undefined>>;

const causa = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Resuelve y COMPRUEBA los destinos antes de correr nada: crea la carpeta, BORRA un resultado viejo y prueba que se puede escribir (escribe y borra). No deja ningún archivo mientras corre, a propósito: el
 * destino típico es `resultado-contratos.json` en la raíz del repo, y un archivo suelto ahí lo vería la clasificación de rutas como una ruta sin clasificar. Si el proceso muere a mitad de camino no queda
 * ningún resultado (ni uno viejo que parezca de esta corrida): el paso del CI que lo sube falla por falta de archivo. Una ruta que no se puede escribir lanza `ErrorDeSalida` con qué variable es y cómo se arregla.
 */
export function prepararSalidas(env: Entorno): Salidas {
  const pedidoJson = env[VARIABLE_DE_EVIDENCIA]?.trim() ?? "";
  const pedidoResumen = env[VARIABLE_DE_RESUMEN]?.trim() ?? "";
  const json = pedidoJson === "" ? null : resolve(pedidoJson);
  const resumen = pedidoResumen === "" ? null : resolve(pedidoResumen);
  if (json !== null) {
    try {
      mkdirSync(dirname(json), { recursive: true });
      rmSync(json, { force: true });
      writeFileSync(json, "");
      rmSync(json);
    } catch (error) {
      throw new ErrorDeSalida(`${VARIABLE_DE_EVIDENCIA}="${pedidoJson}" no se puede escribir (${causa(error)}): sin dónde dejar la evidencia la corrida no vale. Apuntala a una carpeta que exista y se pueda escribir (en el CI, resultado-contratos.json en la raíz) o sacá la variable.`);
    }
  }
  if (resumen !== null) {
    try {
      appendFileSync(resumen, "");
    } catch (error) {
      throw new ErrorDeSalida(`${VARIABLE_DE_RESUMEN}="${pedidoResumen}" no se puede escribir (${causa(error)}): el resumen de la corrida se perdería. Sacá la variable o apuntala a un archivo que se pueda escribir.`);
    }
  }
  return { json, resumen };
}

/** Escribe la evidencia terminada en los destinos que se pidieron (el JSON entero y el resumen en Markdown). */
export function escribirSalidas(salidas: Salidas, evidencia: Evidencia): void {
  if (salidas.json !== null) writeFileSync(salidas.json, `${JSON.stringify(evidencia, null, 2)}\n`);
  if (salidas.resumen !== null) appendFileSync(salidas.resumen, `${markdownDeEvidencia(evidencia)}\n`);
}

export interface OpcionesDelEjecutor {
  /** La raíz del repo (o de una copia exacta). */
  raiz: string;
  env: Entorno;
  /** `AAAA-MM-DD`; el ejecutor real usa `fechaUtcDeHoy()` y NO lee ninguna variable de entorno para la fecha. */
  hoy: string;
  /** `false` omite la matriz de mutaciones (los tests del ejecutor la omiten; el guardián real la corre siempre). */
  correrMatriz: boolean;
  /** Dónde se imprime el resumen y dónde los errores. */
  imprimir: (texto: string) => void;
  imprimirError: (texto: string) => void;
}

async function resumenDeLaMatriz(raiz: string, hoy: string): Promise<ResumenDeMatriz> {
  const corrida = await ejecutarMatriz({ raizReal: raiz, contratos: MANIFIESTO, ejemplos: EJEMPLOS_DE_CONTRATOS, hoy, soloContratos: false });
  const tabla = JSON.parse(tablaComoJson(corrida.filas)) as Record<string, unknown>[];
  return resumirMatriz(corrida, tabla, tablaComoTexto(corrida.filas, true), corrida.filas.filter(falla).length);
}

/** Corre todo, imprime el resumen, escribe las salidas y devuelve el código de salida: 0 si la evidencia no tiene ningún problema, 1 si no. */
export async function ejecutar(o: OpcionesDelEjecutor): Promise<number> {
  let salidas: Salidas;
  try {
    salidas = prepararSalidas(o.env);
  } catch (error) {
    o.imprimirError(`contratos · evidencia: ${causa(error)}`);
    return 1;
  }
  try {
    const matriz = o.correrMatriz ? await resumenDeLaMatriz(o.raiz, o.hoy) : null;
    const evidencia = armarEvidencia({ raiz: o.raiz, hoy: o.hoy, matriz });
    escribirSalidas(salidas, evidencia);
    o.imprimir(textoDeEvidencia(evidencia));
    if (salidas.json !== null) o.imprimir(`Evidencia escrita en ${salidas.json}`);
    return evidencia.veredicto === "ok" ? 0 : 1;
  } catch (error) {
    o.imprimirError(`contratos · evidencia: la corrida se cortó sin terminar (${causa(error)}). Sin evidencia completa no hay «pasó».`);
    if (salidas.json !== null) {
      try {
        writeFileSync(salidas.json, `${JSON.stringify({ version: 1, veredicto: "error", motivo: causa(error) }, null, 2)}\n`);
      } catch {
        // El destino ya se comprobó al empezar; si ahora falla, el mensaje de arriba y el código 1 son lo que queda.
      }
    }
    return 1;
  }
}

if (process.argv[1] && /contratos[\\/]ejecutar\.ts$/.test(process.argv[1])) {
  void ejecutar({ raiz: RAIZ_DEL_REPO, env: process.env, hoy: fechaUtcDeHoy(), correrMatriz: true, imprimir: (t) => console.log(t), imprimirError: (t) => console.error(t) }).then((codigo) => {
    process.exitCode = codigo;
  });
}
