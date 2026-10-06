import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { descubrirCasosDeUsoReales } from "./guardas/casos-de-uso";

/**
 * Regla de arquitectura (Fase 0 del plan de pureza, PR 0.6): LA FICHA DE CADA CASO DE USO SE VERIFICA CONTRA EL CÓDIGO.
 *
 * Los 4 tags de contrato (`@contract/@idempotency/@transaction/@sideEffects`, `casos-de-uso-con-tags-de-contrato.test.ts`) son prosa: se leen, pero ningún test
 * los cruza con el código, así que podían mentir sin que nada fallara. La ficha es la versión MECÁNICA: una línea `@ficha` en el docstring de cada caso de uso, con
 * cinco campos de vocabulario cerrado, y este test comprueba que lo declarado es lo que el archivo hace:
 *
 *   @ficha permiso=<acción> transaccion=<SERIALIZABLE|SIMPLE|NINGUNA> idempotencia=<I3|POR_ESTADO|OPTIMISTA|NO_APLICA> auditoria=<REGISTRO_AUDITORIA|DOCUMENTO_PROPIO> reloj=<INYECTADO|NEW_DATE>
 *
 *  - `permiso`: la acción (de `ACCIONES`) con la que la Server Action que lo envuelve lo protege (`conPermiso*("clave", …)`), o `POR_PROCESO` si la elige en ejecución.
 *  - `transaccion`: `SERIALIZABLE` si llama a `conTransaccionSerializable`; `SIMPLE` si abre una transacción común; `NINGUNA` si no abre ninguna.
 *  - `idempotencia`: `I3` si y solo si llama a `chequearIdempotencia` (clave + hash del payload); `POR_ESTADO` (el estado del documento arbitra el reintento),
 *    `OPTIMISTA` (versión esperada) y `NO_APLICA` no pueden llamarla.
 *  - `auditoria`: `REGISTRO_AUDITORIA` si llama a `registrarCambioAuditado`; `DOCUMENTO_PROPIO` si no (el documento que escribe lleva su usuario y su fecha).
 *  - `reloj`: `INYECTADO` si el archivo no lee la hora actual (`new Date()` sin argumentos, `Date.now()`); `NEW_DATE` si la lee. Un caso de uso NUEVO tiene que ser
 *    `INYECTADO` (la hora entra por el comando: la necesitan el cierre de períodos y `fechaImputacion`); los 13 que hoy leen el reloj son deuda de la Fase 1, escrita abajo.
 *
 * Qué NO verifica: la prosa de los tags, ni qué modelos escribe (eso lo hace `escrituras-auditadas.test.ts` y `kardex-solo-agrega.test.ts`), ni que la idempotencia
 * funcione (la prueban los tests concurrentes de cada caso). Sí evita que la ficha diga una cosa y el código otra, y que un caso de uso nuevo nazca sin ficha.
 */
const VOCABULARIO = {
  transaccion: ["SERIALIZABLE", "SIMPLE", "NINGUNA"],
  idempotencia: ["I3", "POR_ESTADO", "OPTIMISTA", "NO_APLICA"],
  auditoria: ["REGISTRO_AUDITORIA", "DOCUMENTO_PROPIO"],
  reloj: ["INYECTADO", "NEW_DATE"],
} as const;
const CAMPOS = ["permiso", "transaccion", "idempotencia", "auditoria", "reloj"] as const;

/** Casos de uso que hoy leen la hora actual (`reloj=NEW_DATE`): deuda de la Fase 1 del plan (la hora entra por el comando). La lista solo puede achicarse. */
const RELOJ_PENDIENTE: Record<string, string> = Object.fromEntries(
  [
    "server/actions/movimientos/casos-de-uso/anular-compra.ts",
    "server/actions/movimientos/casos-de-uso/anular-venta.ts",
    "server/actions/movimientos/casos-de-uso/cancelar-conteo-fisico.ts",
    "server/actions/movimientos/casos-de-uso/resolver-conteo-pendiente.ts",
    "server/actions/pos/casos-de-uso/cerrar-cuenta.ts",
    "server/actions/pos/casos-de-uso/emitir-ticket-corregido.ts",
    "server/actions/traspasos/casos-de-uso/aceptar-traspaso.ts",
    "server/actions/traspasos/casos-de-uso/aprobar-y-enviar-traspaso.ts",
    "server/actions/traspasos/casos-de-uso/cancelar-solicitud-de-traspaso.ts",
    "server/actions/traspasos/casos-de-uso/confirmar-reingreso-de-traspaso.ts",
    "server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso.ts",
    "server/actions/traspasos/casos-de-uso/rechazar-envio-de-traspaso.ts",
    "server/actions/traspasos/casos-de-uso/rechazar-solicitud-de-traspaso.ts",
  ].map((ruta) => [ruta, "Fase 1: la hora actual entra por el comando (ahora: Date) en lugar de leerse acá."])
);

