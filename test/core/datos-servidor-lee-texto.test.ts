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

const NOTACION = "Formato de número no admitido (solo dígitos y un punto decimal, sin miles ni coma).";
const noEsCanonico = (r: { ok: boolean; codigo?: string; mensaje?: string }, sujeto: string) => expect(falla(r)).toEqual({ codigo: "notacion", mensaje: `${sujeto}: ${NOTACION}` });

describe("validarImporte con texto", () => {
  const precio = { etiqueta: "El precio" };

  it("el servidor lee SOLO el formato canónico (dígitos y un punto decimal): «21000», «21.5», «1234.56», «0.5»", () => {
    expect(validarImporte("21000", precio)).toEqual({ ok: true, valor: 21000 });
    expect(validarImporte("21.5", precio)).toEqual({ ok: true, valor: 21.5 });
    expect(validarImporte("1234.56", precio)).toEqual({ ok: true, valor: 1234.56 });
    expect(validarImporte("0.5", precio)).toEqual({ ok: true, valor: 0.5 });
  });

  it("la notación argentina que escribe la persona NO llega así al servidor: «21,5», «1.234,56», «0,5» son «notacion»", () => {
    for (const t of ["21,5", "1.234,56", "0,5", "21,000"]) noEsCanonico(validarImporte(t, precio), "El precio");
  });

  it("los decimales se cuentan sobre el texto: «21.000» en un importe son 3 decimales (error de decimales, no veintiún mil)", () => {
    expect(falla(validarImporte("21.000", precio))).toEqual({ codigo: "decimales", mensaje: "El precio admite como máximo 2 decimales." });
    expect(falla(validarImporte("1.5555", precio))).toEqual({ codigo: "decimales", mensaje: "El precio admite como máximo 2 decimales." });
  });

  it("lo que no es canónico (miles con punto y coma, anglosajona con miles, científica, símbolos, texto, «.5», «5.», espacios) es «notacion»", () => {
    for (const t of ["1,234.56", "1e3", "$ 100", "abc", "1,2,3", ".5", "5.", "+5", " 5", "5 ", "1 000"]) noEsCanonico(validarImporte(t, precio), "El precio");
  });

  it("vacío es «sin importe» (o «falta» si es obligatorio) y un número ya leído sigue valiendo igual", () => {
    expect(validarImporte("", precio)).toEqual({ ok: true, valor: null });
    expect(falla(validarImporte("", { ...precio, obligatorio: true }))?.codigo).toBe("vacio");
    expect(validarImporte(21000, precio)).toEqual({ ok: true, valor: 21000 });
    expect(falla(validarImporte(21.001, precio))?.codigo).toBe("decimales");
  });
});

describe("validarCantidad con texto: el contexto es la unidad", () => {
  const kg = { nombre: "kg", decimales: 3 };
  const entera = { nombre: "unidad", decimales: 0 };
  const cantidad = { etiqueta: "La cantidad" };

  it("en una unidad de 3 decimales «1.205» es 1,205 (el punto es SIEMPRE decimal para el servidor, ya no hay «ambiguo»); «1205» es 1205; «1,205» es «notacion»", () => {
    expect(validarCantidad("1.205", kg, cantidad)).toEqual({ ok: true, valor: 1.205 });
    expect(validarCantidad("1205", kg, cantidad)).toEqual({ ok: true, valor: 1205 });
    noEsCanonico(validarCantidad("1,205", kg, cantidad), "La cantidad");
  });

  it("RIESGO DE STOCK: «1.205» NUNCA se lee como 1205 (miles): en los kg y l del sembrado (2 decimales) sobra un decimal; en g (0 decimales) también; en un importe, 3 decimales", () => {
    const kgDelSembrado = { nombre: "kg", decimales: 2 };
    const g = { nombre: "g", decimales: 0 };
    expect(falla(validarCantidad("1.205", kgDelSembrado, cantidad))?.codigo).toBe("decimales");
    expect(falla(validarCantidad("21.000", kgDelSembrado, cantidad))?.codigo).toBe("decimales");
    expect(falla(validarCantidad("1.205", g, cantidad))?.codigo).toBe("decimales");
    expect(falla(validarImporte("1.205", { etiqueta: "El precio" }))?.codigo).toBe("decimales");
    expect(validarCantidad("1.205", kg, cantidad)).toEqual({ ok: true, valor: 1.205 });
    expect(validarCantidad("0.125", kg, cantidad)).toEqual({ ok: true, valor: 0.125 });
    noEsCanonico(validarCantidad("1,205", kgDelSembrado, cantidad), "La cantidad");
  });

  it("en una unidad entera «1000» son mil; un decimal (aun «1.000») es error de decimales con el nombre de la unidad; «1,5» es «notacion»", () => {
    expect(validarCantidad("1000", entera, cantidad)).toEqual({ ok: true, valor: 1000 });
    const msg = 'La cantidad tiene que ser un número entero (la unidad "unidad" no admite decimales).';
    expect(falla(validarCantidad("1.5", entera, cantidad))).toEqual({ codigo: "decimales", mensaje: msg });
    expect(falla(validarCantidad("1.000", entera, cantidad))).toEqual({ codigo: "decimales", mensaje: msg });
    noEsCanonico(validarCantidad("1,5", entera, cantidad), "La cantidad");
  });

  it("más decimales de los de la unidad: el mensaje de la unidad", () => {
    expect(falla(validarCantidad("1.2345", kg, cantidad))).toEqual({ codigo: "decimales", mensaje: 'La cantidad admite como máximo 3 decimales (unidad "kg").' });
  });
});

