import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { dbDeEmpresa, dbDeUsuario, transaccionDeEmpresa } from "../../src/core/auth/base";

/**
 * ADR-007, A6: aislamiento por empresa con RLS contra Postgres real. El código de la app corre como `motor2_app` (`prisma` y
 * `dbDeEmpresa`); los fixtures y las verificaciones "por fuera" van como dueño (`prismaAdmin`, que salta el RLS). Con DOS empresas
 * ACTIVE no hay empresa por defecto: sin contexto `app_empresa_actual()` es NULL y no se ve ni se puede insertar nada.
 *
 * Cada test se prueba por mutación: deshabilitar el RLS de `Unidad` (o su política) los pone en rojo.
 */
afterAll(() => prismaAdmin.$disconnect());

const A = "empresa_principal";
const B = "norte";

const GLOBALES = ["Account", "Accion", "CotizacionDolar", "IndicePrecio", "Session", "User", "VerificationToken"];
const PLATAFORMA = ["Empresa"];
// E4 (ADR-012/019): tablas de la consola de plataforma. Tienen RLS (política `solo_plataforma`, por nombre de rol) pero NO por empresa y no llevan `empresaId`.
const CONSOLA = ["AdminPlataforma", "AuditoriaPlataforma", "CodigoDeIngresoPlataforma", "CodigoDeRecuperacionPlataforma", "SesionPlataforma"];

async function unidadesComoDuenio(empresaId: string) {
  return prismaAdmin.unidad.findMany({ where: { empresaId }, orderBy: { nombre: "asc" } });
}

