import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { dbDeEmpresa } from "../../src/core/auth/base";
import { resolverCartaPublica, resolverConfigPortal, resolverPortalCarta } from "../../src/core/carta/publica-consulta";

const empresa = { id: EMPRESA_POR_DEFECTO_ID, slug: "principal", nombre: "Principal" };
const OTRA_EMPRESA_ID = "empresa_otra";
const otraEmpresa = { id: OTRA_EMPRESA_ID, slug: "otra", nombre: "Otra empresa" };

/** Una segunda empresa (PROVISIONING: la por defecto sigue siendo la única ACTIVE y `app_empresa_actual()` resuelve) con una sucursal propia. */
async function crearSucursalDeOtraEmpresa(nombre: string): Promise<string> {
  await prismaAdmin.empresa.upsert({
    where: { id: OTRA_EMPRESA_ID },
    update: {},
    create: { id: OTRA_EMPRESA_ID, nombre: "Otra empresa", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" },
  });
  return (await prismaAdmin.sucursal.create({ data: { nombre, empresaId: OTRA_EMPRESA_ID } })).id;
}

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
    await expect(resolverPortalCarta(empresa, dbDeEmpresa(empresa.id))).resolves.toEqual([]);
  });

  it("solo publicada && sucursal.activo entran — a diferencia del registro completo de la carta externa, acá NO se emite lo que no se muestra", async () => {
    await prisma.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: true },
        { sucursalId: norte, slug: "norte", publicada: false },
        { sucursalId: inactiva, slug: "cerrada", publicada: true },
      ],
    });
    const portal = await resolverPortalCarta(empresa, dbDeEmpresa(empresa.id));
    expect(portal.map((p) => p.slug)).toEqual(["central"]);
  });

  it("etiqueta cae al nombre de la sucursal si no está cargada", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    const [entrada] = await resolverPortalCarta(empresa, dbDeEmpresa(empresa.id));
    expect(entrada).toEqual({ slug: "central", etiqueta: "Central", subtitulo: null, posicion: null });
  });

  it("orden por `orden` y después por etiqueta", async () => {
    await prisma.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: true, etiqueta: "Zeta", orden: 1 },
        { sucursalId: norte, slug: "norte", publicada: true, etiqueta: "Alfa", orden: 0 },
      ],
    });
    const portal = await resolverPortalCarta(empresa, dbDeEmpresa(empresa.id));
    expect(portal.map((p) => p.slug)).toEqual(["norte", "central"]);
  });

  it("posicion: x, y y w completos (Decimal → número, h opcional); si falta uno de los tres, null", async () => {
    const sur = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    await prisma.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: true, orden: 0, posX: 12.5, posY: 40, posW: 30.25, posH: 8 },
        { sucursalId: norte, slug: "norte", publicada: true, orden: 1, posX: 50, posY: 60, posW: 25 },
        { sucursalId: sur, slug: "sur", publicada: true, orden: 2, posX: 50, posY: 60, posH: 5 },
      ],
    });
    const portal = await resolverPortalCarta(empresa, dbDeEmpresa(empresa.id));
    expect(portal.map((p) => [p.slug, p.posicion])).toEqual([
      ["central", { x: 12.5, y: 40, w: 30.25, h: 8 }],
      ["norte", { x: 50, y: 60, w: 25, h: null }],
      ["sur", null],
    ]);
  });

  it("aislamiento entre empresas: el portal de una no lista las sucursales publicadas de la otra", async () => {
    const ajena = await crearSucursalDeOtraEmpresa("Ajena");
    await prismaAdmin.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: true },
        { sucursalId: ajena, empresaId: OTRA_EMPRESA_ID, slug: "ajena", publicada: true },
      ],
    });
    expect((await resolverPortalCarta(empresa, dbDeEmpresa(empresa.id))).map((p) => p.slug)).toEqual(["central"]);
    expect((await resolverPortalCarta(otraEmpresa, dbDeEmpresa(otraEmpresa.id))).map((p) => p.slug)).toEqual(["ajena"]);
  });
});

