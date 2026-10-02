import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "../../src/proxy";
import { ENCABEZADO_RUTA_PEDIDA } from "../../src/core/navegacion/volver";

const BASE = "carta.zuluhub.com.ar";
const pedir = (host: string, path: string, cookie?: string) =>
  proxy(new NextRequest(`http://${host}${path}`, { headers: { host, ...(cookie ? { cookie } : {}) } }));
/** Encabezados que el proxy le pasa a la aplicación (`NextResponse.next({ request })` los publica con este prefijo). */
const aLaApp = (r: Response, nombre: string) => r.headers.get(`x-middleware-request-${nombre}`);

describe("proxy — host de la carta", () => {
  const previo = process.env.CARTA_DOMINIO_BASE;
  beforeEach(() => {
    process.env.CARTA_DOMINIO_BASE = BASE;
  });
  afterEach(() => {
    if (previo === undefined) delete process.env.CARTA_DOMINIO_BASE;
    else process.env.CARTA_DOMINIO_BASE = previo;
  });

  it("la raíz y /<sucursal> de <empresa>.<base> pasan a la aplicación", () => {
    for (const path of ["/", "/centro", "/centro/"]) {
      const r = pedir(`acme.${BASE}`, path);
      expect(r.status, path).toBe(200);
      expect(r.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("en el host de una carta es 404 todo lo que no es la raíz o un segmento: auth, cron, API, la aplicación, archivos y rutas de más de un segmento (un segmento suelto como /login se reescribe a la carta y da 404 ahí: lo prueba el e2e)", () => {
    for (const path of ["/api/auth/signin", "/api/auth/session", "/api/cron/sincronizar-dolar", "/api/cron/sincronizar-ipc", "/mesas/abc", "/carta/tema", "/a/b", "/api/x", "/x.png", "/carta-publica/acme"]) {
      const r = pedir(`acme.${BASE}`, path);
      expect(r.status, path).toBe(404);
      expect(r.headers.get("x-middleware-next"), path).toBeNull();
    }
  });

  it("el dominio base pelado, un subdominio de dos niveles y el puerto: 404 / reglas coherentes", () => {
    expect(pedir(BASE, "/").status).toBe(404);
    expect(pedir(BASE, "/api/auth/signin").status).toBe(404);
    expect(pedir(`a.b.${BASE}`, "/").status).toBe(404);
    expect(pedir(`acme.${BASE}:3000`, "/").status).toBe(200);
    expect(pedir(`ACME.${BASE.toUpperCase()}`, "/api/auth/signin").status).toBe(404);
  });

  it("el 404 no filtra la aplicación y lleva las cabeceras de seguridad", () => {
    const r = pedir(`acme.${BASE}`, "/api/auth/signin");
    expect(r.headers.get("strict-transport-security")).toBeTruthy();
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("un host que solo se parece (termina igual sin el punto) NO es de la zona de cartas", () => {
    const r = pedir(`xcarta.zuluhub.com.ar`, "/login");
    expect(r.status).toBe(200); // host de la app
    expect(aLaApp(r, "content-security-policy")).toContain("nonce-");
  });
});

describe("proxy — host de la aplicación", () => {
  beforeEach(() => {
    delete process.env.CARTA_DOMINIO_BASE;
  });

  it("pone un nonce distinto por pedido, en la CSP de la respuesta y en la que ve la aplicación", () => {
    const a = pedir("app.example.com", "/dashboard");
    const b = pedir("app.example.com", "/dashboard");
    const cspA = a.headers.get("content-security-policy")!;
    const nonceA = /'nonce-([^']+)'/.exec(cspA)![1];
    expect(aLaApp(a, "x-nonce")).toBe(nonceA);
    expect(aLaApp(a, "content-security-policy")).toBe(cspA);
    expect(cspA).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(b.headers.get("content-security-policy")).not.toBe(cspA);
  });

  it("un cliente no puede falsear el nonce ni la CSP que lee la aplicación", () => {
    const r = proxy(new NextRequest("http://app.example.com/dashboard", { headers: { host: "app.example.com", "x-nonce": "falso", "content-security-policy": "script-src *" } }));
    expect(aLaApp(r, "x-nonce")).not.toBe("falso");
    expect(aLaApp(r, "content-security-policy")).not.toContain("script-src *");
  });

  it("sin cookie de sesión recuerda la ruta pedida (menos /login); con cualquiera de las tres cookies, no", () => {
    expect(aLaApp(pedir("app.example.com", "/mesas/1?x=2&_rsc=abc"), ENCABEZADO_RUTA_PEDIDA)).toBe("/mesas/1?x=2");
    expect(aLaApp(pedir("app.example.com", "/login"), ENCABEZADO_RUTA_PEDIDA)).toBeNull();
    for (const nombre of ["authjs.session-token", "__Secure-authjs.session-token", "__Host-authjs.session-token"]) {
      expect(aLaApp(pedir("app.example.com", "/mesas/1", `${nombre}=abc`), ENCABEZADO_RUTA_PEDIDA), nombre).toBeNull();
    }
  });

  it("no pisa la CSP estática de la carta por path ni de /api (esas no llevan nonce)", () => {
    for (const path of ["/carta-publica/acme", "/carta-publica/acme/centro", "/api/auth/session", "/api/cron/sincronizar-dolar"]) {
      expect(pedir("app.example.com", path).headers.get("content-security-policy"), path).toBeNull();
    }
  });

  it("el matcher deja afuera solo los estáticos de Next y el favicon (login y API pasan por el proxy)", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico"]) expect(re.test(path), path).toBe(false);
    for (const path of ["/", "/login", "/api/cron/sincronizar-dolar", "/mesas/1"]) expect(re.test(path), path).toBe(true);
  });
});
