import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría DESPUÉS de que la escritura ya pasó (mismo molde que `test/catalogo/catalogo-auditoria-atomica.test.ts`): con `fallar` la
 * próxima llamada a `registrarCambioAuditado` tira. El resto delega en la implementación real.
 */
const interruptor = vi.hoisted(() => ({ fallar: false }));

vi.mock("../../src/core/permisos/auditoria", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/permisos/auditoria")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      if (interruptor.fallar) throw new Error("auditoría caída (simulada)");
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { eliminarStockMinimo, setStockMinimoProducto } from "../../src/server/actions/stock/stock-minimo";

/**
 * 4.4 de `docs/pureza-integracion.md` (decidido por el dueño el 2026-10-07; Hito 4, bloque C, paso H4C-22 — CAMBIA COMPORTAMIENTO, commit aparte de la mudanza pura
 * de H4C-21): el alta, el cambio y el borrado del stock mínimo dejan su fila en la auditoría administrativa, en la MISMA transacción que el cambio. Entidad
 * «StockMinimoProducto», `entidadId` = el id de la fila (al borrar, el de la fila borrada), `campo: "minimo"`, del valor anterior al nuevo (`null` si la fila no
 * existía o se borró), con la sucursal y una descripción que dice si es el mínimo global de la sucursal o de qué sección. Repetir el mismo valor no deja fila
 * (`registrarCambioAuditado` no escribe lo que no cambió). Si la auditoría falla, no queda el cambio. ROJO contra H4C-21 (el mínimo no se auditaba: era la
 * excepción «stockMinimoProducto.minimo» de `escrituras-auditadas`).
 */
describe("stock mínimo: el alta, el cambio y el borrado se auditan (4.4)", () => {
  let sucursalId: string;
  let seccionId: string;
  let mpId: string;
  let adminId: string;

  beforeEach(async () => {
    interruptor.fallar = false;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Sal", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
  });

  const filasDeAuditoria = async () =>
    (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "StockMinimoProducto" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((r) => ({
      entidadId: r.entidadId,
      campo: r.campo,
      descripcion: r.descripcion,
      valorAnterior: r.valorAnterior,
      valorNuevo: r.valorNuevo,
      actorId: r.actorId,
      sucursalId: r.sucursalId,
    }));
  const filaGlobal = () => prisma.stockMinimoProducto.findFirstOrThrow({ where: { seccionId: null } });

  it("global: el alta, el cambio y el borrado dejan una fila cada uno; el mismo valor no deja nada", async () => {
    await setStockMinimoProducto(mpId, 5);
    const { id } = await filaGlobal();
    await setStockMinimoProducto(mpId, 7.5);
    await setStockMinimoProducto(mpId, 7.5);
    expect((await eliminarStockMinimo(id)).ok).toBe(true);
    const base = { entidadId: id, campo: "minimo", descripcion: 'Stock mínimo de "Sal" (global)', actorId: adminId, sucursalId };
    expect(await filasDeAuditoria()).toEqual([
      { ...base, valorAnterior: null, valorNuevo: "5" },
      { ...base, valorAnterior: "5", valorNuevo: "7.5" },
      { ...base, valorAnterior: "7.5", valorNuevo: null },
    ]);
  });

  it("de una sección: la descripción nombra la sección; un rechazo no deja rastro", async () => {
    expect((await setStockMinimoProducto(mpId, -1, seccionId)).ok).toBe(false);
    expect((await setStockMinimoProducto("cnoexiste000000000000000", 3, seccionId)).ok).toBe(false);
    await setStockMinimoProducto(mpId, 3, seccionId);
    await setStockMinimoProducto(mpId, 0, seccionId);
    const { id } = await prisma.stockMinimoProducto.findFirstOrThrow({ where: { seccionId } });
    await eliminarStockMinimo(id);
    const base = { entidadId: id, campo: "minimo", descripcion: 'Stock mínimo de "Sal" en "Depósito"', actorId: adminId, sucursalId };
    expect(await filasDeAuditoria()).toEqual([
      { ...base, valorAnterior: null, valorNuevo: "3" },
      { ...base, valorAnterior: "3", valorNuevo: "0" },
      { ...base, valorAnterior: "0", valorNuevo: null },
    ]);
  });

  it("atómico: si la auditoría falla no queda el alta, ni el cambio, ni el borrado", async () => {
    interruptor.fallar = true;
    await expect(setStockMinimoProducto(mpId, 5)).rejects.toThrow("auditoría caída");
    await expect(setStockMinimoProducto(mpId, 5, seccionId)).rejects.toThrow("auditoría caída");
    expect(await prisma.stockMinimoProducto.count()).toBe(0);

    interruptor.fallar = false;
    await setStockMinimoProducto(mpId, 5);
    const { id } = await filaGlobal();
    interruptor.fallar = true;
    await expect(setStockMinimoProducto(mpId, 9)).rejects.toThrow("auditoría caída");
    expect(Number((await filaGlobal()).minimo)).toBe(5);
    await expect(eliminarStockMinimo(id)).rejects.toThrow("auditoría caída");
    expect(await prisma.stockMinimoProducto.count({ where: { id } })).toBe(1);
  });
});
