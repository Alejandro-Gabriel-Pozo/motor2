import { describe, expect, it } from "vitest";
import { validarCantidad } from "@/core/datos/cantidad";
import { validarFoodCostObjetivo } from "@/core/datos/food-cost-objetivo";
import { validarImporte } from "@/core/datos/importe";
import { validarPorcentajeDescuento } from "@/core/datos/porcentaje-descuento";
import { validarFactorDeEscala, validarPorcentajeDeDiferencia } from "@/core/datos/porcentaje-y-factor";
import { guardComandoAgregarVersionDeOpcion } from "@/core/features/catalogo/opciones-de-venta.guard";

/**
 * Micro-paso 2c, el SERVIDOR: lo que llega a una Server Action como TEXTO se lee con la misma regla que en la pantalla y con el contexto de su campo (importe 2 decimales, cantidad los de su unidad,
 * porcentaje y factor los de su columna). «21.000» ya no se lee como 21 en silencio; lo ambiguo y lo que no cabe se rechaza con un mensaje que dice cómo escribirlo. El servidor no confía en el cliente:
 * un cliente que mande texto se encuentra con lo mismo que quien teclea.
 */
const falla = (r: { ok: boolean; codigo?: string; mensaje?: string }) => (r.ok ? null : { codigo: r.codigo, mensaje: r.mensaje });

describe("validarImporte con texto", () => {
  const precio = { etiqueta: "El precio" };

  it("«21.000» es veintiún mil (antes 21), «21,5» veintiuno y medio, «1.234,56» mil doscientos treinta y cuatro con 56", () => {
    expect(validarImporte("21.000", precio)).toEqual({ ok: true, valor: 21000 });
    expect(validarImporte("21,5", precio)).toEqual({ ok: true, valor: 21.5 });
    expect(validarImporte("1.234,56", precio)).toEqual({ ok: true, valor: 1234.56 });
    expect(validarImporte("0,5", precio)).toEqual({ ok: true, valor: 0.5 });
    expect(validarImporte(".5", precio)).toEqual({ ok: true, valor: 0.5 });
  });

  it("«21,000» no se adivina: máximo 2 decimales, y dice cómo escribir veintiún mil", () => {
    expect(falla(validarImporte("21,000", precio))).toEqual({ codigo: "decimales", mensaje: "El precio admite como máximo 2 decimales. Para 21000 escribí 21000 o 21.000,00." });
    expect(falla(validarImporte("1,5555", precio))).toEqual({ codigo: "decimales", mensaje: "El precio admite como máximo 2 decimales." });
  });

  it("la notación anglosajona, la notación científica, los símbolos y el texto son «no es un número válido»", () => {
    for (const t of ["1,234.56", "1e3", "$ 100", "abc", "1,2,3"]) expect(falla(validarImporte(t, precio)), t).toEqual({ codigo: "formato", mensaje: "El precio no es un número válido." });
  });

  it("vacío es «sin importe» (o «falta» si es obligatorio) y un número ya leído sigue valiendo igual", () => {
    expect(validarImporte("", precio)).toEqual({ ok: true, valor: null });
    expect(falla(validarImporte("  ", { ...precio, obligatorio: true }))?.codigo).toBe("vacio");
    expect(validarImporte(21000, precio)).toEqual({ ok: true, valor: 21000 });
    expect(falla(validarImporte(21.001, precio))?.codigo).toBe("decimales");
  });
});

