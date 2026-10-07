import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { CLASIFICACION_DE_TABLAS, tablasDeClase } from "../setup/clasificacion-de-tablas";

/**
 * Estructura que deja la migración `multiempresa_estructura` (ADR-007, paso A2): instalación multiempresa-capable activada con UNA
 * empresa. El catálogo de la base se lee de `pg_catalog` (no del schema.prisma) para que un cambio en la migración o un modelo nuevo
 * sin `empresaId` rompa acá. El RLS (paso A6) se prueba en test/aislamiento; acá las unicidades y FK son propiedades de la estructura y se ejercitan como dueño (`prismaAdmin`).
 */
// Las clases salen de la clasificación DECLARADA (`test/setup/clasificacion-de-tablas.ts`): una tabla nueva o que cambia de clase rompe estos tests hasta que se la declare, en vez de un contador que se «arregla» a mano.
const TABLAS_DE_CONSOLA = tablasDeClase("CONSOLA");
const GLOBALES = tablasDeClase("GLOBAL");
// ModuloEmpresa (P4) e Invitacion (E5) llevan `empresaId` pero lo escribe la plataforma indicando la empresa: sin default `app_empresa_actual()` y con FK simple a Empresa.
// Las cinco de identidad de la consola de plataforma (E4, ADR-012/019) no tienen empresa: son de plataforma, no de ninguna empresa.
const PLATAFORMA = [...tablasDeClase("EMPRESA"), ...tablasDeClase("DE_EMPRESA_ESCRITA_POR_LA_PLATAFORMA"), ...TABLAS_DE_CONSOLA];

function codigoDeError(e: unknown): string | undefined {
  return e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
}

