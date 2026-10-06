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
