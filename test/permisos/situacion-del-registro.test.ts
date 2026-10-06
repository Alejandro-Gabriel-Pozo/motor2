import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { activarTodosLosModulos, fijarModulosActivos } from "../setup/modulos";
import { situacionDelRegistroDeModulos } from "../../src/server/acceso/modulos-de-empresa";

/** P8: el aviso del shell distingue una empresa sin ninguna fila (SIN_REGISTRO) de una con filas pero sin vendible disponible. */
const situacion = () => situacionDelRegistroDeModulos(EMPRESA_POR_DEFECTO_ID, prisma);

describe("situacionDelRegistroDeModulos", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("sin ninguna fila: SIN_REGISTRO", async () => {
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, []);
    expect(await situacion()).toBe("SIN_REGISTRO");
  });

  it("con filas pero todas INACTIVO: SIN_VENDIBLE_ACTIVO", async () => {
    await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
    await prismaAdmin.moduloEmpresa.updateMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID }, data: { estado: "INACTIVO" } });
    expect(await situacion()).toBe("SIN_VENDIBLE_ACTIVO");
  });

  it("solo una fila con un módulo que no existe en el catálogo: SIN_VENDIBLE_ACTIVO (no cuenta)", async () => {
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["inventado"]);
    expect(await situacion()).toBe("SIN_VENDIBLE_ACTIVO");
  });

  it("con solo Consignación: CON_MODULOS", async () => {
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["consignacion"]);
    expect(await situacion()).toBe("CON_MODULOS");
  });

  it("con todos los módulos: CON_MODULOS", async () => {
    await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
    expect(await situacion()).toBe("CON_MODULOS");
  });
});