async function tablasPorEmpresa(): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ tabla: string }>>`
    SELECT c.table_name AS tabla
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'empresaId' AND c.table_name NOT IN ('UsuarioEmpresa', 'ModuloEmpresa', 'Invitacion')
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
    it("las tablas por empresa DECLARADAS son exactamente las que tienen empresaId NOT NULL con default app_empresa_actual(); las globales y ninguna otra quedan afuera", async () => {
      const conEmpresa = await tablasPorEmpresa();
      expect(conEmpresa).toEqual(tablasDeClase("POR_EMPRESA"));
      for (const g of GLOBALES) expect(conEmpresa).not.toContain(g);
      expect(conEmpresa).not.toContain("Empresa");

      const columnas = await prisma.$queryRaw<Array<{ tabla: string; nullable: string; predeterminado: string | null }>>`
        SELECT table_name AS tabla, is_nullable AS nullable, column_default AS predeterminado
          FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'empresaId' AND table_name NOT IN ('UsuarioEmpresa', 'ModuloEmpresa', 'Invitacion')`;
      for (const c of columnas) {
        expect(c.nullable, c.tabla).toBe("NO");
        expect(c.predeterminado, c.tabla).toContain("app_empresa_actual()");
      }

      // Como dueño: information_schema solo muestra las tablas sobre las que el rol tiene algún privilegio y motor2_app no tiene ninguno sobre las de la consola.
      const todas = await prismaAdmin.$queryRaw<Array<{ tabla: string }>>`
        SELECT table_name AS tabla FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
      const sinEmpresa = todas.map((t) => t.tabla).filter((t) => !conEmpresa.includes(t)).sort();
      expect(sinEmpresa).toEqual([...GLOBALES, ...PLATAFORMA].sort());
      expect(todas.map((x) => x.tabla).sort(), "toda tabla de la base está declarada, y toda declarada existe").toEqual(Object.keys(CLASIFICACION_DE_TABLAS).sort());
    });

    it("toda FK entre dos tablas por empresa es compuesta e incluye empresaId; ninguna FK a una tabla global lo incluye", async () => {
      const conEmpresa = new Set(await tablasPorEmpresa());
      const fks = await prisma.$queryRaw<Array<{ nombre: string; origen: string; destino: string; columnas: string[] }>>`
        SELECT c.conname::text AS nombre,
               (SELECT relname::text FROM pg_class WHERE oid = c.conrelid) AS origen,
               (SELECT relname::text FROM pg_class WHERE oid = c.confrelid) AS destino,
               ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k ORDER BY k) AS columnas
          FROM pg_constraint c
         WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`;

      const entreTablasPorEmpresa = fks.filter((f) => conEmpresa.has(f.origen) && conEmpresa.has(f.destino));
      // Sin recuento fijo (antes «105», con una nota por cada migración que lo movía): lo que importa es que NINGUNA FK entre tablas por empresa deje de incluir `empresaId`, y eso lo verifica el bucle de abajo
      // para todas las que existan. Que haya FK entre tablas por empresa es lo único que se exige como mínimo.
      expect(entreTablasPorEmpresa.length).toBeGreaterThan(0);
      for (const f of entreTablasPorEmpresa) {
        expect(f.columnas, f.nombre).toHaveLength(2);
        expect(f.columnas, f.nombre).toContain("empresaId");
      }

      const haciaGlobales = fks.filter((f) => conEmpresa.has(f.origen) && GLOBALES.includes(f.destino));
      expect(haciaGlobales.length).toBeGreaterThan(0);
      for (const f of haciaGlobales) expect(f.columnas, f.nombre).not.toContain("empresaId");

      const haciaEmpresa = fks.filter((f) => f.destino === "Empresa" && conEmpresa.has(f.origen));
      expect(haciaEmpresa.map((f) => f.origen).sort(), "cada tabla por empresa tiene su FK a Empresa").toEqual(tablasDeClase("POR_EMPRESA"));
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

    it("ADR-022: sin contexto devuelve NULL aunque haya UNA sola empresa ACTIVE (ya no hay respaldo) y la definición de la función no consulta Empresa", async () => {
      await prismaAdmin.empresa.update({ where: { id: "empresa_testigo" }, data: { estado: "SUSPENDED" } });
      expect(await prismaAdmin.empresa.count({ where: { estado: "ACTIVE" } })).toBe(1);
      const [{ e }] = await prismaSinEmpresa.$queryRaw<Array<{ e: string | null }>>`SELECT app_empresa_actual() AS e`;
      expect(e).toBeNull();
      expect(await prismaSinEmpresa.sucursal.count()).toBe(0); // el RLS no muestra nada sin contexto
      const error = await prismaSinEmpresa.sucursal.create({ data: { nombre: "Sin contexto" } }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(Error); // el DEFAULT es NULL y la columna es NOT NULL
      const [{ definicion }] = await prismaAdmin.$queryRaw<Array<{ definicion: string }>>`SELECT pg_get_functiondef('app_empresa_actual'::regproc) AS definicion`;
      expect(definicion).toContain("app.empresa_id");
      expect(definicion).not.toContain('"Empresa"');
      const [{ con }] = await prismaAdmin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.empresa_id', 'cualquiera', true)`;
        return tx.$queryRaw<Array<{ con: string | null }>>`SELECT app_empresa_actual() AS con`;
      });
      expect(con).toBe("cualquiera");
    });

    it("con dos empresas ACTIVE y sin contexto devuelve NULL y crear una fila falla (se equivoca hacia el lado seguro)", async () => {
      await crearEmpresa("empresa_b", "ACTIVE");
      const [{ e }] = await prismaSinEmpresa.$queryRaw<Array<{ e: string | null }>>`SELECT app_empresa_actual() AS e`;
      expect(e).toBeNull();

      const error = await prismaSinEmpresa.sucursal.create({ data: { nombre: "Sin contexto" } }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(Error);
      expect(await prismaSinEmpresa.sucursal.count()).toBe(0);
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
      await prisma.rol.create({ data: { nombre: "admin", clave: "admin" } });
      await prisma.rol.create({ data: { empresaId: "empresa_b", nombre: "admin", clave: "admin" } });
      expect(codigoDeError(await prisma.rol.create({ data: { nombre: "admin", clave: "admin" } }).catch((e: unknown) => e))).toBe("P2002");

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
