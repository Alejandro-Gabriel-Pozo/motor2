import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { resolverConteoPendiente } from "../../src/server/actions/movimientos/conteo-fisico";
import { registrarUnConteoFisico } from "../setup/conteo-fisico-de-una-fila";
import { reclasificarStock } from "../../src/server/actions/stock/reclasificacion";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * P17 (decisión del dueño, 2026-10-11): una sección dada de baja solo admite sacar mercadería (consumir, mermar o transferir). Acá, los otros tres caminos que la tocan, contra la base real:
 * la VENTA de mostrador (no se vende desde ella), el CONTEO físico (ajusta el saldo, también hacia arriba) y la RECLASIFICACIÓN (mueve stock entre secciones). Todos rechazan con el texto único
 * y, si traen clave I3, la evalúan ANTES (un reintento de algo ya escrito devuelve el resultado original). El cierre de cuenta del POS no cambia (ya usa solo las activas:
 * `test/casos-de-uso/cerrar-cuenta.test.ts`). La tabla de `registrarMovimiento` está en `seccion-desactivada.test.ts`.
 */
describe("P17: venta, conteo y reclasificación con una sección dada de baja", () => {
  let sucursalId: string;
  let seccionId: string;
  let seccionDestinoId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;
  let pvId: string;
  const MENSAJE = (nombre: string) =>
    `La sección «${nombre}» está desactivada: solo se puede sacar mercadería de ella (transferir, mermar o consumir) hasta vaciarla. Elegí otra sección o activala.`;
  const darDeBaja = (id: string) => prisma.seccion.update({ where: { id }, data: { activa: false } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito A")).id;
    seccionDestinoId = (await sembrarSeccion(sucursalId, "Depósito B")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    mpId = mp.id;
    const pv = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    pvId = pv.id;
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 0.2, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }], claveIdempotencia: crypto.randomUUID() });
  });

  describe("venta de mostrador", () => {
    it("se rechaza vender desde una sección dada de baja, con el texto único, y no escribe nada", async () => {
      await darDeBaja(seccionId);
      const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pvId, cantidadVendida: 3 }] });
      expect(r).toEqual({ ok: false, mensaje: MENSAJE("Depósito A") });
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
      expect(await calcularSaldoTotal(mpId, seccionId, prisma)).toBe(10);
    });

    it("I3: reintentar con la MISMA clave una venta ya escrita después de la baja devuelve el resultado original, sin una segunda venta", async () => {
      const clave = crypto.randomUUID();
      const payload = { fecha: new Date(), seccionId, ventas: [{ productoId: pvId, cantidadVendida: 3 }], claveIdempotencia: clave };
      const original = await registrarVenta(payload);
      expect(original.ok, original.mensaje).toBe(true);
      await darDeBaja(seccionId);

      const reintento = await registrarVenta(payload);

      expect(reintento).toEqual({ ok: true, mensaje: original.mensaje });
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
      expect(await calcularSaldoTotal(mpId, seccionId, prisma)).toBeCloseTo(10 - 3 * 0.2);
    });
  });

  describe("conteo físico", () => {
    it("se rechaza contar una sección dada de baja (con ajuste o sin él), con el texto único, y no escribe nada", async () => {
      await darDeBaja(seccionId);
      for (const accion of ["AJUSTAR", "FALTA_MOVIMIENTO", "DESCARTAR"] as const) {
        const r = await registrarUnConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion });
        expect(r, accion).toEqual({ ok: false, mensaje: MENSAJE("Depósito A") });
      }
      expect(await prisma.conteoFisico.count()).toBe(0);
      expect(await calcularSaldoTotal(mpId, seccionId, prisma)).toBe(10);
    });

    it("I3: reintentar con la MISMA clave un conteo ya escrito después de la baja devuelve el mensaje original, sin un segundo conteo", async () => {
      const clave = crypto.randomUUID();
      const datos = { productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR" as const, claveIdempotencia: clave };
      const original = await registrarUnConteoFisico(datos);
      expect(original.ok, original.mensaje).toBe(true);
      await darDeBaja(seccionId);

      const reintento = await registrarUnConteoFisico(datos);

      expect(reintento).toEqual({ ok: true, mensaje: original.mensaje });
      expect(await prisma.conteoFisico.count()).toBe(1);
      expect(await calcularSaldoTotal(mpId, seccionId, prisma)).toBe(7);
    });

    it("un conteo PENDIENTE de antes de la baja se puede resolver igual (sin cambio: resolver no ingresa mercadería)", async () => {
      await registrarUnConteoFisico({ productoId: mpId, seccionId, conteoReal: 15, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
      const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
      await darDeBaja(seccionId);

      const r = await resolverConteoPendiente(conteo.id, "resuelto");

      expect(r.ok, r.mensaje).toBe(true);
      expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: conteo.id } })).estado).toBe("RESUELTO");
    });
  });

  describe("reclasificación", () => {
    it("se rechaza si el ORIGEN está dado de baja, con el nombre del origen, y no escribe nada", async () => {
      await darDeBaja(seccionId);
      const r = await reclasificarStock({ productoId: mpId, seccionOrigenId: seccionId, fecha: new Date(), destinos: [{ seccionId: seccionDestinoId, cantidad: 10 }] });
      expect(r).toEqual({ ok: false, mensaje: MENSAJE("Depósito A") });
      expect(await prisma.operacion.count({ where: { proceso: "RECLASIFICACION" } })).toBe(0);
      expect(await calcularSaldoTotal(mpId, seccionId, prisma)).toBe(10);
    });

    it("se rechaza si algún DESTINO está dado de baja, con el nombre de ese destino, y no escribe nada", async () => {
      await darDeBaja(seccionDestinoId);
      const r = await reclasificarStock({ productoId: mpId, seccionOrigenId: seccionId, fecha: new Date(), destinos: [{ seccionId: seccionDestinoId, cantidad: 10 }] });
      expect(r).toEqual({ ok: false, mensaje: MENSAJE("Depósito B") });
      expect(await prisma.operacion.count({ where: { proceso: "RECLASIFICACION" } })).toBe(0);
      expect(await calcularSaldoTotal(mpId, seccionDestinoId, prisma)).toBe(0);
    });

    it("I3: reintentar con la MISMA clave una reclasificación ya escrita después de la baja devuelve el resultado original, sin repetirla", async () => {
      const clave = crypto.randomUUID();
      const payload = { productoId: mpId, seccionOrigenId: seccionId, fecha: new Date(), destinos: [{ seccionId: seccionDestinoId, cantidad: 10 }], claveIdempotencia: clave };
      const original = await reclasificarStock(payload);
      expect(original.ok, original.mensaje).toBe(true);
      await darDeBaja(seccionDestinoId);

      const reintento = await reclasificarStock(payload);

      expect(reintento).toEqual({ ok: true, mensaje: original.mensaje });
      expect(await prisma.movimientoStock.count({ where: { productoId: mpId, proceso: "RECLASIFICACION" } })).toBe(2);
    });
  });
});
