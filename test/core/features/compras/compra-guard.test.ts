import { describe, expect, it } from "vitest";
import { guardComandoAnularCompra, guardComandoCorregirCompra, guardLineaCompra, guardNroFacturaCompra } from "../../../../src/core/features/compras/compra.guard";

/** Guard de la feature Compra/Devolución a proveedor (src/core/features/compras/compra.guard.ts): formato + normalización, puro. */

describe("guardLineaCompra", () => {
  const KG = { nombre: "kg", decimales: 3 };
  const UNIDAD = { nombre: "unidad", decimales: 0 };

  it("cantidad, precio y peso real válidos: pasan los tres, tal cual", () => {
    const r = guardLineaCompra("Harina", { cantidad: 8, precioTotal: 1024.36, pesoReal: 8.2 }, UNIDAD, KG);
    expect(r).toEqual({ ok: true, valor: { cantidad: 8, precioTotal: 1024.36, pesoReal: 8.2 } });
  });

  it("sin precio: se permite, queda en 0 (compra sin precio sigue permitida)", () => {
    const r = guardLineaCompra("Harina", { cantidad: 8, precioTotal: undefined, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: true, valor: { cantidad: 8, precioTotal: 0, pesoReal: null } });
  });

  it("cantidad NaN: rechaza mencionando el producto, antes de mirar el precio", () => {
    const r = guardLineaCompra("Harina", { cantidad: Number.NaN, precioTotal: -5, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: false, codigo: "formato", mensaje: `La cantidad de "Harina" no es un número válido.` });
  });

  it("cantidad 0 en una compra: se rechaza (no se saltea en silencio)", () => {
    const r = guardLineaCompra("Harina", { cantidad: 0, precioTotal: 100, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: false, codigo: "cero", mensaje: `La cantidad de "Harina" tiene que ser mayor que cero.` });
  });

  it("2,5 en una unidad entera: se rechaza, no se redondea a 3", () => {
    const r = guardLineaCompra("Bolsas", { cantidad: 2.5, precioTotal: 100, pesoReal: null }, UNIDAD, KG);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.mensaje).toContain("entero");
  });

  it("precio negativo: rechaza (no se guarda como 0)", () => {
    const r = guardLineaCompra("Harina", { cantidad: 8, precioTotal: -5, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: false, codigo: "negativo", mensaje: `El precio de "Harina" no puede ser negativo.` });
  });

  it("precio con más de 2 decimales: rechaza", () => {
    const r = guardLineaCompra("Harina", { cantidad: 8, precioTotal: 10.555, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: false, codigo: "decimales", mensaje: `El precio de "Harina" admite como máximo 2 decimales.` });
  });

  it("peso real negativo o NaN: rechaza (antes se ignoraba en silencio)", () => {
    expect(guardLineaCompra("Jamón", { cantidad: 8, precioTotal: 100, pesoReal: -1 }, UNIDAD, KG)).toEqual({
      ok: false,
      codigo: "negativo",
      mensaje: `El peso real de "Jamón" tiene que ser mayor que cero.`,
    });
    expect(guardLineaCompra("Jamón", { cantidad: 8, precioTotal: 100, pesoReal: Number.NaN }, UNIDAD, KG).ok).toBe(false);
  });

  it("dos líneas, una con cantidad inválida: el mensaje nombra ESE producto", () => {
    const buena = guardLineaCompra("Harina", { cantidad: 8, precioTotal: 100, pesoReal: null }, UNIDAD, KG);
    const mala = guardLineaCompra("Azúcar", { cantidad: Number.NaN, precioTotal: 100, pesoReal: null }, UNIDAD, KG);
    expect(buena.ok).toBe(true);
    expect(mala.ok).toBe(false);
    expect(!mala.ok && mala.mensaje).toContain("Azúcar");
  });
});

describe("guardNroFacturaCompra", () => {
  it("acepta un formato real y rechaza solo puntuación, en la carga y en la corrección (mismo validador)", () => {
    expect(guardNroFacturaCompra("A-0001-00012345")).toMatchObject({ ok: true });
    expect(guardNroFacturaCompra("---")).toMatchObject({ ok: false });
  });
});

/**
 * Guard del comando «anular una compra» (Task #41, Fase M). Los mensajes se comparan EXACTOS: son los que devolvía la Server Action
 * `anularCompra` antes de pasar a su caso de uso (test/movimientos/compras-anular.test.ts, sin tocar, los sigue verificando de punta a punta).
 */
