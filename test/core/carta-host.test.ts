import { describe, expect, it } from "vitest";
import {
  armarHostCarta,
  esHostDeZonaCarta,
  esPathPermitidoEnHostCarta,
  interpretarHostCarta,
  patronHostZonaCarta,
  reglasRedirectAppACarta,
  reglasRedirectCarta,
  reglasRewriteCarta,
  urlCartaPublica,
} from "@/core/carta/host";

describe("interpretarHostCarta", () => {
  const BASE = "carta.zuluhub.com.ar";

  it("acepta la forma exacta <slug>.<dominioBase>", () => {
    expect(interpretarHostCarta("la-cuadra.carta.zuluhub.com.ar", BASE)).toEqual({ empresaSlug: "la-cuadra" });
  });

  it("ignora el puerto (típico en desarrollo)", () => {
    expect(interpretarHostCarta("e2e.carta.zuluhub.com.ar:3101", BASE)).toEqual({ empresaSlug: "e2e" });
  });

  it("es insensible a mayúsculas", () => {
    expect(interpretarHostCarta("La-Cuadra.CARTA.ZuluHub.com.ar", BASE)).toEqual({ empresaSlug: "la-cuadra" });
  });

  it("rechaza el dominio base pelado (no es la carta de nadie)", () => {
    expect(interpretarHostCarta("carta.zuluhub.com.ar", BASE)).toBeNull();
    expect(interpretarHostCarta("zuluhub.com.ar", BASE)).toBeNull();
  });

  it("rechaza más de un nivel de subdominio de empresa", () => {
    expect(interpretarHostCarta("a.b.carta.zuluhub.com.ar", BASE)).toBeNull();
  });

  it("el prefijo `carta-` ya no es parte del esquema: carta-x.<dominioBase> es la empresa «carta-x», nunca «x»", () => {
    // Con el esquema nuevo `carta-x` sería el SLUG de una empresa llamada así (se busca en la base y no existe), nunca la empresa `x`.
    expect(interpretarHostCarta("carta-la-cuadra.carta.zuluhub.com.ar", BASE)).toEqual({ empresaSlug: "carta-la-cuadra" });
    expect(interpretarHostCarta("carta-la-cuadra.carta.zuluhub.com.ar", BASE)?.empresaSlug).not.toBe("la-cuadra");
  });

  it("rechaza un host de otro dominio", () => {
    expect(interpretarHostCarta("la-cuadra.otrodominio.com", BASE)).toBeNull();
    expect(interpretarHostCarta("la-cuadra.carta.zuluhub.com.ar.evil.com", BASE)).toBeNull();
  });

  it("rechaza un slug con guion al principio o al final", () => {
    expect(interpretarHostCarta("-la-cuadra.carta.zuluhub.com.ar", BASE)).toBeNull();
    expect(interpretarHostCarta("la-cuadra-.carta.zuluhub.com.ar", BASE)).toBeNull();
  });

  it("null, vacío o sin dominioBase configurado da null, nunca explota", () => {
    expect(interpretarHostCarta(null, BASE)).toBeNull();
    expect(interpretarHostCarta("", BASE)).toBeNull();
    expect(interpretarHostCarta("la-cuadra.carta.zuluhub.com.ar", "")).toBeNull();
    expect(interpretarHostCarta("la-cuadra.carta.zuluhub.com.ar", null)).toBeNull();
  });

  it("carta.localhost con subdominios (desarrollo/e2e) funciona igual que un dominio real", () => {
    expect(interpretarHostCarta("e2e.carta.localhost", "carta.localhost")).toEqual({ empresaSlug: "e2e" });
  });
});

describe("esHostDeZonaCarta", () => {
  const BASE = "carta.zuluhub.com.ar";

  it("es zona de cartas el dominio base y cualquier subdominio suyo, sea carta válida o no", () => {
    for (const host of ["carta.zuluhub.com.ar", "la-cuadra.carta.zuluhub.com.ar", "a.b.carta.zuluhub.com.ar", "x.carta.zuluhub.com.ar:3000", "X.CARTA.ZULUHUB.COM.AR", "x.carta.zuluhub.com.ar."]) {
      expect(esHostDeZonaCarta(host, BASE), host).toBe(true);
    }
  });

  it("no lo son el host de la app ni dominios que solo terminan parecido", () => {
    for (const host of ["app.zuluhub.com.ar", "zuluhub.com.ar", "localhost", "xcarta.zuluhub.com.ar", "carta.zuluhub.com.ar.evil.com", "carta-zuluhub.com.ar"]) {
      expect(esHostDeZonaCarta(host, BASE), host).toBe(false);
    }
  });

  it("sin dominio base o sin host no hay zona", () => {
    expect(esHostDeZonaCarta("x.carta.zuluhub.com.ar", undefined)).toBe(false);
    expect(esHostDeZonaCarta("x.carta.zuluhub.com.ar", " ")).toBe(false);
    expect(esHostDeZonaCarta(null, BASE)).toBe(false);
  });

  it("el patrón de `has` de Next acepta y rechaza lo mismo", () => {
    const re = new RegExp(`^(?:${patronHostZonaCarta(BASE)})$`);
    for (const host of ["carta.zuluhub.com.ar", "la-cuadra.carta.zuluhub.com.ar"]) expect(re.test(host), host).toBe(true);
    for (const host of ["app.zuluhub.com.ar", "xcarta.zuluhub.comXar", "carta-zuluhub.com.ar"]) expect(re.test(host), host).toBe(false);
  });
});

