import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * El conteo de cuentas abiertas que aplica el límite de mesas (`Sucursal.maxMesasAbiertas`) corre SOBRE LA TRANSACCIÓN (Hito 4, bloque POS-B; hueco de red que
 * informó el bloque POS-A en el paso 8).
 *
 * En `abrir-cuenta.ts` el límite se cuenta DENTRO de la transacción SERIALIZABLE que crea la cuenta: así Postgres registra esa lectura como parte de la
 * transacción y dos aperturas a mesas distintas que juntas superarían el límite no pasan las dos (una aborta y, al reintentar, ve la otra). Si el `count` usara
 * la base del contexto (`actor.db`), la lectura quedaría FUERA de la transacción y esa garantía se perdería. La carrera de `test/pos/cuenta-concurrencia.test.ts`
 * NO lo distingue (POS-A, paso 8: con `actor.db` sigue verde, porque otra lectura de la misma transacción —la de `yaAbierta`— provoca el mismo aborto), así que
 * se fija acá de forma DETERMINISTA y estructural, por AST: dentro del callback de `conTransaccionSerializable`, toda lectura sobre `cuenta`
 * (`count`, `findMany`, `findFirst`, …) usa el PARÁMETRO del callback (el `tx`), y hay al menos un `cuenta.count` (el del límite: si desaparece, la regla no
 * puede quedar mirando el vacío).
 */
const RUTA = "src/server/actions/pos/casos-de-uso/abrir-cuenta.ts";
const LECTURAS = new Set(["count", "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "aggregate", "groupBy"]);

interface LecturaDeCuenta {
  cliente: string;
  operacion: string;
}

/** Por cada callback de `conTransaccionSerializable(…, (tx) => …)`: el nombre de su parámetro y las lecturas sobre `cuenta` de su cuerpo, con el cliente usado. */
function lecturasDeCuentaEnLasTransacciones(codigo: string): { parametro: string; lecturas: LecturaDeCuenta[] }[] {
  const fuente = ts.createSourceFile("caso.ts", codigo, ts.ScriptTarget.Latest, true);
  const transacciones: { parametro: string; lecturas: LecturaDeCuenta[] }[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "conTransaccionSerializable") {
      const callback = n.arguments[1];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const [primero] = callback.parameters;
        const parametro = primero && ts.isIdentifier(primero.name) ? primero.name.text : "";
        const lecturas: LecturaDeCuenta[] = [];
        const enElCuerpo = (m: ts.Node): void => {
          if (ts.isCallExpression(m) && ts.isPropertyAccessExpression(m.expression) && LECTURAS.has(m.expression.name.text)) {
            const delegado = m.expression.expression;
            if (ts.isPropertyAccessExpression(delegado) && delegado.name.text === "cuenta") {
              lecturas.push({ cliente: delegado.expression.getText(fuente), operacion: m.expression.name.text });
            }
          }
          ts.forEachChild(m, enElCuerpo);
        };
        enElCuerpo(callback.body);
        transacciones.push({ parametro, lecturas });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return transacciones;
}

/** Las lecturas sobre `cuenta` dentro de una transacción que NO usan el parámetro del callback (`actor.db.cuenta.count`, `prisma.cuenta.findMany`, …). */
function lecturasFueraDeLaTransaccion(codigo: string): string[] {
  return lecturasDeCuentaEnLasTransacciones(codigo).flatMap(({ parametro, lecturas }) =>
    lecturas.filter((l) => l.cliente !== parametro).map((l) => `${l.cliente}.cuenta.${l.operacion} (el callback recibe «${parametro}»)`),
  );
}

describe("el detector (fuentes sintéticas)", () => {
  const conCliente = (cliente: string) => `export async function f(actor: any) {
    return conTransaccionSerializable(actor.transaccion, async (tx) => {
      const ya = await tx.cuenta.findFirst({ where: {} });
      const abiertas = await ${cliente}.cuenta.count({ where: {} });
      return [ya, abiertas];
    });
  }`;

  it("`actor.db.cuenta.count` dentro del callback → infractor", () => {
    expect(lecturasFueraDeLaTransaccion(conCliente("actor.db"))).toEqual(["actor.db.cuenta.count (el callback recibe «tx»)"]);
  });

  it("`tx.cuenta.count` dentro del callback → limpio", () => {
    expect(lecturasFueraDeLaTransaccion(conCliente("tx"))).toEqual([]);
  });

  it("también ve `findMany` y otros clientes (`prisma`, `db`); una lectura FUERA del callback no cuenta", () => {
    const codigo = `export async function f(actor: any) {
      await actor.db.cuenta.count({});
      return conTransaccionSerializable(actor.transaccion, async (t) => {
        await prisma.cuenta.findMany({});
        await db.cuenta.count({});
        await t.cuenta.count({});
      });
    }`;
    expect(lecturasFueraDeLaTransaccion(codigo)).toEqual(["prisma.cuenta.findMany (el callback recibe «t»)", "db.cuenta.count (el callback recibe «t»)"]);
  });
});

describe(`${RUTA}: el límite de mesas se cuenta sobre la transacción`, () => {
  const codigo = readFileSync(join(__dirname, "../..", RUTA), "utf8");
  const transacciones = lecturasDeCuentaEnLasTransacciones(codigo);

  it("encuentra la transacción serializable y, dentro, el `cuenta.count` del límite (si no, la regla mira el vacío)", () => {
    expect(transacciones.length).toBeGreaterThanOrEqual(1);
    expect(transacciones.flatMap((t) => t.lecturas).some((l) => l.operacion === "count")).toBe(true);
  });

  it("toda lectura sobre `cuenta` dentro del callback usa el parámetro del callback, nunca `actor.db` ni otra base", () => {
    expect(
      lecturasFueraDeLaTransaccion(codigo),
      "Una lectura de Cuenta dentro de la transacción serializable usa otro cliente: Postgres no la registra como lectura de la transacción y dos aperturas simultáneas podrían pasar las dos el límite de mesas. Usá el `tx` del callback.",
    ).toEqual([]);
  });
});