describe("catálogo: el RLS está en las tablas por empresa y solo en ellas", () => {
  it("las 56 tablas con `empresaId` (UsuarioEmpresa incluida, S-13; ModuloEmpresa, P4; Invitacion, E5) tienen RLS habilitado, sin FORCE, y la política de aislamiento", async () => {
    const tablas = await prismaAdmin.$queryRaw<Array<{ tabla: string; rls: boolean; forzado: boolean; politicas: string[] }>>`
      SELECT c.relname::text AS tabla, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado,
             COALESCE((SELECT array_agg(p.policyname::text ORDER BY p.policyname) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname), '{}') AS politicas
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'empresaId')
       ORDER BY 1`;
    expect(tablas).toHaveLength(56);
    for (const t of tablas) {
      expect(t.rls, `${t.tabla}: RLS deshabilitado`).toBe(true);
      expect(t.forzado, `${t.tabla}: FORCE no está en el diseño (el dueño que migra debe poder saltarlo)`).toBe(false);
      const esperadas = t.tabla === "UsuarioEmpresa" ? ["aislamiento_empresa", "lectura_propia_usuario"] : t.tabla === "ModuloEmpresa" ? ["aislamiento_empresa", "escritura_plataforma"] : t.tabla === "Invitacion" ? ["aislamiento_empresa", "escritura_plataforma", "lectura_por_token"] : ["aislamiento_empresa"];
      expect(t.politicas, `${t.tabla}: política de aislamiento`).toEqual(esperadas);
    }
  });

  it("la política usa `(SELECT app_empresa_actual())` en USING y en WITH CHECK", async () => {
    const politicas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; usando: string; con_check: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, qual AS usando, with_check AS con_check FROM pg_policies WHERE schemaname = 'public'`;
    expect(politicas).toHaveLength(60 + CONSOLA.length);
    // ModuloEmpresa (P4): lectura por empresa (solo USING, FOR SELECT) y escritura de plataforma (por nombre de rol); ver registro-de-modulos.test.ts.
    for (const p of politicas.filter((x) => x.nombre !== "lectura_propia_usuario" && x.tabla !== "ModuloEmpresa" && !(x.tabla === "Invitacion" && x.nombre !== "aislamiento_empresa") && !CONSOLA.includes(x.tabla))) {
      expect(p.usando, p.tabla).toContain("app_empresa_actual()");
      expect(p.con_check, p.tabla).toContain("app_empresa_actual()");
    }
  });

  it("las tablas de la consola de plataforma tienen RLS con UNA política `solo_plataforma` atada al rol, y ninguna lleva `empresaId`", async () => {
    const politicas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; usando: string; con_check: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, qual AS usando, with_check AS con_check FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(${CONSOLA})`;
    expect(politicas.map((p) => p.tabla).sort()).toEqual([...CONSOLA].sort());
    for (const p of politicas) {
      expect(p.nombre, p.tabla).toBe("solo_plataforma");
      expect(p.usando, p.tabla).toContain("motor2_plataforma");
      expect(p.con_check, p.tabla).toContain("motor2_plataforma");
    }
    const conEmpresa = await prismaAdmin.$queryRaw<Array<{ tabla: string }>>`
      SELECT table_name::text AS tabla FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'empresaId' AND table_name = ANY(${CONSOLA})`;
    expect(conEmpresa).toEqual([]);
  });

  it("las 7 globales y `Empresa` NO tienen RLS ni políticas", async () => {
    const sin = [...GLOBALES, ...PLATAFORMA];
    const tablas = await prismaAdmin.$queryRaw<Array<{ tabla: string; rls: boolean }>>`
      SELECT c.relname::text AS tabla, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(${sin})`;
    expect(tablas.map((t) => t.tabla).sort()).toEqual([...sin].sort());
    for (const t of tablas) expect(t.rls, `${t.tabla} no debe tener RLS`).toBe(false);
    const politicas = await prismaAdmin.$queryRaw<Array<{ tabla: string }>>`
      SELECT tablename::text AS tabla FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(${sin})`;
    expect(politicas).toEqual([]);
  });

  it("no queda ninguna otra tabla de `public` con RLS", async () => {
    const [{ n }] = await prismaAdmin.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`;
    expect(n).toBe(56 + CONSOLA.length);
  });
});

describe("aislamiento entre dos empresas ACTIVE (el código corre como motor2_app)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    await prismaAdmin.empresa.create({ data: { id: B, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    await prismaAdmin.unidad.createMany({
      data: [
        { empresaId: A, nombre: "kg-a", magnitud: "PESO" },
        { empresaId: A, nombre: "l-a", magnitud: "VOLUMEN" },
        { empresaId: B, nombre: "kg-b", magnitud: "PESO" },
      ],
    });
  });

  it("lectura cruzada: cada empresa ve solo lo suyo (findMany, count, findUnique por id ajeno)", async () => {
    const dbA = dbDeEmpresa(A);
    const dbB = dbDeEmpresa(B);
    expect((await dbA.unidad.findMany({ orderBy: { nombre: "asc" } })).map((u) => u.nombre)).toEqual(["kg-a", "l-a"]);
    expect((await dbB.unidad.findMany()).map((u) => u.nombre)).toEqual(["kg-b"]);
    expect(await dbA.unidad.count()).toBe(2);
    const [ajena] = await unidadesComoDuenio(B);
    expect(await dbA.unidad.findUnique({ where: { id: ajena.id } })).toBeNull();
    expect(await dbA.unidad.findFirst({ where: { empresaId: B } })).toBeNull();
    expect((await dbB.unidad.findUnique({ where: { id: ajena.id } }))?.nombre).toBe("kg-b");
  });

  it("lectura con la relación: un `include` desde una fila propia no trae filas de la otra empresa", async () => {
    const [unidadA] = await unidadesComoDuenio(A);
    const [unidadB] = await unidadesComoDuenio(B);
    await prismaAdmin.producto.createMany({
      data: [
        { empresaId: A, codigo: "PV_A", nombre: "De A", tipo: "PV", unidadStockId: unidadA.id, precioVenta: 1 },
        { empresaId: B, codigo: "PV_B", nombre: "De B", tipo: "PV", unidadStockId: unidadB.id, precioVenta: 1 },
      ],
    });
    const conProductos = await dbDeEmpresa(A).unidad.findMany({ include: { productosPorUnidadStock: true } });
    expect(conProductos.flatMap((u) => u.productosPorUnidadStock.map((p) => p.codigo))).toEqual(["PV_A"]);
    expect(await dbDeEmpresa(A).producto.count()).toBe(1);
  });

  it("escritura cruzada: crear con el `empresaId` de otra empresa es rechazado por la política (WITH CHECK)", async () => {
    const error = await dbDeEmpresa(A).unidad.create({ data: { empresaId: B, nombre: "intruso", magnitud: "PESO" } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).message).toMatch(/pol[ií]tica de seguridad|row-level security/i);
    expect(await unidadesComoDuenio(B)).toHaveLength(1);
  });

  it("escritura sin `empresaId` explícito: queda en la empresa del contexto", async () => {
    const creada = await dbDeEmpresa(B).unidad.create({ data: { nombre: "propia-b", magnitud: "CANTIDAD" } });
    expect(creada.empresaId).toBe(B);
    expect(await unidadesComoDuenio(A)).toHaveLength(2);
  });

  it("actualización cruzada: `updateMany` no toca filas ajenas y `update` de un id ajeno falla (P2025)", async () => {
    const [ajena] = await unidadesComoDuenio(B);
    const dbA = dbDeEmpresa(A);
    expect((await dbA.unidad.updateMany({ where: { id: ajena.id }, data: { nombre: "pisada" } })).count).toBe(0);
    expect((await dbA.unidad.updateMany({ data: { activa: false } })).count).toBe(2);
    const error = await dbA.unidad.update({ where: { id: ajena.id }, data: { nombre: "pisada" } }).catch((e: unknown) => e);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2025");
    const despues = (await unidadesComoDuenio(B))[0];
    expect(despues.nombre).toBe("kg-b");
    expect(despues.activa).toBe(true);
  });

  it("mover una fila propia a otra empresa (`update` del empresaId) es rechazado", async () => {
    const [propia] = await unidadesComoDuenio(A);
    const error = await dbDeEmpresa(A).unidad.update({ where: { id: propia.id }, data: { empresaId: B } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((await prismaAdmin.unidad.findUniqueOrThrow({ where: { id: propia.id } })).empresaId).toBe(A);
  });

  it("borrado cruzado: `deleteMany` no borra filas ajenas y `delete` de un id ajeno falla (P2025)", async () => {
    const [ajena] = await unidadesComoDuenio(B);
    const dbA = dbDeEmpresa(A);
    expect((await dbA.unidad.deleteMany({ where: { id: ajena.id } })).count).toBe(0);
    const error = await dbA.unidad.delete({ where: { id: ajena.id } }).catch((e: unknown) => e);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2025");
    expect(await unidadesComoDuenio(B)).toHaveLength(1);
    expect((await dbA.unidad.deleteMany()).count).toBe(2);
    expect(await unidadesComoDuenio(B)).toHaveLength(1);
  });

  it("`$queryRaw` y `$executeRaw` por el cliente de contexto también quedan filtrados", async () => {
    const dbA = dbDeEmpresa(A);
    const filas = await dbA.$queryRaw<Array<{ nombre: string }>>`SELECT nombre FROM "Unidad" ORDER BY nombre`;
    expect(filas.map((f) => f.nombre)).toEqual(["kg-a", "l-a"]);
    expect(await dbA.$executeRaw`UPDATE "Unidad" SET activa = false`).toBe(2);
    expect(await dbA.$executeRaw`DELETE FROM "Unidad" WHERE nombre = 'kg-b'`).toBe(0);
    const error = await dbA.$executeRaw`INSERT INTO "Unidad" (id, "empresaId", nombre, magnitud, decimales) VALUES ('u-cruda', ${B}, 'x', 'PESO', 2)`.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(await prismaAdmin.unidad.count({ where: { id: "u-cruda" } })).toBe(0);
    expect((await unidadesComoDuenio(B))[0].activa).toBe(true);
  });

  it("dentro de `transaccionDeEmpresa` el tx también queda aislado", async () => {
    const [ajena] = await unidadesComoDuenio(B);
    const resultado = await transaccionDeEmpresa(A, async (tx) => ({
      nombres: (await tx.unidad.findMany({ orderBy: { nombre: "asc" } })).map((u) => u.nombre),
      ajena: await tx.unidad.findUnique({ where: { id: ajena.id } }),
      borradas: (await tx.unidad.deleteMany({ where: { empresaId: B } })).count,
    }));
    expect(resultado).toEqual({ nombres: ["kg-a", "l-a"], ajena: null, borradas: 0 });
  });

  it("sin contexto y con dos empresas activas: no se ve nada y no se puede insertar (el sentido seguro)", async () => {
    expect(await prismaSinEmpresa.unidad.findMany()).toEqual([]);
    expect(await prismaSinEmpresa.unidad.count()).toBe(0);
    await expect(prismaSinEmpresa.unidad.create({ data: { nombre: "huerfana", magnitud: "PESO" } })).rejects.toThrow();
    await expect(prismaSinEmpresa.unidad.create({ data: { empresaId: A, nombre: "huerfana", magnitud: "PESO" } })).rejects.toThrow();
    expect((await prismaSinEmpresa.unidad.updateMany({ data: { activa: false } })).count).toBe(0);
    expect((await prismaSinEmpresa.unidad.deleteMany()).count).toBe(0);
    expect(await prismaAdmin.unidad.count()).toBe(3);
  });

  it("`Empresa` y las globales siguen legibles sin contexto; `UsuarioEmpresa` solo con empresa o con el usuario propio", async () => {
    const usuario = await prismaAdmin.user.create({ data: { email: "plataforma@test.com" } });
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: usuario.id, empresaId: B } });
    expect((await prisma.empresa.findMany({ where: { estado: "ACTIVE" } })).map((e) => e.id).sort()).toEqual([B, A, "empresa_testigo"].sort()); // la testigo (ADR-022) es una tercera ACTIVE
    expect(await prisma.usuarioEmpresa.count({ where: { usuarioId: usuario.id } })).toBe(0);
    expect(await dbDeUsuario(usuario.id).usuarioEmpresa.count({ where: { usuarioId: usuario.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: usuario.id } })).toBe(1);
  });
});

describe("el dueño (DIRECT_URL) salta el RLS: es lo que hace posible migrar y sembrar", () => {
  it("ve las filas de todas las empresas sin contexto", async () => {
    await limpiarBaseDeTest();
    await prismaAdmin.empresa.create({ data: { id: B, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    await prismaAdmin.unidad.createMany({ data: [{ empresaId: A, nombre: "a", magnitud: "PESO" }, { empresaId: B, nombre: "b", magnitud: "PESO" }] });
    expect(await prismaAdmin.unidad.count()).toBe(2);
  });
});
