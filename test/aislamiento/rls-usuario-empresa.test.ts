import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { dbDeEmpresa, dbDeUsuario } from "../../src/core/auth/base";

/**
 * S-13: `UsuarioEmpresa` tiene RLS. Con una empresa de contexto se ve y escribe solo esa empresa; antes de tener empresa (login) la única vía es
 * `dbDeUsuario`, que permite LEER las pertenencias propias (policy `lectura_propia_usuario`, solo SELECT).
 *
 * Mutación: `ALTER TABLE "UsuarioEmpresa" DISABLE ROW LEVEL SECURITY` deja en rojo todos; borrar solo `lectura_propia_usuario` deja en rojo los de `dbDeUsuario`;
 * convertirla en FOR ALL deja en rojo "no puede escribir".
 */
afterAll(() => prismaAdmin.$disconnect());

const A = "empresa_principal";
const B = "norte";

let uno: string;
let otro: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.empresa.create({ data: { id: B, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
  uno = (await prismaAdmin.user.create({ data: { email: "uno@test.com" } })).id;
  otro = (await prismaAdmin.user.create({ data: { email: "otro@test.com" } })).id;
  await prismaAdmin.usuarioEmpresa.createMany({
    data: [
      { usuarioId: uno, empresaId: A },
      { usuarioId: uno, empresaId: B },
      { usuarioId: otro, empresaId: B, rolEmpresa: "gerente" },
    ],
  });
});

describe("con dos empresas activas y sin contexto no se ve ni se escribe nada", () => {
  it("lectura vacía e INSERT rechazado con el rol de ejecución", async () => {
    expect(await prisma.usuarioEmpresa.count()).toBe(0);
    await expect(prisma.usuarioEmpresa.create({ data: { usuarioId: otro, empresaId: A } })).rejects.toThrow();
    expect(await prismaAdmin.usuarioEmpresa.count()).toBe(3);
  });
});

describe("con la empresa de contexto (dbDeEmpresa) solo existe esa empresa", () => {
  it("lee solo las pertenencias de la empresa", async () => {
    expect((await dbDeEmpresa(B).usuarioEmpresa.findMany()).map((p) => p.usuarioId).sort()).toEqual([uno, otro].sort());
    expect((await dbDeEmpresa(A).usuarioEmpresa.findMany()).map((p) => p.usuarioId)).toEqual([uno]);
  });

  it("un findFirst por usuario sin filtrar empresa no ve la pertenencia de otra empresa", async () => {
    expect(await dbDeEmpresa(A).usuarioEmpresa.findFirst({ where: { usuarioId: otro } })).toBeNull();
  });

  it("no puede modificar ni borrar filas de otra empresa, ni insertar en otra empresa", async () => {
    expect((await dbDeEmpresa(A).usuarioEmpresa.updateMany({ where: { empresaId: B }, data: { activo: false } })).count).toBe(0);
    expect((await dbDeEmpresa(A).usuarioEmpresa.deleteMany({ where: { empresaId: B } })).count).toBe(0);
    await expect(dbDeEmpresa(A).usuarioEmpresa.create({ data: { usuarioId: otro, empresaId: B, rolEmpresa: null } })).rejects.toThrow();
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { empresaId: B } })).toBe(2);
    expect((await prismaAdmin.usuarioEmpresa.findFirstOrThrow({ where: { usuarioId: otro } })).activo).toBe(true);
  });

  it("sí puede escribir en su propia empresa", async () => {
    const nuevo = (await prismaAdmin.user.create({ data: { email: "nuevo@test.com" } })).id;
    await dbDeEmpresa(A).usuarioEmpresa.create({ data: { usuarioId: nuevo, empresaId: A } });
    expect((await dbDeEmpresa(A).usuarioEmpresa.updateMany({ where: { usuarioId: nuevo }, data: { activo: false } })).count).toBe(1);
  });
});

describe("antes de tener empresa (login): dbDeUsuario lee solo las pertenencias propias", () => {
  it("ve sus pertenencias en todas las empresas y no las de otro usuario", async () => {
    const propias = await dbDeUsuario(uno).usuarioEmpresa.findMany({ where: { usuarioId: uno } });
    expect(propias.map((p) => p.empresaId).sort()).toEqual([A, B].sort());
    expect(await dbDeUsuario(uno).usuarioEmpresa.count({ where: { usuarioId: otro } })).toBe(0);
    expect((await dbDeUsuario(otro).usuarioEmpresa.findMany()).map((p) => p.usuarioId)).toEqual([otro]);
  });

  it("sin filtrar por usuario igual solo devuelve las propias", async () => {
    expect((await dbDeUsuario(uno).usuarioEmpresa.findMany()).map((p) => p.usuarioId)).toEqual([uno, uno]);
  });

  it("es solo lectura: no puede insertar, promover ni borrar en otra empresa", async () => {
    const nuevoSinPertenencia = (await prismaAdmin.user.create({ data: { email: "nuevo2@test.com" } })).id;
    await expect(dbDeUsuario(uno).usuarioEmpresa.create({ data: { usuarioId: nuevoSinPertenencia, empresaId: B, rolEmpresa: "gerente" } })).rejects.toThrow();
    expect((await dbDeUsuario(uno).usuarioEmpresa.updateMany({ data: { rolEmpresa: "gerente" } })).count).toBe(0);
    expect((await dbDeUsuario(uno).usuarioEmpresa.deleteMany()).count).toBe(0);
    expect((await prismaAdmin.usuarioEmpresa.findMany({ where: { usuarioId: uno } })).map((p) => p.rolEmpresa)).toEqual([null, null]);
  });
});

describe("el dueño salta el RLS (migraciones, siembra)", () => {
  it("ve las tres pertenencias sin contexto", async () => {
    expect(await prismaAdmin.usuarioEmpresa.count()).toBe(3);
  });
});

describe("con UNA sola empresa activa el comportamiento de antes se mantiene", () => {
  it("sin contexto el rol de ejecución ve y escribe en esa empresa", async () => {
    await prismaAdmin.usuarioEmpresa.deleteMany({ where: { empresaId: B } });
    await prismaAdmin.empresa.update({ where: { id: B }, data: { estado: "SUSPENDED" } });
    expect(await prisma.usuarioEmpresa.count()).toBe(1);
    await prisma.usuarioEmpresa.create({ data: { usuarioId: otro, empresaId: A } });
    expect(await prismaAdmin.usuarioEmpresa.count()).toBe(2);
  });
});
