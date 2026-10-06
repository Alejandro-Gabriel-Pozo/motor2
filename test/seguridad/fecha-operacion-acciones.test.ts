import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { reclasificarStock } from "../../src/server/actions/stock/reclasificacion";
import { registrarConteoFisico, registrarConteosFisicos } from "../../src/server/actions/movimientos/conteo-fisico";
import { registrarPagoConsignante } from "../../src/server/actions/reportes/consignacion";

// S-08: una fecha rota (Invalid Date → 500 de Prisma) o absurda (año 2099, 1970) se rechaza con un mensaje antes de escribir nada.
const DIA = 24 * 60 * 60 * 1000;
const FECHAS_MALAS: [string, Date, string][] = [
  ["Invalid Date", new Date("no es una fecha"), "La fecha no es válida."],
  ["muy futura", new Date("2099-01-01"), "La fecha no puede ser posterior a mañana."],
  ["muy antigua", new Date(Date.now() - 800 * DIA), "La fecha es demasiado antigua: no puede ser de hace más de 400 días."],
];

describe("las acciones que registran operaciones validan la fecha", () => {
  let sucursalId: string;
  let seccionId: string;
  let seccionDestinoId: string;
  let productoId: string;
  let proveedorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    seccionDestinoId = (await prisma.seccion.create({ data: { nombre: "Otra", sucursalId } })).id;
    productoId = (await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV1", nombre: "Prov" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const nada = async () => expect([await prisma.operacion.count(), await prisma.movimientoStock.count(), await prisma.conteoFisico.count()]).toEqual([0, 0, 0]);

  describe.each(FECHAS_MALAS)("fecha %s", (_n, fecha, mensaje) => {
    it("registrarMovimiento", async () => {
      expect(await registrarMovimiento({ proceso: "COMPRA", fecha, seccionId, items: [{ productoId, cantidad: 1, precioTotal: 10 }] })).toEqual({ ok: false, mensaje });
      await nada();
    });

    it("registrarVenta", async () => {
      expect(await registrarVenta({ fecha, seccionId, ventas: [{ productoId, cantidadVendida: 1 }] })).toEqual({ ok: false, mensaje });
      await nada();
    });

    it("reclasificarStock", async () => {
      expect(await reclasificarStock({ productoId, seccionOrigenId: seccionId, fecha, destinos: [{ seccionId: seccionDestinoId, cantidad: 1 }] })).toEqual({ ok: false, mensaje });
      await nada();
    });

    it("registrarConteoFisico y registrarConteosFisicos", async () => {
      const fila = { productoId, seccionId, conteoReal: 5, fechaConteo: fecha, accion: "AJUSTAR" as const };
      expect(await registrarConteoFisico(fila)).toEqual({ ok: false, mensaje });
      expect(await registrarConteosFisicos([fila])).toMatchObject({ ok: true, resultados: [{ ok: false, mensaje }] });
      await nada();
    });

    it("registrarPagoConsignante", async () => {
      expect(await registrarPagoConsignante(proveedorId, 40, fecha)).toEqual({ ok: false, mensaje });
      expect(await prisma.pagoConsignante.count()).toBe(0);
    });
  });

  it("una fecha de hoy y una de ayer siguen funcionando", async () => {
    expect((await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId, cantidad: 3, precioTotal: 30 }] })).ok).toBe(true);
    expect((await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(Date.now() - DIA), seccionId, items: [{ productoId, cantidad: 3, precioTotal: 30 }] })).ok).toBe(true);
    expect((await registrarPagoConsignante(proveedorId, 40, new Date())).ok).toBe(true);
  });
});
