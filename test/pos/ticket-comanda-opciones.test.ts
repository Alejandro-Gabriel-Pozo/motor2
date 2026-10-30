import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { armarTicket } from "../../src/core/pos/ticket";
import { armarComandas } from "../../src/core/pos/comanda";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { obtenerTicketsRecientes } from "../../src/server/consultas/pos/tickets";
import { obtenerDetalleDeMesa } from "../../src/server/consultas/pos/detalle-de-mesa";
import { listarTicketsEmitidos } from "../../src/server/consultas/reportes/tickets-emitidos";

/**
 * GO-2b (ADR-030): el ticket, la comanda y el detalle de la mesa con opciones. Puro: el ticket agrupa con la huella y el padre, nombra las opciones de la foto, pone
 * cada adicional después de su producto y SIN descuento de cliente; sin opciones, todo idéntico. Contra Postgres: el ticket de una cuenta cerrada coincide al centavo
 * con lo registrado en el cierre, «Tickets emitidos» enlaza cada línea con SU operación, el detalle de la mesa suma igual que el cierre y la comanda muestra las
 * opciones y las anulaciones de los adicionales.
 */
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

describe("armarTicket con opciones (puro)", () => {
  const items = [
    { id: "c1", productoId: "cafe", productoNombre: "Café", cantidad: 1, precioUnitario: 1250, huellaOpciones: H1, nombreDeLinea: "Café grande almendras" },
    { id: "s1", productoId: "shot", productoNombre: "Shot extra", cantidad: 2, precioUnitario: 200, lineaPadreId: "c1", versionDeAdicional: "v1" },
    { id: "c2", productoId: "cafe", productoNombre: "Café", cantidad: 1, precioUnitario: 1250, huellaOpciones: H2, nombreDeLinea: "Café grande de vaca", detalleDeLinea: "azúcar" },
    { id: "m", productoId: "mila", productoNombre: "Milanesa", cantidad: 1, precioUnitario: 9000 },
  ];

  it("dos configuraciones al mismo precio son dos líneas, cada una con SU nombre; el adicional va después de su producto, marcado y sin descuento de cliente", () => {
    expect(armarTicket(items, 10)).toEqual({
      lineas: [
        { producto: "Café grande almendras", cantidad: 1, precioUnitario: 1125, precioListaUnitario: 1250, subtotal: 1125 },
        { producto: "Shot extra", cantidad: 2, precioUnitario: 200, subtotal: 400, esAdicional: true },
        { producto: "Café grande de vaca", cantidad: 1, precioUnitario: 1125, precioListaUnitario: 1250, subtotal: 1125, detalle: "azúcar" },
        { producto: "Milanesa", cantidad: 1, precioUnitario: 8100, precioListaUnitario: 9000, subtotal: 8100 },
      ],
      total: 10750,
    });
  });

  it("sin opciones el ticket es el de siempre: sin campos nuevos", () => {
    const { lineas } = armarTicket([{ id: "m", productoId: "mila", productoNombre: "Milanesa", cantidad: 2, precioUnitario: 9000 }]);
    expect(lineas).toEqual([{ producto: "Milanesa", cantidad: 2, precioUnitario: 9000, subtotal: 18000 }]);
  });
});

describe("armarComandas con opciones (puro)", () => {
  it("la cocina ve las opciones del producto y el adicional marcado; la anulación de un adicional va con sus datos", () => {
    const [comanda] = armarComandas(
      [
        {
          numero: 1,
          items: [
            { id: "c", productoNombre: "Café", restante: 1, creadoPor: "Ana", opciones: ["Grande", "Almendras"], anulaciones: [] },
            { id: "s", productoNombre: "Shot extra", restante: 1, creadoPor: "Ana", esAdicional: true, anulaciones: [{ id: "e", cantidad: -1, motivoAnulacion: "No lo quiso", creadoPor: "Ana" }] },
            { id: "m", productoNombre: "Milanesa", restante: 1, creadoPor: "Ana", anulaciones: [] },
          ],
        },
      ],
      "Ana"
    );
    expect(comanda!.lineas).toEqual([
      { itemId: "c", producto: "Café", cantidad: 1, opciones: ["Grande", "Almendras"] },
      { itemId: "s", producto: "Shot extra", cantidad: 1, esAdicional: true },
      { itemId: "m", producto: "Milanesa", cantidad: 1 },
    ]);
    expect(comanda!.anulaciones).toEqual([{ id: "e", itemId: "s", producto: "Shot extra", cantidad: 1, motivo: "No lo quiso", por: "Ana", quedan: 1, esAdicional: true }]);
  });
});

