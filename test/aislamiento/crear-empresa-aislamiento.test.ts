import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { crearEmpresa } from "../../src/core/features/empresa/crear-empresa";
import { dbDeEmpresa } from "../../src/core/auth/base";

/**
 * ADR-007, A7: una empresa creada por `crearEmpresa` queda aislada de la que ya existía (RLS, el código corre como `motor2_app`).
 * Mutación: deshabilitar el RLS de `Unidad`/`Rol`/`Sucursal` (o crear la empresa con datos de la otra) pone estos tests en rojo.
 */
afterAll(() => prismaAdmin.$disconnect());

const A = EMPRESA_POR_DEFECTO_ID;

let B: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.unidad.createMany({ data: [{ empresaId: A, nombre: "kg-a", magnitud: "PESO" }, { empresaId: A, nombre: "kg", magnitud: "PESO" }] });
  await prismaAdmin.sucursal.create({ data: { empresaId: A, nombre: "Sucursal A" } });
  await prismaAdmin.rol.create({ data: { empresaId: A, nombre: "admin" } });
  ({ empresaId: B } = await crearEmpresa(prisma, {
    nombre: "Pizzería Norte",
    slug: "norte",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    moneda: "ARS",
    emailPrimerAdmin: "gerente@norte.com",
  }));
});

describe("la empresa creada no ve ni pisa a la existente", () => {
  it("cada una ve solo sus unidades, sucursales y roles", async () => {
    const dbA = dbDeEmpresa(A);
    const dbB = dbDeEmpresa(B);
    expect((await dbA.unidad.findMany()).map((u) => u.nombre).sort()).toEqual(["kg", "kg-a"]);
    expect((await dbB.unidad.findMany()).map((u) => u.nombre).sort()).toEqual(["g", "kg", "l", "ml", "unidad"]);
    expect((await dbA.sucursal.findMany()).map((s) => s.nombre)).toEqual(["Sucursal A"]);
    expect((await dbB.sucursal.findMany()).map((s) => s.nombre)).toEqual(["Central"]);
    expect(await dbA.rol.count()).toBe(1);
    expect(await dbB.rol.count()).toBe(2);
    // Ni siquiera por id: la fila de la otra empresa no existe para este contexto.
    const sucursalDeA = await prismaAdmin.sucursal.findFirstOrThrow({ where: { empresaId: A } });
    expect(await dbB.sucursal.findUnique({ where: { id: sucursalDeA.id } })).toBeNull();
  });

  it("los datos de la existente quedaron intactos y sin permisos ni roles de la nueva", async () => {
    expect(await prismaAdmin.unidad.count({ where: { empresaId: A } })).toBe(2);
    expect(await prismaAdmin.rol.count({ where: { empresaId: A } })).toBe(1);
    expect(await prismaAdmin.permisoRol.count({ where: { empresaId: A } })).toBe(0);
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { empresaId: A } })).toBe(0);
  });

  it("«kg» existe en las dos empresas (unicidad por empresa) y modificar la de B no toca la de A", async () => {
    await dbDeEmpresa(B).unidad.updateMany({ where: { nombre: "kg" }, data: { decimales: 5 } });
    expect((await prismaAdmin.unidad.findFirstOrThrow({ where: { empresaId: A, nombre: "kg" } })).decimales).not.toBe(5);
    expect((await prismaAdmin.unidad.findFirstOrThrow({ where: { empresaId: B, nombre: "kg" } })).decimales).toBe(5);
  });

  it("con las dos ACTIVE, desde una no se puede escribir en la otra", async () => {
    await expect(dbDeEmpresa(A).unidad.create({ data: { empresaId: B, nombre: "intruso", magnitud: "PESO" } })).rejects.toThrow();
    expect(await prismaAdmin.unidad.count({ where: { nombre: "intruso" } })).toBe(0);
  });
});
