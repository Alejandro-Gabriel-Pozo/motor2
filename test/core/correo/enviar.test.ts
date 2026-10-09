import { beforeEach, describe, expect, it, vi } from "vitest";

const reportes = vi.hoisted(() => [] as Array<{ clave: string; mensaje: string; area: string }>);
vi.mock("../../../src/lib/reportar-error", () => ({
  reportarErrorUnaVez: async (clave: string, error: Error, area: string) => {
    reportes.push({ clave, mensaje: error.message, area });
  },
  reportarError: async () => {},
}));

import { configuracionDelCanal, problemasDeConfiguracionDeCorreo } from "../../../src/core/correo/configuracion";
import { crearEnviadorDelCanal as crearEnviadorDelCanalConFabrica, enviadorEnMemoriaDelCanal } from "../../../src/core/correo/enviar";
import { crearEnviadorResend } from "../../../src/lib/correo/resend";
import { enviarCorreo, olvidarEnviadoresDelProceso } from "../../../src/lib/enviar-correo";

/**
 * Qué implementación elige cada canal según el entorno, que el mail inválido ni se intenta, y que un fallo se reporta sin contenido (E3).
 * `enviarCorreo` usa el entorno del proceso: bajo Vitest es `NODE_ENV=test`, o sea memoria.
 */
const AVISOS = { CORREO_AVISOS_RESEND_API_KEY: "re_avisos", CORREO_AVISOS_REMITENTE: "Avisos <no-responder@avisos.ejemplo.com>" };
const OPERATIVO = { CORREO_OPERATIVO_RESEND_API_KEY: "re_operativo", CORREO_OPERATIVO_REMITENTE: "facturacion@operativo.ejemplo.com" };
const MENSAJE = { para: ["ana@cliente.com"], asunto: "Tu código de ingreso", texto: "Tu código es 482913" };

beforeEach(() => {
  reportes.length = 0;
  for (const canal of ["avisos", "operativo"] as const) enviadorEnMemoriaDelCanal(canal).vaciar();
  olvidarEnviadoresDelProceso();
});

// La selección recibe la fábrica de Resend inyectada (en producción, `lib/enviar-correo.ts`).
const crearEnviadorDelCanal = (canal: Parameters<typeof crearEnviadorDelCanalConFabrica>[0], source: Parameters<typeof crearEnviadorDelCanalConFabrica>[1]) =>
  crearEnviadorDelCanalConFabrica(canal, source, crearEnviadorResend);

describe("crearEnviadorDelCanal", () => {
  it("en tests es siempre memoria, aunque el entorno tenga claves: un test no manda mails de verdad", () => {
    expect(crearEnviadorDelCanal("avisos", { NODE_ENV: "test", ...AVISOS }).implementacion).toBe("memoria");
    expect(crearEnviadorDelCanal("avisos", { NODE_ENV: "test", VERCEL: "1", ...AVISOS })).toBe(enviadorEnMemoriaDelCanal("avisos"));
  });

  it("con clave y remitente del canal usa Resend; cada canal mira SUS variables", () => {
    expect(crearEnviadorDelCanal("avisos", { ...AVISOS }).implementacion).toBe("resend");
    expect(crearEnviadorDelCanal("operativo", { ...OPERATIVO }).implementacion).toBe("resend");
    expect(crearEnviadorDelCanal("operativo", { ...AVISOS }).implementacion).toBe("consola");
    expect(crearEnviadorDelCanal("avisos", { ...OPERATIVO, VERCEL: "1" }).implementacion).toBe("sin-configurar");
  });

  it("con solo la clave o solo el remitente el canal NO está configurado", () => {
    expect(configuracionDelCanal("avisos", { CORREO_AVISOS_RESEND_API_KEY: "re_avisos" })).toBeNull();
    expect(configuracionDelCanal("avisos", { CORREO_AVISOS_REMITENTE: AVISOS.CORREO_AVISOS_REMITENTE })).toBeNull();
    expect(configuracionDelCanal("avisos", { ...AVISOS, CORREO_AVISOS_REMITENTE: "   " })).toBeNull();
    expect(configuracionDelCanal("avisos", AVISOS)).toEqual({ claveResend: "re_avisos", remitente: AVISOS.CORREO_AVISOS_REMITENTE });
  });

  it("sin configurar: en local (sin VERCEL) muestra por consola; dentro de Vercel no envía y NUNCA cae en consola", () => {
    expect(crearEnviadorDelCanal("avisos", {}).implementacion).toBe("consola");
    expect(crearEnviadorDelCanal("avisos", { NODE_ENV: "production" }).implementacion).toBe("consola");
    for (const VERCEL_ENV of ["production", "preview", "development"]) {
      expect(crearEnviadorDelCanal("avisos", { VERCEL: "1", VERCEL_ENV }).implementacion, VERCEL_ENV).toBe("sin-configurar");
    }
  });
});

