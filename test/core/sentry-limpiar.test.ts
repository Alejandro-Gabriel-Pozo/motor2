import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { limpiarEventoSentry } from "../../src/lib/sentry-limpiar";

function evento(parcial: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...parcial } as ErrorEvent;
}

describe("limpiarEventoSentry (S-16)", () => {
  it("un error de Prisma pierde el mensaje (trae la consulta con emails e importes) y conserva solo el código", () => {
    const e = limpiarEventoSentry(
      evento({ exception: { values: [{ type: "PrismaClientKnownRequestError", value: "Invalid `prisma.user.create()` invocation: Unique constraint failed on email = ana@x.com, monto 12345.67 (P2002)" }] } })
    );
    expect(e.exception!.values![0].value).toBe("Error de base de datos P2002 (mensaje omitido)");
  });

  it("detecta el error de Prisma también por la forma del mensaje, aunque el tipo sea genérico", () => {
    const e = limpiarEventoSentry(evento({ exception: { values: [{ type: "Error", value: "Invalid `prisma.operacion.findMany()` invocation: Argument total = 9999" }] } }));
    expect(e.exception!.values![0].value).not.toContain("9999");
  });

  it("tapa emails y tokens de un error común y lo deja legible", () => {
    const e = limpiarEventoSentry(
      evento({
        message: "Falló el alta de ana@x.com con Bearer abcdefgh12345678",
        exception: { values: [{ type: "Error", value: "sesión eyJhbGciOi.eyJzdWIiOiIx.firmaDeLaSesion de ana@x.com" }] },
      })
    );
    expect(e.message).toBe("Falló el alta de [email] con Bearer [token]");
    expect(e.exception!.values![0].value).toBe("sesión [token] de [email]");
  });

  it("descarta el cuerpo del pedido, las cookies, la query string y las cabeceras de autenticación; conserva las inocuas", () => {
    const e = limpiarEventoSentry(
      evento({
        request: {
          url: "https://app.test/api/x?token=secreto",
          query_string: "token=secreto",
          data: { email: "ana@x.com" },
          cookies: { sesion: "abc" },
          headers: { Authorization: "Bearer zzz", Cookie: "a=b", "X-Api-Key": "k", "user-agent": "jest" },
        },
        user: { email: "ana@x.com", ip_address: "1.2.3.4" },
        extra: { total: 1000 },
      })
    );
    expect(e.request).toEqual({ url: "https://app.test/api/x", headers: { "user-agent": "jest" } });
    expect(e.user).toBeUndefined();
    expect(e.extra).toBeUndefined();
  });

  it("los breadcrumbs de consola pierden los datos y los demás mensajes se limpian", () => {
    const e = limpiarEventoSentry(
      evento({ breadcrumbs: [{ category: "console", message: "hola ana@x.com", data: { arguments: ["ana@x.com"] } }, { category: "ui.click", message: "boton" }] })
    );
    expect(e.breadcrumbs![0]).toEqual({ category: "console", message: "hola [email]" });
    expect(e.breadcrumbs![1].message).toBe("boton");
  });
});

/**
 * S-29: el token de una invitación viaja en el FRAGMENTO del enlace (`/invitacion#t=<token>`, ADR-020 §3) y la URL con query viaja en el pedido, en las migas de
 * navegación y de red y en los spans. Una «lista negra» de cabeceras o un recorte solo en `?` los dejaba pasar a Sentry (a los miembros de su organización).
 */
const TOKEN = "k3Jf9sLw2QxVbN7mPzR4tYuHgD6aEcXo1iWqOl8S-_";

