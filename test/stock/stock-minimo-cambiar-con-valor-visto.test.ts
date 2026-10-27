import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { setStockMinimoProducto } from "../../src/server/actions/stock/stock-minimo";

/**
 * Fase 7, DEC-27: el atajo «Cambiar mínimo» (y la edición de una fila en Configuración › Stock mínimo) manda el mínimo que la persona VIO. I8 del diseño (`docs/diseno-modulo-stock-2026-10-27.md` §5 y §7):
 * no pisa en silencio un cambio ajeno; el mismo pedido repetido es éxito sin cambio; la escritura y su auditoría van juntas. Contra Postgres real, por la Server Action (permiso en el servidor incluido).
 */
describe("cambiar el stock mínimo con el valor visto", () => {
  let sucursalId: string;
  let seccionId: string;
  let mpId: string;
  let admin: { id: string; email: string };
  let operador: { id: string; email: string };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Cocina")).id;
    admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Leche", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    // Mínimos de partida: 10 global y 4 en Cocina (por el camino de siempre).
    expect((await setStockMinimoProducto(mpId, 10)).ok).toBe(true);
    expect((await setStockMinimoProducto(mpId, 4, seccionId)).ok).toBe(true);
  });

  const global = async () => Number((await prisma.stockMinimoProducto.findFirstOrThrow({ where: { seccionId: null } })).minimo);
  const deCocina = async () => Number((await prisma.stockMinimoProducto.findFirstOrThrow({ where: { seccionId } })).minimo);
  /** Las filas de auditoría del mínimo DESPUÉS de las dos altas de partida. */
  const cambiosAuditados = async () =>
    (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "StockMinimoProducto" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).slice(2).map((r) => [r.descripcion, r.valorAnterior, r.valorNuevo]);

  it("si sigue como se vio, cambia y deja UNA fila de auditoría (global y de un depósito)", async () => {
    const r = await setStockMinimoProducto(mpId, 12, null, 10);
    expect(r).toMatchObject({ ok: true, mensaje: 'Stock mínimo de "Leche" (global) actualizado: 12.' });
    expect((await setStockMinimoProducto(mpId, 2.5, seccionId, 4)).ok).toBe(true);
    expect([await global(), await deCocina()]).toEqual([12, 2.5]);
    expect(await cambiosAuditados()).toEqual([
      ['Stock mínimo de "Leche" (global)', "10", "12"],
      ['Stock mínimo de "Leche" en "Cocina"', "4", "2.5"],
    ]);
  });

  it("repetición (doble clic): el segundo pedido encuentra el valor pedido y es éxito SIN escribir ni auditar otra vez", async () => {
    expect((await setStockMinimoProducto(mpId, 12, null, 10)).ok).toBe(true);
    expect((await setStockMinimoProducto(mpId, 12, null, 10)).ok).toBe(true);
    expect(await global()).toBe(12);
    expect(await cambiosAuditados()).toHaveLength(1);
  });

  it("cambio ajeno: si otra persona ya lo cambió, no se guarda nada y se dice cuánto es ahora", async () => {
    expect((await setStockMinimoProducto(mpId, 7, null, 10)).ok).toBe(true); // la otra persona
    const r = await setStockMinimoProducto(mpId, 15, null, 10); // vio 10, ahora es 7
    expect(r).toMatchObject({ ok: false, mensaje: 'Stock mínimo de "Leche" (global) cambió mientras lo editabas: ahora es 7. No se guardó nada: revisalo y volvé a guardar.' });
    expect(await global()).toBe(7);
    expect(await cambiosAuditados()).toEqual([['Stock mínimo de "Leche" (global)', "10", "7"]]);
  });

  it("si la fila se borró mientras tanto, tampoco la vuelve a crear: «ahora es sin cargar»", async () => {
    await prisma.stockMinimoProducto.deleteMany({ where: { seccionId } });
    const r = await setStockMinimoProducto(mpId, 6, seccionId, 4);
    expect(r).toMatchObject({ ok: false });
    expect(r.mensaje).toContain("ahora es sin cargar");
    expect(await prisma.stockMinimoProducto.count({ where: { seccionId } })).toBe(0);
  });

  it("sin el valor visto, el alta/cambio de siempre (upsert) no cambia", async () => {
    expect((await setStockMinimoProducto(mpId, 99)).ok).toBe(true);
    expect(await global()).toBe(99);
  });

  it("permiso en el servidor: el operador (sin «Editar» de stock_minimo) no cambia nada aunque mande el valor visto", async () => {
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    expect((await setStockMinimoProducto(mpId, 12, null, 10)).ok).toBe(false);
    expect(await global()).toBe(10);
    expect(await cambiosAuditados()).toEqual([]);
  });

  it("aislamiento: un depósito de OTRA sucursal no se encuentra (no se cambia su mínimo desde esta)", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const depositoAjeno = await sembrarSeccion(otra.id, "Barra Norte");
    await prisma.stockMinimoProducto.create({ data: { sucursalId: otra.id, productoId: mpId, seccionId: depositoAjeno.id, minimo: 3 } });
    expect(await setStockMinimoProducto(mpId, 8, depositoAjeno.id, 3)).toMatchObject({ ok: false, mensaje: "No se encontró la sección." });
    expect(Number((await prismaAdmin.stockMinimoProducto.findFirstOrThrow({ where: { seccionId: depositoAjeno.id } })).minimo)).toBe(3);
  });

  it("valor visto inválido: se rechaza antes de tocar la base", async () => {
    expect(await setStockMinimoProducto(mpId, 12, null, -1)).toMatchObject({ ok: false, mensaje: "El mínimo que estabas viendo no es válido: volvé a abrir el editor." });
    expect(await setStockMinimoProducto(mpId, 12, null, Number.NaN)).toMatchObject({ ok: false });
    expect(await global()).toBe(10);
  });

  it("concurrencia real: dos personas que vieron 10 guardan a la vez valores distintos → gana UNA, la otra recibe «cambió», una sola auditoría", async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
      const visto = await global();
      const [a, b] = await Promise.all([setStockMinimoProducto(mpId, visto + 1, null, visto), setStockMinimoProducto(mpId, visto + 2, null, visto)]);
      const ganadores = [a, b].filter((r) => r.ok);
      expect(ganadores, `ronda ${ronda}`).toHaveLength(1);
      const perdedor = a.ok ? b : a;
      expect(perdedor.mensaje, `ronda ${ronda}`).toContain("cambió mientras lo editabas");
      expect(await global(), `ronda ${ronda}`).toBe(a.ok ? visto + 1 : visto + 2);
    }
    expect(await cambiosAuditados()).toHaveLength(5);
  });

  it("concurrencia real: dos pedidos IGUALES a la vez (doble clic) → los dos son éxito y queda UNA sola auditoría", async () => {
    const [a, b] = await Promise.all([setStockMinimoProducto(mpId, 3, seccionId, 4), setStockMinimoProducto(mpId, 3, seccionId, 4)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await deCocina()).toBe(3);
    expect(await cambiosAuditados()).toHaveLength(1);
  });
});
