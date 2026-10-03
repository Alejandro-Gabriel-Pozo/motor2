import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { dbDeEmpresa } from "../../src/core/auth/base";
import { MODULOS } from "../../src/core/modulos/catalogo";

/**
 * Bloque 5A, P4: la tabla `ModuloEmpresa` (migración 20261004120000). Qué se prueba, contra Postgres real:
 *  - el backfill (los 9 vendibles ACTIVO a TODA empresa, en cualquier estado; idempotente; mismos módulos que el catálogo del código);
 *  - la lectura por empresa (RLS) y que `motor2_app` NO puede escribir (privilegios), con el rol de ejecución real;
 *  - el segundo candado (el trigger) aunque se le devuelvan los privilegios y se apague el RLS: es lo que frena un GRANT futuro por descuido;
 *  - que el dueño sí escribe (migraciones, limpieza de tests).
 * El camino de `motor2_plataforma` no se puede ejercitar acá: es un rol que se crea a mano en cada base y no existe en la de test. Se verifica en el
 * ensayo O0 (rama de Neon) con `verificacion-previa.sql`; acá se comprueba que la política y el trigger lo nombran.
 */
afterAll(() => prismaAdmin.$disconnect());

const A = "empresa_principal";
const B = "norte";
const C = "sur";

const MIGRACION = readFileSync(join(__dirname, "../../prisma/migrations/20261004120000_registro_de_modulos_por_empresa/migration.sql"), "utf8").replace(/\r\n/g, "\n");
const BACKFILL = MIGRACION.slice(MIGRACION.indexOf('INSERT INTO "ModuloEmpresa"'));
const VENDIBLES = MODULOS.filter((m) => m.tipo === "vendible").map((m) => m.id as string).sort();

async function filas(empresaId: string) {
  return prismaAdmin.moduloEmpresa.findMany({ where: { empresaId }, orderBy: { modulo: "asc" } });
}

