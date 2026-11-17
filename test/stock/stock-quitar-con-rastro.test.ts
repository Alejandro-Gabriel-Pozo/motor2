import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { eliminarStockMinimo, listarStockMinimo, setStockMinimoProducto } from "../../src/server/actions/stock/stock-minimo";
import { eliminarFrecuenciaConteo, listarFrecuenciasConteo, setFrecuenciaConteo } from "../../src/server/actions/stock/frecuencia-conteo";
import { eliminarSeccionHabitual, listarSeccionesHabituales, setSeccionHabitual } from "../../src/server/actions/stock/seccion-habitual";
import { resolverStockMinimo } from "../../src/server/consultas/stock/stock-minimo";

/**
 * E-4(2) del frente 3 (datos): el mínimo de stock, la frecuencia de conteo y la sección habitual NO se borran: se QUITAN con rastro (`quitadoEn`, `quitadoPorId`). Prueba, contra la base:
 *  - quitar deja la fila (con quién y cuándo) y las lecturas ya no la ven; el mínimo quitado deja de valer en `resolverStockMinimo`;
 *  - IDEMPOTENCIA: repetir «quitar» no encuentra nada vigente y se rechaza; no queda una segunda auditoría ni cambia el rastro de la primera quita;
 *  - CONCURRENCIA: dos «quitar» a la vez de la misma fila → una sola gana (una fila de auditoría);
 *  - fijar de nuevo lo quitado lo REACTIVA en el mismo lugar (mismo id, rastro limpio) y la auditoría lo cuenta como alta (anterior `null`).
 */
