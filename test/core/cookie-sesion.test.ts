import { describe, expect, it } from "vitest";
import { COOKIE_SESION_HOST, COOKIE_SESION_HTTP, nombreCookieSesion, sirvePorHttps, tokenDeSesionAbierta } from "@/core/auth/cookie-sesion";

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

  it("el token de la sesión abierta se encuentra con el nombre que la cookie tiene en CADA entorno (el chequeo de cuenta ajena no queda ciego en producción)", () => {
    const entornos = [{ NODE_ENV: "development" }, { NODE_ENV: "production", VERCEL: "1" }, { NODE_ENV: "production", AUTH_URL: "https://app.zuluhub.com.ar" }];
    for (const env of entornos) {
      const cookies = { [nombreCookieSesion(env)]: "token-abierto" } as Record<string, string>;
      expect(tokenDeSesionAbierta((n) => cookies[n], env), JSON.stringify(env)).toBe("token-abierto");
    }
    expect(tokenDeSesionAbierta(() => undefined, { NODE_ENV: "production", VERCEL: "1" })).toBeUndefined();
  });

  // S-20 (T8 del endurecimiento): un subdominio hermano (p. ej. el de una carta) puede plantar una cookie SIN prefijo para el dominio padre; el prefijo `__Host-` existe justamente para que
  // eso no pise la propia. Auth.js, con https, lee SOLO `__Host-authjs.session-token`; el gate de «sesión abierta de otro email» tiene que mirar la MISMA cookie que Auth.js, no la primera de una lista.
  describe("S-20: en https la sesión abierta es SOLO la cookie __Host-", () => {
    const https = { NODE_ENV: "production", VERCEL: "1" };

    it("EL ATAQUE: con la cookie sin prefijo plantada y la __Host- real, gana la __Host- (la plantada se ignora)", () => {
      const cookies: Record<string, string> = { [COOKIE_SESION_HTTP]: "token-plantado-por-el-atacante", [COOKIE_SESION_HOST]: "token-de-la-victima" };
      expect(tokenDeSesionAbierta((n) => cookies[n], https)).toBe("token-de-la-victima");
    });

    it("con SOLO la cookie sin prefijo (o la __Secure- de antes) en https no hay sesión abierta: Auth.js tampoco la lee", () => {
      for (const nombre of [COOKIE_SESION_HTTP, "__Secure-authjs.session-token"]) {
        const cookies: Record<string, string> = { [nombre]: "token-plantado" };
        expect(tokenDeSesionAbierta((n) => cookies[n], https), nombre).toBeUndefined();
      }
    });

    it("sin https (desarrollo y e2e) la cookie es la sin prefijo y las demás no cuentan", () => {
      const cookies: Record<string, string> = { [COOKIE_SESION_HTTP]: "token-http", [COOKIE_SESION_HOST]: "token-host" };
      expect(tokenDeSesionAbierta((n) => cookies[n], { NODE_ENV: "development" })).toBe("token-http");
    });
  });
});
