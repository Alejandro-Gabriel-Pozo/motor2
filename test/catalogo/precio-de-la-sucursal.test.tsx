import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA; guardar, confirmar y refrescar van en
// `test/e2e/catalogo-precio-por-sucursal-en-el-producto.spec.ts`.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/actions/catalogo/precio-local", () => ({ setPrecioLocalProducto: vi.fn(), sincronizarPrecioLocalGrupoCarta: vi.fn() }));

import { PrecioDeLaSucursal, textoDelCambio } from "../../src/components/catalogo/espacio-del-producto/precio-de-la-sucursal";
import { cambioDePrecio } from "../../src/core/catalogo/cambio-de-precio";

const texto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/ /g, " ").replace(/\s+/g, " ").trim();

const dibujar = (props: Partial<Parameters<typeof PrecioDeLaSucursal>[0]> = {}) =>
  renderToStaticMarkup(
    <PrecioDeLaSucursal productoId="p1" sucursalId="s1" sucursalNombre="Centro" precioVigente={18000} precioGlobal={18000} guardado={null} capacidadActiva {...props} />,
  );

describe("PrecioDeLaSucursal: lo que dibuja", () => {
  it("el campo del precio con su rótulo («Precio en «Centro»»), el valor vigente de partida y «Guardar el precio»", () => {
    const html = dibujar();
    const t = texto(html);
    expect(t).toContain("Precio en «Centro»");
    expect(html).toMatch(/<label[^>]*>\s*Precio en «Centro»\s*<\/label>/);
    expect(html).toContain('value="18.000"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>\s*Guardar el precio\s*<\/button>/);
  });

  it("sin cambio de precio y sin precio guardado no dibuja «antes → después» ni «Volver al precio global»", () => {
    const t = texto(dibujar());
    expect(t).not.toContain("Antes → después");
    expect(t).not.toContain("Volver al precio global");
  });

  it("con el precio local habilitado ofrece «Volver al precio global» con el precio global, y no el aviso del deshabilitado", () => {
    const t = texto(dibujar({ precioVigente: 20000, guardado: { precio: 20000, habilitado: true } }));
    expect(t).toMatch(/Volver al precio global \(\$\s*18\.000\)/);
    expect(t).not.toContain("deshabilitado");
  });

  it("con el precio local guardado pero deshabilitado lo dice, y no ofrece volver (ya rige el global)", () => {
    const t = texto(dibujar({ guardado: { precio: 25000, habilitado: false } }));
    expect(t).toMatch(/Hay un precio local guardado \(\$\s*25\.000\) pero deshabilitado: rige el precio global/);
    expect(t).not.toContain("Volver al precio global");
  });

  it("con el precio propio apagado en la sucursal avisa que rige el global", () => {
    expect(texto(dibujar({ capacidadActiva: false }))).toContain("«Centro» no usa precio propio: rige el precio global aunque guardes uno acá.");
    expect(texto(dibujar())).not.toContain("no usa precio propio");
  });
});

describe("textoDelCambio: el «antes → después»", () => {
  it("monto antes → monto después y el porcentaje con signo", () => {
    expect(textoDelCambio(cambioDePrecio(18000, 22000))).toMatch(/^\$\s*18\.000 → \$\s*22\.000 \(\+22,2 %\)$/);
    expect(textoDelCambio(cambioDePrecio(20000, 15000))).toMatch(/\(-25 %\)$/);
  });

  it("sin precio de partida no inventa un porcentaje", () => {
    expect(textoDelCambio(cambioDePrecio(0, 500))).not.toContain("%");
  });
});
