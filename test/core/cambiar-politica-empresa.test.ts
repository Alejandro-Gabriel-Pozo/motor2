import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { PoliticaDeEmpresaError } from "../../src/core/features/empresa/cambio-de-politica";
import { cambiarPoliticaDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-politica-de-empresa";
import type { AutorDeCambioDePlataforma } from "../../src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma";

/**
 * Plataforma (add-on C2): `cambiarPoliticaDeEmpresa` contra Postgres real. Corre con el cliente del DUEÑO (`prismaAdmin`): desde S-33 la operación audita en `AuditoriaPlataforma`, que
 * `motor2_app` no puede escribir (solo `motor2_plataforma`); el camino con el rol real se ejercita en `identidad-de-plataforma.test.ts` y en el ensayo O0. Que el actor no sea un
 * `User`, la atomicidad con la auditoría y la forma de la fila los prueba `cambios-de-plataforma-auditoria.test.ts`.
 */
afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.$disconnect();
});

const AUTOR: AutorDeCambioDePlataforma = { adminId: "admin-1", adminEmail: "operador@plataforma.com", instalacionId: "principal", instalacionNombre: "principal" };

async function crearOtraEmpresa() {
  return prismaAdmin.empresa.create({ data: { nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS" } });
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
});

async function politicaGuardada(id: string) {
  return prismaAdmin.empresa.findUniqueOrThrow({ where: { id }, select: { permisosEditables: true, dosPaneles: true } });
}

const auditoria = () => prismaAdmin.auditoriaPlataforma.findMany({ orderBy: { id: "asc" } });

describe("cambiarPoliticaDeEmpresa", () => {
  it("el perfil lite apaga las dos perillas y deja una fila de auditoría de plataforma por cada una, a nombre del administrador", async () => {
    const resultado = await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "principal", perfil: "lite" }, AUTOR);

    expect([...resultado.cambiadas].sort()).toEqual(["dosPaneles", "permisosEditables"]);
    expect(await politicaGuardada(EMPRESA_POR_DEFECTO_ID)).toEqual({ permisosEditables: false, dosPaneles: false });

    const filas = (await auditoria()).sort((a, b) => (a.detalle as { perilla: string }).perilla.localeCompare((b.detalle as { perilla: string }).perilla));
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => [(f.detalle as { perilla: string }).perilla, (f.detalle as { antes: boolean }).antes, (f.detalle as { despues: boolean }).despues])).toEqual([
      ["dosPaneles", true, false],
      ["permisosEditables", true, false],
    ]);
    for (const fila of filas) {
      expect(fila).toMatchObject({ accion: "politica-cambiada", empresaAfectadaId: EMPRESA_POR_DEFECTO_ID, adminId: AUTOR.adminId, adminEmail: AUTOR.adminEmail });
    }
  });

  it("una perilla suelta pisa lo que fija el perfil", async () => {
    await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "principal", perfil: "lite", dosPaneles: true }, AUTOR);
    expect(await politicaGuardada(EMPRESA_POR_DEFECTO_ID)).toEqual({ permisosEditables: false, dosPaneles: true });
  });

  it("una sola perilla cambia solo esa y audita solo esa", async () => {
    const resultado = await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "principal", dosPaneles: false }, AUTOR);
    expect(resultado.cambiadas).toEqual(["dosPaneles"]);
    expect(await politicaGuardada(EMPRESA_POR_DEFECTO_ID)).toEqual({ permisosEditables: true, dosPaneles: false });
    expect(await auditoria()).toHaveLength(1);
  });

  it("pedir lo que ya está así no cambia nada ni ensucia la auditoría", async () => {
    const resultado = await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "principal", perfil: "completo" }, AUTOR);
    expect(resultado.cambiadas).toEqual([]);
    expect(await auditoria()).toHaveLength(0);
  });

  it("no toca a las otras empresas", async () => {
    const otra = await crearOtraEmpresa();
    await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "principal", perfil: "lite" }, AUTOR);
    expect(await politicaGuardada(otra.id)).toEqual({ permisosEditables: true, dosPaneles: true });
  });

  it("la auditoría queda en la empresa que cambió, no en otra", async () => {
    const otra = await crearOtraEmpresa();
    await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "otra", permisosEditables: false }, AUTOR);
    const fila = await prismaAdmin.auditoriaPlataforma.findFirstOrThrow();
    expect(fila.empresaAfectadaId).toBe(otra.id);
  });

  it("sin perfil ni perillas es un error", async () => {
    await expect(cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "principal" }, AUTOR)).rejects.toThrow(PoliticaDeEmpresaError);
  });

  it("un slug que no existe es un error y no escribe nada", async () => {
    await expect(cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "nope", perfil: "lite" }, AUTOR)).rejects.toThrow(/No existe una empresa/);
    expect(await auditoria()).toHaveLength(0);
  });
});
