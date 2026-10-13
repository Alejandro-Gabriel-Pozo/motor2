import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { dbDeEmpresa } from "../../src/server/sesion/base";
import { actualizarActivaProveedor, actualizarProveedor, altaProveedor } from "../../src/server/actions/catalogo/proveedores";

/**
 * M1 (Paquete 2, C20): clasificación del proveedor en la base (migración 20261015110000_proveedor_ofrece_productos_y_servicios).
 * Seis cosas: (1) la forma de las dos columnas; (2) el CHECK existe y está validado; (3) el CHECK rechaza «ninguno» (con su nombre) y deja pasar los tres estados válidos;
 * (3b) dos ediciones CONCURRENTES, cada una válida por sí sola, no pueden dejar «ninguno»: gana el CHECK sobre la fila combinada; (4) el código de hoy (alta, edición, activar)
 * sigue andando y no toca las columnas; (5) otra empresa no puede cambiar la clasificación de un proveedor ajeno (RLS); (6) la migración es idempotente.
 *
 * Mutación: sacar el CHECK de la migración (y volver a migrar) deja en rojo (3) y (3b); cambiar el DEFAULT de `ofreceProductos` a false, (1) y (4); correr (5) con
 * `prismaAdmin` (que salta la RLS) deja en rojo (5); quitar un `IF NOT EXISTS`, (6).
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261015110000_proveedor_ofrece_productos_y_servicios");
const CHECK = "Proveedor_ofrece_productos_o_servicios_chk";
const A = "empresa_principal";
const B = "norte";

function sentencias(archivo: string): string[] {
  return readFileSync(join(CARPETA, archivo), "utf8")
    .replace(/\r\n/g, "\n")
    .split(";\n")
    .map((s) =>
      s
        .split("\n")
        .filter((linea) => !linea.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
}

async function correrMigracion() {
  for (const sentencia of sentencias("migration.sql")) await prismaAdmin.$executeRawUnsafe(sentencia);
}

const columnas = () =>
  prismaAdmin.$queryRaw<Array<{ nombre: string; tipo: string; nulo: string; defecto: string | null }>>`
    SELECT column_name AS nombre, data_type AS tipo, is_nullable AS nulo, column_default AS defecto
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Proveedor' ORDER BY column_name`;

const restricciones = () =>
  prismaAdmin.$queryRaw<Array<{ nombre: string; validada: boolean; definicion: string }>>`
    SELECT conname::text AS nombre, convalidated AS validada, pg_get_constraintdef(oid) AS definicion
    FROM pg_constraint WHERE conrelid = '"Proveedor"'::regclass AND contype = 'c' ORDER BY 1`;

const clasificacion = async (id: string) => {
  const p = await prismaAdmin.proveedor.findUniqueOrThrow({ where: { id } });
  return [p.ofreceProductos, p.ofreceServicios];
};

async function crearProveedor(empresaId: string, nombre: string) {
  return prismaAdmin.proveedor.create({ data: { empresaId, codigo: `PRV_${nombre}`, nombre } });
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
});

describe("1. forma de las columnas", () => {
  it("ofreceProductos y ofreceServicios son boolean NOT NULL con default true y false", async () => {
    const porNombre = Object.fromEntries((await columnas()).map((c) => [c.nombre, c]));
    expect(porNombre.ofreceProductos).toMatchObject({ tipo: "boolean", nulo: "NO", defecto: "true" });
    expect(porNombre.ofreceServicios).toMatchObject({ tipo: "boolean", nulo: "NO", defecto: "false" });
  });
});

describe("1b. el default lo pone la base (lo que usa el código anterior, que no conoce las columnas)", () => {
  it("un INSERT que no nombra las columnas deja (productos=true, servicios=false)", async () => {
    await prismaAdmin.$executeRaw`INSERT INTO "Proveedor" ("id","empresaId","codigo","nombre") VALUES ('prov_sin_columnas', ${A}, 'PRV_SC', 'Sin columnas')`;
    expect(await clasificacion("prov_sin_columnas")).toEqual([true, false]);
  });
});

describe("2. el CHECK", () => {
  it("existe, exige al menos una de las dos y está validado (la migración corrió VALIDATE)", async () => {
    const chk = (await restricciones()).find((r) => r.nombre === CHECK);
    expect(chk, "falta el CHECK").toBeDefined();
    expect(chk!.validada).toBe(true);
    expect(chk!.definicion).toMatch(/"ofreceProductos"\s+OR\s+"ofreceServicios"/);
  });
});

describe("3. validación: «ninguno» es imposible", () => {
  it("un UPDATE a (false, false) falla con el nombre del CHECK y deja la fila como estaba", async () => {
    const p = await crearProveedor(A, "Uno");
    await expect(prismaAdmin.$executeRaw`UPDATE "Proveedor" SET "ofreceProductos" = false, "ofreceServicios" = false WHERE id = ${p.id}`).rejects.toThrow(new RegExp(CHECK));
    expect(await clasificacion(p.id)).toEqual([true, false]);
  });

  it("un INSERT con (false, false) falla con el nombre del CHECK", async () => {
    await expect(prismaAdmin.proveedor.create({ data: { empresaId: A, codigo: "PRV_NINGUNO", nombre: "Ninguno", ofreceProductos: false, ofreceServicios: false } })).rejects.toThrow(
      new RegExp(CHECK),
    );
    expect(await prismaAdmin.proveedor.count({ where: { nombre: "Ninguno" } })).toBe(0);
  });

  it.each([
    [false, true],
    [true, true],
    [true, false],
  ])("los estados válidos pasan: (productos=%s, servicios=%s)", async (productos, servicios) => {
    const p = await crearProveedor(A, `P${productos}${servicios}`);
    await prismaAdmin.proveedor.update({ where: { id: p.id }, data: { ofreceProductos: productos, ofreceServicios: servicios } });
    expect(await clasificacion(p.id)).toEqual([productos, servicios]);
  });
});

describe("3b. concurrencia: dos ediciones válidas por separado no pueden dejar «ninguno»", () => {
  it("(true, true): una apaga «productos» y otra, a la vez, apaga «servicios». Gana la primera y la segunda choca con el CHECK sobre la fila combinada", async () => {
    const p = await crearProveedor(A, "Carrera");
    await prismaAdmin.proveedor.update({ where: { id: p.id }, data: { ofreceServicios: true } });

    let liberarPrimera!: () => void;
    const hastaLiberar = new Promise<void>((r) => (liberarPrimera = r));
    let primeraTieneLaFila!: () => void;
    const primeraLaTiene = new Promise<void>((r) => (primeraTieneLaFila = r));

    // La primera transacción apaga «productos» (la fila queda en (false, true), válida) y NO termina hasta que la segunda esté esperando el candado.
    const primera = prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "Proveedor" SET "ofreceProductos" = false WHERE id = ${p.id}`;
      primeraTieneLaFila();
      await hastaLiberar;
    });
    await primeraLaTiene;
    // La segunda apagaría «servicios» (sola, (true, false) sería válida): se queda esperando a la primera.
    const segunda = prismaAdmin.$executeRaw`UPDATE "Proveedor" SET "ofreceServicios" = false WHERE id = ${p.id}`.then(
      () => null,
      (e: unknown) => e,
    );
    for (let intento = 0; intento < 100; intento++) {
      const esperando = await prismaAdmin.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%"ofreceServicios" = false%'`;
      if (esperando[0]!.n > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    liberarPrimera();
    await primera;

    expect(String(await segunda)).toContain(CHECK);
    expect(await clasificacion(p.id), "queda lo que dejó la primera: nunca (false, false)").toEqual([false, true]);
  });
});

describe("4. compatibilidad: el código de hoy sigue andando y no toca las columnas", () => {
  it("el alta crea el proveedor como «productos» (el default de la base)", async () => {
    const r = await altaProveedor({ nombre: "Nuevo" });
    expect(r.ok, r.mensaje).toBe(true);
    if (!r.ok) return;
    expect(await clasificacion(r.id)).toEqual([true, false]);
  });

  it("editar el contacto y activar/desactivar no cambian la clasificación", async () => {
    const p = await crearProveedor(A, "Mixto");
    await prismaAdmin.proveedor.update({ where: { id: p.id }, data: { ofreceServicios: true } });
    const edicion = await actualizarProveedor(p.id, { contacto: "Ana", telefono: "299 555 0000" });
    expect(edicion.ok, edicion.mensaje).toBe(true);
    expect(await clasificacion(p.id)).toEqual([true, true]);
    expect((await actualizarActivaProveedor(p.id, false)).ok).toBe(true);
    expect((await actualizarActivaProveedor(p.id, true)).ok).toBe(true);
    expect(await clasificacion(p.id)).toEqual([true, true]);
  });
});

describe("5. aislamiento entre empresas", () => {
  it("la empresa B no puede cambiar la clasificación de un proveedor de A (0 filas) y la fila de A queda igual", async () => {
    await prismaAdmin.empresa.create({ data: { id: B, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const deA = await crearProveedor(A, "DeA");
    const { count } = await dbDeEmpresa(B).proveedor.updateMany({ where: { id: deA.id }, data: { ofreceServicios: true, ofreceProductos: false } });
    expect(count).toBe(0);
    expect(await clasificacion(deA.id)).toEqual([true, false]);
    // …y la propia sí puede.
    const deB = await crearProveedor(B, "DeB");
    expect((await dbDeEmpresa(B).proveedor.updateMany({ where: { id: deB.id }, data: { ofreceServicios: true } })).count).toBe(1);
    expect(await clasificacion(deB.id)).toEqual([true, true]);
  });
});

describe("6. idempotencia de la migración", () => {
  it("volver a correr migration.sql sobre la base ya migrada no falla y deja el mismo catálogo", async () => {
    const antes = { columnas: await columnas(), restricciones: await restricciones() };
    await correrMigracion();
    await correrMigracion();
    expect({ columnas: await columnas(), restricciones: await restricciones() }).toEqual(antes);
  });

  it("los proveedores que ya estaban conservan sus datos y su clasificación al re-correr la migración", async () => {
    const p = await crearProveedor(A, "Previo");
    await prismaAdmin.proveedor.update({ where: { id: p.id }, data: { ofreceProductos: false, ofreceServicios: true } });
    await correrMigracion();
    expect(await clasificacion(p.id)).toEqual([false, true]);
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: p.id } })).nombre).toBe("Previo");
  });
});