interface Observado {
  transaccion: string;
  llamaAChequearIdempotencia: boolean;
  auditoria: string;
  reloj: string;
}

/** Lo que el código del caso de uso HACE (AST, fuera de los comentarios). */
function observar(codigo: string): Observado {
  const fuente = ts.createSourceFile("caso.ts", codigo, ts.ScriptTarget.Latest, true);
  const llamadas = new Set<string>();
  let reloj = false;
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression)) llamadas.add(n.expression.text);
      if (ts.isPropertyAccessExpression(n.expression)) {
        llamadas.add(n.expression.name.text);
        if (ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "Date" && n.expression.name.text === "now") reloj = true;
      }
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date" && (n.arguments?.length ?? 0) === 0) reloj = true;
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return {
    transaccion: llamadas.has("conTransaccionSerializable") ? "SERIALIZABLE" : llamadas.has("transaccion") || llamadas.has("$transaction") ? "SIMPLE" : "NINGUNA",
    llamaAChequearIdempotencia: llamadas.has("chequearIdempotencia"),
    auditoria: llamadas.has("registrarCambioAuditado") ? "REGISTRO_AUDITORIA" : "DOCUMENTO_PROPIO",
    reloj: reloj ? "NEW_DATE" : "INYECTADO",
  };
}

/** Los permisos con los que la Server Action que envuelve al caso de uso lo protege (`conPermiso*("clave", …)` alrededor de la llamada); `POR_PROCESO` si ninguno es literal. */
function permisosObservados(fuenteDelCaso: string, envolventes: string[]): string {
  const funciones = [...fuenteDelCaso.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
  const permisos = new Set<string>();
  for (const codigo of envolventes) {
    const fuente = ts.createSourceFile("accion.ts", codigo, ts.ScriptTarget.Latest, true);
    const buscar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && funciones.includes(n.expression.text)) {
        for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
          if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && /^conPermiso/.test(p.expression.text) && p.arguments[0] && ts.isStringLiteralLike(p.arguments[0])) {
            permisos.add(p.arguments[0].text);
            break;
          }
        }
      }
      ts.forEachChild(n, buscar);
    };
    buscar(fuente);
  }
  return [...permisos].sort().join("|") || "POR_PROCESO";
}

/** La línea `@ficha` del docstring, como `{campo: valor}`; `null` si no hay (o hay más de una). */
function leerFicha(codigo: string): Record<string, string> | null {
  const lineas = [...codigo.matchAll(/^\s*\*\s*@ficha\s+(.+)$/gm)];
  if (lineas.length !== 1) return null;
  return Object.fromEntries(lineas[0][1].trim().split(/\s+/).map((par) => [par.split("=")[0], par.split("=").slice(1).join("=")]));
}

describe("ficha de caso de uso: el observador ve lo que el código hace (la regla no puede quedar ciega)", () => {
  it("transacción: SERIALIZABLE, SIMPLE o NINGUNA", () => {
    expect(observar("export async function f(ctx: any) { return conTransaccionSerializable(ctx, async () => 1); }").transaccion).toBe("SERIALIZABLE");
    expect(observar("export async function f(ctx: any) { return ctx.transaccion(async () => 1); }").transaccion).toBe("SIMPLE");
    expect(observar("export async function f() { return 1; }").transaccion).toBe("NINGUNA");
  });

  it("idempotencia I3 solo si llama a chequearIdempotencia; auditoría solo si llama a registrarCambioAuditado", () => {
    expect(observar("export async function f(tx: any) { await chequearIdempotencia(tx, 'k'); }").llamaAChequearIdempotencia).toBe(true);
    expect(observar("export async function f(tx: any) { await otraCosa(tx); }").llamaAChequearIdempotencia).toBe(false);
    expect(observar("export async function f(tx: any) { await registrarCambioAuditado(tx, {}); }").auditoria).toBe("REGISTRO_AUDITORIA");
    expect(observar("export async function f(tx: any) { await escribir(tx); }").auditoria).toBe("DOCUMENTO_PROPIO");
  });

  it("reloj: new Date() sin argumentos y Date.now() lo leen; new Date(x) y un texto que lo nombra no", () => {
    expect(observar("export const f = () => new Date();").reloj).toBe("NEW_DATE");
    expect(observar("export const f = () => Date.now();").reloj).toBe("NEW_DATE");
    expect(observar("export const f = (x: string) => new Date(x);").reloj).toBe("INYECTADO");
    expect(observar('// new Date()\nexport const f = "Date.now()";').reloj).toBe("INYECTADO");
  });

  it("permiso: el literal de conPermiso* que envuelve la llamada, o POR_PROCESO", () => {
    const caso = "export async function anular(ctx: any) { return 1; }";
    expect(permisosObservados(caso, ['export async function a() { return conPermiso("anular_compra", async (ctx) => anular(ctx)); }'])).toBe("anular_compra");
    expect(permisosObservados(caso, ['export async function a(x: string) { return conPermisoDeEmpresa<R>("x_y", async (ctx) => anular(ctx)); }'])).toBe("x_y");
    expect(permisosObservados(caso, ["export async function a(accion: string) { return conPermiso(accion, async (ctx) => anular(ctx)); }"])).toBe("POR_PROCESO");
  });

  it("leerFicha: una sola línea @ficha con sus pares; sin línea o con dos, null", () => {
    expect(leerFicha("/**\n * @ficha permiso=a_b transaccion=SERIALIZABLE idempotencia=I3 auditoria=DOCUMENTO_PROPIO reloj=INYECTADO\n */")).toEqual({
      permiso: "a_b",
      transaccion: "SERIALIZABLE",
      idempotencia: "I3",
      auditoria: "DOCUMENTO_PROPIO",
      reloj: "INYECTADO",
    });
    expect(leerFicha("/** sin ficha */")).toBeNull();
    expect(leerFicha("/**\n * @ficha permiso=a\n * @ficha permiso=b\n */")).toBeNull();
  });
});

