import { describe, expect, it } from "vitest";
import { guardComandoCancelarConteo } from "../../../../src/core/features/movimientos/cancelar-conteo.guard";
import { guardComandoConteoFisico } from "../../../../src/core/features/movimientos/conteo-fisico.guard";
import { guardComandoResolverConteo } from "../../../../src/core/features/movimientos/resolver-conteo.guard";

/** Guards de los comandos del conteo físico (formato, puros): resolver, cancelar y la acción de registrar. */
describe("guardComandoResolverConteo", () => {
  it.each(["resuelto", "ajustar"] as const)("«%s» pasa y devuelve la MISMA entrada", (comoResolver) => {
    const entrada = { conteoId: "c-1", comoResolver };
    const r = guardComandoResolverConteo(entrada);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toBe(entrada);
  });

  it.each(["x", "", null, undefined, 1, "AJUSTAR", "constructor", "__proto__", "toString"])("comoResolver %j rechaza (nunca cae en la rama de ajustar)", (comoResolver) => {
    expect(guardComandoResolverConteo({ conteoId: "c-1", comoResolver })).toMatchObject({ ok: false, codigo: "formato" });
  });

  it.each([undefined, null, "", 42, {}])("conteoId %j rechaza con «No se encontró ese conteo.»", (conteoId) => {
    expect(guardComandoResolverConteo({ conteoId, comoResolver: "ajustar" })).toMatchObject({ ok: false, mensaje: "No se encontró ese conteo." });
  });

  it("sin entrada: rechaza igual", () => {
    expect(guardComandoResolverConteo(undefined)).toMatchObject({ ok: false });
  });
});

describe("guardComandoCancelarConteo", () => {
  it("un conteoId de texto pasa tal cual (exista o no: eso lo decide el caso de uso)", () => {
    expect(guardComandoCancelarConteo({ conteoId: "c-1" })).toEqual({ ok: true, valor: { conteoId: "c-1" } });
  });

  it.each([undefined, null, "", 42, {}])("conteoId %j rechaza (con undefined Prisma ignoraría el filtro y cargaría el primer conteo)", (conteoId) => {
    expect(guardComandoCancelarConteo({ conteoId })).toMatchObject({ ok: false, mensaje: "No se encontró ese conteo." });
  });

  it("sin entrada: rechaza igual", () => {
    expect(guardComandoCancelarConteo(undefined)).toMatchObject({ ok: false });
  });
});

describe("guardComandoConteoFisico: la acción", () => {
  const base = { productoId: "p-1", seccionId: "s-1", conteoReal: 1, fechaConteo: new Date() };

  it.each(["AJUSTAR", "FALTA_MOVIMIENTO", "DESCARTAR"])("«%s» pasa", (accion) => {
    expect(guardComandoConteoFisico({ ...base, accion }).ok).toBe(true);
  });

  it.each(["BORRAR", "", null, undefined, 3, "constructor"])("acción %j rechaza (antes era un error crudo al buscarla en el mapa de acciones)", (accion) => {
    expect(guardComandoConteoFisico({ ...base, accion })).toMatchObject({ ok: false, codigo: "formato" });
  });
});
