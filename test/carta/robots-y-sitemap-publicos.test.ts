import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { fijarModulosActivos } from "../setup/modulos";
import { GET as robots } from "../../src/app/(carta-publica)/carta-publica/[empresa]/robots.txt/route";
import { GET as sitemap } from "../../src/app/(carta-publica)/carta-publica/[empresa]/sitemap.xml/route";
import appRobots from "../../src/app/robots";

/**
 * `robots.txt` y `sitemap.xml` del host público de la carta. El sitemap sale del MISMO lector que dibuja el portal: lista el portal y las sucursales publicadas y activas de la empresa con el
 * módulo Carta, y nada más (ni una sucursal sin publicar, ni una inactiva). Una empresa que no existe o que no publicó nada da el mismo 404 (S-24). La aplicación, en cambio, prohíbe todo.
 */
const ORIGEN = "https://principal.carta.ejemplo.com.ar";
const pedir = (handler: typeof robots, empresa: string) => handler(new Request("http://x.test/"), { params: Promise.resolve({ empresa }) });
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

let dominioBaseAntes: string | undefined;
let unicaAntes: string | undefined;
beforeEach(async () => {
  dominioBaseAntes = process.env.CARTA_DOMINIO_BASE;
  unicaAntes = process.env.CARTA_EMPRESA_UNICA_COMPILADO;
  process.env.CARTA_DOMINIO_BASE = "carta.ejemplo.com.ar";
  delete process.env.CARTA_EMPRESA_UNICA_COMPILADO;
  await limpiarBaseDeTest();
  await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["carta"]);
});
afterEach(() => {
  if (dominioBaseAntes === undefined) delete process.env.CARTA_DOMINIO_BASE;
  else process.env.CARTA_DOMINIO_BASE = dominioBaseAntes;
  if (unicaAntes === undefined) delete process.env.CARTA_EMPRESA_UNICA_COMPILADO;
  else process.env.CARTA_EMPRESA_UNICA_COMPILADO = unicaAntes;
});

async function sucursal(nombre: string, slug: string, opciones: { publicada?: boolean; activo?: boolean } = {}) {
  const s = await prisma.sucursal.create({ data: { nombre, activo: opciones.activo ?? true } });
  await prisma.sucursalPublica.create({ data: { sucursalId: s.id, slug, publicada: opciones.publicada ?? true } });
}

describe("sitemap.xml", () => {
  it("lista el portal y SOLO las sucursales públicas (publicadas y activas)", async () => {
    await sucursal("Centro", "centro");
    await sucursal("Costa", "costa");
    await sucursal("Borrador", "borrador", { publicada: false });
    await sucursal("Cerrada", "cerrada", { activo: false });
    const r = await pedir(sitemap, "principal");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/xml");
    expect(locs(await r.text()).sort()).toEqual([`${ORIGEN}/`, `${ORIGEN}/centro`, `${ORIGEN}/costa`]);
  });

  it("con el add-on de empresa única las URL son las del dominio base pelado", async () => {
    process.env.CARTA_EMPRESA_UNICA_COMPILADO = "principal";
    await sucursal("Centro", "centro");
    expect(locs(await (await pedir(sitemap, "principal")).text())).toEqual(["https://carta.ejemplo.com.ar/", "https://carta.ejemplo.com.ar/centro"]);
  });

  it("404 igual para una empresa que no existe, una que no publicó nada, y la que no tiene el módulo Carta", async () => {
    await sucursal("Borrador", "borrador", { publicada: false });
    expect((await pedir(sitemap, "no-existe")).status).toBe(404);
    expect((await pedir(sitemap, "principal")).status).toBe(404);
    await sucursal("Centro", "centro");
    expect((await pedir(sitemap, "principal")).status).toBe(200);
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, []);
    expect((await pedir(sitemap, "principal")).status).toBe(404);
  });

  it("sin dominio de cartas configurado no hay dirección pública que listar: 404", async () => {
    delete process.env.CARTA_DOMINIO_BASE;
    await sucursal("Centro", "centro");
    expect((await pedir(sitemap, "principal")).status).toBe(404);
  });
});

describe("robots.txt de la carta", () => {
  it("permite todo y apunta al sitemap del host público", async () => {
    await sucursal("Centro", "centro");
    const r = await pedir(robots, "principal");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/plain");
    expect(await r.text()).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${ORIGEN}/sitemap.xml\n`);
  });

  it("404 para una empresa que no existe o que no publicó nada", async () => {
    expect((await pedir(robots, "no-existe")).status).toBe(404);
    await sucursal("Borrador", "borrador", { publicada: false });
    expect((await pedir(robots, "principal")).status).toBe(404);
  });
});

describe("robots de la aplicación", () => {
  it("prohíbe rastrear todo", () => {
    expect(appRobots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
