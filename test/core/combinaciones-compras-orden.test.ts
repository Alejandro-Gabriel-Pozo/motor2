import { describe, expect, it } from "vitest";
import {
  dimensionesDeOrden,
  productoCartesiano,
  resultadoDeAnular,
  resultadoDeCerrar,
  resultadoDeDatos,
  resultadoDeExceso,
  resultadoDePedir,
  resultadoDePuerta,
  resultadoDeVinculo,
  tablaDeOrden,
} from "../setup/oraculo-compras-orden";

/**
 * Oráculo de combinaciones de la orden de compra (regla «Combinaciones» del dueño): recorre TODAS las combinaciones de las reglas reales (puerta acción × módulo × rol, datos de una orden nueva, pedir, anular, cerrar, vincular un renglón
 * y control de exceso) contra las tablas de `docs/oraculo-combinaciones-compras-orden-2026-11-17.md`, escritas aparte del código. Son pocas, así que el recorrido es exhaustivo. Que la tabla sea EXACTAMENTE el producto de los valores
 * declarados es la mitad del test: una fila repetida, faltante o con un valor no declarado lo pone en rojo.
 */
const DIMENSIONES = dimensionesDeOrden();

const SECCIONES = [
  { seccion: "Puerta de las acciones de la orden", dims: ["A", "M", "O"], decidir: resultadoDePuerta },
  { seccion: "Datos de una orden nueva", dims: ["P", "I", "F"], decidir: resultadoDeDatos },
  { seccion: "Pedir la orden", dims: ["E", "L", "D"], decidir: resultadoDePedir },
  { seccion: "Anular la orden", dims: ["E", "V", "T"], decidir: resultadoDeAnular },
  { seccion: "Cerrar la orden", dims: ["E", "W"], decidir: resultadoDeCerrar },
  { seccion: "Vincular un renglón con una línea de la orden", dims: ["E", "Y", "G", "H"], decidir: resultadoDeVinculo },
  { seccion: "Control de exceso contra la orden", dims: ["N", "X", "Z", "K"], decidir: resultadoDeExceso },
] as const;

describe.each(SECCIONES)("oráculo: $seccion", ({ seccion, dims, decidir }) => {
  const tabla = tablaDeOrden(seccion);

  it("la tabla es exactamente el producto cartesiano de los valores declarados (sin filas repetidas, faltantes ni valores no declarados)", () => {
    expect(tabla.columnas).toEqual([...dims, "Resultado"]);
    const declarado = productoCartesiano(Object.fromEntries(dims.map((d) => [d, DIMENSIONES[d] ?? []])));
    expect(declarado.length).toBeGreaterThan(0);
    const clave = (f: Record<string, string>) => dims.map((d) => f[d]).join("|");
    expect(tabla.filas.map(clave).sort()).toEqual(declarado.map(clave).sort());
  });

  it("cada combinación da el resultado de la tabla", () => {
    expect(tabla.filas.length).toBeGreaterThan(0);
    for (const fila of tabla.filas) {
      expect(decidir(fila), dims.map((d) => `${d}=${fila[d]}`).join(" ")).toBe(fila["Resultado"]);
    }
  });
});
