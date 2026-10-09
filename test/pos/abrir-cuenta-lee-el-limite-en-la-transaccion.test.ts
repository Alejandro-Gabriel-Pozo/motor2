import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarSalon, sembrarCuenta } from "./salon-fixture";
import { abrirCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/abrir-cuenta";

/**
 * M1 (S-51 de `docs/pureza-integracion.md`; hallazgo de la auditoría de acciones): el límite de mesas abiertas (`Sucursal.maxMesasAbiertas`) se leía con `actor.db`, FUERA de la transacción
 * SERIALIZABLE que cuenta las cuentas abiertas y crea la nueva: si el límite se bajaba entre esa lectura y la apertura, se comparaba contra un valor viejo y la mesa se abría de más.
 * Ahora la mesa y el límite se leen con el `tx` de la transacción. El reproductor es determinista: un `actor.db` que EXPLOTA ante cualquier uso (toda lectura de afuera de la transacción).
 */
describe("abrirCuentaCasoDeUso: la mesa y el límite se leen dentro de la transacción (M1)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  const dbProhibida = new Proxy({}, { get: (_t, p) => { throw new Error(`lectura FUERA de la transacción: actor.db.${String(p)}`); } }) as never;
  const actor = () => ({ usuarioId: s.admin.id, sucursalId: s.sucursalId, db: dbProhibida, transaccion: baseDeTest.transaccion });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
  });

  it("abre la cuenta sin tocar `actor.db` (todo se lee con el tx): antes explotaba al leer la mesa afuera", async () => {
    const r = await abrirCuentaCasoDeUso(actor(), { mesaId: s.mesa.id, comensales: 2 });
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    expect(await prisma.cuenta.count({ where: { mesaId: s.mesa.id, cerradaEn: null } })).toBe(1);
  });

  it("el límite de la sucursal se aplica con el valor de la transacción: con límite 1 y una cuenta abierta, la segunda mesa se rechaza (LIMITE_DE_MESAS) y no se abre", async () => {
    await prisma.sucursal.update({ where: { id: s.sucursalId }, data: { maxMesasAbiertas: 1 } });
    const otraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 9 } });
    await sembrarCuenta(otraMesa.id, s.admin.id);

    const r = await abrirCuentaCasoDeUso(actor(), { mesaId: s.mesa.id, comensales: 2 });

    expect(r).toMatchObject({ ok: false, codigo: "LIMITE_DE_MESAS" });
    expect(await prisma.cuenta.count({ where: { mesaId: s.mesa.id } })).toBe(0);
  });

  it("una mesa que no existe o es de otra sucursal sigue siendo MESA_NO_ENCONTRADA", async () => {
    const r = await abrirCuentaCasoDeUso(actor(), { mesaId: "no-existe", comensales: 2 });
    expect(r).toMatchObject({ ok: false, codigo: "MESA_NO_ENCONTRADA" });
  });
});
