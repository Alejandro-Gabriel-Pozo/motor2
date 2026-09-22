import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { setFrecuenciaConteo, eliminarFrecuenciaConteo, listarFrecuenciasConteo } from "../../src/server/actions/stock/frecuencia-conteo";

describe("Frecuencia de conteo (server actions)", () => {
  let sucursalId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Sal", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } });
    mpId = mp.id;
  });

  it("sin ninguna fila cargada, listarFrecuenciasConteo da vacío", async () => {
    expect(await listarFrecuenciasConteo(sucursalId)).toEqual([]);
  });

  it("fija una frecuencia y la lista", async () => {
    const r = await setFrecuenciaConteo(mpId, 7);
    expect(r.ok).toBe(true);
    const filas = await listarFrecuenciasConteo(sucursalId);
    expect(filas).toHaveLength(1);
    expect(filas[0].frecuenciaDias).toBe(7);
    expect(filas[0].producto.nombre).toBe("Sal");
  });

  it("volver a fijar la frecuencia del mismo producto actualiza la fila existente, no crea una segunda", async () => {
    await setFrecuenciaConteo(mpId, 7);
    await setFrecuenciaConteo(mpId, 14);
    const filas = await listarFrecuenciasConteo(sucursalId);
    expect(filas).toHaveLength(1);
    expect(filas[0].frecuenciaDias).toBe(14);
  });

  it("frecuenciaDias 0 desactiva sin borrar la fila", async () => {
    await setFrecuenciaConteo(mpId, 7);
    const r = await setFrecuenciaConteo(mpId, 0);
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain("desactivada");
    const filas = await listarFrecuenciasConteo(sucursalId);
    expect(filas).toHaveLength(1);
    expect(filas[0].frecuenciaDias).toBe(0);
  });

  it("rechaza una frecuencia negativa o no entera", async () => {
    expect((await setFrecuenciaConteo(mpId, -1)).ok).toBe(false);
    expect((await setFrecuenciaConteo(mpId, 3.5)).ok).toBe(false);
    expect(await listarFrecuenciasConteo(sucursalId)).toEqual([]);
  });

  it("elimina una fila", async () => {
    await setFrecuenciaConteo(mpId, 7);
    const [fila] = await listarFrecuenciasConteo(sucursalId);
    const r = await eliminarFrecuenciaConteo(fila.id);
    expect(r.ok).toBe(true);
    expect(await listarFrecuenciasConteo(sucursalId)).toEqual([]);
  });
});
