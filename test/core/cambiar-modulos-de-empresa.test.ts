import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { ModulosDeEmpresaError } from "../../src/core/features/empresa/cambio-de-modulos";
import { cambiarModulosDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa";
import type { AutorDeCambioDePlataforma } from "../../src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma";

/**
 * Bloque 5A, P9: `cambiarModulosDeEmpresa` contra Postgres real. `motor2_app` no puede escribir `ModuloEmpresa` ni `AuditoriaPlataforma`, así que acá la función corre con el
 * cliente del DUEÑO (`prismaAdmin`), que sí puede; el camino con el rol `motor2_plataforma` (el real) se ejercita solo si la base de test lo tiene
 * (`PLATAFORMA_DATABASE_URL`), y siempre en el ensayo O0. Desde S-33 el cambio se audita en `AuditoriaPlataforma` a nombre de un administrador de plataforma (no de un `User`): que el
 * actor no sea un `User`, la atomicidad con la auditoría y la forma de la fila los prueba `cambios-de-plataforma-auditoria.test.ts`.
 */
const NORTE = "norte";
const AUTOR: AutorDeCambioDePlataforma = { adminId: "admin-1", adminEmail: "operador@plataforma.com", instalacionId: "principal", instalacionNombre: "principal" };

afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.empresa.create({ data: { id: NORTE, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
  await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId: NORTE } });
});

const registro = async (empresaId = NORTE) =>
  Object.fromEntries((await prismaAdmin.moduloEmpresa.findMany({ where: { empresaId }, orderBy: { modulo: "asc" } })).map((f) => [f.modulo, f.estado]));
const auditoria = () => prismaAdmin.auditoriaPlataforma.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
const modulosAuditados = async () => (await auditoria()).map((f) => `${f.accion}:${(f.detalle as { modulo: string }).modulo}`);

