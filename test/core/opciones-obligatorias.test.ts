import { describe, expect, it } from "vitest";
import { CODIGO_PRODUCTO_REQUIERE_OPCIONES, mensajeProductoRequiereOpciones, rechazoPorOpcionesObligatorias } from "../../src/core/movimientos/opciones-obligatorias";
import { validarOpcionesElegidas } from "../../src/core/opciones/validar-opciones-elegidas";
import { CAFE, HOTEL, SPA, permitidosDe } from "./opciones/escenarios";

/**
 * UN PRODUCTO CON OPCIONES OBLIGATORIAS NO SE VENDE SIN ELEGIRLAS (fila O.430), la regla pura de la barrera final de la venta (mostrador y cierre de cuenta). Sin base. El TEXTO se fija byte a
 * byte (es lo que ve quien cobra). La regla NO se reimplementa: tiene que coincidir con `validarOpcionesElegidas` sin ninguna opción elegida, que es lo que ya aplica el POS al agregar.
 */
const MENSAJE = "«Café» se vende con opciones obligatorias (ej. tamaño): cobralo desde las mesas/POS, donde se eligen.";

describe("rechazoPorOpcionesObligatorias", () => {
  it("un grupo obligatorio (el tamaño del café, mínimo 1): rechaza nombrando el producto y diciendo dónde se vende", () => {
    expect(rechazoPorOpcionesObligatorias("Café", permitidosDe(CAFE))).toBe(MENSAJE);
  });

  it("sin ningún grupo admitido (el producto de siempre) no rechaza", () => {
    expect(rechazoPorOpcionesObligatorias("Café", [])).toBeNull();
  });

  it("solo grupos opcionales (mínimo 0): no rechaza", () => {
    const soloOpcionales = permitidosDe(CAFE, { grupo: (g) => ({ ...g, cantidadMinima: 0 }) });
    expect(rechazoPorOpcionesObligatorias("Café", soloOpcionales)).toBeNull();
  });

  it("el grupo obligatorio DESASIGNADO del producto (fila apagada) no cuenta; con otro obligatorio activo, sí", () => {
    const sinTamano = permitidosDe(CAFE, { grupo: (g) => (g.grupoId === "g-tamano" ? { ...g, admitido: false } : g) });
    expect(rechazoPorOpcionesObligatorias("Café", sinTamano)).toBeNull();
    const otroObligatorio = permitidosDe(CAFE, { grupo: (g) => (g.grupoId === "g-tamano" ? { ...g, admitido: false } : g.grupoId === "g-tipo" ? { ...g, cantidadMinima: 1 } : g) });
    expect(rechazoPorOpcionesObligatorias("Café", otroObligatorio)).toBe(MENSAJE);
  });

  it("un grupo obligatorio APAGADO para la empresa falla cerrado (igual que el POS: vender sin elegir cobraría mal); uno opcional apagado no participa", () => {
    const tamanoApagado = permitidosDe(CAFE, { grupo: (g) => (g.grupoId === "g-tamano" ? { ...g, activo: false } : g) });
    expect(rechazoPorOpcionesObligatorias("Café", tamanoApagado)).toBe(MENSAJE);
    const tipoApagado = permitidosDe(CAFE, { grupo: (g) => (g.grupoId === "g-tamano" ? { ...g, cantidadMinima: 0 } : g.grupoId === "g-tipo" ? { ...g, activo: false } : g) });
    expect(rechazoPorOpcionesObligatorias("Café", tipoApagado)).toBeNull();
  });

  it("un obligatorio sin ninguna opción disponible también falla cerrado (no hay con qué cumplir el mínimo)", () => {
    const sinOpciones = permitidosDe(CAFE, { grupo: (g) => (g.grupoId === "g-tamano" ? { ...g, opciones: [] } : g) });
    expect(rechazoPorOpcionesObligatorias("Café", sinOpciones)).toBe(MENSAJE);
  });

  it("coincide con validarOpcionesElegidas sin opciones elegidas, en los tres rubros (café, hotel, spa)", () => {
    for (const escenario of [CAFE, HOTEL, SPA]) {
      const permitidos = permitidosDe(escenario);
      expect(rechazoPorOpcionesObligatorias("X", permitidos) === null).toBe(validarOpcionesElegidas(permitidos, []).ok);
    }
  });

  it("el código tipado y el mensaje con otro nombre (comillas angulares, sin tocar el nombre)", () => {
    expect(CODIGO_PRODUCTO_REQUIERE_OPCIONES).toBe("PRODUCTO_REQUIERE_OPCIONES");
    expect(mensajeProductoRequiereOpciones("Pizza 2\" «grande»")).toBe("«Pizza 2\" «grande»» se vende con opciones obligatorias (ej. tamaño): cobralo desde las mesas/POS, donde se eligen.");
  });
});