describe("esPathPermitidoEnHostCarta", () => {
  it("permite la raíz y UN segmento con forma de slug", () => {
    for (const p of ["/", "/la-cuadra", "/central/", "/a1"]) expect(esPathPermitidoEnHostCarta(p), p).toBe(true);
  });

  it("todo lo demás es 404: la API, el cron, el login, la app y los paths de más de un segmento", () => {
    for (const p of ["/api/auth/signin", "/api/cron/sincronizar-dolar", "/api/auth", "/login/x", "/mesas/abc", "/carta/tema", "/a/b", "//evil", "/%2e%2e/api", "/.env", "/robots.txt", "/Login", "/-x", "/a_b"]) {
      expect(esPathPermitidoEnHostCarta(p), p).toBe(false);
    }
  });
});

describe("reglasRewriteCarta", () => {
  // Next arma la regex del `has` de host como ^(?:value)$ y expone los grupos con nombre como :param.
  const regexDelHost = (base: string) => new RegExp(`^(?:${reglasRewriteCarta(base)[0].has[0].value})$`);

  it("sin dominioBase no hay reglas", () => {
    expect(reglasRewriteCarta(undefined)).toEqual([]);
    expect(reglasRewriteCarta("")).toEqual([]);
    expect(reglasRewriteCarta("  ")).toEqual([]);
  });

  it("reescribe / al portal y /<sucursal> a la carta, capturando la empresa del host", () => {
    const [portal, carta] = reglasRewriteCarta("carta.zuluhub.com.ar");
    expect(portal).toMatchObject({ source: "/", destination: "/carta-publica/:empresa" });
    expect(carta).toMatchObject({ source: "/:sucursal([a-z0-9][a-z0-9-]*)", destination: "/carta-publica/:empresa/:sucursal" });
    expect(portal.has).toEqual(carta.has);
  });

  it("el patrón del host acepta y rechaza lo mismo que interpretarHostCarta", () => {
    const base = "carta.zuluhub.com.ar";
    const re = regexDelHost(base);
    for (const host of ["la-cuadra.carta.zuluhub.com.ar", "e2e.carta.zuluhub.com.ar", "carta.zuluhub.com.ar", "www.zuluhub.com.ar", "a.b.carta.zuluhub.com.ar", "-x.carta.zuluhub.com.ar", "x.otro.com"]) {
      expect(re.test(host), host).toBe(interpretarHostCarta(host, base) !== null);
    }
    expect(re.exec("la-cuadra.carta.zuluhub.com.ar")?.groups?.empresa).toBe("la-cuadra");
  });

  it("el punto del dominioBase es literal, no comodín", () => {
    expect(regexDelHost("carta.zuluhub.com.ar").test("x.cartaXzuluhub.com.ar")).toBe(false);
  });

  it("lo que sirve el rewrite (/ y /<sucursal>) coincide con lo que el proxy deja pasar en el host de la carta", () => {
    const [, carta] = reglasRewriteCarta("carta.zuluhub.com.ar");
    const reSucursal = new RegExp(`^${carta.source.replace(":sucursal", "")}$`);
    for (const p of ["/central", "/a-b", "/x9", "/Central", "/-x", "/a/b", "/api/auth"]) {
      expect(esPathPermitidoEnHostCarta(p), p).toBe(reSucursal.test(p) || p === "/");
    }
  });
});

describe("reglasRedirectCarta", () => {
  it("sin dominioBase no hay reglas", () => {
    expect(reglasRedirectCarta(undefined)).toEqual([]);
    expect(reglasRedirectCarta(" ")).toEqual([]);
  });

  it("lleva /carta-publica/<empresa>[/<sucursal>] a la URL limpia, solo en el host de la carta, sin redirección permanente", () => {
    const reglas = reglasRedirectCarta("carta.zuluhub.com.ar");
    expect(reglas.map(({ source, destination, permanent }) => ({ source, destination, permanent }))).toEqual([
      { source: "/carta-publica/:empresa([a-z0-9][a-z0-9-]{0,62})", destination: "/", permanent: false },
      { source: "/carta-publica/:empresa([a-z0-9][a-z0-9-]{0,62})/:sucursal([a-z0-9][a-z0-9-]{0,62})", destination: "/:sucursal", permanent: false },
    ]);
    // El grupo del host NO puede llamarse :empresa: chocaría con el segmento de la ruta.
    for (const r of reglas) expect(r.has[0].value).toContain("?<empresaDelHost>");
    expect(reglas[0].has[0].value.replace("?<empresaDelHost>", "")).toBe(reglasRewriteCarta("carta.zuluhub.com.ar")[0].has[0].value.replace("?<empresa>", ""));
  });
});