describe("ficha de caso de uso: los casos de uso del repositorio", () => {
  const casos = descubrirCasosDeUsoReales();
  const acciones = new Set<string>(ACCIONES.map((a) => a.clave));

  it("encuentra los casos de uso reales (si dejan de encontrarse, la regla quedó vacía)", () => {
    expect(casos.length).toBeGreaterThanOrEqual(23);
  });

  it("todo caso de uso real tiene su ficha completa y de vocabulario cerrado", () => {
    const problemas: string[] = [];
    for (const c of casos) {
      const ficha = leerFicha(c.fuente);
      if (!ficha) {
        problemas.push(`${c.ruta}: falta la línea @ficha (o hay más de una)`);
        continue;
      }
      for (const campo of CAMPOS) if (!ficha[campo]) problemas.push(`${c.ruta}: la ficha no declara ${campo}`);
      for (const [campo, valores] of Object.entries(VOCABULARIO)) {
        if (ficha[campo] && !(valores as readonly string[]).includes(ficha[campo])) problemas.push(`${c.ruta}: ${campo}=${ficha[campo]} no es uno de ${valores.join(", ")}`);
      }
      if (ficha.permiso && ficha.permiso !== "POR_PROCESO") {
        for (const p of ficha.permiso.split("|")) if (!acciones.has(p)) problemas.push(`${c.ruta}: permiso=${p} no es una acción de ACCIONES`);
      }
    }
    expect(problemas, `Cada caso de uso lleva su línea @ficha (ver el docstring de este test):\n${problemas.join("\n")}`).toEqual([]);
  });

  it("lo que la ficha declara es lo que el código hace", () => {
    const mentiras: string[] = [];
    for (const c of casos) {
      const ficha = leerFicha(c.fuente);
      if (!ficha) continue;
      const visto = observar(c.fuente);
      if (ficha.transaccion !== visto.transaccion) mentiras.push(`${c.ruta}: la ficha dice transaccion=${ficha.transaccion} y el código hace ${visto.transaccion}`);
      if (ficha.auditoria !== visto.auditoria) mentiras.push(`${c.ruta}: la ficha dice auditoria=${ficha.auditoria} y el código hace ${visto.auditoria}`);
      if (ficha.reloj !== visto.reloj) mentiras.push(`${c.ruta}: la ficha dice reloj=${ficha.reloj} y el código hace ${visto.reloj}`);
      if ((ficha.idempotencia === "I3") !== visto.llamaAChequearIdempotencia) {
        mentiras.push(`${c.ruta}: la ficha dice idempotencia=${ficha.idempotencia} y ${visto.llamaAChequearIdempotencia ? "el código llama" : "el código NO llama"} a chequearIdempotencia`);
      }
      const permiso = permisosObservados(c.fuente, c.envolventes.map((e) => e.fuente));
      if (ficha.permiso !== permiso) mentiras.push(`${c.ruta}: la ficha dice permiso=${ficha.permiso} y la Server Action lo protege con ${permiso}`);
    }
    expect(mentiras, `La ficha miente (o el código cambió y la ficha no):\n${mentiras.join("\n")}`).toEqual([]);
  });

  it("un caso de uso nuevo nace con el reloj inyectado; los que hoy lo leen están en la lista de la Fase 1 y la lista solo se achica", () => {
    const leenElReloj = casos.filter((c) => leerFicha(c.fuente)?.reloj === "NEW_DATE").map((c) => c.ruta);
    expect(
      leenElReloj.filter((r) => !(r in RELOJ_PENDIENTE)),
      "Un caso de uso nuevo no lee la hora: recibe `ahora` por el comando (el cierre de períodos lo necesita)."
    ).toEqual([]);
    const sobrantes = Object.keys(RELOJ_PENDIENTE).filter((r) => !leenElReloj.includes(r));
    expect(sobrantes, `Ya no leen el reloj (o ya no existen): sacalos de RELOJ_PENDIENTE.\n${sobrantes.join("\n")}`).toEqual([]);
  });
});
