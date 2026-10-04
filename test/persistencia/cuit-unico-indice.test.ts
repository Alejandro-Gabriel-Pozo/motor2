import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * E2 paso 5 (ADR-017): un CUIT identifica a un solo proveedor por empresa (`Proveedor(empresaId, cuit)`) y a una sola empresa (`Empresa(cuit)`),
 * y la base lo hace cumplir con índices únicos comunes (Postgres admite varios NULL). La migración antes normaliza los CUIT existentes y frena
 * si queda alguno repetido: ese bloque se prueba corriéndolo contra datos con y sin repetidos.
 *
 * Mutación: borrar cualquiera de los dos índices deja en rojo "rechaza…" (y "los índices existen y son únicos").
 */
const NORTE = "norte";
const IDX_PROVEEDOR = "Proveedor_empresaId_cuit_key";
const IDX_EMPRESA = "Empresa_cuit_key";
const SQL = readFileSync(join(__dirname, "../../prisma/migrations/20261008120000_cuit_unico/migration.sql"), "utf8").replace(/\r\n/g, "\n");
const BACKFILL = SQL.match(/^UPDATE [^;]*;$/gm) ?? [];
const PRECHEQUEO = SQL.match(/DO \$\$[\s\S]*?\n\$\$;/)?.[0] ?? "";
const CREAR_INDICES = SQL.match(/CREATE UNIQUE INDEX[^;]*;/g)?.map((s) => s.replace(/;$/, "")) ?? [];

afterAll(() => prismaAdmin.$disconnect());

let n = 0;
function proveedor(empresaId: string, cuit: string | null) {
  n += 1;
  return prismaAdmin.proveedor.create({ data: { empresaId, codigo: `PRV_${n}`, nombre: `Proveedor ${n}`, cuit } });
}

async function sinIndices() {
  await prismaAdmin.$executeRawUnsafe(`DROP INDEX "${IDX_PROVEEDOR}"`);
  await prismaAdmin.$executeRawUnsafe(`DROP INDEX "${IDX_EMPRESA}"`);
}

