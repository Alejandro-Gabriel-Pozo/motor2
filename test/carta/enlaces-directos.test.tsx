import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La carta se cachea con `unstable_cache` (necesita el caché de Next, que fuera de un pedido no existe): en esta prueba corre directo.
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), unstable_cache: (fn: () => unknown) => fn }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { fijarModulosActivos } from "../setup/modulos";
import { hrefDeCartaPublica } from "../../src/components/carta-publica/metadatos";
import PortalPage from "../../src/app/(carta-publica)/carta-publica/[empresa]/page";
import CartaPage from "../../src/app/(carta-publica)/carta-publica/[empresa]/[sucursal]/page";

/**
 * Los enlaces entre las páginas públicas apuntan DIRECTO a la URL final: el portal a la carta de cada sucursal y la carta de vuelta al portal. Antes iban a la ruta técnica
 * `/carta-publica/<empresa>/<sucursal>`, que el host de la carta redirigía (307) a `/<sucursal>`: un salto de más en cada toque. Cuando no hay host de carta al que ir (sin dominio de cartas, o
 * `localhost`/`*.localhost` en desarrollo y e2e) siguen yendo por la ruta técnica, que se sirve en el host actual y que ese redirect lleva a la URL limpia (lo prueban los e2e de subdominio).
 */
let dominioBaseAntes: string | undefined;
let unicaAntes: string | undefined;
beforeEach(async () => {
  dominioBaseAntes = process.env.CARTA_DOMINIO_BASE;
  unicaAntes = process.env.CARTA_EMPRESA_UNICA_COMPILADO;
  delete process.env.CARTA_EMPRESA_UNICA_COMPILADO;
  await limpiarBaseDeTest();
  await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["carta"]);
  for (const [nombre, slug] of [["Centro", "centro"], ["Costa", "costa"]]) {
    const s = await prisma.sucursal.create({ data: { nombre } });
    await prisma.sucursalPublica.create({ data: { sucursalId: s.id, slug, publicada: true } });
  }
});
afterEach(() => {
  if (dominioBaseAntes === undefined) delete process.env.CARTA_DOMINIO_BASE;
  else process.env.CARTA_DOMINIO_BASE = dominioBaseAntes;
  if (unicaAntes === undefined) delete process.env.CARTA_EMPRESA_UNICA_COMPILADO;
  else process.env.CARTA_EMPRESA_UNICA_COMPILADO = unicaAntes;
});

const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
async function portal() {
  return renderToStaticMarkup(await PortalPage({ params: Promise.resolve({ empresa: "principal" }) }));
}
async function carta() {
  return renderToStaticMarkup(await CartaPage({ params: Promise.resolve({ empresa: "principal", sucursal: "centro" }) }));
}

describe("enlaces directos entre las páginas públicas", () => {
  it("con dominio de cartas real: el portal enlaza a https://<empresa>.<dominio>/<sucursal> y la carta vuelve a https://<empresa>.<dominio>/, sin la ruta técnica", async () => {
    process.env.CARTA_DOMINIO_BASE = "carta.ejemplo.com.ar";
    const enPortal = hrefs(await portal());
    expect(enPortal).toEqual(expect.arrayContaining(["https://principal.carta.ejemplo.com.ar/centro", "https://principal.carta.ejemplo.com.ar/costa"]));
    expect(enPortal.join(" ")).not.toContain("/carta-publica/");
    const enCarta = hrefs(await carta());
    expect(enCarta).toContain("https://principal.carta.ejemplo.com.ar/");
    expect(enCarta.join(" ")).not.toContain("/carta-publica/");
  });

  it("con el add-on de empresa única: al dominio base pelado", async () => {
    process.env.CARTA_DOMINIO_BASE = "carta.ejemplo.com.ar";
    process.env.CARTA_EMPRESA_UNICA_COMPILADO = "principal";
    expect(hrefs(await portal())).toEqual(expect.arrayContaining(["https://carta.ejemplo.com.ar/centro", "https://carta.ejemplo.com.ar/costa"]));
    expect(hrefs(await carta())).toContain("https://carta.ejemplo.com.ar/");
  });

  it("en desarrollo (localhost) y sin dominio de cartas: la ruta técnica, que se sirve en el host actual", async () => {
    for (const base of ["carta.localhost", "localhost", undefined]) {
      if (base === undefined) delete process.env.CARTA_DOMINIO_BASE;
      else process.env.CARTA_DOMINIO_BASE = base;
      expect(hrefs(await portal()), String(base)).toEqual(expect.arrayContaining(["/carta-publica/principal/centro", "/carta-publica/principal/costa"]));
      expect(hrefs(await carta()), String(base)).toContain("/carta-publica/principal");
    }
  });

  it("hrefDeCartaPublica: portal y sucursal", () => {
    process.env.CARTA_DOMINIO_BASE = "carta.ejemplo.com.ar";
    expect(hrefDeCartaPublica("hotel")).toBe("https://hotel.carta.ejemplo.com.ar/");
    expect(hrefDeCartaPublica("hotel", "centro")).toBe("https://hotel.carta.ejemplo.com.ar/centro");
  });
});
