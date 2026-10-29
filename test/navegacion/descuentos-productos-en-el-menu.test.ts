import { describe, expect, it } from "vitest";
import { GRUPOS_NAV, RUTAS_FUERA_DEL_MENU, accionDeRuta, hrefsDelMenu, panelDeRuta } from "../../src/core/navegacion/estructura";
import { DESCUENTO_POR_PRODUCTO_VISIBLE } from "../../src/core/carta/public";

/**
 * Interruptor del descuento por producto (`DESCUENTO_POR_PRODUCTO_VISIBLE`, `src/core/carta/descuento-producto.ts`; decisión del dueño 2026-10-29): apagado, el reporte «Descuentos de productos»
 * no es ítem del menú pero la pantalla sigue existiendo (ítem de `RUTAS_FUERA_DEL_MENU`, con la misma acción y el mismo panel); prendido, vuelve a su lugar en Reportes. Nunca en los dos lados a la vez.
 */
const RUTA = "/reportes/descuentos-productos";

describe("«Descuentos de productos» según el interruptor del descuento por producto", () => {
  it("está en el menú de Reportes solo con el interruptor prendido; apagado, queda fuera del menú", () => {
    const enElMenu = hrefsDelMenu().includes(RUTA);
    const fueraDelMenu = RUTAS_FUERA_DEL_MENU.some((i) => i.href === RUTA);
    expect(enElMenu).toBe(DESCUENTO_POR_PRODUCTO_VISIBLE);
    expect(fueraDelMenu).toBe(!DESCUENTO_POR_PRODUCTO_VISIBLE);
    if (enElMenu) expect(GRUPOS_NAV.find((g) => g.id === "reportes")?.items.map((i) => i.href)).toContain(RUTA);
  });

  it("en cualquiera de los dos estados, la ruta sigue resolviendo su acción y su panel (la pantalla sigue protegida)", () => {
    expect(accionDeRuta(RUTA)).toBe("reporte_descuentos_productos");
    expect(panelDeRuta(RUTA)).toBe("sucursal");
  });
});
