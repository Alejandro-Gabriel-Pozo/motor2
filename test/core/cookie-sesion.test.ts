import { describe, expect, it } from "vitest";
import { COOKIE_SESION_HOST, COOKIE_SESION_HTTP, NOMBRES_COOKIE_SESION, nombreCookieSesion, sirvePorHttps, tokenDeSesionAbierta } from "@/core/auth/cookie-sesion";

describe("cookie de sesión __Host-", () => {
  it("en producción sobre Vercel (https) la cookie es __Host-authjs.session-token", () => {
    expect(nombreCookieSesion({ NODE_ENV: "production", VERCEL: "1" })).toBe("__Host-authjs.session-token");
    expect(COOKIE_SESION_HOST.startsWith("__Host-")).toBe(true);
  });

  it("en producción con AUTH_URL https también", () => {
    expect(nombreCookieSesion({ NODE_ENV: "production", AUTH_URL: "https://app.zuluhub.com.ar" })).toBe(COOKIE_SESION_HOST);
  });

  it("sin https (e2e: next start sobre http, desarrollo) queda el nombre por defecto: __Host- exige Secure y el navegador la rechazaría", () => {
    expect(nombreCookieSesion({ NODE_ENV: "production" })).toBe(COOKIE_SESION_HTTP);
    expect(nombreCookieSesion({ NODE_ENV: "production", AUTH_URL: "http://localhost:3000" })).toBe(COOKIE_SESION_HTTP);
    expect(nombreCookieSesion({ NODE_ENV: "development", VERCEL: "1" })).toBe(COOKIE_SESION_HTTP);
    expect(nombreCookieSesion({})).toBe(COOKIE_SESION_HTTP);
  });

  it("sirvePorHttps coincide con la decisión del nombre", () => {
    expect(sirvePorHttps({ NODE_ENV: "production", VERCEL: "1" })).toBe(true);
    expect(sirvePorHttps({ NODE_ENV: "production" })).toBe(false);
  });

  it("el proxy reconoce los tres nombres posibles (sin sesión = ninguno presente)", () => {
    expect([...NOMBRES_COOKIE_SESION]).toEqual(expect.arrayContaining(["authjs.session-token", "__Secure-authjs.session-token", "__Host-authjs.session-token"]));
  });

  it("el token de la sesión abierta se encuentra con el nombre que la cookie tiene en CADA entorno (el chequeo de cuenta ajena no queda ciego en producción)", () => {
    const entornos = [{ NODE_ENV: "development" }, { NODE_ENV: "production", VERCEL: "1" }, { NODE_ENV: "production", AUTH_URL: "https://app.zuluhub.com.ar" }];
    for (const env of entornos) {
      const cookies = { [nombreCookieSesion(env)]: "token-abierto" } as Record<string, string>;
      expect(tokenDeSesionAbierta((n) => cookies[n]), JSON.stringify(env)).toBe("token-abierto");
    }
    expect(tokenDeSesionAbierta(() => undefined)).toBeUndefined();
  });
});
