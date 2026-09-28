import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián de arquitectura (Task #41, hallazgo post-cierre 2026-09-28 — docs/pendientes-sesion-2026-09-27.md, "Hallazgo post-cierre"):
 * el test de idempotencia "doble clic" de `registrarPagoConsignante` (M14) era SECUENCIAL (dos `await` uno detrás del otro) y nunca
 * ejercitaba el catch de P2002 real — el mecanismo de I3 puede fallar exactamente en la carrera que dice resolver sin que ningún test
 * se entere. Al auditar el resto del proyecto con este mismo test se encontró un hueco real en `reclasificarStock` (sin NINGÚN test
 * de la clave, ni secuencial — cerrado el mismo día en `test/stock/reclasificacion.test.ts`, describe "idempotencia (I3)").
 * `anularCompra` se sospechó con el mismo hueco en una primera auditoría manual, pero este test automático encontró un segundo
 * archivo (`test/movimientos/compras-anular.test.ts`, describe "concurrencia") con una carrera real que la auditoría manual se
 * había perdido — corregido acá mismo, sin dejarlo en la excepción. `SIN_TEST_CONCURRENTE_TODAVIA` quedó vacía: no hay ningún
 * caso de uso de I3 sin cobertura concurrente real hoy.
 *
 * A propósito NO es una lista a mano de "estos archivos necesitan el test" (ese fue justo el problema con `DOMINIOS_CON_PUBLIC`:
 * un dominio nuevo que nadie se acuerda de agregar queda sin ninguna protección, en silencio). Este test DESCUBRE solo todo caso de
 * uso que implementa I3 (importa `calcularPayloadHash`) y exige que tenga un test con una carrera CONCURRENTE real
 * (`Promise.all`/`Promise.allSettled`, no dos `await` secuenciales) — salvo que esté en `SIN_TEST_CONCURRENTE_TODAVIA`, con motivo.
 * Un caso de uso de I3 nuevo que nadie recuerde testear con concurrencia real hace FALLAR este test por default, no al revés.
 *
 * Verificado en las DOS direcciones, mismo criterio que `lectores-de-receta.test.ts`: una entrada de la excepción que en realidad YA
 * tiene test concurrente (alguien lo agregó y se olvidó de sacarla de la lista) también es una desincronización a corregir.
 */
const SRC = join(__dirname, "../../src");
const TEST = join(__dirname, "../../test");

/**
 * Casos de uso con I3 que TODAVÍA no tienen un test de carrera concurrente real — cada entrada exige motivo. Vaciar esta lista a
 * medida que se les agrega el test (mismo patrón `Promise.allSettled` que `registrarPagoConsignante`,
 * `test/reportes/consignacion.test.ts`, o `test/auditoria/idempotencia-i3-mecanismo.test.ts`).
 */
const SIN_TEST_CONCURRENTE_TODAVIA: Record<string, string> = {};

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function rutaRelativa(base: string, ruta: string): string {
  return relative(base, ruta).split(sep).join("/");
}

/**
 * Saca comentarios de bloque y de línea antes de buscar patrones — sin esto, ESTE MISMO archivo se autodetecta como falso positivo:
 * su propio docstring describe en prosa "un `Promise.allSettled` de `aceptarTransferencia`... tests SECUENCIALES de
 * `reclasificarStock`" (explicando el bug que este comentario corrige), y como `archivosFuente(TEST)` se escanea a sí mismo, ese
 * texto calzaba con el detector. Heurística simple (no distingue un `//` dentro de un string), aceptable para este uso.
 */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Todos los `export async function NOMBRE(` de un archivo — heurística simple, misma que el resto de los tests de arquitectura de este proyecto. */
function nombresDeFunciones(fuente: string): string[] {
  return [...fuente.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
}

interface CasoDeUsoI3 {
  ruta: string; // relativa a src/, ej. "server/actions/reportes/casos-de-uso/registrar-pago-consignante.ts"
  nombresBuscados: string[]; // el nombre propio del caso de uso + el/los nombre(s) del adaptador (Server Action) que lo envuelve
}

/** Descubre TODO caso de uso bajo casos-de-uso/ que implementa I3 (importa `calcularPayloadHash`) — nunca una lista a mano. */
function descubrirCasosDeUsoConI3(): CasoDeUsoI3[] {
  const archivos = archivosFuente(SRC).filter((r) => /[\\/]casos-de-uso[\\/][^\\/]+\.tsx?$/.test(r));
  const resultado: CasoDeUsoI3[] = [];

  for (const archivo of archivos) {
    const fuente = sinComentarios(readFileSync(archivo, "utf8"));
    if (!/\bcalcularPayloadHash\b/.test(fuente)) continue;

    const nombresPropios = nombresDeFunciones(fuente);
    const basename = archivo.replace(/\.tsx?$/, "").split(/[\\/]/).pop()!;

    // El adaptador (Server Action) vive un nivel arriba de casos-de-uso/, e importa `from "./casos-de-uso/<basename>"`.
    const carpetaAccion = dirname(dirname(archivo));
    const archivosDeCarpeta = readdirSync(carpetaAccion).filter((n) => /\.tsx?$/.test(n));
    const nombresWrapper: string[] = [];
    for (const nombreArchivo of archivosDeCarpeta) {
      const rutaWrapper = join(carpetaAccion, nombreArchivo);
      if (statSync(rutaWrapper).isDirectory()) continue;
      const fuenteWrapper = sinComentarios(readFileSync(rutaWrapper, "utf8"));
      if (new RegExp(`from\\s+["']\\./casos-de-uso/${basename}["']`).test(fuenteWrapper)) {
        nombresWrapper.push(...nombresDeFunciones(fuenteWrapper));
      }
    }

    resultado.push({ ruta: rutaRelativa(SRC, archivo), nombresBuscados: [...new Set([...nombresPropios, ...nombresWrapper])] });
  }

  return resultado;
}

/**
 * true si ALGÚN archivo de test tiene una llamada `Promise.all(`/`Promise.allSettled(` cuyo ARGUMENTO (no el archivo entero — eso dio
 * un falso positivo real: `idempotencia-i3-mecanismo.test.ts` tiene un `Promise.allSettled` de `aceptarTransferencia` y, en otro
 * describe del MISMO archivo, tests SECUENCIALES de `reclasificarStock` — el archivo entero "contiene ambas cosas" sin que se
 * relacionen) menciona uno de `nombres`. Se toma un recorte de 400 caracteres después del `(` para cubrir el array de promesas sin
 * tener que parsear JS de verdad — misma heurística "suficientemente buena" que el resto de los tests de arquitectura de este
 * proyecto (ej. `RE_LECTURA` de `lectores-de-receta.test.ts`).
 */
function tieneTestConcurrente(nombres: string[]): boolean {
  const archivosTest = archivosFuente(TEST).filter((r) => /\.test\.tsx?$/.test(r));
  return archivosTest.some((archivo) => {
    const fuente = sinComentarios(readFileSync(archivo, "utf8"));
    return [...fuente.matchAll(/Promise\.(?:all|allSettled)\s*\(/g)].some((m) => {
      const recorte = fuente.slice(m.index!, m.index! + 400);
      return nombres.some((n) => new RegExp(`\\b${n}\\b`).test(recorte));
    });
  });
}

describe("idempotencia I3: todo caso de uso con claveIdempotencia tiene un test de carrera CONCURRENTE real (Promise.all/allSettled), no solo secuencial", () => {
  const casos = descubrirCasosDeUsoConI3();

  it("encuentra casos de uso con I3 en src/ (si esto da 0, algo rompió el descubrimiento, no que ya no haya ninguno)", () => {
    expect(casos.length).toBeGreaterThan(0);
  });

  it("cada caso de uso con I3 tiene test concurrente real, o está en SIN_TEST_CONCURRENTE_TODAVIA con motivo", () => {
    const sinCubrirYSinExcepcion = casos.filter((c) => !tieneTestConcurrente(c.nombresBuscados) && !(c.ruta in SIN_TEST_CONCURRENTE_TODAVIA));

    expect(
      sinCubrirYSinExcepcion,
      `Caso(s) de uso con I3 sin test de carrera concurrente real y sin excepción documentada — agregá un test con Promise.allSettled ` +
        `(mismo patrón que test/reportes/consignacion.test.ts) o sumalo a SIN_TEST_CONCURRENTE_TODAVIA con motivo:\n` +
        sinCubrirYSinExcepcion.map((c) => `  - ${c.ruta} (nombres buscados: ${c.nombresBuscados.join(", ")})`).join("\n")
    ).toEqual([]);
  });

  it("SIN_TEST_CONCURRENTE_TODAVIA no tiene entradas obsoletas (un caso que ya tiene test concurrente, o que ya no existe)", () => {
    for (const ruta of Object.keys(SIN_TEST_CONCURRENTE_TODAVIA)) {
      const caso = casos.find((c) => c.ruta === ruta);
      expect(caso, `${ruta} está en SIN_TEST_CONCURRENTE_TODAVIA pero ya no se descubre como caso de uso con I3 (¿se movió, o dejó de usar calcularPayloadHash?) — sacala de la lista.`).toBeDefined();
      if (caso) {
        expect(
          tieneTestConcurrente(caso.nombresBuscados),
          `${ruta} está en SIN_TEST_CONCURRENTE_TODAVIA pero YA tiene un test concurrente real — sacala de la lista, el hueco ya se cerró.`
        ).toBe(false);
      }
    }
  });
});
