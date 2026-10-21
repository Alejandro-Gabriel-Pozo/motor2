import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { leerPrecioDeOpcion, formaDelGrupoPorRespuesta, type LecturaDePrecio as LecturaDelPrecio } from "../../src/core/opciones/public";
import { LecturaDePrecio } from "../../src/components/catalogo/lectura-de-precio";

/**
 * Fase 6, paso 6.10c: `LecturaDePrecio` dibuja la frase del núcleo dentro de una `LecturaEnVivo`, con el dinero en el formato de la administración (es-AR: «$ 28.000», miles con punto). Se mira
 * el HTML del servidor; el espacio del formato es un espacio de no separación y se compara normalizado.
 */
const texto = (html: string) => html.replace(/<[^>]*>/g, "").replace(/ /g, " ");
const dibujar = (lectura: LecturaDelPrecio) => renderToStaticMarkup(<LecturaDePrecio lectura={lectura} />);

describe("LecturaDePrecio", () => {
  it("una suma sobre la opción más barata: «Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000»", () => {
    const lectura = leerPrecioDeOpcion({
      forma: formaDelGrupoPorRespuesta("SUMA"),
      opcion: { nombre: "Trucha", esNinguna: false },
      tecleado: 3000,
      precioBase: 0,
      referencia: { opcion: "Napolitana", precio: 25000 },
    });
    const html = dibujar(lectura);
    expect(texto(html)).toBe("Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-tono="lectura"');
  });

  it("un precio final con centavos usa la coma decimal: $ 8.500,25", () => {
    const lectura = leerPrecioDeOpcion({ forma: formaDelGrupoPorRespuesta("PRECIO_FINAL"), opcion: { nombre: "Chica", esNinguna: false }, tecleado: 8500.25, precioBase: 0, referencia: null });
    expect(texto(dibujar(lectura))).toBe("Chica = $ 8.500,25");
  });

  it("un grupo incluido no cambia el precio", () => {
    expect(texto(dibujar({ tipo: "no-cambia" }))).toBe("Este grupo no cambia el precio");
  });

  it("al precio final que falta le toca una advertencia; a un importe que no se entendió, un error", () => {
    const falta = dibujar({ tipo: "falta", opcion: "Napolitana" });
    expect(texto(falta)).toContain("Falta el precio final de «Napolitana»");
    expect(falta).toContain('data-tono="advertencia"');
    const invalido = dibujar({ tipo: "invalido", mensaje: "Revisá el importe de «Trucha»: no se entendió." });
    expect(texto(invalido)).toBe("Revisá el importe de «Trucha»: no se entendió.");
    expect(invalido).toContain('data-tono="error"');
  });
});