describe("limpiarEventoSentry (S-29): nada de fragmentos, queries ni cabeceras fuera de la lista blanca", () => {
  it("la URL del pedido pierde el fragmento (`#t=<token>`) además de la query", () => {
    expect(limpiarEventoSentry(evento({ request: { url: `https://app.test/invitacion#t=${TOKEN}` } })).request!.url).toBe("https://app.test/invitacion");
    expect(limpiarEventoSentry(evento({ request: { url: `https://app.test/x?a=1#t=${TOKEN}` } })).request!.url).toBe("https://app.test/x");
    expect(limpiarEventoSentry(evento({ request: { url: `https://app.test/x#t=${TOKEN}?a=1` } })).request!.url).toBe("https://app.test/x");
  });

  it("las cabeceras salen por LISTA BLANCA: x-forwarded-for, referer y la ruta interna ya no pasan; user-agent y content-type sí (sin importar mayúsculas)", () => {
    const e = limpiarEventoSentry(
      evento({
        request: {
          url: "https://app.test/x",
          headers: {
            "x-forwarded-for": "1.2.3.4",
            Referer: `https://app.test/invitacion#t=${TOKEN}`,
            "x-motor2-ruta-pedida": `/invitacion?t=${TOKEN}`,
            "x-vercel-id": "gru1::abc",
            "User-Agent": "jest",
            "Content-Type": "text/plain",
          },
        },
      })
    );
    expect(e.request!.headers).toEqual({ "User-Agent": "jest", "Content-Type": "text/plain" });
  });

  it("las migas de navegación (`data.from` / `data.to`) pierden el fragmento y la query", () => {
    const e = limpiarEventoSentry(
      evento({
        breadcrumbs: [{ category: "navigation", data: { from: `/invitacion#t=${TOKEN}`, to: `/inicio?x=ana@x.com#t=${TOKEN}` } }],
      })
    );
    expect(e.breadcrumbs![0].data).toEqual({ from: "/invitacion", to: "/inicio" });
  });

  it("las migas de red (`fetch` / `xhr`) pierden la query y el fragmento de `data.url` y conservan método y estado", () => {
    const e = limpiarEventoSentry(
      evento({
        breadcrumbs: [
          { category: "fetch", type: "http", data: { method: "GET", url: "https://app.test/api/x?q=ana@x.com", status_code: 200 } },
          { category: "xhr", type: "http", data: { method: "POST", url: `https://app.test/api/y#t=${TOKEN}`, status_code: 500 } },
        ],
      })
    );
    expect(e.breadcrumbs![0].data).toEqual({ method: "GET", url: "https://app.test/api/x", status_code: 200 });
    expect(e.breadcrumbs![1].data).toEqual({ method: "POST", url: "https://app.test/api/y", status_code: 500 });
  });

  it("los spans de una transacción pierden query y fragmento (`data` y `description`) y los textos libres pasan por la limpieza", () => {
    const e = limpiarEventoSentry({
      type: "transaction",
      transaction: `/invitacion#t=${TOKEN}`,
      contexts: { trace: { trace_id: "a", span_id: "b", data: { "url.full": `https://app.test/invitacion#t=${TOKEN}`, "http.query": `t=${TOKEN}`, "http.fragment": `#t=${TOKEN}` } } },
      spans: [
        {
          span_id: "c",
          trace_id: "a",
          start_timestamp: 1,
          description: `GET https://app.test/api/z?token=${TOKEN}`,
          data: { "http.url": `https://app.test/api/z?token=${TOKEN}`, "url.full": `https://app.test/api/z#t=${TOKEN}`, "http.query": `token=${TOKEN}`, "http.response.status_code": 200, nota: "falló ana@x.com" },
        },
      ],
    } as never) as unknown as { transaction: string; contexts: { trace: { data: Record<string, unknown> } }; spans: Array<{ description: string; data: Record<string, unknown> }> };
    expect(e.transaction).toBe("/invitacion");
    expect(e.contexts.trace.data).toEqual({ "url.full": "https://app.test/invitacion" });
    expect(e.spans[0].description).toBe("GET https://app.test/api/z");
    expect(e.spans[0].data).toEqual({ "http.url": "https://app.test/api/z", "url.full": "https://app.test/api/z", "http.response.status_code": 200, nota: "falló [email]" });
  });

  it("ningún rincón del evento serializado conserva el token (barrido de punta a punta)", () => {
    const e = limpiarEventoSentry({
      type: "transaction",
      request: { url: `https://app.test/invitacion#t=${TOKEN}`, headers: { referer: `https://app.test/invitacion#t=${TOKEN}`, "user-agent": "jest" } },
      breadcrumbs: [
        { category: "navigation", data: { from: `/invitacion#t=${TOKEN}`, to: "/inicio" } },
        { category: "fetch", data: { url: `https://app.test/api?t=${TOKEN}` } },
      ],
      spans: [{ span_id: "c", trace_id: "a", start_timestamp: 1, description: `GET /api?t=${TOKEN}`, data: { "url.full": `https://app.test/api?t=${TOKEN}` } }],
    } as never);
    expect(JSON.stringify(e)).not.toContain(TOKEN);
  });
});