describe("porcentajes, factor y food cost con texto", () => {
  it("el % de descuento (2 decimales): «10.5» vale, «10.555» y «1.000» son error de decimales, «10,5» es «notacion»", () => {
    expect(validarPorcentajeDescuento("10.5")).toEqual({ ok: true, valor: 10.5 });
    expect(falla(validarPorcentajeDescuento("10.555"))?.codigo).toBe("decimales");
    expect(falla(validarPorcentajeDescuento("1.000"))?.codigo).toBe("decimales");
    expect(falla(validarPorcentajeDescuento("10,5"))?.codigo).toBe("notacion");
  });

  it("el porcentaje de una diferencia y el factor (4 decimales): «1.500» es 1,5 y «1,5» es «notacion»", () => {
    expect(validarFactorDeEscala("1.500", { etiqueta: "El factor" })).toEqual({ ok: true, valor: 1.5 });
    expect(validarFactorDeEscala("1.5", { etiqueta: "El factor" })).toEqual({ ok: true, valor: 1.5 });
    noEsCanonico(validarFactorDeEscala("1,5", { etiqueta: "El factor" }), "El factor");
    expect(validarPorcentajeDeDiferencia("12.345", { etiqueta: "El porcentaje" })).toEqual({ ok: true, valor: 12.345 });
    noEsCanonico(validarPorcentajeDeDiferencia("12,5", { etiqueta: "El porcentaje" }), "El porcentaje");
    expect(falla(validarFactorDeEscala("1.23456", { etiqueta: "El factor" }))?.codigo).toBe("decimales");
  });

  it("el food cost objetivo (2 decimales)", () => {
    expect(validarFoodCostObjetivo("35.5")).toEqual({ ok: true, valor: 35.5 });
    expect(falla(validarFoodCostObjetivo("35.555"))?.codigo).toBe("decimales");
    expect(falla(validarFoodCostObjetivo("35,5"))?.codigo).toBe("notacion");
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

  it("una cantidad de consumo «0.125» (texto canónico) o 0.125 vale; «0,125» (coma) «0.12345» se rechazan", () => {
    expect(guardar(version("0.125")).ok).toBe(true);
    expect(guardar(version(0.125)).ok).toBe(true);
    expect(guardar(version("1.205")).ok).toBe(true);
    expect(guardar(version("0,125")).ok).toBe(false);
    expect(guardar(version("0.12345")).ok).toBe(false);
  });

  it("la merma admite 2 decimales: «12.5» vale; «12.555» y «12,5» (coma) se rechazan", () => {
    expect(guardar(version(1, "12.5")).ok).toBe(true);
    expect(guardar(version(1, "12.555")).ok).toBe(false);
    expect(guardar(version(1, "12,5")).ok).toBe(false);
  });
});
