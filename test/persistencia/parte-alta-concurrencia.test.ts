import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { digitoVerificadorDeCuit } from "../../src/core/fiscal/cuit-estricto";
import { dbDeEmpresa, transaccionDeEmpresa } from "../../src/server/sesion/base";
import { EMPRESA_POR_DEFECTO_ID as A, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Parte P1: concurrencia e idempotencia del alta CONTRA LA BASE (el caso de uso de la etapa (b) se apoya en esto: la clave única decide y la segunda no duplica).
 *  · Dos (u ocho) altas a la vez del mismo documento, desde conexiones distintas: entra UNA; las demás reciben la violación del único `Parte_documento_uk` (P2002), nunca una segunda ficha.
 *  · La misma clave de alta repetida (clic doble, reintento, corte de red): una sola ficha, el resto choca con `Parte_idempotenciaAlta_uk`.
 *  · `createMany({ skipDuplicates })` (INSERT … ON CONFLICT DO NOTHING) con el mismo documento a la vez, también dentro de una transacción SERIALIZABLE: una fila (verifica lo que el diseño dejó NO VERIFICADO).
 *  · Dos ediciones con la misma versión: gana una, la otra no cambia nada (0 filas).
 * Mutación: sacar el índice único del documento de la migración deja en rojo el primer caso.
 */
afterAll(() => prismaAdmin.$disconnect());
beforeEach(limpiarBaseDeTest);

const cuit = (medio: string): string => `20${medio}${digitoVerificadorDeCuit(`20${medio}`)}`;
const alta = (extra: Record<string, unknown> = {}) =>
  dbDeEmpresa(A).parte.create({ data: { id: randomUUID(), idempotenciaAlta: randomUUID(), payloadHash: "h", naturaleza: "HUMANA", nombre: "Ana Pérez", ...extra } });
const codigo = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" && r.reason instanceof Prisma.PrismaClientKnownRequestError ? r.reason.code : r.status === "fulfilled" ? "OK" : String(r.reason));
const filas = () => prismaAdmin.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "Parte"`).then((r) => r[0]!.n);

describe("alta de la misma persona a la vez", () => {
  it("ocho altas simultáneas del mismo CUIT dejan UNA ficha; las otras siete reciben P2002 (tres rondas, con documentos distintos)", async () => {
    for (const medio of ["11111111", "22222222", "33333333"]) {
      const resultados = await Promise.allSettled(Array.from({ length: 8 }, () => alta({ documentoTipo: "CUIT", documentoNumero: cuit(medio) })));
      expect(resultados.map(codigo).filter((c) => c === "OK"), medio).toHaveLength(1);
      expect(resultados.map(codigo).filter((c) => c === "P2002"), medio).toHaveLength(7);
    }
    expect(await filas()).toBe(3);
  });

  it("CUIT y CUIL del mismo número a la vez: también una sola (es la misma clave)", async () => {
    const numero = cuit("44444444");
    const r = await Promise.allSettled([alta({ documentoTipo: "CUIT", documentoNumero: numero }), alta({ documentoTipo: "CUIL", documentoNumero: numero })]);
    expect(r.map(codigo).sort()).toEqual(["OK", "P2002"]);
    expect(await filas()).toBe(1);
  });

  it("la misma clave de alta repetida (reintento, clic doble): una sola ficha", async () => {
    const id = randomUUID();
    const clave = randomUUID();
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => alta({ id, idempotenciaAlta: clave })));
    expect(r.map(codigo).filter((c) => c === "OK")).toHaveLength(1);
    expect(await filas()).toBe(1);
    // Con otro id pero la misma clave (otra pestaña con la misma clave): también choca; la ficha original no cambia.
    await expect(alta({ idempotenciaAlta: clave, nombre: "Otra Persona" })).rejects.toMatchObject({ code: "P2002" });
    expect((await prismaAdmin.parte.findUniqueOrThrow({ where: { id } })).nombre).toBe("Ana Pérez");
  });

  it("INSERT … ON CONFLICT DO NOTHING (createMany con skipDuplicates) a la vez, suelto y dentro de una transacción SERIALIZABLE: una sola fila, sin error", async () => {
    const numero = cuit("55555555");
    const una = (db: Pick<ReturnType<typeof dbDeEmpresa>, "parte">) => db.parte.createMany({ skipDuplicates: true, data: [{ id: randomUUID(), idempotenciaAlta: randomUUID(), payloadHash: "h", naturaleza: "HUMANA", nombre: "Ana Pérez", documentoTipo: "CUIT", documentoNumero: numero }] });
    const sueltas = await Promise.all(Array.from({ length: 6 }, () => una(dbDeEmpresa(A))));
    expect(sueltas.reduce((s, r) => s + r.count, 0)).toBe(1);
    expect(await filas()).toBe(1);
    await prismaAdmin.$executeRawUnsafe(`DELETE FROM "Parte"`);
    const serializables = await Promise.allSettled(Array.from({ length: 6 }, () => transaccionDeEmpresa(A, (tx) => una({ parte: tx.parte }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })));
    // Con SERIALIZABLE Postgres puede abortar algunas con 40001 (el caso de uso las reintenta); lo que NUNCA puede pasar es más de una ficha.
    expect(serializables.map(codigo).every((c) => c === "OK" || c === "P2034")).toBe(true);
    expect(await filas()).toBe(1);
  });
});

describe("edición concurrente con control de versión", () => {
  it("dos ediciones con la misma versión: gana una, la otra no cambia nada", async () => {
    const parte = await alta();
    const editar = (nombre: string) => dbDeEmpresa(A).parte.updateMany({ where: { id: parte.id, version: parte.version }, data: { nombre } });
    const r = await Promise.all([editar("Primera"), editar("Segunda")]);
    expect(r.map((x) => x.count).sort()).toEqual([0, 1]);
    const final = await prismaAdmin.parte.findUniqueOrThrow({ where: { id: parte.id } });
    expect(final.version).toBe(2);
    expect(["Primera", "Segunda"]).toContain(final.nombre);
  });
});
