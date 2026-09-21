import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
const reportarError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/reportar-error", () => ({ reportarError, reportarErrorUnaVez: vi.fn(async () => {}) }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto, darDeAltaProductoRapido, actualizarProducto } from "../../src/server/actions/catalogo/productos";
import { leerMemoriaAltaProducto } from "../../src/core/catalogo/memoria-alta-producto-almacen";

/** E4: qué acciones escriben la memoria de los últimos valores del alta, y qué NO se recuerda nunca. */
describe("memoria del alta de producto — acciones", () => {
  let kgId: string;
  let gId: string;
  let categoriaId: string;
  let insumoId: string;
  let adminId: string;
  let otroId: string;

  beforeEach(async () => {
    reportarError.mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    insumoId = catalogo.insumo.id;
    categoriaId = catalogo.categoria.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    otroId = (await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
  });

  it("un alta exitosa recuerda EXACTAMENTE los cinco campos, y nada que identifique al producto ni dinero", async () => {
    const r = await darDeAltaProducto({
      nombre: "Harina 000",
      codigo: "MP_HARINA",
      tipo: "MP",
      categoriaId,
      unidadStockId: kgId,
      unidadCompraId: gId,
      factorConversion: 25,
      insumoId,
      precioVenta: 999,
      seProduce: true,
      observaciones: "una observación",
    });
    expect(r.ok).toBe(true);

    const m = await leerMemoriaAltaProducto(adminId);
    expect(m).toEqual({ v: 1, tipo: "MP", categoriaId, unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25 });
    // Contraespejo: nada de lo que identifica al producto o mueve plata pasó a la memoria.
    const guardado = JSON.stringify((await prisma.preferenciaUsuario.findFirstOrThrow({ where: { usuarioId: adminId } })).valor);
    for (const prohibido of ["Harina 000", "MP_HARINA", "999", "observación", insumoId, "seProduce", "precioVenta", "insumoId", "nombre", "codigo"]) {
      expect(guardado).not.toContain(prohibido);
    }
  });

  it("un alta que falla la validación NO guarda nada", async () => {
    const r = await darDeAltaProducto({ nombre: "", tipo: "MP", categoriaId, unidadStockId: kgId, factorConversion: 1 });
    expect(r.ok).toBe(false);
    expect(await leerMemoriaAltaProducto(adminId)).toBeNull();
  });

  it("un alta rechazada por nombre duplicado NO pisa la memoria anterior", async () => {
    await darDeAltaProducto({ nombre: "Azúcar", tipo: "MP", categoriaId, unidadStockId: kgId, factorConversion: 1 });
    const antes = await leerMemoriaAltaProducto(adminId);
    const r = await darDeAltaProducto({ nombre: "AZÚCAR", tipo: "PV", unidadStockId: gId, factorConversion: 7 });
    expect(r.ok).toBe(false);
    expect(await leerMemoriaAltaProducto(adminId)).toEqual(antes);
  });

  it("el último alta reemplaza a la memoria anterior (una sola fila por usuario)", async () => {
    await darDeAltaProducto({ nombre: "Uno", tipo: "MP", categoriaId, unidadStockId: kgId, factorConversion: 1 });
    await darDeAltaProducto({ nombre: "Dos", tipo: "PV", unidadStockId: gId, factorConversion: 1 });
    expect(await leerMemoriaAltaProducto(adminId)).toMatchObject({ tipo: "PV", categoriaId: null, unidadStockId: gId });
    expect(await prisma.preferenciaUsuario.count({ where: { usuarioId: adminId } })).toBe(1);
  });

  it("es por usuario: el alta de uno no le cambia la memoria a otro", async () => {
    await darDeAltaProducto({ nombre: "Del admin", tipo: "MP", categoriaId, unidadStockId: kgId, factorConversion: 1 });
    expect(await leerMemoriaAltaProducto(otroId)).toBeNull();
    await mockearUsuarioActual({ id: otroId, email: "otro@test.com", nombre: null });
    await darDeAltaProducto({ nombre: "Del otro", tipo: "PV", unidadStockId: gId, factorConversion: 1 });
    expect((await leerMemoriaAltaProducto(adminId))?.tipo).toBe("MP");
    expect((await leerMemoriaAltaProducto(otroId))?.tipo).toBe("PV");
  });

  it("el alta rápida del wizard de Compra NO escribe memoria (crea con valores fijos que el usuario no eligió)", async () => {
    const r = await darDeAltaProductoRapido("Levadura fresca", kgId);
    expect(r.ok).toBe(true);
    expect(await leerMemoriaAltaProducto(adminId)).toBeNull();
    expect(await prisma.preferenciaUsuario.count()).toBe(0);
  });

  it("el alta rápida tampoco pisa una memoria que ya existía", async () => {
    await darDeAltaProducto({ nombre: "Uno", tipo: "PV", unidadStockId: gId, factorConversion: 1 });
    const antes = await leerMemoriaAltaProducto(adminId);
    await darDeAltaProductoRapido("Levadura fresca", kgId);
    expect(await leerMemoriaAltaProducto(adminId)).toEqual(antes);
  });

  it("editar un producto NO escribe memoria", async () => {
    const creado = await darDeAltaProductoRapido("A editar", kgId);
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    const r = await actualizarProducto(creado.id, { nombre: "A editar", tipo: "MP", categoriaId, unidadStockId: kgId, unidadCompraId: gId, factorConversion: 4 });
    expect(r.ok).toBe(true);
    expect(await prisma.preferenciaUsuario.count()).toBe(0);
  });

  it("si la memoria falla al guardarse, el alta IGUAL se crea y devuelve ok (best-effort)", async () => {
    const espia = vi.spyOn(prisma.preferenciaUsuario, "upsert").mockRejectedValueOnce(new Error("la base de preferencias se cayó"));
    try {
      const r = await darDeAltaProducto({ nombre: "Sobrevive", tipo: "MP", categoriaId, unidadStockId: kgId, factorConversion: 1 });
      expect(r.ok).toBe(true);
      expect(await prisma.producto.count({ where: { nombre: "Sobrevive" } })).toBe(1);
      expect(reportarError).toHaveBeenCalledWith(expect.any(Error), "memoria-alta-producto-guardar");
    } finally {
      espia.mockRestore();
    }
  });
});
