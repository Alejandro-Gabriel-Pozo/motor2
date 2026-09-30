import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Estructura que deja la migración `multiempresa_estructura` (ADR-007, paso A2): instalación multiempresa-capable activada con UNA
 * empresa. El catálogo de la base se lee de `pg_catalog` (no del schema.prisma) para que un cambio en la migración o un modelo nuevo
 * sin `empresaId` rompa acá. El RLS (paso A6) se prueba en test/aislamiento; acá las unicidades y FK son propiedades de la estructura y se ejercitan como dueño (`prismaAdmin`).
 */
const GLOBALES = ["Account", "Accion", "CotizacionDolar", "IndicePrecio", "Session", "User", "VerificationToken"];
const PLATAFORMA = ["Empresa", "UsuarioEmpresa"];

function codigoDeError(e: unknown): string | undefined {
  return e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
}

async function tablasPorEmpresa(): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ tabla: string }>>`
    SELECT c.table_name AS tabla
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'empresaId' AND c.table_name <> 'UsuarioEmpresa'
     ORDER BY 1`;
  return filas.map((f) => f.tabla);
}

async function crearEmpresa(id: string, estado: "PROVISIONING" | "ACTIVE" = "PROVISIONING") {
  return prisma.empresa.create({ data: { id, nombre: `Empresa ${id}`, slug: id, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado } });
}

