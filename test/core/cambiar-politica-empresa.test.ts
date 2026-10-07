import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { PoliticaDeEmpresaError } from "../../src/core/features/empresa/cambio-de-politica";
import { cambiarPoliticaDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-politica-de-empresa";

/** Plataforma (add-on C2): `cambiarPoliticaDeEmpresa` contra Postgres real, como `motor2_app` (`prisma`); las verificaciones van como dueño. */
afterAll(() => prismaAdmin.$disconnect());

const ACTOR = "operador@plataforma.com";

async function crearOtraEmpresa() {
  return prismaAdmin.empresa.create({ data: { nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS" } });
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.user.create({ data: { email: ACTOR } });
});

async function politicaGuardada(id: string) {
  return prismaAdmin.empresa.findUniqueOrThrow({ where: { id }, select: { permisosEditables: true, dosPaneles: true } });
}

describe("cambiarPoliticaDeEmpresa", () => {
  it("el perfil lite apaga las dos perillas y deja una fila de auditoría por cada una, a nombre del operador", async () => {
    const resultado = await cambiarPoliticaDeEmpresa(prisma, { slug: "principal", actorEmail: ACTOR, perfil: "lite" });

    expect([...resultado.cambiadas].sort()).toEqual(["dosPaneles", "permisosEditables"]);
    expect(await politicaGuardada(EMPRESA_POR_DEFECTO_ID)).toEqual({ permisosEditables: false, dosPaneles: false });

    const actor = await prismaAdmin.user.findUniqueOrThrow({ where: { email: ACTOR } });
    const filas = await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Empresa" }, orderBy: { campo: "asc" } });
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
      ["dosPaneles", "true", "false"],
      ["permisosEditables", "true", "false"],
    ]);
    for (const fila of filas) {
      expect(fila).toMatchObject({ entidadId: EMPRESA_POR_DEFECTO_ID, actorId: actor.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: null });
    }
  });

  it("una perilla suelta pisa lo que fija el perfil", async () => {
    await cambiarPoliticaDeEmpresa(prisma, { slug: "principal", actorEmail: ACTOR, perfil: "lite", dosPaneles: true });
    expect(await politicaGuardada(EMPRESA_POR_DEFECTO_ID)).toEqual({ permisosEditables: false, dosPaneles: true });
  });

  it("una sola perilla cambia solo esa y audita solo esa", async () => {
    const resultado = await cambiarPoliticaDeEmpresa(prisma, { slug: "principal", actorEmail: ACTOR, dosPaneles: false });
    expect(resultado.cambiadas).toEqual(["dosPaneles"]);
    expect(await politicaGuardada(EMPRESA_POR_DEFECTO_ID)).toEqual({ permisosEditables: true, dosPaneles: false });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Empresa" } })).toBe(1);
  });

  it("pedir lo que ya está así no cambia nada ni ensucia la auditoría", async () => {
    const resultado = await cambiarPoliticaDeEmpresa(prisma, { slug: "principal", actorEmail: ACTOR, perfil: "completo" });
    expect(resultado.cambiadas).toEqual([]);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Empresa" } })).toBe(0);
  });

  it("el email del operador se normaliza (mayúsculas y espacios)", async () => {
    await cambiarPoliticaDeEmpresa(prisma, { slug: "principal", actorEmail: `  ${ACTOR.toUpperCase()} `, dosPaneles: false });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Empresa" } })).toBe(1);
  });

  it("no toca a las otras empresas", async () => {
    const otra = await crearOtraEmpresa();
    await cambiarPoliticaDeEmpresa(prisma, { slug: "principal", actorEmail: ACTOR, perfil: "lite" });
    expect(await politicaGuardada(otra.id)).toEqual({ permisosEditables: true, dosPaneles: true });
  });

  it("la auditoría queda en la empresa que cambió, no en otra", async () => {
    const otra = await crearOtraEmpresa();
    await cambiarPoliticaDeEmpresa(prisma, { slug: "otra", actorEmail: ACTOR, permisosEditables: false });
    const fila = await prismaAdmin.registroAuditoria.findFirstOrThrow({ where: { entidad: "Empresa" } });
    expect(fila.empresaId).toBe(otra.id);
    expect(fila.entidadId).toBe(otra.id);
  });

  it("sin perfil ni perillas es un error", async () => {
    await expect(cambiarPoliticaDeEmpresa(prisma, { slug: "principal", actorEmail: ACTOR })).rejects.toThrow(PoliticaDeEmpresaError);
  });

  it("un slug que no existe es un error y no escribe nada", async () => {
    await expect(cambiarPoliticaDeEmpresa(prisma, { slug: "nope", actorEmail: ACTOR, perfil: "lite" })).rejects.toThrow(/No existe una empresa/);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Empresa" } })).toBe(0);
  });

  it("un operador que no existe es un error y no cambia la política", async () => {
    await expect(cambiarPoliticaDeEmpresa(prisma, { slug: "principal", actorEmail: "fantasma@x.com", perfil: "lite" })).rejects.toThrow(/No existe un usuario/);
    expect(await politicaGuardada(EMPRESA_POR_DEFECTO_ID)).toEqual({ permisosEditables: true, dosPaneles: true });
  });
});
