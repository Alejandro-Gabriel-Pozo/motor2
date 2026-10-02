import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prismaAdmin } from "../setup/test-db";

/**
 * Seguridad (decisión del dueño 2026-10-02): `previewFeatures = ["strictUndefinedChecks"]` en `prisma/schema.prisma`.
 * Sin la opción, un `undefined` en un `where` se IGNORA en silencio: `findMany({ where: { empresaId: undefined } })` devuelve
 * filas de todas las empresas y `deleteMany({ where: { id: undefined } })` borra todo. Con la opción, lanza.
 *
 * Mutación: sacar la línea `previewFeatures` del generador (y regenerar el cliente) deja en rojo los tres primeros tests.
 */
afterAll(() => prismaAdmin.$disconnect());

describe("strictUndefinedChecks", () => {
  it("un undefined en el where de una lectura lanza en vez de ignorarse", async () => {
    await expect(prismaAdmin.user.findMany({ where: { id: undefined as never } })).rejects.toThrow();
  });

  it("un undefined en el where de un borrado masivo lanza en vez de borrar todo", async () => {
    await expect(prismaAdmin.user.deleteMany({ where: { email: undefined as never } })).rejects.toThrow();
  });

  it("un undefined en el data de una escritura lanza", async () => {
    await expect(prismaAdmin.user.updateMany({ where: { id: "no-existe" }, data: { name: undefined as never } })).rejects.toThrow();
  });

  it("Prisma.skip omite el campo a propósito y no lanza", async () => {
    await expect(prismaAdmin.user.findMany({ where: { id: Prisma.skip }, take: 1 })).resolves.toBeInstanceOf(Array);
  });
});
