import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TIPOS_DE_PUESTO } from "../../src/core/pos/puesto";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * M1 del mostrador (ADR-039) — migración 20261027100000_m1_puesto_mostrador: `Mesa.tipo` (SALON | MOSTRADOR), el CHECK que ata el tipo al número (el mostrador es la mesa 0), la FK compuesta con discriminador
 * `Cuenta (empresaId, mesaId, tipoMesa) -> Mesa (empresaId, id, tipo)` y el CHECK que dice que el mostrador no lleva comensales. Cada regla rechaza, con el nombre de su restricción, una fila que la rompe;
 * lo que ninguna escritura puede saltear lo impone la BASE, no el caso de uso. El ciclo subir/bajar/subir de la migración está en `test/aislamiento/m1-mostrador-subir-bajar-subir.test.ts`.
 *
 * Mutación: comentar en una copia local de `migration.sql` la línea de un CHECK (o de la FK nueva) deja en rojo solo sus casos.
 */
afterAll(() => prismaAdmin.$disconnect());

let sucursalId: string;
let otraSucursalId: string;
let usuarioId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  sucursalId = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
  otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  usuarioId = (await prisma.user.create({ data: { email: "cajero@test.com" } })).id;
});

const mostrador = (sucursal = sucursalId) => prisma.mesa.create({ data: { sucursalId: sucursal, numero: 0, tipo: "MOSTRADOR" } });
const cuentaDe = (mesaId: string, datos: { tipoMesa?: string; comensales?: number | null } = {}) => prisma.cuenta.create({ data: { mesaId, abiertaPorId: usuarioId, ...datos } });

describe("la migración deja las columnas, las reglas y la clave foránea con discriminador puestas", () => {
  it("Mesa.tipo y Cuenta.tipoMesa son TEXT NOT NULL con default SALON; las filas que nacen sin decirlo son de salón", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; valor: string | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS valor
      FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'Mesa' AND column_name = 'tipo') OR (table_name = 'Cuenta' AND column_name = 'tipoMesa')) ORDER BY table_name`;
    expect(columnas).toEqual([
      { tabla: "Cuenta", columna: "tipoMesa", tipo: "text", es_nulable: "NO", valor: "'SALON'::text" },
      { tabla: "Mesa", columna: "tipo", tipo: "text", es_nulable: "NO", valor: "'SALON'::text" },
    ]);
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    const cuenta = await cuentaDe(mesa.id, { comensales: 2 });
    expect([mesa.tipo, cuenta.tipoMesa]).toEqual(["SALON", "SALON"]);
  });

  it("paridad: los tipos que acepta cada CHECK son exactamente TIPOS_DE_PUESTO", async () => {
    const definiciones = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`
      SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conname IN ('Mesa_tipo_chk', 'Cuenta_tipoMesa_chk') ORDER BY 1`;
    expect(definiciones.map((d) => d.nombre)).toEqual(["Cuenta_tipoMesa_chk", "Mesa_tipo_chk"]);
    for (const d of definiciones) {
      const valores = [...d.definicion.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]).sort();
      expect(valores, d.nombre).toEqual([...TIPOS_DE_PUESTO].sort());
    }
    // Y el SQL de la migración (lo que se aplica en una base real) lista los mismos valores.
    const sql = readFileSync(join(__dirname, "../../prisma/migrations/20261027100000_m1_puesto_mostrador/migration.sql"), "utf8");
    for (const nombre of ["Mesa_tipo_chk", "Cuenta_tipoMesa_chk"]) {
      const linea = sql.split("\n").find((l) => l.includes(`CONSTRAINT "${nombre}"`));
      expect([...(linea ?? "").matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort(), nombre).toEqual([...TIPOS_DE_PUESTO].sort());
    }
  });

  it("no hay políticas de RLS ni privilegios nuevos: las de Mesa y Cuenta no miran el tipo", async () => {
    const politicas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('Mesa', 'Cuenta') AND (coalesce(qual, '') ILIKE '%tipo%' OR coalesce(with_check, '') ILIKE '%tipo%')`;
    expect(politicas).toEqual([]);
  });
});

describe("el tipo del puesto y su número (Mesa_tipo_chk, Mesa_numero_segun_tipo_chk, un mostrador por sucursal)", () => {
  it("el mostrador es la mesa 0 y solo él: una mesa de salón con el 0, o un mostrador con otro número, se rechazan", async () => {
    await expect(mostrador()).resolves.toMatchObject({ numero: 0, tipo: "MOSTRADOR" });
    await expect(prisma.mesa.create({ data: { sucursalId: otraSucursalId, numero: 0, tipo: "SALON" } })).rejects.toThrow(/Mesa_numero_segun_tipo_chk/);
    await expect(prisma.mesa.create({ data: { sucursalId: otraSucursalId, numero: 5, tipo: "MOSTRADOR" } })).rejects.toThrow(/Mesa_numero_segun_tipo_chk/);
  });

  it("un tipo fuera de la lista se rechaza (Mesa_tipo_chk)", async () => {
    await expect(prisma.mesa.create({ data: { sucursalId, numero: 5, tipo: "TERRAZA" } })).rejects.toThrow(/Mesa_tipo_chk/);
  });

  it("un segundo mostrador en la misma sucursal choca (P2002, Mesa_sucursalId_numero_key); en otra sucursal está permitido", async () => {
    await mostrador();
    const segundo = await mostrador().catch((e: unknown) => e);
    expect(segundo, "choque de unicidad").toMatchObject({ code: "P2002" });
    await expect(mostrador(otraSucursalId)).resolves.toMatchObject({ numero: 0 });
    expect(await prisma.mesa.count({ where: { tipo: "MOSTRADOR" } })).toBe(2);
  });
});