describe("guardComandoAnularCompra", () => {
  const UUID = "0b5c3a1e-7d2f-4c8a-9e61-2f3d4b5a6c7d";
  const NO_ENCONTRADA = "No se encontró esa operación en esta sucursal.";
  const CLAVE_INVALIDA = "Clave de reintento inválida.";

  it.each([
    { caso: "válida, sin clave (undefined → null)", entrada: { operacionId: "op-1", claveIdempotencia: undefined }, esperado: { ok: true, valor: { operacionId: "op-1", claveIdempotencia: null } } },
    { caso: "válida, sin la propiedad clave", entrada: { operacionId: "op-1" }, esperado: { ok: true, valor: { operacionId: "op-1", claveIdempotencia: null } } },
    { caso: "válida, con clave UUID", entrada: { operacionId: "op-1", claveIdempotencia: UUID }, esperado: { ok: true, valor: { operacionId: "op-1", claveIdempotencia: UUID } } },
    { caso: "clave que no es un UUID", entrada: { operacionId: "op-1", claveIdempotencia: "no-es-un-uuid" }, esperado: { ok: false, codigo: "formato", mensaje: CLAVE_INVALIDA } },
    { caso: "clave vacía", entrada: { operacionId: "op-1", claveIdempotencia: "" }, esperado: { ok: false, codigo: "formato", mensaje: CLAVE_INVALIDA } },
    { caso: "clave null (solo undefined es «sin clave», como antes)", entrada: { operacionId: "op-1", claveIdempotencia: null }, esperado: { ok: false, codigo: "formato", mensaje: CLAVE_INVALIDA } },
    { caso: "clave inválida Y operacionId no-string: primero la clave (mismo orden que antes)", entrada: { operacionId: 7, claveIdempotencia: "x" }, esperado: { ok: false, codigo: "formato", mensaje: CLAVE_INVALIDA } },
    { caso: "operacionId número", entrada: { operacionId: 123 }, esperado: { ok: false, codigo: "formato", mensaje: NO_ENCONTRADA } },
    { caso: "operacionId null", entrada: { operacionId: null }, esperado: { ok: false, codigo: "formato", mensaje: NO_ENCONTRADA } },
    { caso: "operacionId undefined (antes: Prisma ignoraba el filtro y tomaba la PRIMERA operación de la sucursal)", entrada: { operacionId: undefined }, esperado: { ok: false, codigo: "formato", mensaje: NO_ENCONTRADA } },
    { caso: "operacionId objeto", entrada: { operacionId: { id: "x" } }, esperado: { ok: false, codigo: "formato", mensaje: NO_ENCONTRADA } },
    { caso: "entrada null", entrada: null, esperado: { ok: false, codigo: "formato", mensaje: NO_ENCONTRADA } },
  ])("$caso", ({ entrada, esperado }) => {
    expect(guardComandoAnularCompra(entrada)).toStrictEqual(esperado);
  });
});

/** Guard del comando «corregir la cabecera de una compra» (Task #41, Fase M): solo el operacionId; nueva/esperado pasan tal cual. */
describe("guardComandoCorregirCompra", () => {
  const nueva = { proveedorId: null, nroFactura: "A-1", detalleLibre: "" };
  const esperado = { proveedorId: null, nroFactura: null, detalleLibre: null };
  const NO_ENCONTRADA = "No se encontró esa operación en esta sucursal.";

  it.each([
    { caso: "válida", entrada: { operacionId: "op-1", nueva, esperado }, esperado: { ok: true, valor: { operacionId: "op-1", nueva, esperado } } },
    { caso: "operacionId número", entrada: { operacionId: 123, nueva, esperado }, esperado: { ok: false, codigo: "formato", mensaje: NO_ENCONTRADA } },
    { caso: "operacionId null", entrada: { operacionId: null, nueva, esperado }, esperado: { ok: false, codigo: "formato", mensaje: NO_ENCONTRADA } },
    { caso: "operacionId undefined", entrada: { operacionId: undefined, nueva, esperado }, esperado: { ok: false, codigo: "formato", mensaje: NO_ENCONTRADA } },
  ])("$caso", ({ entrada, esperado: resultado }) => {
    expect(guardComandoCorregirCompra(entrada)).toStrictEqual(resultado);
  });
});