describe("cambiarModulosDeEmpresa", () => {
  it("activar un módulo crea su fila, calcula con qué cuenta la empresa y deja la auditoría de plataforma a nombre del administrador", async () => {
    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock"] }, AUTOR);

    expect(r.cambiados).toEqual([{ modulo: "stock", antes: null, despues: "ACTIVO" }]);
    expect(r.activos).toEqual(["stock"]);
    expect(r.efectivos).toEqual(["administracion", "catalogo_basico", "stock"]);
    expect(await registro()).toEqual({ stock: "ACTIVO" });

    const filas = await auditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ accion: "modulo-activado", empresaAfectadaId: NORTE, adminId: AUTOR.adminId, adminEmail: AUTOR.adminEmail });
    expect(filas[0].detalle).toMatchObject({ modulo: "stock", antes: "sin fila", despues: "ACTIVO" });
  });

  it("activar un módulo que requiere otros NO les crea fila: quedan incluidos por la clausura", async () => {
    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["salon"] }, AUTOR);
    expect(await registro()).toEqual({ salon: "ACTIVO" });
    expect(r.efectivos).toEqual(expect.arrayContaining(["administracion", "salon", "stock", "clientes_basico", "catalogo_basico"]));
  });

  it("desactivar deja la fila en INACTIVO (nunca se borra) y audita el cambio", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock", "carta"] }, AUTOR);
    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", desactivar: ["carta"] }, AUTOR);

    expect(r.cambiados).toEqual([{ modulo: "carta", antes: "ACTIVO", despues: "INACTIVO" }]);
    expect(r.activos).toEqual(["stock"]);
    expect(await registro()).toEqual({ carta: "INACTIVO", stock: "ACTIVO" });
    expect(await modulosAuditados()).toEqual(["modulo-activado:stock", "modulo-activado:carta", "modulo-desactivado:carta"]);
  });

  it("volver a activar un módulo INACTIVO reutiliza su fila", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["carta"] }, AUTOR);
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", desactivar: ["carta"] }, AUTOR);
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["carta"] }, AUTOR);
    expect(await registro()).toEqual({ carta: "ACTIVO" });
    expect(await prismaAdmin.moduloEmpresa.count({ where: { empresaId: NORTE } })).toBe(1);
  });

  it("pedir lo que ya está así (o desactivar lo que no tiene fila) no cambia nada ni ensucia la auditoría", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock"] }, AUTOR);
    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock"], desactivar: ["carta"] }, AUTOR);
    expect(r.cambiados).toEqual([]);
    expect(await registro()).toEqual({ stock: "ACTIVO" });
    expect(await auditoria()).toHaveLength(1);
  });

  it("no se desactiva un módulo que otro activo requiere: el mensaje dice cuál, y no cambia nada", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock", "traspasos"] }, AUTOR);
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", desactivar: ["stock"] }, AUTOR)).rejects.toThrow(/Stock no se puede desactivar.*Traspasos/);
    expect(await registro()).toEqual({ stock: "ACTIVO", traspasos: "ACTIVO" });
    expect(await auditoria()).toHaveLength(2);
  });

  it("desactivar y activar en el mismo pedido sí sirve si la clausura lo permite (sacar Salón y Stock juntos)", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["salon", "stock"] }, AUTOR);
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", desactivar: ["salon", "stock"] }, AUTOR);
    expect(await registro()).toEqual({ salon: "INACTIVO", stock: "INACTIVO" });
  });

  it("es atómico: un módulo inválido en el pedido deja sin aplicar también a los válidos", async () => {
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock", "inventado"] }, AUTOR)).rejects.toThrow(/«inventado» no existe/);
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock", "catalogo_basico"] }, AUTOR)).rejects.toThrow(/fijo o de soporte/);
    expect(await registro()).toEqual({});
    expect(await auditoria()).toHaveLength(0);
  });

  it("rechaza un pedido vacío, un módulo en las dos listas y una empresa que no existe", async () => {
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte" }, AUTOR)).rejects.toThrow(/ningún cambio/);
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock"], desactivar: ["stock"] }, AUTOR)).rejects.toThrow(/activar y desactivar a la vez: stock/);
    await expect(cambiarModulosDeEmpresa(prismaAdmin, { slug: "no-existe", activar: ["stock"] }, AUTOR)).rejects.toThrow(ModulosDeEmpresaError);
    expect(await registro()).toEqual({});
  });

  it("el cambio no toca el registro de otra empresa", async () => {
    const antesDeLaOtra = await registro(EMPRESA_POR_DEFECTO_ID);
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["recetas"] }, AUTOR);
    expect(await registro(EMPRESA_POR_DEFECTO_ID)).toEqual(antesDeLaOtra);
    expect(Object.keys(antesDeLaOtra)).toHaveLength(9);
  });
});

// Sin el rol en la base de test no hay nada que ejercitar: se saltea (en local no existe; el job `integracion` de CI lo crea con crear-rol-motor2-plataforma.sql y también lo cubre el ensayo O0 en una rama de Neon).
describe.skipIf(!process.env.PLATAFORMA_DATABASE_URL)("cambiarModulosDeEmpresa con el rol motor2_plataforma real", () => {
  const plataforma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.PLATAFORMA_DATABASE_URL ?? "" }) });
  afterAll(() => plataforma.$disconnect());

  it("escribe el registro y la auditoría de plataforma con el RLS puesto, y no puede borrar filas", async () => {
    await cambiarModulosDeEmpresa(plataforma, { slug: "norte", activar: ["stock"] }, AUTOR);
    await cambiarModulosDeEmpresa(plataforma, { slug: "norte", desactivar: ["stock"] }, AUTOR);
    expect(await registro()).toEqual({ stock: "INACTIVO" });
    expect(await auditoria()).toHaveLength(2);
    await expect(plataforma.moduloEmpresa.deleteMany({ where: { empresaId: NORTE } })).rejects.toThrow(/permission denied|permiso denegado/i);
  });
});
