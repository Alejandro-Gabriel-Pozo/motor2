import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián de arquitectura (backlog post-cierre de Task #41, 2026-09-28, docs/pendientes-sesion-2026-09-27.md §10): la Server Action
 * que envuelve cada caso de uso tiene que pasar SU RESULTADO por `aResultadoAccion` antes de devolverlo — es la única barrera que
 * impide que `datos`/`codigo`/`erroresPorCampo` (ids internos, motivos de fracaso pensados para tests/futuros llamadores) lleguen
 * crudos al navegador. Un caso de uso nuevo cuyo wrapper se olvide de `aResultadoAccion` (devuelva el `ResultadoCaso` crudo, o lo arme
 * a mano) filtraría esos campos internos a la UI sin que ningún tipo lo marque — `ResultadoCaso`/`ResultadoAccion`
 * (src/core/resultado-caso.ts, src/server/actions/tipos.ts) tienen campos suficientemente parecidos como para que TypeScript no lo
 * distinga solo.
 *
 * DESCUBRE (no una lista a mano) todo caso de uso real (mismo heurístico "la Server Action un nivel arriba lo importa" que
 * `casos-de-uso-con-tags-de-contrato.test.ts` e `idempotencia-i3-cobertura-concurrente.test.ts`) y exige que, en el archivo de esa
 * Server Action, `aResultadoAccion` efectivamente envuelva la llamada al caso de uso — con VENTANA DE PROXIMIDAD (no "el archivo
 * entero contiene ambos textos"), mismo motivo que `tieneTestConcurrente` de `idempotencia-i3-cobertura-concurrente.test.ts`: un
 * archivo con varias acciones (ej. `conteo-fisico.ts`, que envuelve tres casos de uso distintos) podría tener `aResultadoAccion` cerca
 * de UNA llamada y otro caso de uso sin envolver en otra parte del mismo archivo, y "el archivo contiene ambas cosas" no lo detectaría.
 *
 * Dos patrones reales conviven en este proyecto (confirmado con `grep -rn "aResultadoAccion(" src/server/actions`, 2026-09-28):
 *  1. Directo — la inmensa mayoría: `return aResultadoAccion(await xCasoDeUso(...));` (o dentro de un ternario/`.push(...)`, ej.
 *     `conteo-fisico.ts:69`) — el nombre del caso de uso aparece a pocos caracteres de `aResultadoAccion(`.
 *  2. Mediado por variable — `guardar-version-de-receta.ts`: `const resultado = await guardarVersionDeRecetaCasoDeUso(...); ... if
 *     (resultado.ok) refrescarVistaSiHaceFalta(); return aResultadoAccion(resultado);` (el side effect entre medio hace que el
 *     patrón directo no alcance).
 */
const SRC = join(__dirname, "../../src");

/**
 * Casos de uso reales cuyo wrapper NO envuelve la llamada con `aResultadoAccion` — cada entrada exige motivo. A diferencia de otras
 * excepciones de este proyecto (ej. `DOMINIOS_SIN_PUBLIC_TODAVIA`), estas son PERMANENTES por diseño, no "todavía sin hacer":
 * `crearSolicitudTransferencia`/`crearEnvioDirectoTransferencia` (`src/server/actions/traspasos/traspasos.ts`) devuelven
 * `ResultadoConId` (`{ ok, mensaje, id, nombre }`, `src/server/actions/tipos.ts`), no `ResultadoAccion` — la UI necesita el id/nombre
 * del traspaso recién creado para navegar, algo que `aResultadoAccion` (que solo deja pasar `ok`/`mensaje`) no puede dar. Verificado
 * que `ResultadoConId`/`okConId` no filtran `codigo`/`erroresPorCampo` — mismo criterio de "solo lo necesario", con más campos.
 */
const SIN_ENVOLTORIO_TODAVIA: Record<string, string> = {
  "server/actions/traspasos/casos-de-uso/crear-solicitud-de-traspaso.ts":
    "crearSolicitudTransferencia devuelve ResultadoConId ({ ok, mensaje, id, nombre }), no ResultadoAccion — la UI necesita el traspasoId/productoNombre recién creados para navegar. okConId/error no filtran codigo/erroresPorCampo. Diseño permanente, no un olvido.",
  "server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso.ts":
    "crearEnvioDirectoTransferencia devuelve ResultadoConId ({ ok, mensaje, id, nombre }), no ResultadoAccion — mismo motivo que crear-solicitud-de-traspaso.ts. Diseño permanente, no un olvido.",
  "server/actions/pos/casos-de-uso/emitir-ticket-corregido.ts":
    "emitirTicketCorregido arma { ...ok(r.mensaje), numero: r.datos.numero, ejemplar: r.datos.ejemplar } a mano (docstring propio: " +
    "\"Como aResultadoAccion, pero la pantalla necesita además QUÉ ejemplar se emitió — solo numero y ejemplar de datos, nunca los ids " +
    "internos\") — devuelve ResultadoTicketCorregido, no ResultadoAccion. Mismo criterio de aResultadoAccion (nunca ids internos), con 2 " +
    "campos extra elegidos a mano. Diseño permanente, no un olvido.",
  "server/actions/pos/casos-de-uso/enviar-a-cocina.ts":
    "enviarACocina (server/actions/pos/cuenta-pedido.ts; Hito 4, bloque 4.1, paso 11) arma { ...ok(r.mensaje), numeroEnvio: r.datos.numeroEnvio, envioNuevo: " +
    "r.datos.envioNuevo } a mano — devuelve ResultadoEnvioACocina, no ResultadoAccion: la pantalla imprime la comanda solo del envío que creó ESTA llamada " +
    "(envioNuevo) y necesita su número. Mismo criterio que emitir-ticket-corregido.ts: nunca ids internos, solo esos 2 campos de datos. Diseño permanente, no un olvido.",
  "server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts":
    "aceptarMiInvitacion (server/actions/auth/invitacion.ts) no devuelve el resultado del caso de uso: si falla devuelve error(resultado.mensaje) (solo el texto) y si sale bien borra la cookie y redirige a /login (redirect de Next, que corta la acción). El ResultadoDeAceptacion ({ ok, empresaId, nombreEmpresa } | { ok, mensaje }) no tiene codigo ni erroresPorCampo y nunca llega entero al navegador. Diseño permanente (B3-5), no un olvido.",
  "server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario.ts":
    "aceptarMiInvitacionDeUsuario (server/actions/auth/invitacion.ts): mismo diseño que la de gerente — si falla devuelve error(resultado.mensaje) y si sale bien borra la cookie y redirige a /login; el ResultadoDeAceptacion nunca llega entero al navegador. Diseño permanente (B3-7), no un olvido.",
  "server/actions/auth/casos-de-uso/enviar-invitacion-y-anotar.ts":
    "enviarInvitacionYAnotar (Hito 3, I.5f) es el EFECTO EXTERNO de la alta, el reenvío y la invitación a vincular (usuarios.ts): la Server Action lo llama después de que su transacción confirmó la invitación y solo lee si el mail salió (ResultadoDelEnvio { enviado, motivo }) para armar el mensaje final, que sí sale por ok/error. El ResultadoDelEnvio no tiene codigo, datos ni erroresPorCampo y nunca llega al navegador. Diseño permanente, no un olvido.",
  "server/actions/reportes/casos-de-uso/sincronizar-dolar.ts":
    "No tiene Server Action ni navegador: lo invocan los crons y el encabezado de la aplicación (`sincronizaciones.ts`, sin \"use server\", permiso SISTEMA) y devuelve un ResultadoSincronizacionDolar (días rellenados, fuente, errores) o lanza si ninguna fuente responde (el cron contesta 502). Nunca llega al browser. Diseño permanente, no un olvido.",
  "server/actions/reportes/casos-de-uso/sincronizar-ipc.ts":
    "No tiene Server Action ni navegador: lo invoca el cron del IPC (`sincronizaciones.ts`, sin \"use server\", permiso SISTEMA) y devuelve un ResultadoSincronizacionIPC (meses nuevos, antigüedad de la serie) o lanza si la API no trae la serie. Nunca llega al browser. Diseño permanente, no un olvido.",
};

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function rutaRelativa(base: string, ruta: string): string {
  return relative(base, ruta).split(sep).join("/");
}

/** Saca comentarios de bloque y de línea antes de buscar patrones — mismo motivo que los otros tests de arquitectura de esta sesión. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Todos los `export async function NOMBRE(` de un archivo. */
function nombresDeFunciones(fuente: string): string[] {
  return [...fuente.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
}

interface CasoDeUsoReal {
  ruta: string; // relativa a src/, ej. "server/actions/stock/casos-de-uso/reclasificar-stock.ts"
  nombresPropios: string[]; // export async function ...CasoDeUso del propio archivo
  fuentesWrapper: string[]; // contenido (sin comentarios) de cada Server Action que lo importa
}

/** Descubre TODO caso de uso real — mismo heurístico "la Server Action un nivel arriba lo importa" que los dos tests hermanos. */
function descubrirCasosDeUsoReales(): CasoDeUsoReal[] {
  const archivos = archivosFuente(SRC).filter((r) => /[\\/]server[\\/]actions[\\/][^\\/]+[\\/]casos-de-uso[\\/][^\\/]+\.tsx?$/.test(r));
  const resultado: CasoDeUsoReal[] = [];

  for (const archivo of archivos) {
    const basename = archivo.replace(/\.tsx?$/, "").split(/[\\/]/).pop()!;
    const carpetaAccion = dirname(dirname(archivo)); // un nivel arriba de casos-de-uso/
    const archivosDeCarpeta = readdirSync(carpetaAccion).filter((n) => /\.tsx?$/.test(n));

    const fuentesWrapper: string[] = [];
    for (const nombreArchivo of archivosDeCarpeta) {
      const rutaHermano = join(carpetaAccion, nombreArchivo);
      if (statSync(rutaHermano).isDirectory()) continue;
      const fuenteHermano = sinComentarios(readFileSync(rutaHermano, "utf8"));
      if (new RegExp(`from\\s+["']\\./casos-de-uso/${basename}["']`).test(fuenteHermano)) fuentesWrapper.push(fuenteHermano);
    }
    if (!fuentesWrapper.length) continue; // helper interno (ej. armar-linea-de-movimiento.ts), no un caso de uso real.

    const nombresPropios = nombresDeFunciones(sinComentarios(readFileSync(archivo, "utf8")));
    resultado.push({ ruta: rutaRelativa(SRC, archivo), nombresPropios, fuentesWrapper });
  }

  return resultado;
}

/**
 * true si ALGUNO de los wrappers envuelve la llamada a alguno de `nombresPropios` con `aResultadoAccion` — patrón directo (ventana de
 * 60 caracteres después de `aResultadoAccion(`, cubre `await ` + el nombre) o mediado por variable (`const/let X = ...nombreCasoDeUso(`
 * seguido, más adelante en el mismo archivo, de `aResultadoAccion(X)` — con o sin `await`).
 */
function envueltoPorAResultadoAccion(fuentesWrapper: string[], nombresPropios: string[]): boolean {
  return fuentesWrapper.some((fuente) => {
    const directo = [...fuente.matchAll(/aResultadoAccion\(\s*(?:await\s+)?/g)].some((m) => {
      const recorte = fuente.slice(m.index! + m[0].length, m.index! + m[0].length + 60);
      return nombresPropios.some((n) => recorte.startsWith(`${n}(`));
    });
    if (directo) return true;

    return nombresPropios.some((n) => {
      const mVar = fuente.match(new RegExp(`\\b(?:const|let)\\s+(\\w+)[^;]*?\\b${n}\\(`));
      if (!mVar) return false;
      const variable = mVar[1];
      const desde = mVar.index! + mVar[0].length;
      return new RegExp(`aResultadoAccion\\(\\s*(?:await\\s+)?${variable}\\s*\\)`).test(fuente.slice(desde));
    });
  });
}

describe("arquitectura: la Server Action de cada caso de uso real envuelve su resultado con aResultadoAccion", () => {
  const casos = descubrirCasosDeUsoReales();

  it("encuentra casos de uso reales en src/ (si esto da 0, algo rompió el descubrimiento, no que ya no haya ninguno)", () => {
    expect(casos.length).toBeGreaterThan(0);
  });

  it("cada caso de uso real está envuelto con aResultadoAccion en su Server Action, o está en SIN_ENVOLTORIO_TODAVIA con motivo", () => {
    const sinEnvolverYSinExcepcion = casos.filter((c) => !envueltoPorAResultadoAccion(c.fuentesWrapper, c.nombresPropios) && !(c.ruta in SIN_ENVOLTORIO_TODAVIA));

    expect(
      sinEnvolverYSinExcepcion,
      `Caso(s) de uso cuya Server Action no envuelve el resultado con aResultadoAccion (¿devuelve el ResultadoCaso crudo, o lo arma a ` +
        `mano?) — agregá el envoltorio o sumalo a SIN_ENVOLTORIO_TODAVIA con motivo:\n` +
        sinEnvolverYSinExcepcion.map((c) => `  - ${c.ruta} (${c.nombresPropios.join(", ")})`).join("\n")
    ).toEqual([]);
  });

  it("SIN_ENVOLTORIO_TODAVIA no tiene entradas obsoletas (un caso que ya está envuelto, o que ya no existe)", () => {
    for (const ruta of Object.keys(SIN_ENVOLTORIO_TODAVIA)) {
      const caso = casos.find((c) => c.ruta === ruta);
      expect(caso, `${ruta} está en SIN_ENVOLTORIO_TODAVIA pero ya no se descubre como caso de uso real — sacala de la lista.`).toBeDefined();
      if (caso) {
        expect(
          envueltoPorAResultadoAccion(caso.fuentesWrapper, caso.nombresPropios),
          `${ruta} está en SIN_ENVOLTORIO_TODAVIA pero YA está envuelto con aResultadoAccion — sacala de la lista, el hueco ya se cerró.`
        ).toBe(false);
      }
    }
  });
});
