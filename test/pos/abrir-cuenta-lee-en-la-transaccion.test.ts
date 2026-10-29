import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarSalon } from "./salon-fixture";
import { abrirCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/abrir-cuenta";

/**
 * M1 (S-51 de `docs/pureza-integracion.md`; hallazgo de la auditoría de acciones): la mesa (con su sucursal) se leía con `actor.db`, FUERA de la transacción SERIALIZABLE que mira la cuenta
 * abierta y crea la nueva. Ahora la mesa y su sucursal se leen con el `tx` de la transacción. El reproductor es determinista: un `actor.db` que EXPLOTA ante cualquier uso (toda lectura de afuera
 * de la transacción). (Antes este archivo también probaba el límite de mesas abiertas, retirado el 2026-10-29 por decisión del dueño.)
 */
describe("abrirCuentaCasoDeUso: la mesa se lee dentro de la transacción (M1)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  const dbProhibida = new Proxy({}, { get: (_t, p) => { throw new Error(`lectura FUERA de la transacción: actor.db.${String(p)}`); } }) as never;
  // El actor lleva el alcance que tiene en producción: SOLO su sucursal activa (ADR-028).
  const actor = () => {
    const { transaccion, alcance } = baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] });
    return { usuarioId: s.admin.id, sucursalId: s.sucursalId, db: dbProhibida, transaccion, alcance };
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
  });

  it("abre la cuenta sin tocar `actor.db` (todo se lee con el tx): antes explotaba al leer la mesa afuera", async () => {
    const r = await abrirCuentaCasoDeUso(actor(), { mesaId: s.mesa.id, comensales: 2 });
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    expect(await prisma.cuenta.count({ where: { mesaId: s.mesa.id, cerradaEn: null } })).toBe(1);
  });

  it("una mesa que no existe o es de otra sucursal sigue siendo MESA_NO_ENCONTRADA", async () => {
    const r = await abrirCuentaCasoDeUso(actor(), { mesaId: "no-existe", comensales: 2 });
    expect(r).toMatchObject({ ok: false, codigo: "MESA_NO_ENCONTRADA" });
  });
});