describe("reglasRedirectAppACarta", () => {
  const BASE = "carta.zuluhub.com.ar";
  const regexMissing = () => new RegExp(`^(?:${reglasRedirectAppACarta(BASE)[0].missing[0].value})$`);

  it("sin dominioBase no hay reglas (instalación sin subdominio: la carta se sirve por path)", () => {
    expect(reglasRedirectAppACarta(undefined)).toEqual([]);
    expect(reglasRedirectAppACarta(" ")).toEqual([]);
  });

  it("lleva /carta-publica/<empresa>[/<sucursal>] al host de la carta, sin redirección permanente", () => {
    expect(reglasRedirectAppACarta(BASE).map(({ source, destination, permanent }) => ({ source, destination, permanent }))).toEqual([
      { source: "/carta-publica/:empresa([a-z0-9][a-z0-9-]{0,62})", destination: "https://:empresa.carta.zuluhub.com.ar/", permanent: false },
      { source: "/carta-publica/:empresa([a-z0-9][a-z0-9-]{0,62})/:sucursal([a-z0-9][a-z0-9-]{0,62})", destination: "https://:empresa.carta.zuluhub.com.ar/:sucursal", permanent: false },
    ]);
  });

  it("los parámetros solo aceptan forma de slug: la redirección no copia texto arbitrario al destino", () => {
    for (const regla of reglasRedirectAppACarta(BASE)) {
      const fuente = regla.source.replace(/:\w+(\([^)]*\))/g, "$1").replace(/^\/carta-publica\//, "");
      const re = new RegExp(`^${fuente}$`);
      for (const malo of ["x.evil.com", "x@evil.com", "x%0d%0a", "X", "-x", "x/../y", "a".repeat(64)]) expect(re.test(malo), malo).toBe(false);
    }
  });

  it("aplica en el host de la app y en cualquier otro, pero no en el host de la carta ni en localhost pelado", () => {
    const re = regexMissing();
    // `missing` = "no coincide con esto": los hosts que matchean quedan afuera de la redirección.
    for (const excluido of ["principal.carta.zuluhub.com.ar", "localhost", "127.0.0.1"]) expect(re.test(excluido), excluido).toBe(true);
    for (const redirige of ["app.zuluhub.com.ar", "motor2-demo.vercel.app", "app-e2e.localhost", "carta.zuluhub.com.ar", "a.b.carta.zuluhub.com.ar"]) expect(re.test(redirige), redirige).toBe(false);
  });

  it("no tiene grupos de captura (Next no debe interpretarlos como parámetros)", () => {
    expect(new RegExp(`${reglasRedirectAppACarta(BASE)[0].missing[0].value}|`).exec("")?.length).toBe(1);
  });

  it("es disjunta de reglasRedirectCarta: el host de la carta nunca cae en las dos", () => {
    const host = "principal.carta.zuluhub.com.ar";
    expect(interpretarHostCarta(host, BASE)).not.toBeNull();
    expect(regexMissing().test(host)).toBe(true);
  });
});

describe("urlCartaPublica", () => {
  it("con un dominio base real apunta directo al host de la carta (sin depender del redirect)", () => {
    expect(urlCartaPublica("carta.zuluhub.com.ar", "principal")).toBe("https://principal.carta.zuluhub.com.ar/");
    expect(urlCartaPublica("carta.zuluhub.com.ar", "principal", "lacuadra")).toBe("https://principal.carta.zuluhub.com.ar/lacuadra");
    expect(urlCartaPublica(" Carta.ZuluHub.com.ar ", "principal", "lacuadra")).toBe("https://principal.carta.zuluhub.com.ar/lacuadra");
  });

  it("sin dominio base, o con localhost / *.localhost (desarrollo y e2e), queda el path /carta-publica/...", () => {
    for (const base of [undefined, null, "", "  ", "localhost", "dev.localhost", "carta.localhost"]) {
      expect(urlCartaPublica(base, "e2e")).toBe("/carta-publica/e2e");
      expect(urlCartaPublica(base, "e2e", "central")).toBe("/carta-publica/e2e/central");
    }
  });

  it("la URL directa resuelve a la misma empresa que interpretarHostCarta", () => {
    const { hostname } = new URL(urlCartaPublica("carta.zuluhub.com.ar", "la-cuadra", "x"));
    expect(interpretarHostCarta(hostname, "carta.zuluhub.com.ar")).toEqual({ empresaSlug: "la-cuadra" });
  });
});

describe("armarHostCarta", () => {
  it("es la inversa de interpretarHostCarta", () => {
    const host = armarHostCarta("la-cuadra", "carta.zuluhub.com.ar");
    expect(host).toBe("la-cuadra.carta.zuluhub.com.ar");
    expect(interpretarHostCarta(host, "carta.zuluhub.com.ar")).toEqual({ empresaSlug: "la-cuadra" });
  });
});
