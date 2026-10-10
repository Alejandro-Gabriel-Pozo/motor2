import { afterAll, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, prismaAdmin } from "../setup/test-db"; // primero: carga el .env antes de que `src/lib/db` lea DATABASE_URL
import { baseDeEmpresa, type BaseDelContexto } from "../../src/core/auth/base";

/**
 * M.3-A8: `baseDeTest` es la base explícita (`db` + `transaccion`) que los tests le pasan al negocio. Sigue siendo un OBJETO (`baseDeTest.db`, `...baseDeTest`: los ~30 archivos que ya la usan no
 * cambian) y además se puede LLAMAR: `baseDeTest(alcance?)` fija el alcance por sucursal igual que `baseDeEmpresa(EMPRESA_DE_PRUEBA_ID, alcance)` (M.3-A2). Sin alcance = el comportamiento de siempre.
 */
afterAll(() => prismaAdmin.$disconnect());

type Contexto = { empresa: string | null; lectura: string | null; escritura: string | null };
const CONSULTA = (cliente: Pick<BaseDelContexto["db"], "$queryRaw">) =>
  cliente.$queryRaw<Contexto[]>`SELECT current_setting('app.empresa_id', true) AS empresa, current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`;

/** El contexto que ve una consulta suelta (`db`) y una transacción (`transaccion`) de la base: tienen que coincidir. */
async function contextoDe(base: Pick<BaseDelContexto, "db" | "transaccion">) {
  const [suelta] = await CONSULTA(base.db);
  const [enTransaccion] = await base.transaccion(async (tx) => await CONSULTA(tx));
  expect(enTransaccion, "db y transaccion fijan lo mismo").toEqual(suelta);
  return suelta;
}

describe("baseDeTest — los usos de siempre no cambian", () => {
  it("como objeto: `.db`, `.transaccion` y el spread `...baseDeTest` siguen funcionando, en la empresa de prueba y SIN alcance por sucursal", async () => {
    const copia = { ...baseDeTest };
    expect(Object.keys(copia).sort()).toEqual(["db", "transaccion"]);
    expect(copia.db).toBe(baseDeTest.db);
    expect(baseDeTest.alcance).toBeUndefined();
    expect(await contextoDe(baseDeTest)).toEqual({ empresa: EMPRESA_POR_DEFECTO_ID, lectura: "", escritura: "" });
    expect(typeof baseDeTest.transaccion).toBe("function");
  });

  it("llamada sin argumentos da lo mismo que el objeto (sin alcance)", async () => {
    const base = baseDeTest();
    expect(base.alcance).toBeUndefined();
    expect(await contextoDe(base)).toEqual(await contextoDe(baseDeTest));
  });
});

describe("baseDeTest(alcance) — fija el alcance por sucursal como baseDeEmpresa(empresa, alcance)", () => {
  const alcance = { lectura: ["sucursal_a", "sucursal_b"], escritura: ["sucursal_a"] };

  it("la consulta suelta y la transacción ven la empresa de prueba y las dos listas; `.alcance` es el que se pidió", async () => {
    const base = baseDeTest(alcance);
    expect(await contextoDe(base)).toEqual({ empresa: EMPRESA_POR_DEFECTO_ID, lectura: "sucursal_a,sucursal_b", escritura: "sucursal_a" });
    expect(base.alcance).toEqual(alcance);
  });

  it("es lo mismo que armar la base a mano con baseDeEmpresa", async () => {
    expect(await contextoDe(baseDeTest(alcance))).toEqual(await contextoDe(baseDeEmpresa(EMPRESA_POR_DEFECTO_ID, alcance)));
  });

  it("dos bases con alcances distintos, en simultáneo, no se mezclan entre sí ni con la base sin alcance", async () => {
    const a = baseDeTest({ lectura: ["a"], escritura: ["a"] });
    const b = baseDeTest({ lectura: ["b"], escritura: [] });
    const [ca, cb, c0] = await Promise.all([contextoDe(a), contextoDe(b), contextoDe(baseDeTest)]);
    expect(ca).toMatchObject({ lectura: "a", escritura: "a" });
    expect(cb).toMatchObject({ lectura: "b", escritura: "" });
    expect(c0).toMatchObject({ lectura: "", escritura: "" });
  });

  it("un id mal formado o repetido falla al armar la base, no en la primera consulta", () => {
    expect(() => baseDeTest({ lectura: ["a,b"], escritura: [] })).toThrow(/forma de un id de sucursal/);
    expect(() => baseDeTest({ lectura: [], escritura: ["a", "a"] })).toThrow(/repetido/);
  });
});
