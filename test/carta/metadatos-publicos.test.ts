import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La carta se cachea con `unstable_cache` (necesita el caché de Next, que fuera de un pedido no existe): en esta prueba corre directo.
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), unstable_cache: (fn: () => unknown) => fn }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { fijarModulosActivos } from "../setup/modulos";
import { MARCA_PUBLICA } from "../../src/core/carta/marca";
import { generateMetadata as metadatosDelPortal } from "../../src/app/(carta-publica)/carta-publica/[empresa]/page";
import { generateMetadata as metadatosDeLaSucursal } from "../../src/app/(carta-publica)/carta-publica/[empresa]/[sucursal]/page";

/**
 * La parte pública no muestra el nombre de la aplicación: ni «Motor2» ni «ERP» en el título, la descripción, Open Graph ni Twitter (venían del documento raíz, que es el de la administración).
 * Se prueba lo que las páginas entregan a Next (`generateMetadata`) con la base real: la marca fija, el nombre y las secciones de la sucursal que salen de los datos, la dirección canónica del host
 * público, indexable, y la imagen para compartir SOLO si el comercio cargó una.
 */
const SIN_NOMBRE_DE_LA_APP = /motor2|\berp\b/i;
const EMPRESA = "principal";

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

async function sembrarSucursal(opciones: { nombre: string; slug: string; tema?: Record<string, string>; conCarta?: boolean }) {
  const sucursal = await prisma.sucursal.create({ data: { nombre: opciones.nombre } });
  await prisma.sucursalPublica.create({ data: { sucursalId: sucursal.id, slug: opciones.slug, publicada: true, etiqueta: opciones.nombre } });
  if (opciones.tema) await prisma.temaCartaSucursal.create({ data: { sucursalId: sucursal.id, valores: opciones.tema, aplicarEnCarta: true } });
  if (opciones.conCarta) {
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos principales", orden: 1 } });
    const p = await prisma.producto.create({ data: { codigo: "BIFE", nombre: "Bife", tipo: "PV", precioVenta: 1000, unidadStockId: u.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursal.id, productoId: p.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursal.id, productoId: p.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
  }
  return sucursal;
}

/** El objeto de `Metadata` entero, como texto: lo que buscaría un buscador o una vista previa. */
const comoTexto = (m: unknown) => JSON.stringify(m);

describe("metadatos de la carta de una sucursal", () => {
  it("título con la marca, descripción con las secciones, canónica del host público, indexable, Open Graph y Twitter; sin el nombre de la aplicación", async () => {
    await sembrarSucursal({ nombre: "El Pirquinero", slug: "pirquinero", conCarta: true });
    const m = await metadatosDeLaSucursal({ params: Promise.resolve({ empresa: EMPRESA, sucursal: "pirquinero" }) });
    expect(m.title).toBe(`El Pirquinero · Carta · ${MARCA_PUBLICA}`);
    expect(m.description).toBe(`Carta de El Pirquinero — ${MARCA_PUBLICA}. Platos principales.`);
    expect(m.alternates?.canonical).toBe("https://principal.carta.ejemplo.com.ar/pirquinero");
    expect(String(m.metadataBase)).toBe("https://principal.carta.ejemplo.com.ar/");
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.openGraph).toMatchObject({ type: "website", locale: "es_AR", siteName: MARCA_PUBLICA, title: m.title, description: m.description, url: "https://principal.carta.ejemplo.com.ar/pirquinero" });
    expect(m.twitter).toMatchObject({ card: "summary", title: m.title, description: m.description });
    // Sin imagen cargada por el comercio no se inventa ninguna.
    expect((m.openGraph as { images?: unknown }).images).toBeUndefined();
    expect((m.twitter as { images?: unknown }).images).toBeUndefined();
    expect(comoTexto(m)).not.toMatch(SIN_NOMBRE_DE_LA_APP);
  });

  it("el nombre y la descripción que el comercio cargó en el tema mandan, y su imagen https sale en la vista previa", async () => {
    await sembrarSucursal({
      nombre: "Sucursal 3",
      slug: "tres",
      tema: { restaurante_nombre: "La Cantina", restaurante_descripcion: "Pastas caseras frente al lago.", hero_imagen_fondo_url: "https://cdn.ejemplo.com/hero.jpg" },
    });
    const m = await metadatosDeLaSucursal({ params: Promise.resolve({ empresa: EMPRESA, sucursal: "tres" }) });
    expect(m.title).toBe(`La Cantina · Carta · ${MARCA_PUBLICA}`);
    expect(m.description).toBe("Pastas caseras frente al lago.");
    expect((m.openGraph as { images?: unknown }).images).toEqual(["https://cdn.ejemplo.com/hero.jpg"]);
    expect((m.twitter as { images?: unknown }).images).toEqual(["https://cdn.ejemplo.com/hero.jpg"]);
  });

  it("sin dominio de cartas configurado no se declara canónica ni base (solo existe la ruta técnica)", async () => {
    delete process.env.CARTA_DOMINIO_BASE;
    await sembrarSucursal({ nombre: "El Pirquinero", slug: "pirquinero" });
    const m = await metadatosDeLaSucursal({ params: Promise.resolve({ empresa: EMPRESA, sucursal: "pirquinero" }) });
    expect(m.alternates).toBeUndefined();
    expect(m.metadataBase).toBeUndefined();
    expect((m.openGraph as { url?: unknown }).url).toBeUndefined();
    expect(m.title).toBe(`El Pirquinero · Carta · ${MARCA_PUBLICA}`);
  });

  it("con el add-on de empresa única la canónica es la del dominio base pelado", async () => {
    process.env.CARTA_EMPRESA_UNICA_COMPILADO = EMPRESA;
    await sembrarSucursal({ nombre: "El Pirquinero", slug: "pirquinero" });
    const m = await metadatosDeLaSucursal({ params: Promise.resolve({ empresa: EMPRESA, sucursal: "pirquinero" }) });
    expect(m.alternates?.canonical).toBe("https://carta.ejemplo.com.ar/pirquinero");
  });

  it("una carta que no resuelve no define metadatos: queda el texto neutro del layout (lo comprueba el e2e)", async () => {
    expect(await metadatosDeLaSucursal({ params: Promise.resolve({ empresa: EMPRESA, sucursal: "no-existe" }) })).toEqual({});
    expect(await metadatosDelPortal({ params: Promise.resolve({ empresa: "no-existe" }) })).toEqual({});
  });
});

describe("metadatos del portal", () => {
  it("«<marca> · Cartas», la descripción lista las sucursales y la canónica es la raíz del host público", async () => {
    await sembrarSucursal({ nombre: "Centro", slug: "centro" });
    await sembrarSucursal({ nombre: "Costa", slug: "costa" });
    const m = await metadatosDelPortal({ params: Promise.resolve({ empresa: EMPRESA }) });
    expect(m.title).toBe(`${MARCA_PUBLICA} · Cartas`);
    expect(m.description).toBe(`Cartas de ${MARCA_PUBLICA}: Centro, Costa.`);
    expect(m.alternates?.canonical).toBe("https://principal.carta.ejemplo.com.ar/");
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.openGraph).toMatchObject({ type: "website", locale: "es_AR", siteName: MARCA_PUBLICA, url: "https://principal.carta.ejemplo.com.ar/" });
    expect(m.twitter).toMatchObject({ card: "summary" });
    expect(comoTexto(m)).not.toMatch(SIN_NOMBRE_DE_LA_APP);
  });

  it("el título y el logo que el comercio cargó en el portal mandan", async () => {
    await sembrarSucursal({ nombre: "Centro", slug: "centro" });
    await prisma.portalCartaEmpresa.create({ data: { valores: { portal_titulo: "Nuestras sucursales", empresa_logo_url: "https://cdn.ejemplo.com/logo.png" } } });
    const m = await metadatosDelPortal({ params: Promise.resolve({ empresa: EMPRESA }) });
    expect(m.title).toBe(`Nuestras sucursales · ${MARCA_PUBLICA}`);
    expect((m.openGraph as { images?: unknown }).images).toEqual(["https://cdn.ejemplo.com/logo.png"]);
  });
});
