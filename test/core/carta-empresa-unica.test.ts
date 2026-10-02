import { describe, expect, it } from "vitest";
import { esPathPermitidoEnHostCarta, urlCartaPublica } from "@/core/carta/host";
import { esHostDeEmpresaUnica, reglasRedirectEmpresaUnica, reglasRewriteEmpresaUnica, urlCartaPublicaConEmpresaUnica } from "@/core/carta/carta-empresa-unica";

const BASE = "carta.hotelesdelneuquen.com.ar";
const SLUG = "hoteles-neuquen";

/** Cómo evalúa Next un `has` de host: valor en minúsculas y sin puerto, regex anclada. */
const coincideHost = (valor: string, host: string) => new RegExp(`^${valor}$`).test(host.split(":", 1)[0].toLowerCase());

describe("CARTA_EMPRESA_UNICA — apagado por defecto", () => {
  it("sin la variable no hay reglas, ni host de empresa única, y los links son los de siempre", () => {
    for (const apagado of [undefined, null, ""]) {
      expect(reglasRewriteEmpresaUnica(BASE, apagado)).toEqual([]);
      expect(reglasRedirectEmpresaUnica(BASE, apagado)).toEqual([]);
      expect(esHostDeEmpresaUnica(BASE, BASE, apagado)).toBe(false);
      expect(urlCartaPublicaConEmpresaUnica(BASE, apagado, SLUG, "centro")).toBe(urlCartaPublica(BASE, SLUG, "centro"));
    }
  });
});

describe("reglasRewriteEmpresaUnica", () => {
  const reglas = reglasRewriteEmpresaUnica(BASE, SLUG);

  it("/ es el portal y /<sucursal> la carta de la empresa configurada, con el slug LITERAL en el destino (nunca capturado del pedido)", () => {
    expect(reglas.map((r) => [r.source, r.destination])).toEqual([
      ["/", `/carta-publica/${SLUG}`],
      ["/:sucursal([a-z0-9][a-z0-9-]*)", `/carta-publica/${SLUG}/:sucursal`],
    ]);
    for (const r of reglas) expect(r.destination).not.toContain(":empresa");
  });

  it("solo aplica al host EXACTO del dominio base: no a <x>.<base>, ni a <base>.evil, ni a <base>X, ni al punto final", () => {
    for (const r of reglas) {
      const valor = r.has[0].value;
      expect(coincideHost(valor, BASE)).toBe(true);
      expect(coincideHost(valor, BASE.toUpperCase())).toBe(true);
      expect(coincideHost(valor, `${BASE}:3000`)).toBe(true);
      for (const otro of [`x.${BASE}`, `${BASE}.evil.com`, `${BASE}x`, `x${BASE}`, `${BASE}.`, "hotelesdelneuquen.com.ar", "cartaXhotelesdelneuquen.com.ar", "app.hotelesdelneuquen.com.ar"]) {
        expect(coincideHost(valor, otro), otro).toBe(false);
      }
    }
  });

  it("todo path que el proxy deja pasar en el host de la empresa única lo reescribe alguna regla (paridad proxy ↔ rewrite)", () => {
    const regexDeSucursal = new RegExp(`^/(${/\(([^)]+)\)$/.exec(reglas[1].source)![1]})/?$`);
    const reescrito = (p: string) => p === reglas[0].source || regexDeSucursal.test(p);
    for (const p of ["/", "/centro", "/centro/", "/a", "/9", "/sucursal-1", "/a-b-c-9", "/login", "/api", "/dashboard"]) {
      expect(esPathPermitidoEnHostCarta(p), p).toBe(true);
      expect(reescrito(p), `${p} lo deja pasar el proxy pero no lo reescribe ninguna regla`).toBe(true);
    }
    for (const p of ["/a/b", "/x.png", "/_next/x", "/api/auth/session", "/-x", "/Centro"]) {
      expect(esPathPermitidoEnHostCarta(p), p).toBe(false);
      expect(reescrito(p), p).toBe(false);
    }
  });

  it("un slug de empresa inválido o un dominio base ausente TIRA (el build falla, no sigue con el add-on a medias)", () => {
    for (const malo of ["X", "a--b", "a.b", "-x", "x-", "a b", " x", "x/y", "a".repeat(64)]) {
      expect(() => reglasRewriteEmpresaUnica(BASE, malo), malo).toThrow(/CARTA_EMPRESA_UNICA/);
      expect(() => reglasRedirectEmpresaUnica(BASE, malo), malo).toThrow(/CARTA_EMPRESA_UNICA/);
    }
    for (const sinBase of [undefined, null, "", "  "]) {
      expect(() => reglasRewriteEmpresaUnica(sinBase, SLUG)).toThrow(/CARTA_DOMINIO_BASE/);
      expect(() => reglasRedirectEmpresaUnica(sinBase, SLUG)).toThrow(/CARTA_DOMINIO_BASE/);
    }
  });

  it("el dominio base se normaliza (mayúsculas y espacios) y sus puntos se escapan", () => {
    const r = reglasRewriteEmpresaUnica(` ${BASE.toUpperCase()} `, SLUG);
    expect(r[0].has[0].value).toBe("carta\\.hotelesdelneuquen\\.com\\.ar");
  });
});

