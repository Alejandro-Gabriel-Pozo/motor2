import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Las lecturas de `abrirCuentaCasoDeUso` corren SOBRE LA TRANSACCIÓN (Hito 4, bloque POS-B; M1/S-51). Antes este guardián se llamaba «el límite de mesas en la transacción» y fijaba que el
 * `cuenta.count` del límite de mesas abiertas usara el `tx`. El límite se retiró el 2026-10-29 (decisión del dueño, Task #13 §2): ya no hay conteo, pero la regla de fondo sigue valiendo y por
 * eso el guardián se CONSERVA, sin el `count`: en `abrir-cuenta.ts` la mesa (con su sucursal: `activo`, P15) y la cuenta abierta de la mesa (la idempotencia: «ya tenía una cuenta abierta») se leen
 * DENTRO de la transacción SERIALIZABLE que crea la cuenta, así Postgres registra esas lecturas como parte de la transacción y arbitra la carrera contra un apagado de la sucursal o una apertura
 * simultánea de la misma mesa. Si alguna usara la base del contexto (`actor.db`), la lectura quedaría FUERA de la transacción y esa garantía se perdería. Se fija de forma DETERMINISTA y estructural,
 * por AST: dentro del callback de `conTransaccionSerializable`, toda lectura sobre `cuenta`, `mesa` o `sucursal` (`count`, `findMany`, `findFirst`, …) usa el PARÁMETRO del callback (el `tx`), y hay
 * al menos una de `mesa` y una de `cuenta` (si desaparecen, la regla no puede quedar mirando el vacío).
 */
const RUTA = "src/server/actions/pos/casos-de-uso/abrir-cuenta.ts";
const LECTURAS = new Set(["count", "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "aggregate", "groupBy"]);

/** M1 (S-51): `cuenta` (la cuenta abierta de la mesa), `mesa` y `sucursal` (su estado `activo`) se leen sobre la transacción. */
const MODELOS = new Set(["cuenta", "mesa", "sucursal"]);

interface LecturaEnTransaccion {
  cliente: string;
  modelo: string;
  operacion: string;
}

/** Por cada callback de `conTransaccionSerializable(…, (tx) => …)`: el nombre de su parámetro y las lecturas sobre `cuenta` de su cuerpo, con el cliente usado. */
function lecturasDeCuentaEnLasTransacciones(codigo: string): { parametro: string; lecturas: LecturaEnTransaccion[] }[] {
  const fuente = ts.createSourceFile("caso.ts", codigo, ts.ScriptTarget.Latest, true);
  const transacciones: { parametro: string; lecturas: LecturaEnTransaccion[] }[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "conTransaccionSerializable") {
      const callback = n.arguments[1];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const [primero] = callback.parameters;
        const parametro = primero && ts.isIdentifier(primero.name) ? primero.name.text : "";
        const lecturas: LecturaEnTransaccion[] = [];
        const enElCuerpo = (m: ts.Node): void => {
          if (ts.isCallExpression(m) && ts.isPropertyAccessExpression(m.expression) && LECTURAS.has(m.expression.name.text)) {
            const delegado = m.expression.expression;
            if (ts.isPropertyAccessExpression(delegado) && MODELOS.has(delegado.name.text)) {
              lecturas.push({ cliente: delegado.expression.getText(fuente), modelo: delegado.name.text, operacion: m.expression.name.text });
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
    lecturas.filter((l) => l.cliente !== parametro).map((l) => `${l.cliente}.${l.modelo}.${l.operacion} (el callback recibe «${parametro}»)`),
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

describe(`${RUTA}: las lecturas van sobre la transacción`, () => {
  const codigo = readFileSync(join(__dirname, "../..", RUTA), "utf8");
  const transacciones = lecturasDeCuentaEnLasTransacciones(codigo);

  it("encuentra la transacción serializable y, dentro, una lectura de `mesa` y una de `cuenta` (si no, la regla mira el vacío)", () => {
    expect(transacciones.length).toBeGreaterThanOrEqual(1);
    const modelos = new Set(transacciones.flatMap((t) => t.lecturas).map((l) => l.modelo));
    expect(modelos.has("mesa")).toBe(true);
    expect(modelos.has("cuenta")).toBe(true);
  });

  it("toda lectura sobre `cuenta`, `mesa` o `sucursal` dentro del callback usa el parámetro del callback, nunca `actor.db` ni otra base", () => {
    expect(
      lecturasFueraDeLaTransaccion(codigo),
      "Una lectura de Cuenta dentro de la transacción serializable usa otro cliente: Postgres no la registra como lectura de la transacción y la idempotencia de reabrir una mesa o el chequeo de sucursal activa podrían leer un valor viejo. Usá el `tx` del callback.",
    ).toEqual([]);
  });
});
