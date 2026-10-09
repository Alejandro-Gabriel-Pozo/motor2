/**
 * La ÚNICA puerta de `src/` para pedirle JSON a un tercero por HTTP (S-30, GT-18). Las respuestas de las APIs externas (el dólar, el IPC) terminan en tablas GLOBALES que leen todas las
 * empresas, así que todo lo que traen es input no confiable. Este helper fija lo que no depende del contenido:
 *   - HTTPS y host en una lista cerrada que declara quien llama (nada de seguir una URL que no se escribió acá);
 *   - `redirect: "error"`: un 302 hacia otro host (o hacia `http`) no se sigue, falla;
 *   - tope de tiempo y TOPE DE TAMAÑO: se lee el cuerpo de a trozos y se corta al pasar `maxBytes` (también se mira `content-length` antes de empezar). Antes se hacía
 *     `resp.json()`, que lee la respuesta entera sin límite en la memoria de la función;
 *   - ningún mensaje de error lleva la URL completa (solo el host): puede traer parámetros.
 * El contenido (fechas, rangos, plausibilidad) lo valida el cálculo puro de `core/reportes`. Sin `import "server-only"`: los tests lo ejercitan con `vi.stubGlobal("fetch")`.
 */
export interface OpcionesDePedidoAcotado {
  /** Hosts exactos (sin puerto) a los que se puede pedir. */
  hostsPermitidos: readonly string[];
  /** Tamaño máximo del cuerpo, en bytes. */
  maxBytes: number;
  /** Tope de tiempo del pedido entero (cuerpo incluido). Por defecto 15 s. */
  timeoutMs?: number;
}

export async function pedirJsonAcotado(url: string, opciones: OpcionesDePedidoAcotado): Promise<unknown> {
  const destino = new URL(url);
  if (destino.protocol !== "https:" || destino.username || destino.password || destino.port !== "" || !opciones.hostsPermitidos.includes(destino.hostname)) {
    throw new Error(`pedido a un destino no permitido (${destino.hostname})`);
  }
  const host = destino.host;
  const resp = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(opciones.timeoutMs ?? 15_000) });
  if (!resp.ok) throw new Error(`${host} respondió ${resp.status}`);

  const declarado = Number(resp.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > opciones.maxBytes) {
    await resp.body?.cancel();
    throw new Error(`${host} respondió más de ${opciones.maxBytes} bytes`);
  }
  if (!resp.body) throw new Error(`${host} respondió sin cuerpo`);

  const lector = resp.body.getReader();
  const trozos: Uint8Array[] = [];
  let leidos = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    leidos += value.byteLength;
    if (leidos > opciones.maxBytes) {
      await lector.cancel();
      throw new Error(`${host} respondió más de ${opciones.maxBytes} bytes`);
    }
    trozos.push(value);
  }
  const texto = new TextDecoder().decode(Buffer.concat(trozos));
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw new Error(`${host} respondió algo que no es JSON`);
  }
}
