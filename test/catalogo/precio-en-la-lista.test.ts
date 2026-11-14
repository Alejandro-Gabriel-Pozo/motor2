import { describe, expect, it } from "vitest";
import { claseDelProducto, TIPOS_FILTRABLES, ETIQUETA_DEL_TIPO, textoDelPrecioEnLaLista } from "../../src/core/catalogo/public";

/**
 * La lista de Productos (docs/diseno-productos-igual-a-pedernal-2026-11-13.md, D1). Dimensiones que cambian lo que ve el usuario en el lugar del precio: tipo (MP/PV) × modo de venta (directo/por opción) × precio (0/positivo).
 * El ORÁCULO es esta tabla, escrita aparte del código: un test recorre las 8 combinaciones contra ella. Si aparece un valor nuevo de `tipo` o de modo sin declarar, el test de cobertura de abajo falla.
 */
const ORACULO: { tipo: "MP" | "PV"; modoDeVenta: string; precio: number; esperado: string | null }[] = [
  { tipo: "PV", modoDeVenta: "DIRECTO", precio: 9500, esperado: "$\u00a09.500,00" },
  { tipo: "PV", modoDeVenta: "DIRECTO", precio: 0, esperado: "Sin precio" },
  { tipo: "PV", modoDeVenta: "BASE_CONFIGURABLE", precio: 0, esperado: "Según medida" },
  // El precio central de un producto por opción se conserva pero queda bloqueado (no se cobra): la lista no lo muestra.
  { tipo: "PV", modoDeVenta: "BASE_CONFIGURABLE", precio: 4000, esperado: "Según medida" },
  { tipo: "MP", modoDeVenta: "DIRECTO", precio: 0, esperado: null },
  { tipo: "MP", modoDeVenta: "DIRECTO", precio: 500, esperado: null },
  { tipo: "MP", modoDeVenta: "BASE_CONFIGURABLE", precio: 0, esperado: null },
  { tipo: "MP", modoDeVenta: "BASE_CONFIGURABLE", precio: 500, esperado: null },
];

describe("textoDelPrecioEnLaLista", () => {
  it.each(ORACULO)("$tipo · $modoDeVenta · precio $precio → $esperado", ({ esperado, ...producto }) => {
    expect(textoDelPrecioEnLaLista(producto)).toBe(esperado);
  });

  it("el oráculo recorre todas las combinaciones de tipo × modo × (precio 0 / positivo)", () => {
    const claves = new Set(ORACULO.map((o) => `${o.tipo}|${o.modoDeVenta}|${o.precio > 0}`));
    expect(claves.size).toBe(2 * 2 * 2);
  });
});

describe("claseDelProducto y las etiquetas del «¿Qué es?»", () => {
  it("cada combinación de tipo × se produce × respalda tiene su clase", () => {
    expect(claseDelProducto({ tipo: "PV", seProduce: false, respaldaUnaOpcion: false })).toBe("venta");
    expect(claseDelProducto({ tipo: "PV", seProduce: false, respaldaUnaOpcion: true })).toBe("respaldo");
    expect(claseDelProducto({ tipo: "MP", seProduce: false, respaldaUnaOpcion: false })).toBe("materia-prima");
    expect(claseDelProducto({ tipo: "MP", seProduce: true, respaldaUnaOpcion: false })).toBe("se-produce");
  });

  it("toda clase filtrable tiene su etiqueta, no vacía y distinta de las demás (sumar una clase obliga a ponerla)", () => {
    const etiquetas = TIPOS_FILTRABLES.map((t) => ETIQUETA_DEL_TIPO[t]);
    expect(etiquetas.every((e) => e.trim() !== "")).toBe(true);
    expect(new Set(etiquetas).size).toBe(TIPOS_FILTRABLES.length);
  });
});