describe("stock: quitar con rastro (E-4(2))", () => {
  let sucursalId: string;
  let seccionId: string;
  let mpId: string;
  let pvId: string;
  let adminId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Barra")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Sal", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    pvId = (await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pizza", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 1000 } })).id;
  });

  const auditoria = async () =>
    (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "StockMinimoProducto" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((r) => [r.valorAnterior, r.valorNuevo]);

  it("stock mínimo: quitar deja la fila con quién y cuándo, deja de valer y no se puede quitar dos veces", async () => {
    await setStockMinimoProducto(mpId, 5);
    const fila = await prisma.stockMinimoProducto.findFirstOrThrow({ where: { productoId: mpId } });
    expect(await resolverStockMinimo(sucursalId, mpId, null, prisma)).toBe(5);

    expect((await eliminarStockMinimo(fila.id)).ok).toBe(true);
    const quitada = await prisma.stockMinimoProducto.findUniqueOrThrow({ where: { id: fila.id } });
    expect(quitada.quitadoPorId).toBe(adminId);
    expect(quitada.quitadoEn).toBeInstanceOf(Date);
    expect(Number(quitada.minimo)).toBe(5);
    expect(await resolverStockMinimo(sucursalId, mpId, null, prisma)).toBeNull();
    expect(await listarStockMinimo(sucursalId)).toEqual([]);

    // Repetir: se rechaza, el rastro de la primera quita no cambia y no hay una segunda auditoría.
    expect(await eliminarStockMinimo(fila.id)).toEqual({ ok: false, mensaje: "No se encontró la fila de Stock Mínimo." });
    expect(await prisma.stockMinimoProducto.findUniqueOrThrow({ where: { id: fila.id } })).toMatchObject({ quitadoEn: quitada.quitadoEn, quitadoPorId: adminId });
    expect(await auditoria()).toEqual([[null, "5"], ["5", null]]);
  });

  it("stock mínimo: fijar de nuevo lo quitado lo reactiva en el mismo lugar, como un alta", async () => {
    await setStockMinimoProducto(mpId, 5, seccionId);
    const fila = await prisma.stockMinimoProducto.findFirstOrThrow({ where: { productoId: mpId } });
    await eliminarStockMinimo(fila.id);
    await setStockMinimoProducto(mpId, 8, seccionId);
    const filas = await prisma.stockMinimoProducto.findMany({ where: { productoId: mpId } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: fila.id, quitadoEn: null, quitadoPorId: null });
    expect(Number(filas[0].minimo)).toBe(8);
    expect(await resolverStockMinimo(sucursalId, mpId, seccionId, prisma)).toBe(8);
    expect(await auditoria()).toEqual([[null, "5"], ["5", null], [null, "8"]]);
  });

  it("stock mínimo: dos «quitar» simultáneos de la misma fila → gana uno, una sola auditoría", async () => {
    await setStockMinimoProducto(mpId, 5);
    const { id } = await prisma.stockMinimoProducto.findFirstOrThrow({ where: { productoId: mpId } });
    const resultados = await Promise.all([eliminarStockMinimo(id), eliminarStockMinimo(id)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toHaveLength(1);
    expect(await auditoria()).toEqual([[null, "5"], ["5", null]]);
  });

  it("frecuencia de conteo: quitar con rastro, repetir se rechaza, fijar de nuevo reactiva", async () => {
    await setFrecuenciaConteo(mpId, 7);
    const fila = await prisma.frecuenciaConteoProducto.findFirstOrThrow({ where: { productoId: mpId } });
    expect((await eliminarFrecuenciaConteo(fila.id)).ok).toBe(true);
    expect(await prisma.frecuenciaConteoProducto.findUniqueOrThrow({ where: { id: fila.id } })).toMatchObject({ quitadoPorId: adminId, quitadoEn: expect.any(Date) });
    expect(await listarFrecuenciasConteo(sucursalId)).toEqual([]);
    expect((await eliminarFrecuenciaConteo(fila.id)).ok).toBe(false);
    const dos = await Promise.all([setFrecuenciaConteo(mpId, 3), setFrecuenciaConteo(mpId, 3)]);
    expect(dos.every((r) => r.ok)).toBe(true);
    const filas = await prisma.frecuenciaConteoProducto.findMany({ where: { productoId: mpId } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: fila.id, frecuenciaDias: 3, quitadoEn: null, quitadoPorId: null });
  });

  it("frecuencia de conteo: dos «quitar» simultáneos → gana uno", async () => {
    await setFrecuenciaConteo(mpId, 7);
    const { id } = await prisma.frecuenciaConteoProducto.findFirstOrThrow({ where: { productoId: mpId } });
    const resultados = await Promise.all([eliminarFrecuenciaConteo(id), eliminarFrecuenciaConteo(id)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
  });

  it("sección habitual: quitar con rastro, repetir se rechaza, fijar de nuevo reactiva en el mismo lugar", async () => {
    await setSeccionHabitual(pvId, seccionId);
    const fila = await prisma.seccionHabitualProducto.findFirstOrThrow({ where: { productoId: pvId } });
    expect((await eliminarSeccionHabitual(fila.id)).ok).toBe(true);
    expect(await prisma.seccionHabitualProducto.findUniqueOrThrow({ where: { id: fila.id } })).toMatchObject({ quitadoPorId: adminId, quitadoEn: expect.any(Date) });
    expect(await listarSeccionesHabituales(sucursalId)).toEqual([]);
    expect((await eliminarSeccionHabitual(fila.id)).ok).toBe(false);
    await setSeccionHabitual(pvId, seccionId);
    const filas = await prisma.seccionHabitualProducto.findMany({ where: { productoId: pvId } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: fila.id, quitadoEn: null, quitadoPorId: null });
    expect(await listarSeccionesHabituales(sucursalId)).toHaveLength(1);
  });

  it("sección habitual: dos «quitar» simultáneos → gana uno", async () => {
    await setSeccionHabitual(pvId, seccionId);
    const { id } = await prisma.seccionHabitualProducto.findFirstOrThrow({ where: { productoId: pvId } });
    const resultados = await Promise.all([eliminarSeccionHabitual(id), eliminarSeccionHabitual(id)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
  });
});
