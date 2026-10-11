import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MesaCard, type MesaCardProps } from "../../src/components/mesas/mesa-card";
import { formatearMonto } from "../../src/core/pos/public";

/**
 * P19 (decisión del dueño, 2026-10-11): el total de la tarjeta de la mesa muestra los centavos, con el MISMO formato que el ticket y la pantalla de la mesa
 * (`formatearMonto`). Antes la tarjeta redondeaba a pesos enteros (`maximumFractionDigits: 0`) y mostraba «$ 1.235» donde el ticket decía «$ 1.234,56».
 * No necesita base: se dibuja el componente a HTML estático.
 */
const base = { numero: "01", productosSinEnviar: 2 } satisfies Partial<MesaCardProps>;
// `formatearMonto` separa el símbolo con un espacio no cortable: se normaliza solo para comparar texto legible.
const plano = (html: string) => html.replace(/\u00a0/g, " ");

describe("P19: el total de la tarjeta de la mesa muestra los centavos como el ticket", () => {
  it("1234,56 sale exactamente como lo formatea el ticket, con centavos y sin redondear", () => {
    const html = renderToStaticMarkup(<MesaCard {...base} estado="en_pedido" total={1234.56} />);
    expect(html).toContain(formatearMonto(1234.56));
    expect(plano(html)).toContain("1.234,56");
    expect(plano(html)).not.toContain("1.235");
  });

  it("una mesa ocupada usa el mismo formato", () => {
    const html = renderToStaticMarkup(<MesaCard {...base} estado="ocupada" total={1234.56} />);
    expect(html).toContain(formatearMonto(1234.56));
    expect(plano(html)).not.toContain("1.235");
  });

  it("un monto entero no cambia: 18400 sigue siendo «$ 18.400»", () => {
    const html = renderToStaticMarkup(<MesaCard {...base} estado="ocupada" total={18400} />);
    expect(plano(html)).toContain("$ 18.400");
    expect(plano(html)).not.toContain("18.400,");
  });

  it("0,5 muestra «0,5» (el formato del ticket: de 0 a 2 decimales)", () => {
    const html = renderToStaticMarkup(<MesaCard {...base} estado="en_pedido" total={0.5} />);
    expect(plano(html)).toContain("0,5");
    expect(html).toContain(formatearMonto(0.5));
  });

  it("sin total, la tarjeta muestra el guion y no inventa un monto", () => {
    const html = renderToStaticMarkup(<MesaCard {...base} estado="en_pedido" />);
    expect(html).toContain("—");
    expect(html).not.toContain("$");
  });

  it("una mesa libre no muestra total aunque se le pase uno", () => {
    const html = renderToStaticMarkup(<MesaCard {...base} estado="libre" total={1234.56} />);
    expect(html).not.toContain("1.234");
    expect(html).not.toContain("$");
  });
});
