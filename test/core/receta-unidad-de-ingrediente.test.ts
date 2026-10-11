import { describe, expect, it } from "vitest";
import { validarUnidadDeIngredientes, type IngredienteInput } from "../../src/core/catalogo/receta-validacion";

/**
 * U7 / D3 (decisión del dueño, 2026-10-11): una receta NO puede escribirse en otra unidad que la de STOCK de la materia prima (g contra kg), por ahora. El consumo multiplica el número de la
 * receta por el stock en SU unidad de stock; un «g» sobre una MP en «kg» descontaría 1000 veces más stock y costo. Sin base de datos: la regla es pura.
 */
describe("validarUnidadDeIngredientes — la unidad de la receta es la de stock de la materia prima", () => {
  const productos = new Map([
    ["harina", { nombre: "Harina 000", unidadStockId: "kg" }],
    ["aceite", { nombre: "Aceite de oliva", unidadStockId: "lt" }],
  ]);
  const unidades = new Map([
    ["kg", "kg"],
    ["g", "g"],
    ["lt", "lt"],
  ]);
  const ing = (insumoProductoId: string, unidadId: string): IngredienteInput => ({ insumoProductoId, unidadId, cantidad: 1 });

  it("acepta cuando todos los ingredientes están en la unidad de stock de su materia prima", () => {
    expect(validarUnidadDeIngredientes([ing("harina", "kg"), ing("aceite", "lt")], productos, unidades)).toBeNull();
  });

  it("rechaza g sobre una MP que se descuenta en kg, y el mensaje dice qué falla, por qué y cómo resolverlo", () => {
    const mensaje = validarUnidadDeIngredientes([ing("harina", "g")], productos, unidades);
    expect(mensaje).toContain("Harina 000");
    expect(mensaje).toContain("está cargado en g");
    expect(mensaje).toContain("se descuenta en kg");
    expect(mensaje).toContain("cargá la cantidad en kg");
  });

  it("rechaza si UNO solo de varios ingredientes está en otra unidad, y nombra a ese", () => {
    const mensaje = validarUnidadDeIngredientes([ing("harina", "kg"), ing("aceite", "g")], productos, unidades);
    expect(mensaje).toContain("Aceite de oliva");
    expect(mensaje).toContain("se descuenta en lt");
  });

  it("una unidad que no figura en el mapa de nombres igual se rechaza (no se deja pasar por no poder nombrarla)", () => {
    expect(validarUnidadDeIngredientes([ing("harina", "fantasma")], productos, unidades)).not.toBeNull();
  });

  it("el ingrediente cuya MP no figura en el mapa lo reporta la otra validación (`validarIngredientes`), no esta", () => {
    expect(validarUnidadDeIngredientes([ing("no-existe", "kg")], productos, unidades)).toBeNull();
  });
});
