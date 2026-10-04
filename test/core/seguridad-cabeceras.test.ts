import { describe, expect, it } from "vitest";
import { cabecerasCarta, cabecerasComunes, cspApp, cspCarta, generarNonce } from "@/core/seguridad/cabeceras";

const directiva = (csp: string, nombre: string) => csp.split("; ").find((d) => d.startsWith(`${nombre} `) || d === nombre);

describe("cspApp", () => {
  const csp = cspApp({ nonce: "abc123", desarrollo: false, https: true });

  it("script-src lleva el nonce del pedido y NO permite 'unsafe-inline' ni 'unsafe-eval'", () => {
    const s = directiva(csp, "script-src")!;
    expect(s).toContain("'nonce-abc123'");
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
  });

  it("en desarrollo suma 'unsafe-eval' (lo necesita el refresco en caliente) y estilos en línea", () => {
    const dev = cspApp({ nonce: "n", desarrollo: true, https: false });
    expect(directiva(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directiva(dev, "style-src")).toContain("'unsafe-inline'");
  });

  it("no se puede embeber la app (frame-ancestors 'none'), ni cargar plugins ni cambiar la base", () => {
    expect(directiva(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directiva(csp, "object-src")).toBe("object-src 'none'");
    expect(directiva(csp, "base-uri")).toBe("base-uri 'self'");
  });

  it("el login puede ir a Google, y el navegador puede mandar a Sentry; nada más afuera", () => {
    expect(directiva(csp, "form-action")).toBe("form-action 'self' https://accounts.google.com");
    expect(directiva(csp, "connect-src")).toContain("https://*.ingest.sentry.io");
    expect(directiva(csp, "connect-src")).not.toMatch(/ \*| https:( |$)/);
    expect(directiva(csp, "default-src")).toBe("default-src 'self'");
  });

  it("upgrade-insecure-requests solo con https (la suite e2e corre por http)", () => {
    expect(csp).toContain("upgrade-insecure-requests");
    expect(cspApp({ nonce: "n", desarrollo: false, https: false })).not.toContain("upgrade-insecure-requests");
  });

  it("sin destinos de formulario (la consola de plataforma, que no tiene login con Google) los formularios solo envían al propio sitio", () => {
    const consola = cspApp({ nonce: "n", desarrollo: false, https: true, destinosDeFormulario: [] });
    expect(directiva(consola, "form-action")).toBe("form-action 'self'");
    expect(consola).not.toContain("accounts.google.com");
    expect(directiva(consola, "script-src")).toContain("'nonce-n'");
  });
});

describe("cspCarta", () => {
  const csp = cspCarta({ https: true });

  it("es estática (sin nonce: la carta sigue siendo ISR) y no se puede embeber", () => {
    expect(csp).not.toContain("nonce-");
    expect(directiva(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directiva(csp, "form-action")).toBe("form-action 'self'");
    expect(directiva(csp, "object-src")).toBe("object-src 'none'");
  });

  it("las imágenes de cada comercio vienen de cualquier https; todo lo demás, del propio sitio", () => {
    expect(directiva(csp, "img-src")).toContain("https:");
    expect(directiva(csp, "default-src")).toBe("default-src 'self'");
    expect(directiva(csp, "connect-src")).not.toContain("accounts.google.com");
  });
});

describe("cabeceras", () => {
  it("las comunes incluyen HSTS, nosniff, Referrer-Policy, Permissions-Policy y X-Frame-Options", () => {
    const claves = cabecerasComunes().map((c) => c.key);
    for (const k of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options"]) expect(claves).toContain(k);
    expect(cabecerasComunes().find((c) => c.key === "X-Content-Type-Options")?.value).toBe("nosniff");
    expect(cabecerasComunes().find((c) => c.key === "X-Frame-Options")?.value).toBe("DENY");
  });

  it("la carta lleva su CSP y, por defecto, noindex", () => {
    const c = cabecerasCarta({ https: true });
    expect(c.find((h) => h.key === "Content-Security-Policy")?.value).toBe(cspCarta({ https: true }));
    expect(c.find((h) => h.key === "X-Robots-Tag")?.value).toBe("noindex, nofollow");
  });
});

describe("generarNonce", () => {
  it("es base64, de 16 bytes y distinto en cada llamada", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generarNonce()));
    expect(nonces.size).toBe(50);
    for (const n of nonces) {
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(n, "base64")).toHaveLength(16);
    }
  });
});
