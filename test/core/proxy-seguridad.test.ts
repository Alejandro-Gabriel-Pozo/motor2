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

  it("en el host de una carta solo se lee: cualquier método que no sea GET/HEAD, y cualquier pedido con next-action, es 404", () => {
    const pedirCon = (metodo: string, headers: Record<string, string> = {}) =>
      proxy(new NextRequest(`http://acme.${BASE}/centro`, { method: metodo, headers: { host: `acme.${BASE}`, ...headers } }));
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) expect(pedirCon(metodo).status, metodo).toBe(404);
    expect(pedirCon("GET", { "next-action": "abc123" }).status).toBe(404);
    expect(pedirCon("POST", { "next-action": "abc123" }).status).toBe(404);
    expect(pedirCon("GET").status).toBe(200);
    expect(pedirCon("HEAD").status).toBe(200);
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

describe("proxy — carta de la empresa única en el dominio base (add-on CARTA_EMPRESA_UNICA)", () => {
  const previoBase = process.env.CARTA_DOMINIO_BASE;
  const previoUnica = process.env.CARTA_EMPRESA_UNICA_COMPILADO;
  beforeEach(() => {
    process.env.CARTA_DOMINIO_BASE = BASE;
    process.env.CARTA_EMPRESA_UNICA_COMPILADO = "acme";
  });
  afterEach(() => {
    if (previoBase === undefined) delete process.env.CARTA_DOMINIO_BASE;
    else process.env.CARTA_DOMINIO_BASE = previoBase;
    if (previoUnica === undefined) delete process.env.CARTA_EMPRESA_UNICA_COMPILADO;
    else process.env.CARTA_EMPRESA_UNICA_COMPILADO = previoUnica;
  });

  it("la raíz y /<sucursal> del dominio base pasan a la aplicación, también con puerto y en mayúsculas", () => {
    for (const path of ["/", "/centro", "/centro/"]) {
      const r = pedir(BASE, path);
      expect(r.status, path).toBe(200);
      expect(r.headers.get("x-middleware-next"), path).toBe("1");
    }
    expect(pedir(`${BASE}:3000`, "/centro").status).toBe(200);
    expect(pedir(BASE.toUpperCase(), "/centro").status).toBe(200);
  });

  it("en el dominio base todo lo demás es 404: auth, cron, API, la aplicación, archivos, rutas de más de un segmento, escrituras y Server Actions", () => {
    for (const path of ["/api/auth/signin", "/api/auth/session", "/api/cron/sincronizar-dolar", "/mesas/abc", "/carta/tema", "/a/b", "/api/x", "/x.png", "/carta-publica/acme"]) {
      const r = pedir(BASE, path);
      expect(r.status, path).toBe(404);
      expect(r.headers.get("x-middleware-next"), path).toBeNull();
    }
    const pedirCon = (metodo: string, headers: Record<string, string> = {}) =>
      proxy(new NextRequest(`http://${BASE}/centro`, { method: metodo, headers: { host: BASE, ...headers } }));
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) expect(pedirCon(metodo).status, metodo).toBe(404);
    expect(pedirCon("GET", { "next-action": "abc123" }).status).toBe(404);
    expect(pedirCon("HEAD").status).toBe(200);
  });

  it("<empresa>.<base> sigue resolviendo por subdominio; el punto final y un subdominio de dos niveles siguen siendo 404", () => {
    expect(pedir(`acme.${BASE}`, "/centro").status).toBe(200);
    expect(pedir(`otra.${BASE}`, "/centro").status).toBe(200);
    expect(pedir(`acme.${BASE}`, "/api/auth/signin").status).toBe(404);
    expect(pedir(`${BASE}.`, "/").status).toBe(404);
    expect(pedir(`a.b.${BASE}`, "/").status).toBe(404);
  });

  it("sin el add-on (variable compilada vacía o ausente) el dominio base pelado sigue siendo 404", () => {
    process.env.CARTA_EMPRESA_UNICA_COMPILADO = "";
    expect(pedir(BASE, "/").status).toBe(404);
    expect(pedir(BASE, "/centro").status).toBe(404);
    delete process.env.CARTA_EMPRESA_UNICA_COMPILADO;
    expect(pedir(BASE, "/").status).toBe(404);
  });

  it("un valor compilado que no es un slug no habilita nada", () => {
    process.env.CARTA_EMPRESA_UNICA_COMPILADO = "No Valido";
    expect(pedir(BASE, "/").status).toBe(404);
  });

  it("el host de la app no se ve afectado: sigue con su CSP con nonce", () => {
    const r = pedir("app.example.com", "/login");
    expect(r.status).toBe(200);
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

  it("recuerda la ruta pedida (menos /login), con o sin cookie de sesión: quien tiene dos empresas y ninguna elegida también necesita volver", () => {
    expect(aLaApp(pedir("app.example.com", "/mesas/1?x=2&_rsc=abc"), ENCABEZADO_RUTA_PEDIDA)).toBe("/mesas/1?x=2");
    expect(aLaApp(pedir("app.example.com", "/login"), ENCABEZADO_RUTA_PEDIDA)).toBeNull();
    for (const nombre of ["authjs.session-token", "__Secure-authjs.session-token", "__Host-authjs.session-token"]) {
      expect(aLaApp(pedir("app.example.com", "/mesas/1", `${nombre}=abc`), ENCABEZADO_RUTA_PEDIDA), nombre).toBe("/mesas/1");
    }
  });

  it("un cliente no puede falsear la ruta a la que vuelve el login: en /login se descarta, en cualquier otra ruta se pisa", () => {
    const conEncabezado = (path: string, cookie?: string) =>
      proxy(new NextRequest(`http://app.example.com${path}`, { headers: { host: "app.example.com", [ENCABEZADO_RUTA_PEDIDA]: "//evil.example", ...(cookie ? { cookie } : {}) } }));
    expect(aLaApp(conEncabezado("/mesas/1", "authjs.session-token=abc"), ENCABEZADO_RUTA_PEDIDA)).toBe("/mesas/1");
    expect(aLaApp(conEncabezado("/login"), ENCABEZADO_RUTA_PEDIDA)).toBeNull();
    expect(aLaApp(conEncabezado("/mesas/1"), ENCABEZADO_RUTA_PEDIDA)).toBe("/mesas/1");
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

describe("proxy — paths que Next no sabe decodificar (antes: 500 «failed to decode param»; ahora 404 sin llegar a la aplicación)", () => {
  beforeEach(() => {
    delete process.env.CARTA_DOMINIO_BASE;
  });

  const ROTOS = [
    "/carta-publica/acme/%25", // un `%` bien escapado: la carta es ISR y Next decodifica dos veces
    "/carta-publica/acme/abc%25zz",
    "/carta-publica/acme/%25E0%25A4%25A",
    "/carta-publica/%25/centro",
    "/carta-publica/acme/%zz", // escape inválido
    "/carta-publica/acme/a%",
    "/carta-publica/acme/%E0%A4%A", // UTF-8 incompleto
    "/carta-publica/acme/%ff",
    "/carta-publica/acme/%C0%AF", // secuencia sobrelarga
    "/carta-publica/acme/%ED%A0%80", // sustituto UTF-16 codificado en UTF-8
    "/carta-publica/acme/%00", // NUL
    "/catalogo/productos/%zz/editar", // y en las rutas de la aplicación
    "/mesas/%E0%A4%A",
    "/api/auth/%zz",
  ];

  it("responde 404 sin llegar a la aplicación (sin x-middleware-next), con las cabeceras de seguridad y sin detalles", async () => {
    for (const path of ROTOS) {
      const r = pedir("app.example.com", path);
      expect(r.status, path).toBe(404);
      expect(r.headers.get("x-middleware-next"), path).toBeNull();
      expect(r.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(await r.text(), path).toBe("Not Found");
    }
  });

  it("también en el host de una carta (subdominio)", () => {
    process.env.CARTA_DOMINIO_BASE = BASE;
    for (const path of ["/%25", "/%zz", "/%00", "/centro/%zz"]) expect(pedir(`acme.${BASE}`, path).status, path).toBe(404);
    delete process.env.CARTA_DOMINIO_BASE;
  });

  it("no cambia lo válido: sucursales con y sin barra final, rutas de la aplicación y un `%` bien escapado fuera de la carta pasan como antes", () => {
    for (const path of ["/carta-publica", "/carta-publica/acme", "/carta-publica/acme/centro", "/carta-publica/acme/centro/", "/api/auth/session"]) {
      const r = pedir("app.example.com", path);
      expect(r.status, path).toBe(200);
      expect(r.headers.get("x-middleware-next"), path).toBe("1");
    }
    for (const path of ["/", "/login", "/catalogo/productos", "/catalogo/productos/abc123/editar", "/catalogo/productos/a%20b/editar", "/catalogo/productos/%25/editar", "/mesas/1?x=%25"]) {
      const r = pedir("app.example.com", path);
      expect(r.status, path).toBe(200);
      expect(r.headers.get("x-middleware-next"), path).toBe("1");
    }
  });
});
