import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { resolverCartaPublica, resolverPortalCarta } from "../../src/core/carta/publica-consulta";

/**
 * ADR-006, Fase 2: capa de lectura de la carta pública nueva contra Postgres real. La lógica de qué PV entran a la carta ya
 * está probada en menu-consulta.test.ts — acá se prueba la composición nueva: qué sucursales entran al portal, el orden, y
 * cuándo se aplica el tema o se cae al default.
 */
describe("resolverPortalCarta", () => {
  let central: string;
  let norte: string;
  let inactiva: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    inactiva = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
  });

  it("sin filas, lista vacía", async () => {
    await expect(resolverPortalCarta(prisma)).resolves.toEqual([]);
  });

  it("solo publicada && sucursal.activo entran — a diferencia del registro completo de la carta externa, acá NO se emite lo que no se muestra", async () => {
    await prisma.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: true },
        { sucursalId: norte, slug: "norte", publicada: false },
        { sucursalId: inactiva, slug: "cerrada", publicada: true },
      ],
    });
    const portal = await resolverPortalCarta(prisma);
    expect(portal.map((p) => p.slug)).toEqual(["central"]);
  });

  it("etiqueta cae al nombre de la sucursal si no está cargada", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    const [entrada] = await resolverPortalCarta(prisma);
    expect(entrada).toEqual({ slug: "central", etiqueta: "Central", subtitulo: null });
  });

  it("orden por `orden` y después por etiqueta", async () => {
    await prisma.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: true, etiqueta: "Zeta", orden: 1 },
        { sucursalId: norte, slug: "norte", publicada: true, etiqueta: "Alfa", orden: 0 },
      ],
    });
    const portal = await resolverPortalCarta(prisma);
    expect(portal.map((p) => p.slug)).toEqual(["norte", "central"]);
  });
});

describe("resolverCartaPublica", () => {
  let central: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
  });

  it("null si el slug no existe", async () => {
    await expect(resolverCartaPublica("no-existe", prisma)).resolves.toBeNull();
  });

  it("null si existe pero no está publicada", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: false } });
    await expect(resolverCartaPublica("central", prisma)).resolves.toBeNull();
  });

  it("null si la sucursal está inactiva, aunque esté publicada", async () => {
    const inactiva = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
    await prisma.sucursalPublica.create({ data: { sucursalId: inactiva, slug: "cerrada", publicada: true } });
    await expect(resolverCartaPublica("cerrada", prisma)).resolves.toBeNull();
  });

  it("sin tema (ninguna fila), el estilo es el default del catálogo", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    const r = await resolverCartaPublica("central", prisma);
    expect(r).not.toBeNull();
    expect(r!.carta.sucursal.id).toBe(central);
    expect(r!.estilo.valores.restaurante_nombre).toBe("");
  });

  it("con tema guardado pero SIN aplicar, sigue en el default — un borrador nunca se filtra a la carta pública", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, aplicarEnCarta: false, valores: { restaurante_nombre: "Borrador" } } });
    const r = await resolverCartaPublica("central", prisma);
    expect(r!.estilo.valores.restaurante_nombre).toBe("");
  });

  it("con tema aplicado, el estilo usa esos valores", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, aplicarEnCarta: true, valores: { restaurante_nombre: "La Cuadra" } } });
    const r = await resolverCartaPublica("central", prisma);
    expect(r!.estilo.valores.restaurante_nombre).toBe("La Cuadra");
  });
});
