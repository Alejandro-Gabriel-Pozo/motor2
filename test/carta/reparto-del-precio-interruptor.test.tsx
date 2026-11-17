import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RepartoDelPrecio } from "../../src/app/(app)/carta/parametrizacion/promociones/reparto-del-precio";
import type { ParteParaRepartir } from "../../src/core/pos/reparto-del-precio-de-la-promo";

/** El bloque «Reparto del precio» (solo lectura): sus textos en cada caso. El interruptor lo decide la página (`ARMADO_DE_PROMO_COMO_PEDERNAL`), ver los dos estados abajo. */
const PARTES: ParteParaRepartir[] = [
  { nombre: "Platos", cantidadMinima: 1, cantidadMaxima: 1, ejemplo: { nombre: "Barbacoa", precioLista: 12000 } },
  { nombre: "Bebidas", cantidadMinima: 1, cantidadMaxima: 1, ejemplo: { nombre: "Gaseosa", precioLista: 2200 } },
];

describe("RepartoDelPrecio", () => {
  it("dibuja cada componente con su parte y su lista, y el texto de la maqueta", () => {
    const html = renderToStaticMarkup(<RepartoDelPrecio precio={13500} partes={PARTES} />);
    expect(html).toContain("Reparto del precio");
    expect(html).toMatch(/Barbacoa[^<]*11\.408,45 \(Lista [^<]*12\.000,00\)/);
    expect(html).toMatch(/Gaseosa[^<]*2\.091,55 \(Lista [^<]*2\.200,00\)/);
    expect(html).toContain("Se reparte en proporción al precio de lista. Para el ejemplo se usa el primer producto disponible de cada elección.");
    expect(html).not.toContain("cantidad máxima");
  });

  it("con un rango, no suma la explicación del máximo (pocas palabras, pedido del dueño 2026-11-17)", () => {
    const html = renderToStaticMarkup(<RepartoDelPrecio precio={13500} partes={[{ ...PARTES[0]!, cantidadMinima: 0, cantidadMaxima: 2 }, PARTES[1]!]} />);
    expect(html).not.toContain("cantidad máxima");
  });

  it("sin productos disponibles: lo dice, sin inventar un precio; con el precio bajo el piso: muestra el mensaje", () => {
    const sin = renderToStaticMarkup(<RepartoDelPrecio precio={13500} partes={PARTES.map((p) => ({ ...p, ejemplo: null }))} />);
    expect(sin).toContain("Sin productos disponibles para el ejemplo");
    expect(sin).not.toContain("$");
    const error = renderToStaticMarkup(<RepartoDelPrecio precio={0.01} partes={PARTES} />);
    expect(error).toContain("no alcanza el piso");
  });

  it("si falta producto en una parte NO se reparte: avisa en cuáles faltan y no muestra ningún importe repartido", () => {
    const html = renderToStaticMarkup(<RepartoDelPrecio precio={13500} partes={[PARTES[0]!, { ...PARTES[1]!, ejemplo: null }]} />);
    expect(html).toContain("No se puede mostrar el reparto");
    expect(html).toContain(PARTES[1]!.nombre);
    expect(html).not.toContain("$");
    expect(html).not.toContain("Lista");
  });

  it("promo sin componentes: no se dibuja nada", () => {
    expect(renderToStaticMarkup(<RepartoDelPrecio precio={13500} partes={[]} />)).toBe("");
  });
});
