import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { MENSAJE_PERMISOS_DE_PLATAFORMA, PERFILES_DE_POLITICA, politicaDeEmpresa } from "../../src/core/permisos/politica-de-empresa";

afterAll(() => prismaAdmin.$disconnect());
beforeEach(limpiarBaseDeTest);

describe("politicaDeEmpresa (lee la política guardada en Empresa)", () => {
  it("una empresa sin tocar es «completa»: permisos editables y menú en dos paneles", async () => {
    expect(await politicaDeEmpresa(EMPRESA_POR_DEFECTO_ID, prisma)).toEqual({ permisosEditables: true, dosPaneles: true });
  });

  it("refleja permisosEditables en false sin tocar dosPaneles", async () => {
    await prismaAdmin.empresa.update({ where: { id: EMPRESA_POR_DEFECTO_ID }, data: { permisosEditables: false } });
    expect(await politicaDeEmpresa(EMPRESA_POR_DEFECTO_ID, prisma)).toEqual({ permisosEditables: false, dosPaneles: true });
  });

  it("refleja dosPaneles en false sin tocar permisosEditables", async () => {
    await prismaAdmin.empresa.update({ where: { id: EMPRESA_POR_DEFECTO_ID }, data: { dosPaneles: false } });
    expect(await politicaDeEmpresa(EMPRESA_POR_DEFECTO_ID, prisma)).toEqual({ permisosEditables: true, dosPaneles: false });
  });

  it("cada empresa tiene la suya: cambiar una no mueve a las otras", async () => {
    const otra = await prismaAdmin.empresa.create({
      data: { nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", permisosEditables: false, dosPaneles: false },
    });
    expect(await politicaDeEmpresa(otra.id, prisma)).toEqual({ permisosEditables: false, dosPaneles: false });
    expect(await politicaDeEmpresa(EMPRESA_POR_DEFECTO_ID, prisma)).toEqual({ permisosEditables: true, dosPaneles: true });
  });

  it("una empresa que no existe es un error, no una política por omisión", async () => {
    await expect(politicaDeEmpresa("no-existe", prisma)).rejects.toThrow(/no existe la empresa/);
  });

  it("los planes fijan las dos perillas: completo todo activo, lite ninguna", () => {
    expect(PERFILES_DE_POLITICA.completo).toEqual({ permisosEditables: true, dosPaneles: true });
    expect(PERFILES_DE_POLITICA.lite).toEqual({ permisosEditables: false, dosPaneles: false });
  });

  it("el mensaje de rechazo le explica a la empresa quién administra sus permisos", () => {
    expect(MENSAJE_PERMISOS_DE_PLATAFORMA).toMatch(/plataforma/);
  });
});