describe("registro de módulos por empresa (P4)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    await prismaAdmin.empresa.createMany({
      data: [
        { id: B, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
        { id: C, nombre: "Sur", slug: "sur", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "SUSPENDED" },
      ],
    });
    await prismaAdmin.moduloEmpresa.deleteMany();
  });

  describe("backfill", () => {
    it("los módulos que reparte son exactamente los vendibles del catálogo del código (ni uno más, ni uno menos)", async () => {
      await prismaAdmin.$executeRawUnsafe(BACKFILL);
      expect((await filas(A)).map((f) => f.modulo)).toEqual(VENDIBLES);
      expect(VENDIBLES).toHaveLength(9);
    });

    it("da los 9 en ACTIVO a toda empresa existente, sea cual sea su estado (también la suspendida)", async () => {
      await prismaAdmin.$executeRawUnsafe(BACKFILL);
      for (const empresaId of [A, B, C]) {
        const f = await filas(empresaId);
        expect(f, empresaId).toHaveLength(9);
        expect(new Set(f.map((x) => x.estado)), empresaId).toEqual(new Set(["ACTIVO"]));
      }
    });

    it("es idempotente y NO pisa lo que la plataforma ya cambió", async () => {
      await prismaAdmin.$executeRawUnsafe(BACKFILL);
      await prismaAdmin.moduloEmpresa.updateMany({ where: { empresaId: B, modulo: "salon" }, data: { estado: "INACTIVO" } });
      await prismaAdmin.$executeRawUnsafe(BACKFILL);
      expect(await prismaAdmin.moduloEmpresa.count()).toBe(27);
      expect((await prismaAdmin.moduloEmpresa.findFirstOrThrow({ where: { empresaId: B, modulo: "salon" } })).estado).toBe("INACTIVO");
    });

    it("una empresa creada DESPUÉS no recibe filas (estado válido: la activa la plataforma)", async () => {
      await prismaAdmin.$executeRawUnsafe(BACKFILL);
      await prismaAdmin.empresa.create({ data: { id: "nueva", nombre: "Nueva", slug: "nueva", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
      expect(await filas("nueva")).toEqual([]);
    });
  });

  describe("forma de la tabla", () => {
    it("una sola fila por (empresa, módulo), un módulo vacío no entra y la fila sigue a la empresa (FK)", async () => {
      await prismaAdmin.moduloEmpresa.create({ data: { empresaId: B, modulo: "stock" } });
      await expect(prismaAdmin.moduloEmpresa.create({ data: { empresaId: B, modulo: "stock" } })).rejects.toThrow(/Unique constraint/i);
      await expect(prismaAdmin.moduloEmpresa.create({ data: { empresaId: B, modulo: "  " } })).rejects.toThrow(/modulo_no_vacio_check|check constraint/i);
      await expect(prismaAdmin.moduloEmpresa.create({ data: { empresaId: "no-existe", modulo: "stock" } })).rejects.toThrow(/Foreign key/i);
      await expect(prismaAdmin.empresa.delete({ where: { id: B } })).rejects.toThrow(/Foreign key/i);
    });

    it("el estado por defecto es ACTIVO", async () => {
      expect((await prismaAdmin.moduloEmpresa.create({ data: { empresaId: B, modulo: "stock" } })).estado).toBe("ACTIVO");
    });
  });

  describe("lectura y escritura como motor2_app", () => {
    beforeEach(async () => {
      await prismaAdmin.$executeRawUnsafe(BACKFILL);
    });

    it("cada empresa lee solo sus filas (RLS por empresa)", async () => {
      await prismaAdmin.moduloEmpresa.updateMany({ where: { empresaId: B, modulo: "carta" }, data: { estado: "INACTIVO" } });
      const deA = await dbDeEmpresa(A).moduloEmpresa.findMany();
      const deB = await dbDeEmpresa(B).moduloEmpresa.findMany();
      expect(deA).toHaveLength(9);
      expect(new Set(deA.map((f) => f.empresaId))).toEqual(new Set([A]));
      expect(deB).toHaveLength(9);
      expect(new Set(deB.map((f) => f.empresaId))).toEqual(new Set([B]));
      expect(deB.find((f) => f.modulo === "carta")?.estado).toBe("INACTIVO");
      expect(await dbDeEmpresa(A).moduloEmpresa.findFirst({ where: { empresaId: B } })).toBeNull();
    });

    it("sin contexto de empresa (con 2+ ACTIVE) no ve ninguna fila", async () => {
      expect(await prisma.moduloEmpresa.count()).toBe(0);
    });

    it("no puede insertar, actualizar, borrar ni truncar: privilegios denegados", async () => {
      const db = dbDeEmpresa(A);
      await expect(db.moduloEmpresa.create({ data: { empresaId: A, modulo: "otro" } })).rejects.toThrow(/permission denied|permiso denegado/i);
      await expect(db.moduloEmpresa.updateMany({ data: { estado: "INACTIVO" } })).rejects.toThrow(/permission denied|permiso denegado/i);
      await expect(db.moduloEmpresa.deleteMany()).rejects.toThrow(/permission denied|permiso denegado/i);
      await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "ModuloEmpresa"')).rejects.toThrow(/permission denied|permiso denegado/i);
      expect(await prismaAdmin.moduloEmpresa.count()).toBe(27);
    });

    it("segundo candado: aunque se le devuelvan los privilegios y se apague el RLS, el trigger frena a motor2_app", async () => {
      await prismaAdmin.$executeRawUnsafe('GRANT INSERT, UPDATE, DELETE, TRUNCATE ON "ModuloEmpresa" TO motor2_app');
      await prismaAdmin.$executeRawUnsafe('ALTER TABLE "ModuloEmpresa" DISABLE ROW LEVEL SECURITY');
      try {
        const db = dbDeEmpresa(A);
        const solo = /solo lo escribe la plataforma/;
        await expect(db.moduloEmpresa.create({ data: { empresaId: A, modulo: "otro" } })).rejects.toThrow(solo);
        await expect(db.moduloEmpresa.updateMany({ data: { estado: "INACTIVO" } })).rejects.toThrow(solo);
        await expect(db.moduloEmpresa.deleteMany()).rejects.toThrow(solo);
        await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "ModuloEmpresa"')).rejects.toThrow(solo);
        expect(await prismaAdmin.moduloEmpresa.count()).toBe(27);
        expect(await prismaAdmin.moduloEmpresa.count({ where: { estado: "INACTIVO" } })).toBe(0);
      } finally {
        await prismaAdmin.$executeRawUnsafe('ALTER TABLE "ModuloEmpresa" ENABLE ROW LEVEL SECURITY');
        await prismaAdmin.$executeRawUnsafe('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "ModuloEmpresa" FROM motor2_app');
      }
    });

    it("el dueño sí escribe (migraciones, limpieza de la base de test)", async () => {
      await prismaAdmin.moduloEmpresa.updateMany({ where: { empresaId: A }, data: { estado: "INACTIVO" } });
      expect(await prismaAdmin.moduloEmpresa.count({ where: { estado: "INACTIVO" } })).toBe(9);
      await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId: A } });
      expect(await prismaAdmin.moduloEmpresa.count()).toBe(18);
    });
  });

  describe("catálogo de la base", () => {
    it("motor2_plataforma tiene la política de escritura y el trigger la nombra; la política de lectura es solo SELECT por empresa", async () => {
      const politicas = await prismaAdmin.$queryRaw<Array<{ nombre: string; cmd: string; usando: string | null; con_check: string | null }>>`
        SELECT policyname::text AS nombre, cmd::text AS cmd, qual AS usando, with_check AS con_check FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'ModuloEmpresa' ORDER BY 1`;
      expect(politicas.map((p) => [p.nombre, p.cmd])).toEqual([["aislamiento_empresa", "SELECT"], ["escritura_plataforma", "ALL"]]);
      expect(politicas[0].usando).toContain("app_empresa_actual()");
      expect(politicas[1].usando).toContain("motor2_plataforma");
      expect(politicas[1].con_check).toContain("motor2_plataforma");
      const [fn] = await prismaAdmin.$queryRaw<Array<{ fuente: string }>>`SELECT prosrc AS fuente FROM pg_proc WHERE proname = 'proteger_registro_de_modulos'`;
      expect(fn.fuente).toContain("motor2_plataforma");
    });

    it("los dos triggers (por fila y por TRUNCATE) están, y motor2_app solo tiene SELECT", async () => {
      const triggers = await prismaAdmin.$queryRaw<Array<{ nombre: string }>>`
        SELECT tgname::text AS nombre FROM pg_trigger WHERE tgrelid = to_regclass('public."ModuloEmpresa"') AND NOT tgisinternal ORDER BY 1`;
      expect(triggers.map((t) => t.nombre)).toEqual(["ModuloEmpresa_solo_plataforma_fila", "ModuloEmpresa_solo_plataforma_truncate"]);
      const privilegios = await prismaAdmin.$queryRaw<Array<{ privilegio: string }>>`
        SELECT privilege_type::text AS privilegio FROM information_schema.role_table_grants WHERE table_name = 'ModuloEmpresa' AND grantee = 'motor2_app' ORDER BY 1`;
      expect(privilegios.map((p) => p.privilegio)).toEqual(["SELECT"]);
    });
  });
});