describe("problemasDeConfiguracionDeCorreo", () => {
  it("sin ninguna variable, o con un canal completo, o con los dos completos y separados: sin problemas", () => {
    expect(problemasDeConfiguracionDeCorreo({})).toEqual([]);
    expect(problemasDeConfiguracionDeCorreo({ ...AVISOS })).toEqual([]);
    expect(problemasDeConfiguracionDeCorreo({ ...AVISOS, ...OPERATIVO })).toEqual([]);
  });

  it("clave sin remitente (o al revés) es un problema, y el mensaje nombra variables, no valores", () => {
    const sinRemitente = problemasDeConfiguracionDeCorreo({ CORREO_AVISOS_RESEND_API_KEY: "re_avisos" });
    expect(sinRemitente).toHaveLength(1);
    expect(sinRemitente[0]).toMatch(/CORREO_AVISOS_RESEND_API_KEY y CORREO_AVISOS_REMITENTE se configuran juntas \(falta CORREO_AVISOS_REMITENTE\)/);
    expect(sinRemitente[0]).not.toContain("re_avisos");
    expect(problemasDeConfiguracionDeCorreo({ CORREO_OPERATIVO_REMITENTE: "a@b.com" })[0]).toMatch(/falta CORREO_OPERATIVO_RESEND_API_KEY/);
  });

  it("los dos canales con la misma clave o con el mismo dominio de remitente son un problema (cada uno tiene su cuenta, su cupo y su dominio)", () => {
    const mismaClave = problemasDeConfiguracionDeCorreo({ ...AVISOS, ...OPERATIVO, CORREO_OPERATIVO_RESEND_API_KEY: "re_avisos" });
    expect(mismaClave).toHaveLength(1);
    expect(mismaClave[0]).toMatch(/no pueden ser la misma clave/);
    expect(mismaClave[0]).not.toContain("re_avisos");
    const mismoDominio = problemasDeConfiguracionDeCorreo({ ...AVISOS, ...OPERATIVO, CORREO_OPERATIVO_REMITENTE: "otro@AVISOS.ejemplo.com" });
    expect(mismoDominio).toHaveLength(1);
    expect(mismoDominio[0]).toMatch(/no pueden usar el mismo dominio/);
  });
});

describe("enviarCorreo", () => {
  it("manda por el canal pedido (memoria bajo test) y devuelve el resultado", async () => {
    expect(await enviarCorreo("avisos", MENSAJE)).toEqual({ ok: true, idExterno: "memoria-1" });
    expect(enviadorEnMemoriaDelCanal("avisos").enviados).toEqual([MENSAJE]);
    expect(enviadorEnMemoriaDelCanal("operativo").enviados).toEqual([]);
    expect(reportes).toEqual([]);
  });

  it("un mensaje inválido ni se intenta: DEFINITIVO, nada enviado, y se reporta", async () => {
    const malos = [
      { ...MENSAJE, para: [] },
      { ...MENSAJE, para: ["no-es-un-mail"] },
      { ...MENSAJE, para: Array.from({ length: 51 }, (_, i) => `u${i}@cliente.com`) },
      { ...MENSAJE, asunto: "linea 1\nBcc: otro@x.com" },
      { ...MENSAJE, asunto: "" },
      { ...MENSAJE, asunto: "x".repeat(201) },
      { ...MENSAJE, texto: "   " },
      { ...MENSAJE, responderA: "Ana <ana@cliente.com>" },
      { ...MENSAJE, claveDeIdempotencia: "a\nb" },
    ];
    for (const malo of malos) {
      expect(await enviarCorreo("avisos", malo)).toMatchObject({ ok: false, motivo: "DEFINITIVO" });
    }
    expect(enviadorEnMemoriaDelCanal("avisos").enviados).toEqual([]);
    expect(reportes.length).toBeGreaterThan(0);
  });

  it("un fallo del proveedor vuelve como resultado, no lanza, y se reporta a Sentry sin contenido ni destinatarios", async () => {
    enviadorEnMemoriaDelCanal("operativo").fallarProximoEnvio("CUPO");
    const resultado = await enviarCorreo("operativo", MENSAJE);
    expect(resultado).toMatchObject({ ok: false, motivo: "CUPO" });
    expect(reportes).toHaveLength(1);
    expect(reportes[0].area).toBe("correo");
    expect(reportes[0].mensaje).toMatch(/Correo operativo no enviado \(CUPO\)/);
    for (const secreto of ["ana@cliente.com", "482913", "Tu código"]) expect(JSON.stringify(reportes)).not.toContain(secreto);
  });
});
