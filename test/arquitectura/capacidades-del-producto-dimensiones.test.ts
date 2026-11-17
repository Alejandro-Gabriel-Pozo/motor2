import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DONDE_SE_DECIDE_HOY } from "../catalogo/capacidades-del-producto-oraculo";

/**
 * GUARDIÁN DE DIMENSIONES de `capacidadesDelProducto` (docs/diseno-reventa-e4-2026-11-17.md §8, regla de combinaciones del 2026-10-28). Falla si aparece una dimensión NUEVA sin declarar si afecta o no:
 *  (a) una clave nueva en los datos de entrada (`DatosDeCapacidad`): lo que el producto aporta para decidir;
 *  (b) una capacidad nueva en la salida (`CapacidadesDelProducto`): debe tener su fila en el oráculo (`DONDE_SE_DECIDE_HOY`) y su celda en cada forma del producto.
 * Cada declaración lleva su motivo. LÍMITES (alarma para errores honestos, no un límite de seguridad): lee el TEXTO del archivo, no los tipos de TypeScript.
 */
const RAIZ = join(__dirname, "../..");
const ARCHIVO = join(RAIZ, "src/core/catalogo/capacidades-del-producto.ts");
const fuente = readFileSync(ARCHIVO, "utf8");

interface Declaracion {
  afecta: boolean;
  motivo: string;
}
const conMotivo = (d: Declaracion) => d.motivo.trim().length >= 8;
const clavesDe = (interfaz: string): string[] => [...(new RegExp(`export interface ${interfaz} \\{([\\s\\S]*?)\\n\\}`).exec(fuente)?.[1] ?? "").matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]!);

const ENTRADA: Record<string, Declaracion> = {
  tipo: { afecta: true, motivo: "MP o PV: decide casi todo hoy (qué se compra, qué se vende, qué es ingrediente)." },
  seProduce: { afecta: true, motivo: "marca «se produce»: stock propio, producción y receta del producto." },
  claseDeUso: { afecta: true, motivo: "solo REVENTA cambia algo (se compra y se vende); el resto de las clases no cambia lo que hoy se decide por tipo." },
};

const SALIDA: Record<string, Declaracion> = {
  seCompra: { afecta: true, motivo: "dinero y stock: el proceso COMPRA." },
  seVende: { afecta: true, motivo: "dinero y visibilidad: precio, carta, POS, venta." },
  tieneStockPropio: { afecta: true, motivo: "stock: compra, venta, conteo, traspaso, ajuste." },
  sePuedeProducir: { afecta: true, motivo: "stock: el proceso PRODUCCION." },
  llevaReceta: { afecta: true, motivo: "composición y costo: receta propia." },
  esIngredienteDeReceta: { afecta: true, motivo: "stock y costo: ser componente de otra receta." },
  loConsumeUnaOpcion: { afecta: true, motivo: "stock: lo que una opción de venta consume." },
};

describe("guardián de dimensiones de las capacidades del producto (regla de combinaciones, 2026-10-28)", () => {
  it("(a) cada dato de entrada está declarado, con su motivo", () => {
    const claves = clavesDe("DatosDeCapacidad");
    expect(claves.length, "no se pudieron leer las claves: ¿cambió la forma del archivo?").toBeGreaterThanOrEqual(3);
    expect(claves.filter((c) => !(c in ENTRADA)), "dimensión nueva sin declarar si afecta o no (agregala acá con su motivo y a la tabla del oráculo)").toEqual([]);
    expect(Object.keys(ENTRADA).filter((c) => !claves.includes(c)), "declarada pero ya no existe").toEqual([]);
    for (const d of Object.values(ENTRADA)) expect(conMotivo(d)).toBe(true);
  });

  it("(b) cada capacidad de la salida está declarada, con su motivo y su fila en el oráculo", () => {
    const claves = clavesDe("CapacidadesDelProducto");
    expect(claves.length, "no se pudieron leer las capacidades: ¿cambió la forma del archivo?").toBeGreaterThanOrEqual(7);
    expect(claves.filter((c) => !(c in SALIDA)), "capacidad nueva sin declarar (agregala acá y al oráculo)").toEqual([]);
    expect(Object.keys(SALIDA).filter((c) => !claves.includes(c)), "declarada pero ya no existe").toEqual([]);
    expect(Object.keys(DONDE_SE_DECIDE_HOY).sort(), "el oráculo tiene que tener «dónde se decide hoy» de cada capacidad").toEqual([...claves].sort());
    for (const d of Object.values(SALIDA)) expect(conMotivo(d)).toBe(true);
  });
});