describe("resolverConfigPortal", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("sin fila, el estilo por defecto: sin imagen ni título (grilla)", async () => {
    const e = await resolverConfigPortal(empresa, dbDeEmpresa(empresa.id));
    expect(e.imagenFondo).toBeNull();
    expect(e.valores.portal_titulo).toBe("");
    expect(e.proporcion).toBe("1080/1533");
  });

  it("con fila, usa lo guardado (y VUELVE a validar: un valor inválido cargado a mano cae al default)", async () => {
    await prisma.portalCartaEmpresa.create({
      data: { valores: { portal_titulo: "Nuestras sedes", portal_bg_image_url: "https://x.com/mapa.png", portal_bg_overlay: "0.4", portal_card_bg: "rojo; x" } },
    });
    const e = await resolverConfigPortal(empresa, dbDeEmpresa(empresa.id));
    expect(e.valores.portal_titulo).toBe("Nuestras sedes");
    expect(e.imagenFondo).toBe("https://x.com/mapa.png");
    expect(e.overlay).toBe(0.4);
    expect(e.variablesCss["--portal-card-bg"]).toBeUndefined();
  });

  it("aislamiento entre empresas: cada una ve SU config, y con la base de una no se lee la de la otra ni con el id explícito", async () => {
    await prisma.portalCartaEmpresa.create({ data: { valores: { portal_titulo: "Principal" } } });
    await crearSucursalDeOtraEmpresa("Ajena");
    await prismaAdmin.portalCartaEmpresa.create({ data: { empresaId: OTRA_EMPRESA_ID, valores: { portal_titulo: "Otra" } } });

    expect((await resolverConfigPortal(empresa, dbDeEmpresa(empresa.id))).valores.portal_titulo).toBe("Principal");
    expect((await resolverConfigPortal(otraEmpresa, dbDeEmpresa(otraEmpresa.id))).valores.portal_titulo).toBe("Otra");
    expect((await resolverConfigPortal(otraEmpresa, dbDeEmpresa(empresa.id))).valores.portal_titulo).toBe("");
  });
});

describe("resolverCartaPublica", () => {
  let central: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
  });

  it("null si el slug no existe", async () => {
    await expect(resolverCartaPublica(empresa, "no-existe", dbDeEmpresa(empresa.id))).resolves.toBeNull();
  });

  it("null si existe pero no está publicada", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: false } });
    await expect(resolverCartaPublica(empresa, "central", dbDeEmpresa(empresa.id))).resolves.toBeNull();
  });

  it("null si la sucursal está inactiva, aunque esté publicada", async () => {
    const inactiva = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
    await prisma.sucursalPublica.create({ data: { sucursalId: inactiva, slug: "cerrada", publicada: true } });
    await expect(resolverCartaPublica(empresa, "cerrada", dbDeEmpresa(empresa.id))).resolves.toBeNull();
  });

  it("sin tema (ninguna fila), el estilo es el default del catálogo", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    const r = await resolverCartaPublica(empresa, "central", dbDeEmpresa(empresa.id));
    expect(r).not.toBeNull();
    expect(r!.carta.sucursal.id).toBe(central);
    expect(r!.estilo.valores.restaurante_nombre).toBe("");
  });

  it("con tema guardado pero SIN aplicar, sigue en el default — un borrador nunca se filtra a la carta pública", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, aplicarEnCarta: false, valores: { restaurante_nombre: "Borrador" } } });
    const r = await resolverCartaPublica(empresa, "central", dbDeEmpresa(empresa.id));
    expect(r!.estilo.valores.restaurante_nombre).toBe("");
  });

  it("con tema aplicado, el estilo usa esos valores", async () => {
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    await prisma.temaCartaSucursal.create({ data: { sucursalId: central, aplicarEnCarta: true, valores: { restaurante_nombre: "La Cuadra" } } });
    const r = await resolverCartaPublica(empresa, "central", dbDeEmpresa(empresa.id));
    expect(r!.estilo.valores.restaurante_nombre).toBe("La Cuadra");
  });

  it("aislamiento entre empresas: el mismo slug de sucursal resuelve a la sucursal de CADA empresa", async () => {
    const ajena = await crearSucursalDeOtraEmpresa("Ajena");
    await prismaAdmin.sucursalPublica.createMany({
      data: [
        { sucursalId: central, slug: "central", publicada: true },
        { sucursalId: ajena, empresaId: OTRA_EMPRESA_ID, slug: "central", publicada: true },
      ],
    });
    expect((await resolverCartaPublica(empresa, "central", dbDeEmpresa(empresa.id)))!.carta.sucursal.id).toBe(central);
    expect((await resolverCartaPublica(otraEmpresa, "central", dbDeEmpresa(otraEmpresa.id)))!.carta.sucursal.id).toBe(ajena);
  });

  it("aislamiento entre empresas: un slug publicado solo en la otra empresa da null", async () => {
    const ajena = await crearSucursalDeOtraEmpresa("Ajena");
    await prismaAdmin.sucursalPublica.create({ data: { sucursalId: ajena, empresaId: OTRA_EMPRESA_ID, slug: "solo-ajena", publicada: true } });
    await expect(resolverCartaPublica(empresa, "solo-ajena", dbDeEmpresa(empresa.id))).resolves.toBeNull();
    await expect(resolverCartaPublica(otraEmpresa, "solo-ajena", dbDeEmpresa(otraEmpresa.id))).resolves.not.toBeNull();
  });
});
