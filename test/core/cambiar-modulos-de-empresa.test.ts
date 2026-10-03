import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { cambiarModulosDeEmpresa, ModulosDeEmpresaError } from "../../src/core/features/empresa/cambiar-modulos-de-empresa";

/**
 * Bloque 5A, P9: `cambiarModulosDeEmpresa` contra Postgres real. `motor2_app` no puede escribir `ModuloEmpresa`, así que acá la función corre con el
 * cliente del DUEÑO (`prismaAdmin`), que sí puede; el camino con el rol `motor2_plataforma` (el real) se ejercita solo si la base de test lo tiene
 * (`PLATAFORMA_DATABASE_URL`), y siempre en el ensayo O0.
 */
const ACTOR = "operador@plataforma.com";
const NORTE = "norte";

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.user.create({ data: { email: ACTOR } });
  await prismaAdmin.empresa.create({ data: { id: NORTE, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
  await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId: NORTE } });
});

const registro = async (empresaId = NORTE) =>
  Object.fromEntries((await prismaAdmin.moduloEmpresa.findMany({ where: { empresaId }, orderBy: { modulo: "asc" } })).map((f) => [f.modulo, f.estado]));
const auditoria = () => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "ModuloEmpresa" }, orderBy: [{ entidadId: "asc" }, { creadoEn: "asc" }] });

describe("cambiarModulosDeEmpresa", () => {
  it("activar un módulo crea su fila, calcula con qué cuenta la empresa y deja la auditoría a nombre del operador", async () => {
    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["stock"] });

    expect(r.cambiados).toEqual([{ modulo: "stock", antes: null, despues: "ACTIVO" }]);
    expect(r.activos).toEqual(["stock"]);
    expect(r.efectivos).toEqual(["administracion", "catalogo_basico", "stock"]);
    expect(await registro()).toEqual({ stock: "ACTIVO" });

    const actor = await prismaAdmin.user.findUniqueOrThrow({ where: { email: ACTOR } });
    const filas = await auditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entidadId: `${NORTE}:stock`, campo: "estado", valorAnterior: null, valorNuevo: "ACTIVO", actorId: actor.id, empresaId: NORTE, sucursalId: null });
    expect(filas[0].descripcion).toContain("Norte");
    expect(filas[0].descripcion).toContain("Stock");
  });

  it("activar un módulo que requiere otros NO les crea fila: quedan incluidos por la clausura", async () => {
    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["salon"] });
    expect(await registro()).toEqual({ salon: "ACTIVO" });
    expect(r.efectivos).toEqual(expect.arrayContaining(["administracion", "salon", "stock", "clientes_basico", "catalogo_basico"]));
  });

  it("desactivar deja la fila en INACTIVO (nunca se borra) y audita el cambio", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["stock", "carta"] });
    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, desactivar: ["carta"] });

    expect(r.cambiados).toEqual([{ modulo: "carta", antes: "ACTIVO", despues: "INACTIVO" }]);
    expect(r.activos).toEqual(["stock"]);
    expect(await registro()).toEqual({ carta: "INACTIVO", stock: "ACTIVO" });
    const deCarta = (await auditoria()).filter((f) => f.entidadId === `${NORTE}:carta`);
    expect(deCarta.map((f) => [f.valorAnterior, f.valorNuevo])).toEqual([[null, "ACTIVO"], ["ACTIVO", "INACTIVO"]]);
  });

  it("volver a activar un módulo INACTIVO reutiliza su fila", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["carta"] });
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, desactivar: ["carta"] });
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["carta"] });
    expect(await registro()).toEqual({ carta: "ACTIVO" });
    expect(await prismaAdmin.moduloEmpresa.count({ where: { empresaId: NORTE } })).toBe(1);
  });

  it("pedir lo que ya está así (o desactivar lo que no tiene fila) no cambia nada ni ensucia la auditoría", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["stock"] });
    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["stock"], desactivar: ["carta"] });
    expect(r.cambiados).toEqual([]);
    expect(await registro()).toEqual({ stock: "ACTIVO" });
    expect(await auditoria()).toHaveLength(1);
  });

  it("no se desactiva un módulo que otro activo requiere: el mensaje dice cuál, y no cambia nada", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["stock", "traspasos"] });
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, desactivar: ["stock"] })).rejects.toThrow(/Stock no se puede desactivar.*Traspasos/);
    expect(await registro()).toEqual({ stock: "ACTIVO", traspasos: "ACTIVO" });
    expect(await auditoria()).toHaveLength(2);
  });

  it("desactivar y activar en el mismo pedido sí sirve si la clausura lo permite (sacar Salón y Stock juntos)", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["salon", "stock"] });
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, desactivar: ["salon", "stock"] });
    expect(await registro()).toEqual({ salon: "INACTIVO", stock: "INACTIVO" });
  });

  it("es atómico: un módulo inválido en el pedido deja sin aplicar también a los válidos", async () => {
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["stock", "inventado"] })).rejects.toThrow(/«inventado» no existe/);
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["stock", "catalogo_basico"] })).rejects.toThrow(/fijo o de soporte/);
    expect(await registro()).toEqual({});
    expect(await auditoria()).toHaveLength(0);
  });

  it("rechaza un pedido vacío, un módulo en las dos listas, una empresa o un operador que no existen", async () => {
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR })).rejects.toThrow(/ningún cambio/);
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: ACTOR, activar: ["stock"], desactivar: ["stock"] })).rejects.toThrow(/activar y desactivar a la vez: stock/);
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "no-existe", actorEmail: ACTOR, activar: ["stock"] })).rejects.toThrow(ModulosDeEmpresaError);
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: "nadie@x.com", activar: ["stock"] })).rejects.toThrow(/No existe un usuario/);
    expect(await registro()).toEqual({});
  });

  it("el email del operador se normaliza y el cambio no toca el registro de otra empresa", async () => {
    const antesDeLaOtra = await registro(EMPRESA_POR_DEFECTO_ID);
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", actorEmail: `  ${ACTOR.toUpperCase()} `, activar: ["recetas"] });
    expect(await registro(EMPRESA_POR_DEFECTO_ID)).toEqual(antesDeLaOtra);
    expect(Object.keys(antesDeLaOtra)).toHaveLength(9);
  });
});

// Sin el rol en la base de test no hay nada que ejercitar: se saltea (en CI y en local hoy no existe; lo cubre el ensayo O0 en una rama de Neon).
describe.skipIf(!process.env.PLATAFORMA_DATABASE_URL)("cambiarModulosDeEmpresa con el rol motor2_plataforma real", () => {
  const plataforma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.PLATAFORMA_DATABASE_URL ?? "" }) });
  afterAll(() => plataforma.$disconnect());

  it("escribe el registro y la auditoría con el RLS puesto, y no puede borrar filas", async () => {
    await cambiarModulosDeEmpresa(plataforma, { slug: "norte", actorEmail: ACTOR, activar: ["stock"] });
    await cambiarModulosDeEmpresa(plataforma, { slug: "norte", actorEmail: ACTOR, desactivar: ["stock"] });
    expect(await registro()).toEqual({ stock: "INACTIVO" });
    expect(await auditoria()).toHaveLength(2);
    await expect(plataforma.moduloEmpresa.deleteMany({ where: { empresaId: NORTE } })).rejects.toThrow(/permission denied|permiso denegado/i);
  });
});
