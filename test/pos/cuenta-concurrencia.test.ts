import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { abrirCuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { crearMesa } from "../../src/server/actions/pos/mesas";
import { agregarItems, enviarACocina, quitarItemSinEnviar } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta, emitirTicketCorregido } from "../../src/server/actions/pos/cuenta-cierre";
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
    // Un solo ticket numerado: el cierre que perdió la carrera no emite otro ejemplar.
    expect(await prisma.ejemplarTicket.findMany({ select: { cuentaId: true, numero: true, ejemplar: true } })).toEqual([{ cuentaId: cuenta.id, numero: 1, ejemplar: 1 }]);
  });

  it("dos «Emitir ticket corregido» a la vez: un solo ejemplar B; el otro ve que ya refleja las anulaciones (docs/plan-numeracion-ticket-2026-09-25.md)", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const flan = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id, productoId: s.flan.id } });
    expect((await anularVenta(flan.operacionId!)).ok).toBe(true);

    const resultados = await Promise.all([emitirTicketCorregido(cuenta.id, "Cajero A"), emitirTicketCorregido(cuenta.id, "Cajero B")]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok).map((r) => r.mensaje)).toEqual(["El ticket N.º 1-B ya refleja las anulaciones."]);
    expect((await prisma.ejemplarTicket.findMany({ where: { cuentaId: cuenta.id }, orderBy: { ejemplar: "asc" } })).map((e) => e.ejemplar)).toEqual([1, 2]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Cuenta" } })).toBe(1);
  });

  for (const cuantas of [2, 3]) {
    it(`${cuantas} cierres de mesas distintas de la misma sucursal a la vez: números 1..${cuantas}, sin repetir ni saltear (docs/plan-numeracion-ticket-2026-09-25.md)`, async () => {
      const cuentas = [];
      for (let i = 0; i < cuantas; i++) {
        const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 200 + i } });
        cuentas.push(await sembrarCuenta(mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]));
      }
      const resultados = await Promise.all(cuentas.map((c) => cerrarCuenta(c.id)));
      expect(resultados.map((r) => r.ok), resultados.map((r) => r.mensaje).join(" / ")).toEqual(cuentas.map(() => true));

      const ejemplares = await prisma.ejemplarTicket.findMany({ where: { sucursalId: s.sucursalId } });
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

  // ── Hito 4, paso 0.4 (`docs/plan-hito-4-pureza.md` §5): las carreras que faltaban, escritas contra el código ANTERIOR a mudar el POS a casos de uso. ──────────

  // Medido al escribirlo (3 corridas × 3 vueltas): la carrera la arbitra la transacción SERIALIZABLE (la que pierde reintenta y ve `yaAbierta`); el `catch` del
  // choque del índice único parcial no se alcanzó nunca (respondiendo error ahí, el test sigue verde). Es el respaldo, no el árbitro.
  it("(a) dos «Abrir cuenta» a la vez sobre la MISMA mesa: las dos responden ok y queda una sola cuenta abierta", async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 300 + vuelta } });
      const resultados = await Promise.all([abrirCuenta(mesa.id, 2), abrirCuenta(mesa.id, 3)]);
      expect(resultados.map((r) => r.ok), `vuelta ${vuelta}: ${resultados.map((r) => r.mensaje).join(" / ")}`).toEqual([true, true]);
      expect(resultados.filter((r) => r.mensaje === `La mesa ${300 + vuelta} ya tenía una cuenta abierta.`), `vuelta ${vuelta}`).toHaveLength(1);
      expect(await prisma.cuenta.count({ where: { mesaId: mesa.id, cerradaEn: null } }), `vuelta ${vuelta}`).toBe(1);
    }
  });

  it("(b) dos «Nueva mesa» a la vez con el MISMO número: una se crea y la otra recibe «Ya existe la mesa N» (el índice único (sucursal, número) arbitra)", async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const numero = 400 + vuelta;
      const resultados = await Promise.all([crearMesa(numero), crearMesa(numero)]);
      expect(resultados.filter((r) => r.ok), `vuelta ${vuelta}: ${resultados.map((r) => r.mensaje).join(" / ")}`).toEqual([{ ok: true, mensaje: `Mesa ${numero} creada.` }]);
      expect(resultados.filter((r) => !r.ok)).toEqual([{ ok: false, mensaje: `Ya existe la mesa ${numero} en esta sucursal.` }]);
      expect(await prisma.mesa.count({ where: { sucursalId: s.sucursalId, numero } }), `vuelta ${vuelta}`).toBe(1);
    }
  });

  it("(c) «Quitar» un ítem sin enviar contra «Enviar a cocina» ese mismo ítem: nunca las dos; el ítem queda borrado o enviado, nunca las dos cosas", async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 500 + vuelta } });
      const cuenta = await sembrarCuenta(mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }]);
      const item = cuenta.items[0];
      const [quitado, enviado] = await Promise.all([quitarItemSinEnviar(item.id), enviarACocina(cuenta.id, [item.id])]);
      const final = await prisma.cuentaItem.findUnique({ where: { id: item.id } });
      const detalle = `vuelta ${vuelta}: ${quitado.mensaje} / ${enviado.mensaje}`;
      // Que «Enviar» responda ok no alcanza para decir que envió: si el ítem ya no estaba, contesta «Esos ítems ya estaban enviados.» sin crear el envío.
      const envioNuevo = enviado.ok && enviado.envioNuevo;
      expect([quitado.ok, envioNuevo], detalle).not.toEqual([true, true]);
      if (quitado.ok) expect(final, detalle).toBeNull();
      if (envioNuevo) expect(final?.numeroEnvio, detalle).toBe(1);
      expect(quitado.ok || envioNuevo, detalle).toBe(true);
    }
  });

  it("(d) O.12: dos «Agregar» IGUALES a la vez DUPLICAN los ítems (agregarItems no tiene I3; se fija el comportamiento de hoy, no se arregla)", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    const resultados = await Promise.all([agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }]), agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }])]);
    expect(resultados).toEqual([
      { ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." },
      { ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." },
    ]);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect(items.map((i) => [i.productoId, Number(i.cantidad), i.numeroEnvio])).toEqual([
      [s.milanesa.id, 1, null],
      [s.milanesa.id, 1, null],
    ]);
  });
});
