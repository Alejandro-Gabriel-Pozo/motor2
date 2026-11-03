import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { reclasificarStock } from "../../src/server/actions/stock/reclasificacion";
import { registrarConteosFisicos } from "../../src/server/actions/movimientos/conteo-fisico";
import { registrarPagoConsignante } from "../../src/server/actions/reportes/consignacion";
import { comprobanteDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

// S-08: una fecha rota (Invalid Date → 500 de Prisma) o absurda (año 2099, 1970) se rechaza con un mensaje antes de escribir nada.
const DIA = 24 * 60 * 60 * 1000;
const MENSAJE_TOPE_MANANA = "La fecha no puede ser posterior a mañana.";
const MENSAJE_TOPE_HOY_COMPRA = "La fecha de la compra no puede ser posterior a hoy.";
const FECHAS_MALAS: [string, Date, string][] = [
  ["Invalid Date", new Date("no es una fecha"), "La fecha no es válida."],
  ["muy futura", new Date("2099-01-01"), MENSAJE_TOPE_MANANA],
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
    // El tope de «mañana» es el de los procesos que NO son COMPRA: acá se prueba con un AJUSTE.
    it("registrarMovimiento (AJUSTE)", async () => {
      expect(await registrarMovimiento({ proceso: "AJUSTE", fecha, seccionId, items: [{ productoId, cantidad: 1 }], claveIdempotencia: crypto.randomUUID() })).toEqual({ ok: false, mensaje });
      await nada();
    });

    // I13 (etapa 1 de Compras): la COMPRA no tiene el día de margen; solo cambia el mensaje del tope de fecha futura.
    it("registrarMovimiento (COMPRA)", async () => {
      const mensajeDeCompra = mensaje === MENSAJE_TOPE_MANANA ? MENSAJE_TOPE_HOY_COMPRA : mensaje;
      expect(await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha, seccionId, items: [{ productoId, cantidad: 1, precioTotal: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() })).toEqual({ ok: false, mensaje: mensajeDeCompra });
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

    it("registrarConteosFisicos", async () => {
      const fila = { productoId, seccionId, conteoReal: 5, fechaConteo: fecha, accion: "AJUSTAR" as const };
      expect(await registrarConteosFisicos([fila])).toMatchObject({ ok: true, resultados: [{ ok: false, mensaje }] });
      await nada();
    });

    it("registrarPagoConsignante", async () => {
      expect(await registrarPagoConsignante(proveedorId, 40, fecha, undefined, crypto.randomUUID())).toEqual({ ok: false, mensaje });
      expect(await prisma.pagoConsignante.count()).toBe(0);
    });
  });

  // I13: el borde exacto del tope de la COMPRA es el fin de HOY en hora argentina (UTC-3), con el reloj fijo; el AJUSTE conserva el día de margen.
  describe("borde del tope de la fecha, en hora argentina, con el reloj fijo", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-30T12:00:00-03:00"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const compra = async (fecha: Date) =>
      registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha, seccionId, items: [{ productoId, cantidad: 1, precioTotal: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });
    const ajuste = async (fecha: Date) => registrarMovimiento({ proceso: "AJUSTE", fecha, seccionId, items: [{ productoId, cantidad: 1 }], claveIdempotencia: crypto.randomUUID() });

    it("COMPRA: hoy 23:59:59 (AR) pasa la validación de fecha", async () => {
      expect((await compra(new Date("2026-09-30T23:59:59-03:00"))).ok).toBe(true);
    });

    it("COMPRA: mañana 00:00 (AR) falla con el mensaje de la compra, sin escribir nada", async () => {
      expect(await compra(new Date("2026-10-01T00:00:00-03:00"))).toEqual({ ok: false, mensaje: MENSAJE_TOPE_HOY_COMPRA });
      await nada();
    });

    it("AJUSTE (no es compra): mañana 00:00 (AR) todavía pasa, pasado mañana 00:00 (AR) falla con el mensaje de «mañana»", async () => {
      expect((await ajuste(new Date("2026-10-01T00:00:00-03:00"))).ok).toBe(true);
      expect(await ajuste(new Date("2026-10-02T00:00:00-03:00"))).toEqual({ ok: false, mensaje: MENSAJE_TOPE_MANANA });
    });
  });

  it("una fecha de hoy y una de ayer siguen funcionando", async () => {
    expect((await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId, cantidad: 3, precioTotal: 30, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() })).ok).toBe(true);
    expect((await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(Date.now() - DIA), seccionId, items: [{ productoId, cantidad: 3, precioTotal: 30, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() })).ok).toBe(true);
    // B2 (ola «precio y carta», Fase 2): el pago es a un consignante, el de algún producto.
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    await prisma.producto.create({ data: { codigo: "MP_CONSIGNADO", nombre: "Vino consignado", tipo: "MP", unidadStockId: kg.id, esConsignacion: true, proveedorConsignacionId: proveedorId, precioConsignacion: 20 } });
    expect((await registrarPagoConsignante(proveedorId, 40, new Date(), undefined, crypto.randomUUID())).ok).toBe(true);
  });
});