describe("la cuenta lleva el tipo de su puesto, y la base lo impone (Cuenta_empresaId_mesaId_tipoMesa_fkey)", () => {
  it("una cuenta de MOSTRADOR sobre el puesto mostrador anda, y sin comensales", async () => {
    const m = await mostrador();
    await expect(cuentaDe(m.id, { tipoMesa: "MOSTRADOR" })).resolves.toMatchObject({ tipoMesa: "MOSTRADOR", comensales: null });
  });

  it("una cuenta de SALÓN sobre el puesto mostrador se rechaza (23503): el default no puede esconder el mostrador", async () => {
    const m = await mostrador();
    await expect(cuentaDe(m.id)).rejects.toThrow(/Cuenta_empresaId_mesaId_tipoMesa_fkey/);
    await expect(cuentaDe(m.id, { tipoMesa: "SALON", comensales: null })).rejects.toThrow(/Cuenta_empresaId_mesaId_tipoMesa_fkey/);
  });

  it("una cuenta de MOSTRADOR sobre una mesa de salón se rechaza (23503)", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 3 } });
    await expect(cuentaDe(mesa.id, { tipoMesa: "MOSTRADOR" })).rejects.toThrow(/Cuenta_empresaId_mesaId_tipoMesa_fkey/);
  });

  it("el mostrador no lleva comensales (Cuenta_comensales_segun_tipo_chk, 23514); el salón sí", async () => {
    const m = await mostrador();
    await expect(cuentaDe(m.id, { tipoMesa: "MOSTRADOR", comensales: 2 })).rejects.toThrow(/Cuenta_comensales_segun_tipo_chk/);
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 3 } });
    await expect(cuentaDe(mesa.id, { comensales: 2 })).resolves.toMatchObject({ comensales: 2 });
  });

  it("un tipo de cuenta fuera de la lista se rechaza (Cuenta_tipoMesa_chk)", async () => {
    const m = await mostrador();
    await expect(cuentaDe(m.id, { tipoMesa: "TERRAZA" })).rejects.toThrow(/Cuenta_tipoMesa_chk/);
  });

  it("el tipo de un puesto con cuentas no cambia (ON UPDATE RESTRICT): ni mesa → mostrador, ni mostrador → mesa", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 3 } });
    await cuentaDe(mesa.id, { comensales: 2 });
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "Mesa" SET "tipo" = 'MOSTRADOR', "numero" = 0 WHERE id = '${mesa.id}'`)).rejects.toThrow(/Cuenta_empresaId_mesaId_tipoMesa_fkey/);

    const m = await mostrador(otraSucursalId);
    await cuentaDe(m.id, { tipoMesa: "MOSTRADOR" });
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "Mesa" SET "tipo" = 'SALON', "numero" = 1 WHERE id = '${m.id}'`)).rejects.toThrow(/Cuenta_empresaId_mesaId_tipoMesa_fkey/);
    expect(await prisma.mesa.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ tipo: "MOSTRADOR", numero: 0 });
  });

  it("sin cuentas el tipo sí se puede corregir (la restricción es sobre lo que ya tiene cuentas)", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 9 } });
    await prismaAdmin.$executeRawUnsafe(`UPDATE "Mesa" SET "tipo" = 'MOSTRADOR', "numero" = 0 WHERE id = '${mesa.id}'`);
    expect(await prisma.mesa.findUniqueOrThrow({ where: { id: mesa.id } })).toMatchObject({ tipo: "MOSTRADOR", numero: 0 });
  });

  it("en M1 el mostrador tiene a lo sumo UNA cuenta abierta (el índice de «una abierta por mesa» sigue en pie)", async () => {
    const m = await mostrador();
    await cuentaDe(m.id, { tipoMesa: "MOSTRADOR" });
    await expect(cuentaDe(m.id, { tipoMesa: "MOSTRADOR" })).rejects.toThrow(/Cuenta_una_abierta_por_mesa_key/);
  });

  it("el puesto con cuentas no se borra (RESTRICT)", async () => {
    const m = await mostrador();
    await cuentaDe(m.id, { tipoMesa: "MOSTRADOR" });
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "Mesa" WHERE id = '${m.id}'`)).rejects.toThrow(/Cuenta_empresaId_mesaId_tipoMesa_fkey/);
  });
});