async function restaurarIndices() {
  await limpiarBaseDeTest();
  await prismaAdmin.empresa.updateMany({ data: { cuit: null } });
  for (const crear of CREAR_INDICES) await prismaAdmin.$executeRawUnsafe(crear);
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.empresa.updateMany({ data: { cuit: null } });
  await prismaAdmin.empresa.create({ data: { id: NORTE, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
});

describe("índices únicos de CUIT", () => {
  it("los índices existen y son únicos (sin WHERE: comunes, no parciales)", async () => {
    for (const [nombre, columnas] of [[IDX_PROVEEDOR, /\("empresaId", cuit\)/], [IDX_EMPRESA, /\(cuit\)/]] as const) {
      const [fila] = await prismaAdmin.$queryRaw<Array<{ def: string }>>`SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${nombre}`;
      expect(fila?.def, nombre).toMatch(/CREATE UNIQUE INDEX/);
      expect(fila?.def, nombre).toMatch(columnas);
      expect(fila?.def, nombre).not.toMatch(/WHERE/);
    }
  });

  it("rechaza dos proveedores con el mismo CUIT en la misma empresa", async () => {
    await proveedor(EMPRESA_POR_DEFECTO_ID, "30703088534");
    await expect(proveedor(EMPRESA_POR_DEFECTO_ID, "30703088534")).rejects.toThrow(/Unique constraint|Proveedor_empresaId_cuit_key/);
  });

  it("rechaza dejar a un proveedor con el CUIT de otro por UPDATE", async () => {
    await proveedor(EMPRESA_POR_DEFECTO_ID, "30703088534");
    const otro = await proveedor(EMPRESA_POR_DEFECTO_ID, null);
    await expect(prismaAdmin.proveedor.update({ where: { id: otro.id }, data: { cuit: "30703088534" } })).rejects.toThrow();
  });

  it("permite el mismo CUIT en proveedores de OTRA empresa", async () => {
    await proveedor(EMPRESA_POR_DEFECTO_ID, "30703088534");
    await proveedor(NORTE, "30703088534");
    expect(await prismaAdmin.proveedor.count({ where: { cuit: "30703088534" } })).toBe(2);
  });

  it("permite cualquier cantidad de proveedores sin CUIT, en una misma empresa", async () => {
    await proveedor(EMPRESA_POR_DEFECTO_ID, null);
    await proveedor(EMPRESA_POR_DEFECTO_ID, null);
    await proveedor(EMPRESA_POR_DEFECTO_ID, null);
    expect(await prismaAdmin.proveedor.count({ where: { empresaId: EMPRESA_POR_DEFECTO_ID, cuit: null } })).toBe(3);
  });

  it("rechaza dos empresas con el mismo CUIT; las que no tienen CUIT conviven", async () => {
    await prismaAdmin.empresa.update({ where: { id: EMPRESA_POR_DEFECTO_ID }, data: { cuit: "30703088534" } });
    await expect(prismaAdmin.empresa.update({ where: { id: NORTE }, data: { cuit: "30703088534" } })).rejects.toThrow(/Unique constraint|Empresa_cuit_key/);
    await prismaAdmin.empresa.create({ data: { id: "sur", nombre: "Sur", slug: "sur", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    expect(await prismaAdmin.empresa.count({ where: { cuit: null } })).toBe(3); // norte, sur y la testigo (ADR-022); la por defecto tiene CUIT
  });
});

describe("migración: backfill y chequeo previo", () => {
  it("se pudo extraer el backfill, el chequeo y los dos índices del SQL de la migración", () => {
    expect(BACKFILL).toHaveLength(4);
    expect(PRECHEQUEO).toContain("RAISE EXCEPTION");
    expect(CREAR_INDICES).toHaveLength(2);
    expect(CREAR_INDICES.join(" ")).toContain(IDX_PROVEEDOR);
    expect(CREAR_INDICES.join(" ")).toContain(IDX_EMPRESA);
  });

  it("el backfill normaliza (vacío → NULL, separadores → 11 dígitos) y no toca los inválidos ni los ya canónicos", async () => {
    await sinIndices();
    try {
      const vacio = await proveedor(EMPRESA_POR_DEFECTO_ID, "   ");
      const conGuiones = await proveedor(EMPRESA_POR_DEFECTO_ID, " 30-70308853-4 ");
      const conPuntos = await proveedor(EMPRESA_POR_DEFECTO_ID, "20.12345678.6");
      const canonico = await proveedor(EMPRESA_POR_DEFECTO_ID, "27123456780");
      const invalido = await proveedor(EMPRESA_POR_DEFECTO_ID, "30-7030885");
      const letras = await proveedor(EMPRESA_POR_DEFECTO_ID, "ABC-123");
      await prismaAdmin.empresa.update({ where: { id: NORTE }, data: { cuit: "33-69345023-9" } });
      for (const sentencia of BACKFILL) await prismaAdmin.$executeRawUnsafe(sentencia);
      const cuit = async (id: string) => (await prismaAdmin.proveedor.findUniqueOrThrow({ where: { id } })).cuit;
      expect(await cuit(vacio.id)).toBeNull();
      expect(await cuit(conGuiones.id)).toBe("30703088534");
      expect(await cuit(conPuntos.id)).toBe("20123456786");
      expect(await cuit(canonico.id)).toBe("27123456780");
      expect(await cuit(invalido.id)).toBe("30-7030885");
      expect(await cuit(letras.id)).toBe("ABC-123");
      expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: NORTE } })).cuit).toBe("33693450239");
    } finally {
      await restaurarIndices();
    }
  });

  it("con dos proveedores repetidos (tras normalizar) en una empresa se detiene y los nombra; con datos limpios pasa", async () => {
    await sinIndices();
    try {
      const a = await proveedor(EMPRESA_POR_DEFECTO_ID, "30-70308853-4");
      const b = await proveedor(EMPRESA_POR_DEFECTO_ID, "30703088534");
      await proveedor(NORTE, "30703088534"); // el mismo CUIT en otra empresa NO es repetido
      for (const sentencia of BACKFILL) await prismaAdmin.$executeRawUnsafe(sentencia);
      await expect(prismaAdmin.$executeRawUnsafe(PRECHEQUEO)).rejects.toThrow(new RegExp(`empresa ${EMPRESA_POR_DEFECTO_ID}: proveedores .*(${a.id}|${b.id})`));
      await prismaAdmin.proveedor.update({ where: { id: b.id }, data: { cuit: null } });
      await prismaAdmin.$executeRawUnsafe(PRECHEQUEO);
    } finally {
      await restaurarIndices();
    }
  });

  it("con dos empresas repetidas se detiene y las nombra", async () => {
    await sinIndices();
    try {
      await prismaAdmin.empresa.update({ where: { id: EMPRESA_POR_DEFECTO_ID }, data: { cuit: "30-70308853-4" } });
      await prismaAdmin.empresa.update({ where: { id: NORTE }, data: { cuit: "30703088534" } });
      for (const sentencia of BACKFILL) await prismaAdmin.$executeRawUnsafe(sentencia);
      await expect(prismaAdmin.$executeRawUnsafe(PRECHEQUEO)).rejects.toThrow(new RegExp(`Empresas con el mismo CUIT: .*${NORTE}`));
    } finally {
      await restaurarIndices();
    }
  });
});