describe("reglasRedirectEmpresaUnica", () => {
  const reglas = reglasRedirectEmpresaUnica(BASE, SLUG);

  it("en el host del dominio base los links /carta-publica/<slug>[/<s>] van a / y /<s>; en otro host (la app), al dominio base", () => {
    expect(reglas.map((r) => [r.source, "has" in r ? "has" : "missing", r.destination])).toEqual([
      [`/carta-publica/${SLUG}`, "has", "/"],
      [`/carta-publica/${SLUG}/:sucursal([a-z0-9][a-z0-9-]{0,62})`, "has", "/:sucursal"],
      [`/carta-publica/${SLUG}`, "missing", `https://${BASE}/`],
      [`/carta-publica/${SLUG}/:sucursal([a-z0-9][a-z0-9-]{0,62})`, "missing", `https://${BASE}/:sucursal`],
    ]);
    for (const r of reglas) expect(r.permanent).toBe(false);
  });

  it("el redirect hacia el dominio base NO actúa en la zona de cartas (<x>.<base>), ni en localhost ni en 127.0.0.1; sí en la app", () => {
    const desdeApp = reglas.filter((r): r is Extract<typeof r, { missing: unknown }> => "missing" in r);
    for (const r of desdeApp) {
      const valor = r.missing[0].value;
      for (const zona of [BASE, `x.${BASE}`, "localhost", "127.0.0.1", `x.${BASE}:3000`]) expect(coincideHost(valor, zona), zona).toBe(true);
      for (const app of ["app.hotelesdelneuquen.com.ar", "hotelesdelneuquen.com.ar", "stockhneuquen.vercel.app"]) expect(coincideHost(valor, app), app).toBe(false);
    }
  });

  it("van antes que las reglas del núcleo: solo el slug configurado (otra empresa sigue su camino por <otra>.<base>)", () => {
    for (const r of reglas) expect(r.source.startsWith(`/carta-publica/${SLUG}`)).toBe(true);
  });
});

describe("esHostDeEmpresaUnica", () => {
  it("es el host exacto del dominio base (sin importar mayúsculas ni puerto), con el add-on activo", () => {
    expect(esHostDeEmpresaUnica(BASE, BASE, SLUG)).toBe(true);
    expect(esHostDeEmpresaUnica(BASE.toUpperCase(), BASE, SLUG)).toBe(true);
    expect(esHostDeEmpresaUnica(`${BASE}:3000`, ` ${BASE} `, SLUG)).toBe(true);
  });

  it("no es el de <x>.<base>, ni <base>.evil, ni <base>X, ni el punto final, ni otro dominio", () => {
    for (const otro of [`x.${BASE}`, `${BASE}.evil.com`, `${BASE}x`, `${BASE}.`, "hotelesdelneuquen.com.ar", null, undefined, ""]) {
      expect(esHostDeEmpresaUnica(otro, BASE, SLUG), String(otro)).toBe(false);
    }
  });

  it("apagado, con slug inválido o sin dominio base: false, y nunca tira", () => {
    for (const slug of [undefined, null, "", "X", "a--b"]) expect(esHostDeEmpresaUnica(BASE, BASE, slug)).toBe(false);
    for (const base of [undefined, null, "", "  "]) expect(esHostDeEmpresaUnica(BASE, base, SLUG)).toBe(false);
  });
});

describe("urlCartaPublicaConEmpresaUnica", () => {
  it("la empresa única, con un dominio real, es https://<base>/[<sucursal>] (sin el slug)", () => {
    expect(urlCartaPublicaConEmpresaUnica(BASE, SLUG, SLUG)).toBe(`https://${BASE}/`);
    expect(urlCartaPublicaConEmpresaUnica(BASE, SLUG, SLUG, "centro")).toBe(`https://${BASE}/centro`);
  });

  it("otra empresa, localhost/*.localhost y el add-on apagado: lo de siempre", () => {
    expect(urlCartaPublicaConEmpresaUnica(BASE, SLUG, "otra", "centro")).toBe(`https://otra.${BASE}/centro`);
    expect(urlCartaPublicaConEmpresaUnica("carta.localhost", "e2e", "e2e", "centro")).toBe("/carta-publica/e2e/centro");
    expect(urlCartaPublicaConEmpresaUnica("localhost", "e2e", "e2e")).toBe("/carta-publica/e2e");
    expect(urlCartaPublicaConEmpresaUnica(BASE, undefined, SLUG, "centro")).toBe(`https://${SLUG}.${BASE}/centro`);
    expect(urlCartaPublicaConEmpresaUnica(undefined, SLUG, SLUG, "centro")).toBe(`/carta-publica/${SLUG}/centro`);
  });
});
