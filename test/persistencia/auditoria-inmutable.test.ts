import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * S-12: `RegistroAuditoria` es append-only para el rol de ejecución (`motor2_app`). Dos candados: REVOKE UPDATE/DELETE y un trigger que rechaza a
 * quien no sea el dueño. El dueño (`prismaAdmin`) queda exento a propósito: es quien migra y quien limpia la base de test.
 *
 * Mutación: sacar el REVOKE deja en rojo solo los tests de "privilegio"; sacar el trigger deja en rojo el de "GRANT devuelto" y el de TRUNCATE.
 */
afterAll(() => prismaAdmin.$disconnect());

let actorId: string;

async function crearRegistro() {
  return prisma.registroAuditoria.create({
    data: { entidad: "Producto", entidadId: "p1", descripcion: "Producto: precio", campo: "precioVenta", valorAnterior: "1", valorNuevo: "2", actorId },
  });
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  actorId = (await prismaAdmin.user.create({ data: { email: "auditor@test.com" } })).id;
});

describe("el rol de ejecución solo agrega y lee la auditoría", () => {
  it("puede insertar y leer", async () => {
    const r = await crearRegistro();
    expect((await prisma.registroAuditoria.findUnique({ where: { id: r.id } }))?.valorNuevo).toBe("2");
  });

  it("no puede modificar una fila", async () => {
    const r = await crearRegistro();
    await expect(prisma.registroAuditoria.update({ where: { id: r.id }, data: { valorNuevo: "999" } })).rejects.toThrow();
    await expect(prisma.registroAuditoria.updateMany({ data: { descripcion: "borrado" } })).rejects.toThrow();
    expect((await prismaAdmin.registroAuditoria.findUniqueOrThrow({ where: { id: r.id } })).valorNuevo).toBe("2");
  });

  it("no puede borrar filas", async () => {
    const r = await crearRegistro();
    await expect(prisma.registroAuditoria.delete({ where: { id: r.id } })).rejects.toThrow();
    await expect(prisma.registroAuditoria.deleteMany()).rejects.toThrow();
    expect(await prismaAdmin.registroAuditoria.count()).toBe(1);
  });

  it("no puede vaciar la tabla (TRUNCATE)", async () => {
    await crearRegistro();
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "RegistroAuditoria"')).rejects.toThrow();
    expect(await prismaAdmin.registroAuditoria.count()).toBe(1);
  });
});

describe("el trigger frena aunque un GRANT futuro le devuelva el permiso al rol de ejecución", () => {
  it("con UPDATE, DELETE y TRUNCATE concedidos de nuevo, igual rechaza con 'append-only'", async () => {
    const [{ rol }] = await prisma.$queryRaw<Array<{ rol: string }>>`SELECT current_user::text AS rol`;
    const r = await crearRegistro();
    await prismaAdmin.$executeRawUnsafe(`GRANT UPDATE, DELETE, TRUNCATE ON "RegistroAuditoria" TO "${rol}"`);
    try {
      await expect(prisma.registroAuditoria.update({ where: { id: r.id }, data: { valorNuevo: "999" } })).rejects.toThrow(/append-only/);
      await expect(prisma.registroAuditoria.delete({ where: { id: r.id } })).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "RegistroAuditoria"')).rejects.toThrow(/append-only/);
    } finally {
      await prismaAdmin.$executeRawUnsafe(`REVOKE UPDATE, DELETE, TRUNCATE ON "RegistroAuditoria" FROM "${rol}"`);
    }
    expect(await prismaAdmin.registroAuditoria.count()).toBe(1);
  });
});

describe("el dueño (migraciones, reset de test) sigue pudiendo corregir y limpiar", () => {
  it("UPDATE, DELETE y TRUNCATE como dueño funcionan", async () => {
    const r = await crearRegistro();
    await prismaAdmin.registroAuditoria.update({ where: { id: r.id }, data: { valorNuevo: "3" } });
    expect((await prismaAdmin.registroAuditoria.findUniqueOrThrow({ where: { id: r.id } })).valorNuevo).toBe("3");
    await prismaAdmin.registroAuditoria.deleteMany();
    await crearRegistro();
    await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "RegistroAuditoria"');
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
  });
});
