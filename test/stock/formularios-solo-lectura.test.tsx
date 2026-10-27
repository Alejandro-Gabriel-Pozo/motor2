import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
// Las Server Actions no se llaman al dibujar: se reemplazan para no levantar el servidor.
vi.mock("../../src/server/actions/stock/stock-minimo", () => ({ setStockMinimoProducto: vi.fn() }));
vi.mock("../../src/server/actions/stock/seccion-habitual", () => ({ setSeccionHabitual: vi.fn() }));
vi.mock("../../src/server/actions/stock/frecuencia-conteo", () => ({ setFrecuenciaConteo: vi.fn() }));
// El buscador de productos lee del servidor al escribir: acá alcanza con un campo (el `fieldset` lo apaga igual).
vi.mock("../../src/components/selector-producto", () => ({ SelectorProducto: () => <input aria-label="Insumo" /> }));

import { StockMinimoForm } from "../../src/app/(app)/stock/minimo/stock-minimo-form";
import { SeccionHabitualForm } from "../../src/app/(app)/stock/seccion-habitual/seccion-habitual-form";
import { ConteoFrecuenciaForm } from "../../src/app/(app)/stock/conteo-frecuencia/conteo-frecuencia-form";
import { AvisoSoloLecturaDeStock } from "../../src/components/stock/aviso-solo-lectura";

/**
 * DEC-33 (ver ≠ escribir con niveles de la misma clave) en las pantallas de Configuración de Stock: quien solo puede VER recibe el formulario DESHABILITADO (un `fieldset disabled` que apaga todos sus
 * controles, y el botón «Guardar» también) y el aviso de por qué. Quien puede editar, el de siempre. El servidor rechaza igual (`conPermiso`; ver stock-minimo-cambiar-con-valor-visto.test.ts).
 */
const SECCIONES = [{ id: "s1", nombre: "Cocina" }];
const formularios = (soloLectura: boolean) => ({
  "Stock mínimo": renderToStaticMarkup(<StockMinimoForm secciones={SECCIONES} soloLectura={soloLectura} />),
  "Depósito habitual": renderToStaticMarkup(<SeccionHabitualForm secciones={SECCIONES} soloLectura={soloLectura} />),
  "Frecuencia de conteo": renderToStaticMarkup(<ConteoFrecuenciaForm soloLectura={soloLectura} />),
});

describe("formularios de Configuración de Stock con «Ver» solo", () => {
  it.each(Object.entries(formularios(true)))("%s: fieldset deshabilitado y «Guardar» deshabilitado", (_, html) => {
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toMatch(/<button disabled="" type="submit"/);
  });

  it.each(Object.entries(formularios(false)))("%s: con «Editar», nada deshabilitado", (_, html) => {
    expect(html).not.toMatch(/disabled=""/);
  });

  it("el aviso dice qué se ve y por qué no se puede cambiar, como estado (no interrumpe)", () => {
    const html = renderToStaticMarkup(<AvisoSoloLecturaDeStock que="el stock mínimo" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Solo lectura: tu rol puede ver el stock mínimo, pero no hacer cambios.");
  });
});