describe("validarCantidad con texto: el contexto es la unidad", () => {
  const kg = { nombre: "kg", decimales: 3 };
  const entera = { nombre: "unidad", decimales: 0 };
  const cantidad = { etiqueta: "La cantidad" };

  it("en una unidad de 3 decimales «1.205» es ambiguo (¿1,205 o 1205?) y no se guarda ninguna de las dos; «1,205» y «1205» sí", () => {
    expect(falla(validarCantidad("1.205", kg, cantidad))).toEqual({ codigo: "ambiguo", mensaje: "La cantidad: ¿1,205 o 1205? Escribí 1205 o 1,205." });
    expect(validarCantidad("1,205", kg, cantidad)).toEqual({ ok: true, valor: 1.205 });
    expect(validarCantidad("1205", kg, cantidad)).toEqual({ ok: true, valor: 1205 });
  });

  it("en una unidad entera «1.000» son mil y un decimal es error con el nombre de la unidad", () => {
    expect(validarCantidad("1.000", entera, cantidad)).toEqual({ ok: true, valor: 1000 });
    expect(falla(validarCantidad("1,5", entera, cantidad))).toEqual({ codigo: "decimales", mensaje: 'La cantidad tiene que ser un número entero (la unidad "unidad" no admite decimales).' });
  });

  it("más decimales de los de la unidad: el mensaje de la unidad", () => {
    expect(falla(validarCantidad("1,2345", kg, cantidad))).toEqual({ codigo: "decimales", mensaje: 'La cantidad admite como máximo 3 decimales (unidad "kg").' });
  });
});

describe("porcentajes, factor y food cost con texto", () => {
  it("el % de descuento (2 decimales): «10,5» vale, «10,555» es error de decimales y «1.000» son mil (fuera de rango)", () => {
    expect(validarPorcentajeDescuento("10,5")).toEqual({ ok: true, valor: 10.5 });
    expect(falla(validarPorcentajeDescuento("10,555"))?.codigo).toBe("decimales");
    expect(falla(validarPorcentajeDescuento("1.000"))?.codigo).toBe("rango");
  });

  it("el porcentaje de una diferencia y el factor (4 decimales): «1.500» es ambiguo y «1,5» vale", () => {
    expect(falla(validarFactorDeEscala("1.500", { etiqueta: "El factor" }))).toEqual({ codigo: "ambiguo", mensaje: "El factor: ¿1,500 o 1500? Escribí 1500 o 1,500." });
    expect(validarFactorDeEscala("1,5", { etiqueta: "El factor" })).toEqual({ ok: true, valor: 1.5 });
    expect(falla(validarPorcentajeDeDiferencia("12.345", { etiqueta: "El porcentaje" }))?.codigo).toBe("ambiguo");
    expect(validarPorcentajeDeDiferencia("12,5", { etiqueta: "El porcentaje" })).toEqual({ ok: true, valor: 12.5 });
    expect(falla(validarFactorDeEscala("1,23456", { etiqueta: "El factor" }))?.codigo).toBe("decimales");
  });

  it("el food cost objetivo (2 decimales)", () => {
    expect(validarFoodCostObjetivo("35,5")).toEqual({ ok: true, valor: 35.5 });
    expect(falla(validarFoodCostObjetivo("35,555"))?.codigo).toBe("decimales");
    expect(validarFoodCostObjetivo("")).toEqual({ ok: true, valor: null });
  });
});

describe("el guard de las opciones de venta lee los consumos con su contexto", () => {
  const version = (cantidad: unknown, mermaPorcentaje: unknown = 0) => ({
    diferencia: { tipo: "MONTO", monto: 0 },
    factorEscala: null,
    consumos: [{ efecto: "SUMA", insumoProductoId: "i1", reemplazaAProductoId: null, cantidad, mermaPorcentaje, escalaConLaMedida: false }],
  });
  const guardar = (v: unknown) => guardComandoAgregarVersionDeOpcion({ opcionId: "o1", numeroEsperado: 1, version: v });

  it("una cantidad de consumo «0,125» o 0.125 vale; «1.205» (ambigua, 4 decimales) y «0,12345» se rechazan", () => {
    expect(guardar(version("0,125")).ok).toBe(true);
    expect(guardar(version(0.125)).ok).toBe(true);
    expect(guardar(version("1.205")).ok).toBe(false);
    expect(guardar(version("0,12345")).ok).toBe(false);
  });

  it("la merma admite 2 decimales: «12,5» vale y «12,555» se rechaza", () => {
    expect(guardar(version(1, "12,5")).ok).toBe(true);
    expect(guardar(version(1, "12,555")).ok).toBe(false);
  });
});
