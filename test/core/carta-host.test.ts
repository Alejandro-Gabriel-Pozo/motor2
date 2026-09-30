import { describe, expect, it } from "vitest";
import { armarHostCarta, interpretarHostCarta, reglasRedirectCarta, reglasRewriteCarta } from "@/core/carta/host";

describe("interpretarHostCarta", () => {
  const BASE = "motor2carta.com";

  it("acepta la forma exacta carta-<slug>.<dominioBase>", () => {
    expect(interpretarHostCarta("carta-la-cuadra.motor2carta.com", BASE)).toEqual({ empresaSlug: "la-cuadra" });
  });

  it("ignora el puerto (típico en desarrollo)", () => {
    expect(interpretarHostCarta("carta-e2e.motor2carta.com:3101", BASE)).toEqual({ empresaSlug: "e2e" });
  });

  it("es insensible a mayúsculas", () => {
    expect(interpretarHostCarta("CARTA-La-Cuadra.MOTOR2CARTA.COM", BASE)).toEqual({ empresaSlug: "la-cuadra" });
  });

  it("rechaza el dominio pelado, sin carta-", () => {
    expect(interpretarHostCarta("motor2carta.com", BASE)).toBeNull();
    expect(interpretarHostCarta("la-cuadra.motor2carta.com", BASE)).toBeNull();
  });

  it("rechaza www", () => {
    expect(interpretarHostCarta("www.motor2carta.com", BASE)).toBeNull();
  });

  it("rechaza carta- sin ningún slug de empresa", () => {
    expect(interpretarHostCarta("carta.motor2carta.com", BASE)).toBeNull();
    expect(interpretarHostCarta("carta-.motor2carta.com", BASE)).toBeNull();
  });

  it("rechaza más de un nivel de subdominio de empresa", () => {
    expect(interpretarHostCarta("carta-a.b.motor2carta.com", BASE)).toBeNull();
  });

  it("rechaza el formato viejo de dos niveles carta.<slug>.<dominioBase>", () => {
    expect(interpretarHostCarta("carta.la-cuadra.motor2carta.com", BASE)).toBeNull();
  });

  it("rechaza un host de otro dominio", () => {
    expect(interpretarHostCarta("carta-la-cuadra.otrodominio.com", BASE)).toBeNull();
  });

  it("rechaza un slug con guion al principio o al final", () => {
    expect(interpretarHostCarta("carta--la-cuadra.motor2carta.com", BASE)).toBeNull();
    expect(interpretarHostCarta("carta-la-cuadra-.motor2carta.com", BASE)).toBeNull();
  });

  it("null, vacío o sin dominioBase configurado da null, nunca explota", () => {
    expect(interpretarHostCarta(null, BASE)).toBeNull();
    expect(interpretarHostCarta("", BASE)).toBeNull();
    expect(interpretarHostCarta("carta-la-cuadra.motor2carta.com", "")).toBeNull();
    expect(interpretarHostCarta("carta-la-cuadra.motor2carta.com", null)).toBeNull();
  });

  it("localhost con subdominios (desarrollo/e2e) funciona igual que un dominio real", () => {
    expect(interpretarHostCarta("carta-e2e.localhost", "localhost")).toEqual({ empresaSlug: "e2e" });
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
    const [portal, carta] = reglasRewriteCarta("motor2carta.com");
    expect(portal).toMatchObject({ source: "/", destination: "/carta-publica/:empresa" });
    expect(carta).toMatchObject({ source: "/:sucursal([a-z0-9][a-z0-9-]*)", destination: "/carta-publica/:empresa/:sucursal" });
    expect(portal.has).toEqual(carta.has);
  });

  it("el patrón del host acepta y rechaza lo mismo que interpretarHostCarta", () => {
    const base = "motor2carta.com";
    const re = regexDelHost(base);
    for (const host of ["carta-la-cuadra.motor2carta.com", "carta-e2e.motor2carta.com", "carta.motor2carta.com", "www.motor2carta.com", "carta-a.b.motor2carta.com", "carta--x.motor2carta.com", "carta-x.otro.com"]) {
      expect(re.test(host), host).toBe(interpretarHostCarta(host, base) !== null);
    }
    expect(re.exec("carta-la-cuadra.motor2carta.com")?.groups?.empresa).toBe("la-cuadra");
  });

  it("el punto del dominioBase es literal, no comodín", () => {
    expect(regexDelHost("motor2carta.com").test("carta-x.motor2cartaXcom")).toBe(false);
  });
});

describe("reglasRedirectCarta", () => {
  it("sin dominioBase no hay reglas", () => {
    expect(reglasRedirectCarta(undefined)).toEqual([]);
    expect(reglasRedirectCarta(" ")).toEqual([]);
  });

  it("lleva /carta-publica/<empresa>[/<sucursal>] a la URL limpia, solo en el host de la carta, sin redirección permanente", () => {
    const reglas = reglasRedirectCarta("motor2carta.com");
    expect(reglas.map(({ source, destination, permanent }) => ({ source, destination, permanent }))).toEqual([
      { source: "/carta-publica/:empresa", destination: "/", permanent: false },
      { source: "/carta-publica/:empresa/:sucursal", destination: "/:sucursal", permanent: false },
    ]);
    // El grupo del host NO puede llamarse :empresa: chocaría con el segmento de la ruta.
    for (const r of reglas) expect(r.has[0].value).toContain("?<empresaDelHost>");
    expect(reglas[0].has[0].value.replace("?<empresaDelHost>", "")).toBe(reglasRewriteCarta("motor2carta.com")[0].has[0].value.replace("?<empresa>", ""));
  });
});

describe("armarHostCarta", () => {
  it("es la inversa de interpretarHostCarta", () => {
    const host = armarHostCarta("la-cuadra", "motor2carta.com");
    expect(host).toBe("carta-la-cuadra.motor2carta.com");
    expect(interpretarHostCarta(host, "motor2carta.com")).toEqual({ empresaSlug: "la-cuadra" });
  });
});