describe("ticket, «Tickets emitidos», detalle y comanda contra Postgres (GO-2b)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let c: CafeDelSalon;
  let cuentaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    c = await sembrarCafeDelSalon(s);
    await entrarComo(s.admin);
    cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    const cliente = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 10 } });
    await prisma.cuenta.update({ where: { id: cuentaId }, data: { clienteId: cliente.id, descuentoPorcentaje: 10 } });
    expect(
      (
        await agregarItems(cuentaId, [
          { productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId)] },
          { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId)] },
          { productoId: s.flan.id, cantidad: 1 },
        ])
      ).ok
    ).toBe(true);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
  });

  it("el detalle de la mesa suma lo mismo que cobra el cierre (el adicional sin descuento de cliente) y muestra las opciones", async () => {
    const detalle = await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db, new Date());
    const cafe = detalle!.cuenta!.envios[0]!.items.find((i) => i.precioUnitario === 1250)!;
    expect(cafe.opciones).toEqual(["Grande", "Almendras"]);
    expect(detalle!.cuenta!.envios[0]!.items.find((i) => i.productoId === c.anclaDelShotId)!.esAdicional).toBe(true);
    expect(detalle!.cuenta!.total).toBe(2250 + 400 + 855 + 2700);
    // Y la comanda de ese envío (la arma la pantalla con `armarComandas`) lleva las opciones.
    const [comanda] = armarComandas(detalle!.cuenta!.envios, detalle!.cuenta!.mesero);
    expect(comanda!.lineas.find((l) => l.opciones?.includes("Almendras"))).toMatchObject({ producto: "Café", cantidad: 2 });
  });

  it("la comanda muestra la anulación del adicional que arrastró anular su producto", async () => {
    const cafe = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, precioUnitario: 1250 } });
    expect((await anularItemEnviado(cafe.id, 1, "Se cayó", 2)).ok).toBe(true);
    const detalle = await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db, new Date());
    const [comanda] = armarComandas(detalle!.cuenta!.envios, detalle!.cuenta!.mesero);
    expect(comanda!.anulaciones.map((a) => [a.producto, a.cantidad, a.quedan, a.esAdicional ?? false])).toEqual([
      ["Café", 1, 1, false],
      ["Shot extra", 1, 1, true],
    ]);
  });

  it("el ticket de la cuenta cerrada coincide AL CENTAVO con lo registrado, y «Tickets emitidos» enlaza cada línea con su operación", async () => {
    const cierre = await cerrarCuenta(cuentaId);
    expect(cierre.ok, cierre.mensaje).toBe(true);
    const registrado = (await prisma.movimientoStock.findMany({ where: { proceso: "VENTA" } })).reduce((suma, m) => suma + Number(m.precioTotal), 0);
    const db = baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db;
    const [ticket] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, db, undefined, new Date());
    expect(ticket!.total).toBe(Math.round(registrado * 100) / 100);
    // El orden es el de escritura (como el cierre): los sueltos van en el createMany antes que las líneas configuradas.
    expect(ticket!.lineas.map((l) => [l.producto, l.cantidad, l.subtotal, l.esAdicional ?? false])).toEqual([
      ["Flan", 1, 2700, false],
      ["Café grande almendras", 2, 2250, false],
      ["Shot extra", 2, 400, true],
      ["Café chico", 1, 855, false],
    ]);
    const emitidos = await listarTicketsEmitidos(s.sucursalId, {}, db);
    const lineas = emitidos.items[0]!.detalle.lineas;
    const ops = await prisma.operacion.findMany({ where: { proceso: "VENTA" }, include: { movimientos: { where: { proceso: "VENTA" } } } });
    for (const l of lineas) {
      const op = ops.find((o) => o.id === l.operacionId)!;
      expect(Number(op.movimientos[0]!.precioTotal), l.producto).toBe(l.subtotal);
    }
    expect(new Set(lineas.map((l) => l.operacionId)).size).toBe(4);
    expect(emitidos.items[0]!.importe).toBe(ticket!.total);
  });
});
