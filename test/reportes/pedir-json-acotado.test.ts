import { afterEach, describe, expect, it, vi } from "vitest";
import { pedirJsonAcotado } from "../../src/server/adaptadores/pedir-json-acotado";

/** `pedirJsonAcotado` (S-30, GT-18): la única puerta para pedirle JSON a un tercero. Host fijo, https, sin redirecciones, con tope de tamaño y de tiempo. */
const OPCIONES = { hostsPermitidos: ["api.ejemplo.test"], maxBytes: 1024 };
const URL_OK = "https://api.ejemplo.test/v1/dato?x=1";

describe("pedirJsonAcotado", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("devuelve el JSON parseado y pide sin caché, sin seguir redirecciones y con un tope de tiempo", async () => {
    const inits: Array<RequestInit | undefined> = [];
    vi.stubGlobal("fetch", async (...args: [string, RequestInit?]) => {
      inits.push(args[1]);
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    });
    await expect(pedirJsonAcotado(URL_OK, OPCIONES)).resolves.toEqual({ ok: 1 });
    const init = inits[0]!;
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("un destino que no es https, con credenciales, con puerto o de otro host se rechaza SIN pedir nada", async () => {
    const red = vi.fn();
    vi.stubGlobal("fetch", red);
    for (const url of ["http://api.ejemplo.test/x", "https://otro.test/x", "https://user:clave@api.ejemplo.test/x", "https://api.ejemplo.test:8443/x", "https://api.ejemplo.test.malo.test/x", "https://malo.test/api.ejemplo.test"]) {
      await expect(pedirJsonAcotado(url, OPCIONES), url).rejects.toThrow(/destino no permitido/);
    }
    expect(red).not.toHaveBeenCalled();
  });

  it("una respuesta que pasa el tope se corta, con o sin `content-length`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[" + "1,".repeat(2000) + "1]", { status: 200 })));
    await expect(pedirJsonAcotado(URL_OK, OPCIONES)).rejects.toThrow(/más de 1024 bytes/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[1]", { status: 200, headers: { "content-length": "999999" } })));
    await expect(pedirJsonAcotado(URL_OK, OPCIONES)).rejects.toThrow(/más de 1024 bytes/);
  });

  it("un cuerpo que llega en trozos se corta apenas pasa el tope, sin leer el resto", async () => {
    let trozosLeidos = 0;
    const flujo = new ReadableStream<Uint8Array>({
      pull(control) {
        trozosLeidos++;
        control.enqueue(new Uint8Array(400).fill(49));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(flujo, { status: 200 })));
    await expect(pedirJsonAcotado(URL_OK, OPCIONES)).rejects.toThrow(/más de 1024 bytes/);
    expect(trozosLeidos).toBeLessThan(10);
  });

  it("un estado de error, un cuerpo que no es JSON y una redirección fallan, y el mensaje no lleva la URL con sus parámetros", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    await expect(pedirJsonAcotado(URL_OK, OPCIONES)).rejects.toThrow("api.ejemplo.test respondió 503");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(pedirJsonAcotado(URL_OK, OPCIONES)).rejects.toThrow("api.ejemplo.test respondió algo que no es JSON");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(pedirJsonAcotado(URL_OK, OPCIONES)).rejects.toThrow(TypeError);
    const mensajes: string[] = [];
    for (const f of [() => new Response("no", { status: 503 }), () => new Response("<html>", { status: 200 })]) {
      vi.stubGlobal("fetch", vi.fn(async () => f()));
      await pedirJsonAcotado(URL_OK, OPCIONES).catch((e: Error) => mensajes.push(e.message));
    }
    for (const m of mensajes) expect(m).not.toContain("x=1");
  });
});
