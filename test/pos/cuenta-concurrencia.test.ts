import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { abrirCuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta, emitirBoletaCorregida } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta } from "../../src/server/actions/movimientos/venta";

/**
 * Carreras del salón (docs/plan-tomar-pedido-2026-09-25.md paso 6; molde test/auditoria/concurrencia-*): dos mozos o un doble clic
 * sobre la misma cuenta. La transacción SERIALIZABLE de cada acción es la que arbitra — estos casos confirman que ninguna carrera
 * deja un estado imposible (dos ventas de la misma cuenta, un ítem sin enviar en una cuenta cerrada, anulaciones por encima de lo
 * pedido, dos números de envío para los mismos ítems).
 */
describe("POS: concurrencia sobre una misma cuenta", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  it("dos cierres a la vez: un solo juego de ventas; el otro ve la cuenta ya cerrada", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    const resultados = await Promise.all([cerrarCuenta(cuenta.id), cerrarCuenta(cuenta.id)]);
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados.filter((r) => r.mensaje === "La cuenta de la mesa 4 ya estaba cerrada.")).toHaveLength(1);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(2);
    expect(await prisma.movimientoStock.count({ where: { proceso: "VENTA" } })).toBe(2);
    // Una sola boleta numerada: el cierre que perdió la carrera no emite otro ejemplar.
    expect(await prisma.ejemplarBoleta.findMany({ select: { cuentaId: true, numero: true, ejemplar: true } })).toEqual([{ cuentaId: cuenta.id, numero: 1, ejemplar: 1 }]);
  });

  it("dos «Emitir boleta corregida» a la vez: un solo ejemplar B; el otro ve que ya refleja las anulaciones (docs/plan-numeracion-boleta-2026-09-25.md)", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const flan = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id, productoId: s.flan.id } });
    expect((await anularVenta(flan.operacionId!)).ok).toBe(true);

    const resultados = await Promise.all([emitirBoletaCorregida(cuenta.id, "Cajero A"), emitirBoletaCorregida(cuenta.id, "Cajero B")]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok).map((r) => r.mensaje)).toEqual(["La boleta N.º 1-B ya refleja las anulaciones."]);
    expect((await prisma.ejemplarBoleta.findMany({ where: { cuentaId: cuenta.id }, orderBy: { ejemplar: "asc" } })).map((e) => e.ejemplar)).toEqual([1, 2]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Cuenta" } })).toBe(1);
  });

  for (const cuantas of [2, 3]) {
    it(`${cuantas} cierres de mesas distintas de la misma sucursal a la vez: números 1..${cuantas}, sin repetir ni saltear (docs/plan-numeracion-boleta-2026-09-25.md)`, async () => {
      const cuentas = [];
      for (let i = 0; i < cuantas; i++) {
        const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 200 + i } });
        cuentas.push(await sembrarCuenta(mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]));
      }
      const resultados = await Promise.all(cuentas.map((c) => cerrarCuenta(c.id)));
      expect(resultados.map((r) => r.ok), resultados.map((r) => r.mensaje).join(" / ")).toEqual(cuentas.map(() => true));

      const ejemplares = await prisma.ejemplarBoleta.findMany({ where: { sucursalId: s.sucursalId } });
      expect(ejemplares.map((e) => e.numero).sort((a, b) => a - b)).toEqual(Array.from({ length: cuantas }, (_, i) => i + 1));
      expect(ejemplares.every((e) => e.ejemplar === 1)).toBe(true);
      expect(new Set(ejemplares.map((e) => e.cuentaId))).toEqual(new Set(cuentas.map((c) => c.id)));
    });
  }

  it("agregarItems contra cerrarCuenta: nunca queda un ítem sin enviar en una cuenta cerrada", async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 100 + vuelta } });
      const cuenta = await sembrarCuenta(mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
      const [agregado, cierre] = await Promise.all([agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }]), cerrarCuenta(cuenta.id)]);

      const final = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id }, include: { items: true } });
      const sinEnviar = final.items.filter((i) => i.numeroEnvio === null);
      if (final.cerradaEn) expect(sinEnviar, `vuelta ${vuelta}: cerrada con ítems sin enviar`).toEqual([]);
      // Exactamente uno de los dos "ganó": o se agregó y el cierre se bloqueó, o se cerró y el agregado se rechazó.
      expect([agregado.ok, cierre.ok], `vuelta ${vuelta}: ${agregado.mensaje} / ${cierre.mensaje}`).not.toEqual([true, true]);
    }
  });

  it("dos anulaciones que juntas exceden lo que queda: una sola pasa", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.milanesa.id, cantidad: 3, precioUnitario: 9000, numeroEnvio: 1 }]);
    const item = cuenta.items[0];
    const resultados = await Promise.all([anularItemEnviado(item.id, 2, "Mozo A", 3), anularItemEnviado(item.id, 2, "Mozo B", 3)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    const espejos = await prisma.cuentaItem.findMany({ where: { anulaAItemId: item.id } });
    expect(espejos.map((e) => Number(e.cantidad))).toEqual([-2]);
    expect(await prisma.registroAuditoria.count()).toBe(1);
  });

  it("límite de mesas abiertas: con N-1 ya abiertas, dos aperturas simultáneas a mesas DISTINTAS → exactamente una tiene éxito (docs/plan-comensales-y-limite-mesas-2026-09-26.md)", async () => {
    await prisma.sucursal.update({ where: { id: s.sucursalId }, data: { maxMesasAbiertas: 2 } });
    // Ya hay 1 mesa abierta (s.mesa): con el límite en 2, queda lugar para exactamente UNA más entre las dos que compiten.
    await abrirCuenta(s.mesa.id, 2);
    const [mesaA, mesaB] = await Promise.all([
      prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 700 } }),
      prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 701 } }),
    ]);
    const resultados = await Promise.all([abrirCuenta(mesaA.id, 2), abrirCuenta(mesaB.id, 2)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)[0].mensaje).toBe('Se alcanzó el máximo de 2 mesas abiertas en «Central». Cerrá o liberá una antes de abrir otra.');
    expect(await prisma.cuenta.count({ where: { cerradaEn: null } })).toBe(2); // la de antes + la única que ganó la carrera
  });

  it("dos «Enviar a cocina» a la vez: un solo número de envío", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 },
    ]);
    const ids = cuenta.items.map((i) => i.id);
    const resultados = await Promise.all([enviarACocina(cuenta.id, ids), enviarACocina(cuenta.id, ids)]);
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados.filter((r) => r.mensaje === "Esos ítems ya estaban enviados.")).toHaveLength(1);
    // Solo una de las dos llamadas creó el envío (la que imprime la comanda); las dos informan el mismo número.
    expect(resultados.map((r) => (r.ok ? [r.numeroEnvio, r.envioNuevo] : null)).sort()).toEqual([[1, false], [1, true]]);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect(new Set(items.map((i) => i.numeroEnvio))).toEqual(new Set([1]));
  });
});
