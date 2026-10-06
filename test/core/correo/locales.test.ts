import { describe, expect, it } from "vitest";
import { dominioDelRemitente, esDireccionValida, esRemitenteValido } from "../../../src/core/correo/direcciones";
import { crearEnviadorDeConsola, crearEnviadorEnMemoria, crearEnviadorSinConfigurar } from "../../../src/core/correo/locales";

const MENSAJE = { para: ["ana@cliente.com"], asunto: "Tu código de ingreso", texto: "Tu código es 482913", responderA: "admin@cliente.com" };

describe("consola", () => {
  it("muestra el mail entero en la terminal, avisa que no se envía y devuelve ok", async () => {
    const lineas: string[] = [];
    const resultado = await crearEnviadorDeConsola("avisos", (l) => lineas.push(l)).enviar(MENSAJE);
    expect(resultado).toEqual({ ok: true, idExterno: null });
    expect(lineas).toHaveLength(1);
    for (const parte of ["avisos", "NO se envía", "Para: ana@cliente.com", "Responder a: admin@cliente.com", "Asunto: Tu código de ingreso", "Tu código es 482913"]) {
      expect(lineas[0]).toContain(parte);
    }
  });
});

describe("memoria", () => {
  it("guarda lo enviado, en orden, y devuelve un id", async () => {
    const enviador = crearEnviadorEnMemoria();
    expect(await enviador.enviar(MENSAJE)).toEqual({ ok: true, idExterno: "memoria-1" });
    await enviador.enviar({ ...MENSAJE, asunto: "Otro" });
    expect(enviador.enviados.map((m) => m.asunto)).toEqual(["Tu código de ingreso", "Otro"]);
  });

  it("fallarProximoEnvio hace fallar UN envío con el motivo pedido, sin guardarlo; vaciar limpia todo", async () => {
    const enviador = crearEnviadorEnMemoria();
    enviador.fallarProximoEnvio("CUPO");
    expect(await enviador.enviar(MENSAJE)).toMatchObject({ ok: false, motivo: "CUPO" });
    expect(enviador.enviados).toHaveLength(0);
    expect(await enviador.enviar(MENSAJE)).toMatchObject({ ok: true });
    enviador.fallarProximoEnvio("TRANSITORIO");
    enviador.vaciar();
    expect(enviador.enviados).toHaveLength(0);
    expect(await enviador.enviar(MENSAJE)).toMatchObject({ ok: true });
  });
});

describe("sin configurar", () => {
  it("no envía y lo dice como fallo DEFINITIVO, nombrando el canal", async () => {
    expect(await crearEnviadorSinConfigurar("operativo").enviar(MENSAJE)).toEqual({ ok: false, motivo: "DEFINITIVO", detalle: "canal operativo sin configurar" });
  });
});

describe("direcciones y remitentes", () => {
  it("acepta direcciones simples y rechaza nombres, saltos de línea, separadores y dominios sin punto", () => {
    expect(esDireccionValida("ana.perez+x@sub.cliente.com.ar")).toBe(true);
    for (const mala of ["", "ana", "ana@", "@cliente.com", "ana@cliente", "Ana <ana@cliente.com>", "ana@cliente.com\nbcc:x@y.com", "a b@cliente.com", "a@b.com,c@d.com", "a@@b.com"]) {
      expect(esDireccionValida(mala), JSON.stringify(mala)).toBe(false);
    }
  });

  it("el remitente es una dirección sola o `Nombre <dirección>`, y de ahí sale el dominio en minúsculas", () => {
    expect(esRemitenteValido("no-responder@Avisos.Ejemplo.com")).toBe(true);
    expect(esRemitenteValido("Avisos Zulu <no-responder@avisos.ejemplo.com>")).toBe(true);
    expect(dominioDelRemitente("Avisos Zulu <no-responder@Avisos.Ejemplo.com>")).toBe("avisos.ejemplo.com");
    for (const malo of ["", "Avisos", "Avisos <>", "<a@b.com>", "Avisos <a@b>", "Avisos\r\n <a@b.com>"]) {
      expect(esRemitenteValido(malo), JSON.stringify(malo)).toBe(false);
      expect(dominioDelRemitente(malo)).toBeNull();
    }
  });
});
