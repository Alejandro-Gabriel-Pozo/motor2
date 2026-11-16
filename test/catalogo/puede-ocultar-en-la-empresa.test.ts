import { beforeEach, describe, expect, it } from "vitest";
import { puedeOcultarEnLaEmpresa } from "@/server/acceso/ocultar-en-la-empresa";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";

/**
 * ¿Quién puede ocultar en TODA la empresa? (docs/diseno-ocultar-como-pedernal-2026-11-15.md, O-10 y O-13; la regla pura es `esGerenteOAdministradorConAlcanceTotal`, aquí se prueba su lectura de las sucursales ACTIVAS
 * de la empresa contra Postgres con la RLS real). Gerente (rol de la empresa) o administrador, con membresía en TODAS las sucursales activas; una sucursal dada de baja no cuenta; sin sucursales activas, nadie.
 */
describe("puedeOcultarEnLaEmpresa", () => {
  let sucursalA: string;
  let sucursalB: string;
  const ctx = (membresias: { sucursalId: string; esAdmin: boolean }[], rolEmpresa: string | null) => ({ empresaId: EMPRESA_POR_DEFECTO_ID, db: baseDeTest.db, membresias: membresias as never, rolEmpresa });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalA = (await sembrarBase()).sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  });

  it("administrador con membresía de administración en TODAS las sucursales activas: sí", async () => {
    expect(await puedeOcultarEnLaEmpresa(ctx([{ sucursalId: sucursalA, esAdmin: true }, { sucursalId: sucursalB, esAdmin: true }], null))).toBe(true);
  });

  it("administrador solo de UNA de dos sucursales activas: no (alcance total)", async () => {
    expect(await puedeOcultarEnLaEmpresa(ctx([{ sucursalId: sucursalA, esAdmin: true }, { sucursalId: sucursalB, esAdmin: false }], null))).toBe(false);
    expect(await puedeOcultarEnLaEmpresa(ctx([{ sucursalId: sucursalA, esAdmin: true }], null))).toBe(false);
  });

  it("gerente con membresía en todas (aunque no sea administrador): sí; gerente sin membresía en una: no", async () => {
    expect(await puedeOcultarEnLaEmpresa(ctx([{ sucursalId: sucursalA, esAdmin: false }, { sucursalId: sucursalB, esAdmin: false }], "gerente"))).toBe(true);
    expect(await puedeOcultarEnLaEmpresa(ctx([{ sucursalId: sucursalA, esAdmin: false }], "gerente"))).toBe(false);
  });

  it("el operador (ni gerente ni administrador): no, y un rol de empresa que no es gerente tampoco abre nada", async () => {
    expect(await puedeOcultarEnLaEmpresa(ctx([{ sucursalId: sucursalA, esAdmin: false }, { sucursalId: sucursalB, esAdmin: false }], null))).toBe(false);
    expect(await puedeOcultarEnLaEmpresa(ctx([{ sucursalId: sucursalA, esAdmin: false }, { sucursalId: sucursalB, esAdmin: false }], "otro"))).toBe(false);
  });

  it("una sucursal dada de baja no cuenta para el alcance total; sin ninguna activa, nadie", async () => {
    await prisma.sucursal.update({ where: { id: sucursalB }, data: { activo: false } });
    expect(await puedeOcultarEnLaEmpresa(ctx([{ sucursalId: sucursalA, esAdmin: true }], null))).toBe(true);
    await prisma.sucursal.update({ where: { id: sucursalA }, data: { activo: false } });
    expect(await puedeOcultarEnLaEmpresa(ctx([{ sucursalId: sucursalA, esAdmin: true }], "gerente"))).toBe(false);
  });
});
