import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guardián de arquitectura (Hito 4, bloque 4.3, paso H4C-10 — D-9): DENTRO del callback de una transacción (`actor.transaccion(async (tx) => …)`,
 * `ctx.transaccion(…)`, `conTransaccionSerializable(…, async (tx) => …)`, `conGobierno(…)`, `$transaction(async (tx) => …)`), `registrarCambioAuditado` recibe
 * como cliente el PARÁMETRO del callback (`tx`), nunca otro (`actor.db`, `ctx.db`, `prisma`).
 *
 * Por qué: con otro cliente la fila de auditoría se escribe en OTRA conexión y se confirma sola, aunque esté escrita dentro del callback. Los tests de atomicidad
 * del repositorio (`precio-auditoria-atomica`, `dinero-de-carta-auditoria-atomica`, `catalogo-auditoria-atomica`, `insumo-auditado`) rompen la auditoría y miran
 * que el cambio no quede, pero NO pueden ver este caso cuando la auditoría es lo último del callback: si falla, el callback lanza y la transacción se deshace igual,
 * y el día que la transacción falle DESPUÉS (al confirmar) queda una fila de auditoría de un cambio que no existe. Nació de la mutación «auditar con `actor.db`
 * dentro del callback» del renombre de D-9, que ningún test veía. `prisma-global-sin-escrituras-en-transaccion.test.ts` cubre las escrituras directas con el
 * cliente global dentro de `conTransaccionSerializable`; esta regla cubre la auditoría, con cualquier transacción.
 *
 * Alcance: todo `src/server/` y `src/core/` (AST de TypeScript, fuera de los comentarios). Un paso compartido que recibe el cliente por parámetro
 * (`guardarPrecioLocalEnTx(tx, …)`) no es un callback de transacción: queda fuera y está bien (audita con el cliente que le pasan).
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src/server", "src/core"];
/** Las funciones que abren una transacción y reciben su cuerpo como callback (por nombre o por la última propiedad: `actor.transaccion(…)` → `transaccion`). */
const ABREN_TRANSACCION = new Set(["transaccion", "conTransaccionSerializable", "conGobierno", "$transaction", "transaccionDeEmpresa"]);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

const nombreDeLaLlamada = (llamada: ts.CallExpression): string | null =>
  ts.isIdentifier(llamada.expression) ? llamada.expression.text : ts.isPropertyAccessExpression(llamada.expression) ? llamada.expression.name.text : null;

/** Las llamadas a `registrarCambioAuditado` dentro del callback de una transacción cuyo primer argumento no es el parámetro del callback, como «línea: cliente». */
function auditoriasConOtroCliente(codigo: string, archivo = "x.ts"): string[] {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const malas: string[] = [];
  const revisarCuerpo = (cuerpo: ts.Node, parametro: string): void => {
    const visitar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && nombreDeLaLlamada(n) === "registrarCambioAuditado") {
        const cliente = n.arguments[0];
        if (!cliente || !ts.isIdentifier(cliente) || cliente.text !== parametro) {
          malas.push(`${fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1}: ${cliente ? cliente.getText(fuente) : "(sin cliente)"}`);
        }
      }
      ts.forEachChild(n, visitar);
    };
    visitar(cuerpo);
  };
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ABREN_TRANSACCION.has(nombreDeLaLlamada(n) ?? "")) {
      for (const arg of n.arguments) {
        if ((ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && arg.parameters[0] && ts.isIdentifier(arg.parameters[0].name)) {
          revisarCuerpo(arg.body, arg.parameters[0].name.text);
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return malas;
}

describe("auditoría con el cliente de la transacción", () => {
  it("el detector ve lo que tiene que ver (casos sintéticos)", () => {
    expect(auditoriasConOtroCliente("async function f(actor: any) { await actor.transaccion(async (tx: any) => { await registrarCambioAuditado(tx, {}); }); }")).toEqual([]);
    expect(auditoriasConOtroCliente("async function f(actor: any) { await actor.transaccion(async (tx: any) => { await registrarCambioAuditado(actor.db, {}); }); }")).toEqual(["1: actor.db"]);
    expect(auditoriasConOtroCliente("async function f(a: any) { await conTransaccionSerializable(a.transaccion, async (t: any) => { await registrarCambioAuditado(prisma, {}); }); }")).toEqual(["1: prisma"]);
    // Fuera de un callback de transacción no se exige nada (una auditoría suelta con la base del contexto es otra decisión, a la vista en su ficha).
    expect(auditoriasConOtroCliente("async function f(actor: any) { await registrarCambioAuditado(actor.db, {}); }")).toEqual([]);
    // Un paso compartido que recibe el cliente por parámetro audita con ese cliente: no es un callback.
    expect(auditoriasConOtroCliente("async function paso(tx: any) { await registrarCambioAuditado(tx, {}); }")).toEqual([]);
  });

  it("ningún callback de transacción de src/server ni src/core audita con otro cliente", () => {
    const problemas: string[] = [];
    let queAuditan = 0;
    for (const carpeta of CARPETAS) {
      for (const ruta of archivos(join(RAIZ, carpeta))) {
        const codigo = readFileSync(ruta, "utf8");
        if (!/registrarCambioAuditado/.test(codigo)) continue;
        queAuditan++;
        const rel = relative(RAIZ, ruta).split(sep).join("/");
        for (const m of auditoriasConOtroCliente(codigo, rel)) problemas.push(`${rel}:${m}`);
      }
    }
    expect(queAuditan, "sanidad: hay archivos que auditan").toBeGreaterThan(10);
    expect(problemas, `registrarCambioAuditado dentro del callback de una transacción tiene que recibir el cliente del callback (tx):\n${problemas.join("\n")}`).toEqual([]);
  });
});
