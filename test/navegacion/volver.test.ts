import { describe, expect, it } from "vitest";
import { rutaDesdeReferer, rutaInternaSegura, urlDeLogin } from "../../src/core/navegacion/volver";

describe("rutaInternaSegura: solo rutas internas de la aplicación", () => {
  it.each([
    "/reportes/costos",
    "/catalogo/proveedores?editar=abc123",
    "/movimientos/conteo-fisico?seccionId=cmu454mlu0002lt42yzz0a5ow",
    "/stock/minimo#fila-3",
    "/catalogo/recetas/cmu1/historial",
    "/reportes/%C3%A1rea", // lo no ASCII, ya codificado en %XX, sí se acepta
    "/%2F%2Fsitio-falso.example.com", // %2F no es una barra para el navegador: queda dentro del sitio
  ])("acepta %s", (ruta) => {
    expect(rutaInternaSegura(ruta)).toBe(ruta);
  });

  it.each([
    ["otro sitio con esquema", "https://sitio-falso.example.com/reportes"],
    ["otro sitio sin esquema (//)", "//sitio-falso.example.com"],
    ["otro sitio con barra invertida", "/\\sitio-falso.example.com"],
    ["barra invertida en el medio", "/reportes\\..\\otra"],
    ["javascript:", "javascript:alert(1)"],
    ["sin barra inicial", "reportes/costos"],
    ["salto de línea (inyección de encabezado)", "/reportes\r\nSet-Cookie: a=b"],
    ["tabulación", "/reportes\t/costos"],
    ["carácter nulo", "/reportes" + String.fromCharCode(0)],
    ["letras fuera de ASCII (cirílico)", "/р"],
    ["emoji", "/x😀"],
    ["separador de línea Unicode", "/reportes"+String.fromCharCode(0x2028)+"x"],
    ["espacio", "/reportes costos"],
    ["vacío", ""],
    ["demasiado largo", "/" + "a".repeat(600)],
  ])("rechaza %s", (_motivo, ruta) => {
    expect(rutaInternaSegura(ruta)).toBeNull();
  });

  it.each(["/", "/login", "/login?volver=/reportes", "/login/otra", "/api/auth/signout", "/api/cron/sincronizar-ipc"])(
    "rechaza %s: la raíz decide sola, /login sería un bucle y /api no son pantallas",
    (ruta) => {
      expect(rutaInternaSegura(ruta)).toBeNull();
    }
  );

  it("null y undefined dan null", () => {
    expect(rutaInternaSegura(null)).toBeNull();
    expect(rutaInternaSegura(undefined)).toBeNull();
  });
});

describe("rutaDesdeReferer: solo si el Referer es de este mismo sitio", () => {
  it("toma la ruta y la consulta de un Referer del mismo host", () => {
    expect(rutaDesdeReferer("https://motor2-demo.vercel.app/catalogo/proveedores?editar=x", "motor2-demo.vercel.app")).toBe("/catalogo/proveedores?editar=x");
  });

  it("ignora un Referer de otro sitio, aunque su ruta parezca válida", () => {
    expect(rutaDesdeReferer("https://accounts.google.com/reportes/costos", "motor2-demo.vercel.app")).toBeNull();
  });

  it("ignora un Referer que es la raíz o /login, uno inválido y la ausencia de Referer o de host", () => {
    expect(rutaDesdeReferer("https://motor2-demo.vercel.app/", "motor2-demo.vercel.app")).toBeNull();
    expect(rutaDesdeReferer("https://motor2-demo.vercel.app/login?volver=%2Freportes", "motor2-demo.vercel.app")).toBeNull();
    expect(rutaDesdeReferer("no-es-una-url", "motor2-demo.vercel.app")).toBeNull();
    expect(rutaDesdeReferer(null, "motor2-demo.vercel.app")).toBeNull();
    expect(rutaDesdeReferer("https://motor2-demo.vercel.app/reportes", null)).toBeNull();
  });
});

describe("urlDeLogin", () => {
  it("agrega ?volver= codificado si hay adónde volver, y si no va a /login a secas", () => {
    expect(urlDeLogin("/catalogo/proveedores?editar=x&y=1")).toBe("/login?volver=%2Fcatalogo%2Fproveedores%3Feditar%3Dx%26y%3D1");
    expect(urlDeLogin(null)).toBe("/login");
  });
});
