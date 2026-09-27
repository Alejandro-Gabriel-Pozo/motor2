import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO: `fallarEnLlamada = N` hace que la N-ésima llamada a
 * `registrarCambioAuditado` (contando desde que se arma) tire, DESPUÉS de que la acción ya escribió el precio. El resto de las
 * llamadas delegan en la implementación real (escriben la fila de auditoría de verdad).
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/core/permisos/auditoria", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/permisos/auditoria")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      interruptor.llamadas++;
      if (interruptor.fallarEnLlamada !== null && interruptor.llamadas === interruptor.fallarEnLlamada) {
        throw new Error("auditoría caída (simulada)");
      }
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, sincronizarPrecioGrupoCarta, type DatosProducto } from "../../src/server/actions/catalogo/productos";
import { setPrecioLocalProducto, sincronizarPrecioLocalGrupoCarta } from "../../src/server/actions/movimientos/precio-local";

/**
 * Cambio de precio + su auditoría, atómicos (Task #41, Fase M10). Antes, las cuatro acciones que cambian un precio hacían el
 * `update`/`upsert` y DESPUÉS, fuera de toda transacción, escribían la auditoría (A3, Pivote 6): si la auditoría fallaba (o el
 * proceso se caía entre las dos escrituras), el precio quedaba cambiado SIN rastro. Ahora van en una sola transacción: si falla
 * cualquier fila de auditoría, no queda NADA — ni el precio nuevo ni las filas de auditoría que sí se habían escrito.
 */
describe("cambio de precio y su auditoría son atómicos", () => {
  let sucursalId: string;
  let unidadId: string;
  let ids: Record<string, string>;

  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } });
    const pv = async (codigo: string, nombre: string) =>
      (await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta: 5000, unidadStockId: unidadId }, sucursalId)).id;
    ids = { coca: await pv("PAA_COCA", "Coca-Cola 500cc"), sprite: await pv("PAA_SPRITE", "Sprite 500cc") };
    const agId = (await prisma.itemAgrupadoCarta.create({ data: { nombre: "Gaseosa 500 CC", seccionCartaId: seccion.id } })).id;
    await prisma.opcionItemAgrupadoCarta.createMany({
      data: [ids.coca, ids.sprite].map((productoId, orden) => ({ itemAgrupadoCartaId: agId, productoId, orden })),
    });
    interruptor.llamadas = 0;
  });

  afterEach(() => {
    interruptor.fallarEnLlamada = null;
  });

  const precioVenta = async (id: string) => Number((await prisma.producto.findUniqueOrThrow({ where: { id } })).precioVenta);
  const precioLocal = (productoId: string) => prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
  const datosPV = (nombre: string, precioVenta: number, extra: Partial<DatosProducto> = {}): DatosProducto => ({
    nombre, tipo: "PV", unidadStockId: unidadId, factorConversion: 1, precioVenta, ...extra,
  });

  describe("actualizarProducto (precio de venta global)", () => {
    it("falla la auditoría del precio de venta → el precio NO cambia", async () => {
      interruptor.fallarEnLlamada = 1;
      await expect(actualizarProducto(ids.coca, datosPV("Coca-Cola 500cc", 5500))).rejects.toThrow("auditoría caída");
      expect(await precioVenta(ids.coca)).toBe(5000);
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });

    it("falla la ÚLTIMA auditoría (paso de venta) → ni el precio ni las auditorías ya escritas quedan", async () => {
      interruptor.fallarEnLlamada = 3;
      await expect(actualizarProducto(ids.coca, datosPV("Coca-Cola 500cc", 5500, { precioConsignacion: 10, pasoVenta: 1 }))).rejects.toThrow("auditoría caída");
      expect(await precioVenta(ids.coca)).toBe(5000);
      expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: ids.coca } })).precioConsignacion)).toBe(0);
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });

    it("sin falla → precio y auditoría quedan (control)", async () => {
      expect((await actualizarProducto(ids.coca, datosPV("Coca-Cola 500cc", 5500))).ok).toBe(true);
      expect(await precioVenta(ids.coca)).toBe(5500);
      expect(await prisma.registroAuditoria.count({ where: { entidadId: ids.coca, campo: "precioVenta" } })).toBe(1);
    });
  });

  describe("sincronizarPrecioGrupoCarta", () => {
    it("falla la auditoría del SEGUNDO producto → ninguno de los dos cambia de precio, sin auditoría", async () => {
      interruptor.fallarEnLlamada = 2;
      await expect(sincronizarPrecioGrupoCarta([ids.coca, ids.sprite], 5500)).rejects.toThrow("auditoría caída");
      expect(await precioVenta(ids.coca)).toBe(5000);
      expect(await precioVenta(ids.sprite)).toBe(5000);
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });
  });

  describe("setPrecioLocalProducto", () => {
    it("falla la auditoría del precio → el precio local existente NO cambia", async () => {
      await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: ids.coca, precio: 6000, habilitado: true } });
      interruptor.fallarEnLlamada = 1;
      await expect(setPrecioLocalProducto(ids.coca, 7000, true)).rejects.toThrow("auditoría caída");
      expect(Number((await precioLocal(ids.coca))!.precio)).toBe(6000);
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });

    it("falla la auditoría de `habilitado` (la segunda) → no se crea el precio local ni queda la auditoría del precio", async () => {
      interruptor.fallarEnLlamada = 2;
      await expect(setPrecioLocalProducto(ids.coca, 7000, true)).rejects.toThrow("auditoría caída");
      expect(await precioLocal(ids.coca)).toBeNull();
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });
  });

  describe("sincronizarPrecioLocalGrupoCarta", () => {
    it("falla una auditoría del SEGUNDO producto → no queda ningún precio local ni auditoría", async () => {
      interruptor.fallarEnLlamada = 3; // 1-2: precio/habilitado del primero; 3: precio del segundo
      await expect(sincronizarPrecioLocalGrupoCarta(sucursalId, [ids.coca, ids.sprite], 5500, true)).rejects.toThrow("auditoría caída");
      expect(await prisma.precioLocalProducto.count()).toBe(0);
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });
  });
});
