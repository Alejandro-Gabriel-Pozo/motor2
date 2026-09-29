import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { resolverRegistroTenants } from "../../src/core/carta/registro-consulta";

/**
 * resolverRegistroTenants contra Postgres real (docs/plan-registro-tenants-2026-09-24.md, M3): solo las sucursales con fila en
 * `SucursalPublica` (opt-in, D3), todas las filas —también las no publicadas o de una sucursal inactiva, con `activo: false`
 * (D4)— y en una sola consulta.
 */
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc";

describe("resolverRegistroTenants", () => {
  let central: string;
  let norte: string;
  let cerrada: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    cerrada = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
    // Una cuarta sucursal SIN fila: no tiene que aparecer.
    await prisma.sucursal.create({ data: { nombre: "Sin portal" } });
  });

  it("sin filas → lista vacía (no es un error)", async () => {
    const r = await resolverRegistroTenants(prisma);
    expect(r.version).toBe(1);
    expect(r.tenants).toEqual([]);
  });

  it("solo las sucursales con fila; inactiva o no publicada → activo:false pero aparecen igual", async () => {
    await prisma.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: true, sheetId: SHEET, orden: 1, posX: 12.5, posY: 40, posW: 8 },
        { sucursalId: norte, slug: "norte", publicada: false, orden: 2 },
        { sucursalId: cerrada, slug: "cerrada", publicada: true, sheetId: SHEET, orden: 3 },
      ],
    });
    const { tenants } = await resolverRegistroTenants(prisma);
    expect(tenants.map((t) => [t.slug, t.activo])).toEqual([
      ["central", true],
      ["norte", false],
      ["cerrada", false],
    ]);
    expect(tenants[0]).toMatchObject({ etiqueta: "Central", sucursalId: central, posicion: { x: 12.5, y: 40, w: 8, h: null }, sheetId: SHEET, sheetMenuNombre: "Menu" });
    expect(typeof tenants[0].posicion?.x).toBe("number");
  });

  it("menuDesdeMotor2 y sucursalId salen tal cual", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true, sheetId: SHEET, menuDesdeMotor2: true, etiqueta: "Hostería Central", subtituloPortal: "Frente al lago" } });
    const { tenants } = await resolverRegistroTenants(prisma);
    expect(tenants).toEqual([
      {
        slug: "central",
        etiqueta: "Hostería Central",
        dominio: null,
        subtitulo: "Frente al lago",
        posicion: null,
        orden: 0,
        activo: true,
        sucursalId: central,
        menuDesdeMotor2: true,
        temaDesdeMotor2: false,
        sheetId: SHEET,
        sheetMenuNombre: "Menu",
      },
    ]);
  });

  it("temaDesdeMotor2 (docs/plan-tema-carta-2026-09-24.md, M6): true con el tema aplicado, false en borrador o sin tema", async () => {
    await prisma.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: true, sheetId: SHEET, orden: 1 },
        { sucursalId: norte, slug: "norte", publicada: true, sheetId: SHEET, orden: 2 },
        { sucursalId: cerrada, slug: "cerrada", publicada: true, sheetId: SHEET, orden: 3 },
      ],
    });
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, aplicarEnCarta: true, valores: { color_marca: "red" } } });
    await prisma.temaCartaSucursal.create({ data: { sucursalId: norte, aplicarEnCarta: false, valores: { color_marca: "blue" } } });
    const { tenants } = await resolverRegistroTenants(prisma);
    expect(tenants.map((t) => [t.slug, t.temaDesdeMotor2])).toEqual([
      ["central", true],
      ["norte", false],
      ["cerrada", false],
    ]);
  });

  it("hace exactamente una consulta (sucursalPublica.findMany, con la sucursal incluida)", async () => {
    await prisma.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central" },
        { sucursalId: norte, slug: "norte" },
      ],
    });
    // Con un tema aplicado: el select anidado de temaCarta tampoco suma consultas.
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, aplicarEnCarta: true } });
    const operaciones: string[] = [];
    const contador = prisma.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            operaciones.push(`${model}.${operation}`);
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const r = await resolverRegistroTenants(contador);
    expect(r.tenants).toHaveLength(2);
    expect(r.tenants.map((t) => t.temaDesdeMotor2)).toEqual([true, false]);
    expect(operaciones).toEqual(["SucursalPublica.findMany"]);
  });
});
