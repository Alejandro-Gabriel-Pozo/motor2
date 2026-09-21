import { beforeEach, describe, expect, it, vi } from "vitest";

const reportarError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/reportar-error", () => ({ reportarError, reportarErrorUnaVez: vi.fn(async () => {}) }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { borrarMemoriaAltaProducto, guardarMemoriaAltaProducto, leerMemoriaAltaProducto } from "../../src/core/catalogo/memoria-alta-producto-almacen";
import type { MemoriaAltaProducto } from "../../src/core/catalogo/memoria-alta-producto";

const memoria: MemoriaAltaProducto = { v: 1, tipo: "MP", categoriaId: "cat1", unidadStockId: "kg", unidadCompraId: "bolsa", factorConversion: 25 };

describe("almacén de la memoria del alta de producto (contra Postgres real)", () => {
  let ana: string;
  let beto: string;

  beforeEach(async () => {
    reportarError.mockClear();
    await limpiarBaseDeTest();
    const { sucursal, admin } = await sembrarBase();
    ana = (await crearUsuarioConMembresia({ email: "ana@test.local", sucursalId: sucursal.id, rolId: admin.id })).id;
    beto = (await crearUsuarioConMembresia({ email: "beto@test.local", sucursalId: sucursal.id, rolId: admin.id })).id;
  });

  it("sin nada guardado, no hay memoria", async () => {
    expect(await leerMemoriaAltaProducto(ana)).toBeNull();
  });

  it("guarda y lee lo mismo que se guardó", async () => {
    await guardarMemoriaAltaProducto(ana, memoria);
    expect(await leerMemoriaAltaProducto(ana)).toEqual(memoria);
  });

  it("guardar de nuevo REEMPLAZA (una sola fila por usuario), no acumula", async () => {
    await guardarMemoriaAltaProducto(ana, memoria);
    await guardarMemoriaAltaProducto(ana, { ...memoria, tipo: "PV", categoriaId: null });
    expect(await leerMemoriaAltaProducto(ana)).toEqual({ ...memoria, tipo: "PV", categoriaId: null });
    expect(await prisma.preferenciaUsuario.count({ where: { usuarioId: ana } })).toBe(1);
  });

  it("es POR USUARIO: la memoria de uno no se ve ni se pisa con la de otro", async () => {
    await guardarMemoriaAltaProducto(ana, memoria);
    expect(await leerMemoriaAltaProducto(beto)).toBeNull();
    await guardarMemoriaAltaProducto(beto, { ...memoria, categoriaId: "otra" });
    expect((await leerMemoriaAltaProducto(ana))?.categoriaId).toBe("cat1");
    expect((await leerMemoriaAltaProducto(beto))?.categoriaId).toBe("otra");
  });

  it("borrar olvida SOLO la del usuario indicado, y no falla si no había nada", async () => {
    await guardarMemoriaAltaProducto(ana, memoria);
    await guardarMemoriaAltaProducto(beto, memoria);
    await borrarMemoriaAltaProducto(ana);
    expect(await leerMemoriaAltaProducto(ana)).toBeNull();
    expect(await leerMemoriaAltaProducto(beto)).toEqual(memoria);
    await expect(borrarMemoriaAltaProducto(ana)).resolves.toBeUndefined();
  });

  it("una fila con contenido corrupto se lee como «sin memoria», sin lanzar", async () => {
    await prisma.preferenciaUsuario.create({ data: { usuarioId: ana, clave: "alta_producto", valor: { v: 99, cualquier: "cosa" } } });
    expect(await leerMemoriaAltaProducto(ana)).toBeNull();
    await prisma.preferenciaUsuario.update({ where: { usuarioId_clave: { usuarioId: ana, clave: "alta_producto" } }, data: { valor: "texto suelto" } });
    expect(await leerMemoriaAltaProducto(ana)).toBeNull();
  });

  it("leer y guardar son best-effort: si la base falla, no lanzan", async () => {
    const dbRota = { preferenciaUsuario: { findUnique: () => Promise.reject(new Error("caída")), upsert: () => Promise.reject(new Error("caída")) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(leerMemoriaAltaProducto(ana, dbRota as any)).resolves.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(guardarMemoriaAltaProducto(ana, memoria, dbRota as any)).resolves.toBeUndefined();
    // No se traga en silencio: cada fallo se reporta con su área.
    expect(reportarError).toHaveBeenCalledTimes(2);
    expect(reportarError).toHaveBeenCalledWith(expect.any(Error), "memoria-alta-producto-leer");
    expect(reportarError).toHaveBeenCalledWith(expect.any(Error), "memoria-alta-producto-guardar");
  });

  it("se borra junto con el usuario (cascade)", async () => {
    await guardarMemoriaAltaProducto(ana, memoria);
    await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: ana } });
    await prisma.user.delete({ where: { id: ana } });
    expect(await prisma.preferenciaUsuario.count({ where: { usuarioId: ana } })).toBe(0);
  });
});
