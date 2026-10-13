import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { cerrarConexiones, conexionComoApp, pidDe } from "../setup/gasto";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { agregarVersionDeOpcionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/agregar-version-de-opcion";

/**
 * GO-2a, paso 7: CONCURRENCIA REAL de las versiones de una opción (Postgres real, como `motor2_app`). La versión nueva es la vigente + 1 y el único `(opcionId, numero)` arbitra:
 *  - 2 y 3 versiones a la vez con el MISMO número esperado: exactamente UNA fila N+1; las demás `VERSION_DESACTUALIZADA` (en loop, con la guarda contra el falso verde);
 *  - con un cliente `pg` como `motor2_app` que deja ABIERTA la inserción de la N+1: el caso de uso queda esperando el bloqueo del índice único; cuando el otro confirma, recibe el
 *    23505 o el 40001, reintenta y su relectura rechaza; si el otro deshace, el caso de uso gana;
 *  - el mismo pedido repetido: idempotente, sin fila nueva ni auditoría.
 */
const ITERACIONES = 10;
type Resultado = Awaited<ReturnType<typeof agregarVersionDeOpcionCasoDeUso>>;

/** Espera (hasta 10 s) a que alguna sesión distinta de `pidPropio` quede esperando un bloqueo: la del caso de uso, detrás de la inserción abierta. */
async function esperarQueAlguienEspere(pidPropio: number) {
  for (let i = 0; i < 200; i++) {
    const r = await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND pid <> ${pidPropio}`;
    if (Number(r[0]!.n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("el caso de uso nunca quedó esperando el bloqueo del índice único");
}

describe("versiones de una opción — concurrencia real (GO-2a)", () => {
  let e: EscenarioDeOpciones;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const MONTO = (monto: number) => ({ tipo: "MONTO" as const, monto });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
  });

  afterEach(async () => {
    await cerrarConexiones();
  });

  it.each([2, 3])("%i versiones a la vez con el mismo número esperado: UNA sola fila nueva y las demás VERSION_DESACTUALIZADA", async (cuantas) => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const numero = i + 1;
      const resultados = await Promise.allSettled(
        Array.from({ length: cuantas }, (_, k) => agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: e.almendrasId, numeroEsperado: numero, version: { diferencia: MONTO(200 + 10 * i + k), factorEscala: null, consumos: [] } }))
      );
      expect(resultados.every((s) => s.status === "fulfilled"), `iteración ${i}: una promesa rechazó`).toBe(true);
      const valores = resultados.map((s) => (s as PromiseFulfilledResult<Resultado>).value);
      expect(valores.filter((v) => v.ok), `iteración ${i}: ${valores.map((v) => v.mensaje).join(" | ")}`).toHaveLength(1);
      expect(valores.filter((v) => !v.ok).map((v) => (v.ok ? "" : v.codigo))).toEqual(Array(cuantas - 1).fill("VERSION_DESACTUALIZADA"));
      const versiones = await prisma.versionDeOpcion.findMany({ where: { opcionId: e.almendrasId }, orderBy: { numero: "asc" }, select: { id: true, numero: true } });
      expect(versiones.map((v) => v.numero), `iteración ${i}`).toEqual(Array.from({ length: numero + 1 }, (_, k) => k + 1));
      // Una sola fila de auditoría de `numero` por versión nueva: la del ganador.
      expect(await prisma.registroAuditoria.count({ where: { entidad: "VersionDeOpcion", campo: "numero" } })).toBe(numero);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron: el test no ejercitó el único ni el reintento").toBeGreaterThan(cuantas * ITERACIONES);
    intentos.mockRestore();
  });

  it("un cliente `pg` como motor2_app deja ABIERTA la inserción de la versión 2: el caso de uso espera el bloqueo, y al confirmarse la otra recibe el choque, reintenta y rechaza", async () => {
    const otro = await conexionComoApp();
    await otro.query("BEGIN");
    await otro.query(`INSERT INTO "VersionDeOpcion" ("id", "opcionId", "numero", "tipoDeDiferencia", "diferenciaPrecio", "creadoPorId") VALUES ($1, $2, 2, 'MONTO', 999.00, $3)`, [randomUUID(), e.almendrasId, e.usuarioId]);
    const enCurso = agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: e.almendrasId, numeroEsperado: 1, version: { diferencia: MONTO(175), factorEscala: null, consumos: [] } });
    await esperarQueAlguienEspere(await pidDe(otro));
    await otro.query("COMMIT");
    const r = await enCurso;
    expect(r).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    const versiones = await prisma.versionDeOpcion.findMany({ where: { opcionId: e.almendrasId }, orderBy: { numero: "asc" } });
    expect(versiones.map((v) => [v.numero, Number(v.diferenciaPrecio)])).toEqual([
      [1, 150],
      [2, 999],
    ]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "VersionDeOpcion" } })).toBe(0);
  });

  it("si la otra inserción se DESHACE, el caso de uso que la esperaba gana con la versión 2", async () => {
    const otro = await conexionComoApp();
    await otro.query("BEGIN");
    await otro.query(`INSERT INTO "VersionDeOpcion" ("id", "opcionId", "numero", "tipoDeDiferencia", "diferenciaPrecio", "creadoPorId") VALUES ($1, $2, 2, 'MONTO', 999.00, $3)`, [randomUUID(), e.almendrasId, e.usuarioId]);
    const enCurso = agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: e.almendrasId, numeroEsperado: 1, version: { diferencia: MONTO(175), factorEscala: null, consumos: [] } });
    await esperarQueAlguienEspere(await pidDe(otro));
    await otro.query("ROLLBACK");
    expect(await enCurso).toMatchObject({ ok: true, datos: { numero: 2, yaExistia: false } });
    const v2 = await prisma.versionDeOpcion.findFirstOrThrow({ where: { opcionId: e.almendrasId, numero: 2 } });
    expect(Number(v2.diferenciaPrecio)).toBe(175);
  });

  it("el mismo pedido dos veces seguidas (y dos veces a la vez): una sola versión nueva y una sola auditoría", async () => {
    const comando = { opcionId: e.vacaId, numeroEsperado: 1, version: { diferencia: MONTO(10), factorEscala: null, consumos: [] } };
    const [a, b] = await Promise.all([agregarVersionDeOpcionCasoDeUso(actor(), comando), agregarVersionDeOpcionCasoDeUso(actor(), comando)]);
    const c = await agregarVersionDeOpcionCasoDeUso(actor(), comando);
    expect([a, b, c].every((r) => r.ok)).toBe(true);
    expect([a, b, c].filter((r) => r.ok && r.datos.yaExistia)).toHaveLength(2);
    expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.vacaId } })).toBe(2);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "VersionDeOpcion", campo: "numero" } })).toBe(1);
  });
});
