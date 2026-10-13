import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { configuracionesMasPedidasEnSucursal } from "../../src/server/lecturas/pos/mas-pedidas";
import { cargarOpcionesDelSelector } from "../../src/server/consultas/pos/opciones-del-selector";

/**
 * GO-2d paso 9 («lo más pedido», modelo 3), contra Postgres: cuenta por huella las líneas de producto pedidas en las mesas de ESTA sucursal en los últimos 30 días, de mayor a
 * menor; no cuenta lo de otra sucursal ni lo de antes, y la consulta del selector arma los botones con sus nombres.
 *
 * Mutaciones (rojo → revertido → verde): sacar `cuenta: { mesa: { sucursalId } }` del `where` (lo de Norte, 50 chicos, pasa adelante); sacar `creadoEn: { gte: desde }` (los 10
 * medianos de hace 40 días pasan adelante).
 */
describe("lo más pedido en la sucursal", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let c: CafeDelSalon;
  let norteId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    c = await sembrarCafeDelSalon(s);
    await entrarComo(s.admin);
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    expect(
      (
        await agregarItems(cuentaId, [
          { productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId)] },
          { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId)] },
          { productoId: c.cafeId, cantidad: 10, opciones: [elegida(c, c.medianoId)] },
        ])
      ).ok
    ).toBe(true);
    // Los 10 medianos son de hace 40 días: fuera de la ventana.
    const mediano = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, cantidad: 10 } });
    await prisma.cuentaItem.update({ where: { id: mediano.id }, data: { creadoEn: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) } });
    // En OTRA sucursal se pidieron 50 chicos (la misma huella): no cuentan acá.
    const chico = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, cantidad: 1, productoId: c.cafeId } });
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    norteId = norte.id;
    const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 9 } });
    const cuentaNorte = await sembrarCuenta(mesaNorte.id, s.admin.id);
    await prisma.cuentaItem.create({ data: { cuentaId: cuentaNorte.id, productoId: c.cafeId, cantidad: 50, precioUnitario: chico.precioUnitario, huellaOpciones: chico.huellaOpciones, creadoPorId: s.admin.id } });
  });

  const db = () => baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db;
  const hace30Dias = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  it("cuenta por huella lo de esta sucursal en la ventana, de mayor a menor, con lo elegido dentro del precio (sin el adicional)", async () => {
    // Con una base que también ve Norte (quien ve varias sucursales): el filtro por la mesa de la cuenta es el que deja afuera lo de allá, no solo la RLS.
    const veLasDos = baseDeTest({ lectura: [s.sucursalId, norteId], escritura: [s.sucursalId] }).db;
    const pedidas = (await configuracionesMasPedidasEnSucursal(veLasDos, s.sucursalId, [c.cafeId], hace30Dias())).get(c.cafeId)!;
    expect(pedidas.map((p) => p.unidades)).toEqual([2, 1]);
    expect(pedidas[0]!.elegidas).toEqual(expect.arrayContaining([{ opcionId: c.grandeId, cantidad: 1 }, { opcionId: c.almendrasId, cantidad: 1 }]));
    expect(pedidas[0]!.elegidas).toHaveLength(2);
    expect(pedidas[1]!.elegidas).toEqual([{ opcionId: c.chicoId, cantidad: 1 }]);
  });

  it("el selector arma los botones con sus nombres, con los días cortados en la zona de la empresa", async () => {
    const selector = { seccionesCarta: [], fueraDeCarta: [{ productoId: c.cafeId, codigo: "PV_CAFE", nombre: "Café", precio: 1000, decimales: 0, pasoVenta: null, tieneStockReal: false }] };
    const conf = await cargarOpcionesDelSelector(s.sucursalId, db(), selector, { ahora: new Date(), zonaHoraria: "America/Argentina/Buenos_Aires" });
    expect(conf[c.cafeId]!.masPedidas.map((p) => p.etiqueta)).toEqual(["Grande · Almendras", "Chico"]);
    // Sin la hora y la zona, no se lee.
    expect((await cargarOpcionesDelSelector(s.sucursalId, db(), selector))[c.cafeId]!.masPedidas).toEqual([]);
  });
});