describe("multiempresa: estructura de la base (ADR-007, A2)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  describe("catálogo de tablas", () => {
    it("49 tablas de dominio tienen empresaId NOT NULL con default app_empresa_actual(); las 7 globales y ninguna otra quedan afuera", async () => {
      const conEmpresa = await tablasPorEmpresa();
      expect(conEmpresa).toHaveLength(49);
      for (const g of GLOBALES) expect(conEmpresa).not.toContain(g);
      expect(conEmpresa).not.toContain("Empresa");

      const columnas = await prisma.$queryRaw<Array<{ tabla: string; nullable: string; predeterminado: string | null }>>`
        SELECT table_name AS tabla, is_nullable AS nullable, column_default AS predeterminado
          FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'empresaId' AND table_name <> 'UsuarioEmpresa'`;
      for (const c of columnas) {
        expect(c.nullable, c.tabla).toBe("NO");
        expect(c.predeterminado, c.tabla).toContain("app_empresa_actual()");
      }

      const todas = await prisma.$queryRaw<Array<{ tabla: string }>>`
        SELECT table_name AS tabla FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
      const sinEmpresa = todas.map((t) => t.tabla).filter((t) => !conEmpresa.includes(t)).sort();
      expect(sinEmpresa).toEqual([...GLOBALES, ...PLATAFORMA].sort());
    });

    it("toda FK entre dos tablas por empresa es compuesta e incluye empresaId (94); ninguna FK a una tabla global lo incluye", async () => {
      const conEmpresa = new Set(await tablasPorEmpresa());
      const fks = await prisma.$queryRaw<Array<{ nombre: string; origen: string; destino: string; columnas: string[] }>>`
        SELECT c.conname::text AS nombre,
               (SELECT relname::text FROM pg_class WHERE oid = c.conrelid) AS origen,
               (SELECT relname::text FROM pg_class WHERE oid = c.confrelid) AS destino,
               ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k ORDER BY k) AS columnas
          FROM pg_constraint c
         WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`;

      const entreTablasPorEmpresa = fks.filter((f) => conEmpresa.has(f.origen) && conEmpresa.has(f.destino));
      expect(entreTablasPorEmpresa).toHaveLength(94);
      for (const f of entreTablasPorEmpresa) {
        expect(f.columnas, f.nombre).toHaveLength(2);
        expect(f.columnas, f.nombre).toContain("empresaId");
      }

      const haciaGlobales = fks.filter((f) => conEmpresa.has(f.origen) && GLOBALES.includes(f.destino));
      expect(haciaGlobales.length).toBeGreaterThan(0);
      for (const f of haciaGlobales) expect(f.columnas, f.nombre).not.toContain("empresaId");

      const haciaEmpresa = fks.filter((f) => f.destino === "Empresa" && conEmpresa.has(f.origen));
      expect(haciaEmpresa).toHaveLength(49);
    });
  });

  describe("app_empresa_actual() (D1 = V1)", () => {
    it("sin contexto devuelve la única empresa ACTIVE", async () => {
      const [{ e }] = await prisma.$queryRaw<Array<{ e: string | null }>>`SELECT app_empresa_actual() AS e`;
      expect(e).toBe(EMPRESA_POR_DEFECTO_ID);
    });

    it("una empresa que no está ACTIVE no cuenta como la actual", async () => {
      await crearEmpresa("empresa_b");
      const [{ e }] = await prisma.$queryRaw<Array<{ e: string | null }>>`SELECT app_empresa_actual() AS e`;
      expect(e).toBe(EMPRESA_POR_DEFECTO_ID);
    });

    it("con app.empresa_id fijado en la transacción gana el contexto, y las filas nuevas nacen en esa empresa", async () => {
      await crearEmpresa("empresa_b");
      const creada = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.empresa_id', 'empresa_b', true)`;
        return tx.sucursal.create({ data: { nombre: "Sucursal B" } });
      });
      expect(creada.empresaId).toBe("empresa_b");
      expect((await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).empresaId).toBe(EMPRESA_POR_DEFECTO_ID);
    });

    it("con dos empresas ACTIVE y sin contexto devuelve NULL y crear una fila falla (se equivoca hacia el lado seguro)", async () => {
      await crearEmpresa("empresa_b", "ACTIVE");
      const [{ e }] = await prisma.$queryRaw<Array<{ e: string | null }>>`SELECT app_empresa_actual() AS e`;
      expect(e).toBeNull();

      const error = await prisma.sucursal.create({ data: { nombre: "Sin contexto" } }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(Error);
      expect(await prisma.sucursal.count()).toBe(0);
    });
  });

  describe("unicidades por empresa (ADR-007, «Unicidades por empresa»)", () => {
    const prisma = prismaAdmin;
    beforeEach(async () => {
      await crearEmpresa("empresa_b");
    });

    it("el mismo nombre de Unidad se repite entre empresas pero no dentro de una (P2002)", async () => {
      await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO" } });
      await prisma.unidad.create({ data: { empresaId: "empresa_b", nombre: "kg", magnitud: "PESO" } });

      const repetida = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO" } }).catch((e: unknown) => e);
      expect(codigoDeError(repetida)).toBe("P2002");
    });

    it("el índice manual por lower(nombre) también es por empresa", async () => {
      await prisma.unidad.create({ data: { nombre: "Litro", magnitud: "VOLUMEN" } });
      await prisma.unidad.create({ data: { empresaId: "empresa_b", nombre: "LITRO", magnitud: "VOLUMEN" } });

      const otraCapitalizacion = await prisma.unidad.create({ data: { nombre: "LITRO", magnitud: "VOLUMEN" } }).catch((e: unknown) => e);
      expect(codigoDeError(otraCapitalizacion)).toBe("P2002");
    });

    it("el código de Producto se repite entre empresas pero no dentro de una", async () => {
      const unidadA = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
      const unidadB = await prisma.unidad.create({ data: { empresaId: "empresa_b", nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
      await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Empanada", tipo: "PV", unidadStockId: unidadA.id, precioVenta: 500 } });
      await prisma.producto.create({ data: { empresaId: "empresa_b", codigo: "PV_1", nombre: "Empanada", tipo: "PV", unidadStockId: unidadB.id, precioVenta: 500 } });

      const repetido = await prisma.producto
        .create({ data: { codigo: "PV_1", nombre: "Otra", tipo: "PV", unidadStockId: unidadA.id, precioVenta: 500 } })
        .catch((e: unknown) => e);
      expect(codigoDeError(repetido)).toBe("P2002");
    });

    it("Rol y Sucursal: nombre por empresa", async () => {
      await prisma.rol.create({ data: { nombre: "admin" } });
      await prisma.rol.create({ data: { empresaId: "empresa_b", nombre: "admin" } });
      expect(codigoDeError(await prisma.rol.create({ data: { nombre: "admin" } }).catch((e: unknown) => e))).toBe("P2002");

      await prisma.sucursal.create({ data: { nombre: "Central" } });
      await prisma.sucursal.create({ data: { empresaId: "empresa_b", nombre: "Central" } });
      expect(codigoDeError(await prisma.sucursal.create({ data: { nombre: "Central" } }).catch((e: unknown) => e))).toBe("P2002");
    });

    it("la capacidad por defecto de una acción (sucursalId NULL) es única por empresa, no global", async () => {
      await prisma.accion.create({ data: { clave: "accion_x", descripcion: "x" } });
      await prisma.capacidadSucursal.create({ data: { accionClave: "accion_x", habilitado: true } });
      await prisma.capacidadSucursal.create({ data: { empresaId: "empresa_b", accionClave: "accion_x", habilitado: true } });

      const repetida = await prisma.capacidadSucursal.create({ data: { accionClave: "accion_x", habilitado: false } }).catch((e: unknown) => e);
      expect(codigoDeError(repetida)).toBe("P2002");
    });
  });

  describe("FK compuestas: una fila no puede apuntar a otra empresa", () => {
    const prisma = prismaAdmin;
    it("una Mesa de la empresa por defecto no puede colgar de una Sucursal de otra empresa (P2003)", async () => {
      await crearEmpresa("empresa_b");
      const sucursalB = await prisma.sucursal.create({ data: { empresaId: "empresa_b", nombre: "Sucursal B" } });

      const cruzada = await prisma.mesa.create({ data: { sucursalId: sucursalB.id, numero: 1 } }).catch((e: unknown) => e);
      expect(codigoDeError(cruzada)).toBe("P2003");
      expect(await prisma.mesa.count()).toBe(0);

      const propia = await prisma.mesa.create({ data: { empresaId: "empresa_b", sucursalId: sucursalB.id, numero: 1 } });
      expect(propia.empresaId).toBe("empresa_b");
    });

    it("un 1:1 con FK compuesta (SucursalPublica) exige la misma empresa que su Sucursal", async () => {
      await crearEmpresa("empresa_b");
      const sucursalB = await prisma.sucursal.create({ data: { empresaId: "empresa_b", nombre: "Sucursal B" } });

      const cruzada = await prisma.sucursalPublica.create({ data: { sucursalId: sucursalB.id, slug: "b" } }).catch((e: unknown) => e);
      expect(codigoDeError(cruzada)).toBe("P2003");
    });
  });

  describe("plataforma", () => {
    it("una empresa con filas de dominio no se puede borrar (RESTRICT)", async () => {
      await prisma.sucursal.create({ data: { nombre: "Central" } });
      const borrado = await prisma.empresa.delete({ where: { id: EMPRESA_POR_DEFECTO_ID } }).catch((e: unknown) => e);
      expect(codigoDeError(borrado)).toBe("P2003");
    });

    it("un usuario pertenece a una empresa una sola vez", async () => {
      const usuario = await prisma.user.create({ data: { email: "u@test.com" } });
      await prisma.usuarioEmpresa.create({ data: { usuarioId: usuario.id, empresaId: EMPRESA_POR_DEFECTO_ID, rolEmpresa: "gerente" } });
      const repetida = await prisma.usuarioEmpresa.create({ data: { usuarioId: usuario.id, empresaId: EMPRESA_POR_DEFECTO_ID } }).catch((e: unknown) => e);
      expect(codigoDeError(repetida)).toBe("P2002");
    });
  });
});
