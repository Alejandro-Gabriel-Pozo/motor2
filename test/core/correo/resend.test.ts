import { describe, expect, it } from "vitest";
import { crearEnviadorResend, motivoDeFalloDeResend } from "../../../src/core/correo/resend";
import type { MensajeDeCorreo } from "../../../src/core/correo/tipos";

/**
 * El envío por Resend (E3): qué pide a la API y cómo clasifica cada respuesta para que quien llama sepa si reintentar (TRANSITORIO), esperar
 * al otro día (CUPO) o corregir (DEFINITIVO). Todo contra un `fetch` falso: ningún test sale a internet.
 */
const CONFIG = { claveResend: "re_clave_secreta_de_prueba", remitente: "Avisos <no-responder@avisos.ejemplo.com>" };
const MENSAJE: MensajeDeCorreo = { para: ["ana@cliente.com", "beto@cliente.com"], asunto: "Tu código de ingreso", texto: "Tu código es 482913" };

function conRespuesta(status: number, cuerpo: unknown) {
  const pedidos: Array<{ url: string; init: RequestInit }> = [];
  const fetchFalso = async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status });
  };
  return { pedidos, enviador: crearEnviadorResend(CONFIG, fetchFalso) };
}

describe("crearEnviadorResend: el pedido", () => {
  it("hace POST a /emails con la clave en Authorization y el cuerpo con remitente, destinatarios, asunto y texto", async () => {
    const { pedidos, enviador } = conRespuesta(200, { id: "id-externo-1" });
    expect(await enviador.enviar(MENSAJE)).toEqual({ ok: true, idExterno: "id-externo-1" });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe("https://api.resend.com/emails");
    expect(pedidos[0].init.method).toBe("POST");
    const cabeceras = pedidos[0].init.headers as Record<string, string>;
    expect(cabeceras.Authorization).toBe(`Bearer ${CONFIG.claveResend}`);
    expect(cabeceras["Idempotency-Key"]).toBeUndefined();
    expect(JSON.parse(pedidos[0].init.body as string)).toEqual({ from: CONFIG.remitente, to: MENSAJE.para, subject: MENSAJE.asunto, text: MENSAJE.texto });
  });

  it("agrega html, reply_to y la Idempotency-Key solo cuando vienen", async () => {
    const { pedidos, enviador } = conRespuesta(200, { id: "x" });
    await enviador.enviar({ ...MENSAJE, html: "<p>Hola</p>", responderA: "admin@cliente.com", claveDeIdempotencia: "solicitud-42-aviso-1" });
    const cuerpo = JSON.parse(pedidos[0].init.body as string);
    expect(cuerpo.html).toBe("<p>Hola</p>");
    expect(cuerpo.reply_to).toBe("admin@cliente.com");
    expect((pedidos[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("solicitud-42-aviso-1");
  });

  it("una respuesta 200 sin id igual cuenta como enviada", async () => {
    expect(await conRespuesta(200, {}).enviador.enviar(MENSAJE)).toEqual({ ok: true, idExterno: null });
  });
});

describe("crearEnviadorResend: clasificación de errores", () => {
  const casos: Array<[number, string, "CUPO" | "TRANSITORIO" | "DEFINITIVO"]> = [
    [429, "daily_quota_exceeded", "CUPO"],
    [429, "monthly_quota_exceeded", "CUPO"],
    [429, "rate_limit_exceeded", "TRANSITORIO"],
    [409, "concurrent_idempotent_requests", "TRANSITORIO"],
    [409, "invalid_idempotent_request", "DEFINITIVO"],
    [500, "application_error", "TRANSITORIO"],
    [503, "sin_nombre", "TRANSITORIO"],
    [408, "sin_nombre", "TRANSITORIO"],
    [401, "restricted_api_key", "DEFINITIVO"],
    [403, "invalid_from_address", "DEFINITIVO"],
    [422, "validation_error", "DEFINITIVO"],
    [400, "missing_required_field", "DEFINITIVO"],
  ];
  for (const [status, nombre, esperado] of casos) {
    it(`${status} ${nombre} → ${esperado}`, async () => {
      expect(motivoDeFalloDeResend(status, nombre)).toBe(esperado);
      const resultado = await conRespuesta(status, { statusCode: status, name: nombre, message: "ana@cliente.com no puede recibir" }).enviador.enviar(MENSAJE);
      expect(resultado).toEqual({ ok: false, motivo: esperado, detalle: `Resend ${status} ${nombre}` });
    });
  }

  it("un cuerpo de error ilegible o con un nombre raro no rompe ni se copia al detalle", async () => {
    expect(await conRespuesta(500, "<html>caído</html>").enviador.enviar(MENSAJE)).toEqual({ ok: false, motivo: "TRANSITORIO", detalle: "Resend 500 sin_nombre" });
    const raro = await conRespuesta(422, { name: "ana@cliente.com código 482913" }).enviador.enviar(MENSAJE);
    expect(raro).toEqual({ ok: false, motivo: "DEFINITIVO", detalle: "Resend 422 sin_nombre" });
  });

  it("un fallo de red o de tiempo agotado es TRANSITORIO y no lanza", async () => {
    const enviador = crearEnviadorResend(CONFIG, async () => {
      throw new TypeError("fetch failed: ana@cliente.com");
    });
    expect(await enviador.enviar(MENSAJE)).toEqual({ ok: false, motivo: "TRANSITORIO", detalle: "Resend: sin respuesta (red o tiempo agotado)" });
  });

  it("ningún detalle de fallo contiene la clave, los destinatarios ni el código del mail", async () => {
    for (const [status, nombre] of casos) {
      const r = await conRespuesta(status, { name: nombre, message: "ana@cliente.com 482913" }).enviador.enviar(MENSAJE);
      const texto = JSON.stringify(r);
      for (const secreto of [CONFIG.claveResend, "ana@cliente.com", "482913"]) expect(texto).not.toContain(secreto);
    }
  });
});
