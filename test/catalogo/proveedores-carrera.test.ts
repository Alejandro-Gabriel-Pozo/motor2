import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Qué hace la escritura simulada ANTES de la real: `"otro-con-el-cuit"` mete OTRO proveedor con el mismo CUIT (la carrera que gana el índice único
 * `(empresaId, cuit)`: la escritura real tira P2002), `"p2002"` tira un P2002 sin que nadie tenga el CUIT (el código autogenerado agotado o un choque que no es
 * del CUIT), `"otro-error"` tira un error que no es de unicidad, `null` no hace nada.
 */
const escenario = vi.hoisted(() => ({ modo: null as "otro-con-el-cuit" | "p2002" | "otro-error" | null }));
const p2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });

vi.mock("../../src/server/persistencia/catalogo/proveedores", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/persistencia/catalogo/proveedores")>();
  const { prisma } = await import("../setup/test-db");
  const antes = async (cuit: string | null) => {
    if (escenario.modo === "p2002") throw p2002();
    if (escenario.modo === "otro-error") throw new Error("se cayó la base");
    if (escenario.modo === "otro-con-el-cuit" && !(await prisma.proveedor.findFirst({ where: { nombre: "Ganador" } }))) {
      await prisma.proveedor.create({ data: { codigo: "PRV_GANADOR", nombre: "Ganador", cuit } });
    }
  };
  return {
    ...original,
    crearProveedorNuevo: async (...args: Parameters<typeof original.crearProveedorNuevo>) => {
      await antes(args[1].valores.cuit);
      return original.crearProveedorNuevo(...args);
    },
    guardarContactoDeProveedor: async (...args: Parameters<typeof original.guardarContactoDeProveedor>) => {
      await antes(args[1].valores.cuit);
      return original.guardarContactoDeProveedor(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProveedor, altaProveedor } from "../../src/server/actions/catalogo/proveedores";

/**
 * El camino de la CARRERA del alta y de la edición de un proveedor (Hito 4, bloque C, paso H4C-14): dos pedidos con el mismo CUIT a la vez pasan los dos el
 * chequeo previo y al segundo lo frena el índice único; el caso de uso atrapa el P2002, vuelve a leer quién tiene el CUIT y lo nombra. Si el choque no es por el
 * CUIT, responde «Colisión generando el código…» (alta) o «el dato choca con otro proveedor» (edición). Ningún test pasaba por ese `catch` (la concurrencia real
 * casi nunca lo alcanza): se simula la carrera reemplazando la escritura de la persistencia (precedente: `test/pos/choque-de-unicidad-del-driver.test.ts`).
 */
describe("proveedores: la carrera del CUIT (el índice único frena al segundo)", () => {
  beforeEach(async () => {
    escenario.modo = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const MENSAJE = "Ya existe un proveedor con ese CUIT («Ganador»). Dos proveedores de una misma empresa no pueden compartir CUIT: revisá que esté bien cargado.";

  it("alta: otro tomó el CUIT entre el chequeo y la escritura → nombra al otro y no crea", async () => {
    escenario.modo = "otro-con-el-cuit";
    expect(await altaProveedor({ nombre: "Perdedor", cuit: "30-70308853-4" })).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await prisma.proveedor.findMany({ select: { nombre: true } })).toEqual([{ nombre: "Ganador" }]);
  });

  it("alta: un choque que no es del CUIT → «Colisión generando el código…»", async () => {
    escenario.modo = "p2002";
    expect(await altaProveedor({ nombre: "Perdedor" })).toEqual({ ok: false, mensaje: "Colisión generando el código del proveedor — reintentá." });
  });

  it("edición: otro tomó el CUIT entre el chequeo y la escritura → nombra al otro; un choque que no es del CUIT → «choca con otro proveedor»", async () => {
    const sur = await prisma.proveedor.create({ data: { codigo: "PRV_SUR", nombre: "Sur" } });
    escenario.modo = "otro-con-el-cuit";
    expect(await actualizarProveedor(sur.id, { cuit: "30-70308853-4" })).toEqual({ ok: false, mensaje: MENSAJE });
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: sur.id } })).cuit).toBeNull();
    escenario.modo = "p2002";
    expect(await actualizarProveedor(sur.id, { contacto: "Ana" })).toEqual({ ok: false, mensaje: "No se pudo guardar: el dato choca con otro proveedor." });
  });

  it("otro error de la escritura no se disfraza de choque: sigue lanzando (alta y edición)", async () => {
    const sur = await prisma.proveedor.create({ data: { codigo: "PRV_SUR", nombre: "Sur" } });
    escenario.modo = "otro-error";
    await expect(altaProveedor({ nombre: "Perdedor" })).rejects.toThrow("se cayó la base");
    await expect(actualizarProveedor(sur.id, { contacto: "Ana" })).rejects.toThrow("se cayó la base");
  });
});
