import { describe, expect, it } from "vitest";
import {
  armarComandoDeOpcionNueva,
  ayudaDelImporte,
  etiquetaDelImporte,
  formularioDeOpcionInicial,
  loQueLleva,
  textosDeLaVentana,
} from "../../src/components/catalogo/nueva-opcion-en-el-grupo-formulario";
import { MARCA_DE_NO_CANONICO } from "../../src/core/datos/numero-tecleado";

/** Lo puro de «+ Opción» / «+ Extra» (la ventana de la tarjeta de un grupo del producto): qué lleva la opción según el grupo, los textos y el comando que se arma. El servidor valida todo (y decide por el tipo que lee). */
describe("loQueLleva: qué pide la opción nueva según el grupo", () => {
  it.each([
    ["ADICIONAL", null, "cobra"],
    ["INCLUIDA", null, "nada"],
    ["VARIANTE", null, "suma"],
    ["MEDIDA", "ABSOLUTO", "precio-final"],
    ["MEDIDA", "DIFERENCIA", "suma"],
    ["MEDIDA", null, "suma"],
  ] as const)("%s en modo %s → %s", (tipo, modo, esperado) => {
    expect(loQueLleva(tipo, modo)).toBe(esperado);
  });
});

describe("textos de la ventana", () => {
  it("«+ Extra» en un adicional y «+ Opción» en los demás, con el grupo en el nombre accesible", () => {
    expect(textosDeLaVentana("ADICIONAL", "Extras")).toMatchObject({ boton: "+ Extra", botonAccesible: "+ Extra en Extras", titulo: "Nuevo extra en «Extras»", nombre: "Nombre del extra", enviar: "Agregar el extra" });
    expect(textosDeLaVentana("VARIANTE", "Leche")).toMatchObject({ boton: "+ Opción", botonAccesible: "+ Opción en Leche", titulo: "Nueva opción en «Leche»", nombre: "Nombre de la opción", enviar: "Agregar la opción" });
  });

  it("el nombre accesible del botón contiene el texto visible (etiqueta en el nombre)", () => {
    for (const tipo of ["ADICIONAL", "VARIANTE", "MEDIDA", "INCLUIDA"] as const) {
      const t = textosDeLaVentana(tipo, "Grupo");
      expect(t.botonAccesible.startsWith(t.boton), tipo).toBe(true);
    }
  });

  it("la etiqueta y la ayuda del importe: una por cada cosa que se lleva, ninguna si no lleva", () => {
    expect(etiquetaDelImporte("precio-final")).toBe("Precio final de la opción");
    expect(etiquetaDelImporte("suma")).toBe("Cuánto suma");
    expect(etiquetaDelImporte("cobra")).toBe("Cuánto cobra");
    expect(etiquetaDelImporte("nada")).toBeNull();
    expect(ayudaDelImporte("nada")).toBeNull();
    expect(ayudaDelImporte("cobra")).toContain("producto interno");
  });
});

describe("armarComandoDeOpcionNueva", () => {
  const grupo = (lleva: Parameters<typeof armarComandoDeOpcionNueva>[0]["lleva"]) => ({ productoId: "p1", grupoId: "g1", versionEsperada: 4, lleva });

  it("lo que suma: arranca en 0 (una opción que no suma nada no necesita que se teclee un cero) y vacío es 0", () => {
    expect(formularioDeOpcionInicial("suma")).toEqual({ nombre: "", importe: "0", unidadStockId: "" });
    expect(armarComandoDeOpcionNueva(grupo("suma"), { nombre: "  Avena ", importe: "", unidadStockId: "" })).toEqual({ productoId: "p1", grupoId: "g1", versionEsperada: 4, nombre: "Avena", importe: 0, unidadStockId: null });
    expect(armarComandoDeOpcionNueva(grupo("suma"), { nombre: "Avena", importe: "200.5", unidadStockId: "" }).importe).toBe(200.5);
  });

  it("el precio final y lo que cobra el extra: vacío viaja como null (el servidor dice que falta) y un texto que no se entiende como NaN (dice que no es un número)", () => {
    for (const lleva of ["precio-final", "cobra"] as const) {
      expect(armarComandoDeOpcionNueva(grupo(lleva), { nombre: "X", importe: "", unidadStockId: "" }).importe, lleva).toBeNull();
      expect(armarComandoDeOpcionNueva(grupo(lleva), { nombre: "X", importe: `1.205${MARCA_DE_NO_CANONICO}`, unidadStockId: "" }).importe, lleva).toBeNaN();
      expect(armarComandoDeOpcionNueva(grupo(lleva), { nombre: "X", importe: "9000", unidadStockId: "" }).importe, lleva).toBe(9000);
    }
  });

  it("un grupo incluido no lleva importe, aunque haya algo tecleado", () => {
    expect(armarComandoDeOpcionNueva(grupo("nada"), { nombre: "Edulcorante", importe: "50", unidadStockId: "" }).importe).toBeNull();
  });

  it("la unidad del respaldo solo viaja en un extra, y vacía es null", () => {
    expect(armarComandoDeOpcionNueva(grupo("cobra"), { nombre: "Crema", importe: "120", unidadStockId: "u1" }).unidadStockId).toBe("u1");
    expect(armarComandoDeOpcionNueva(grupo("cobra"), { nombre: "Crema", importe: "120", unidadStockId: "" }).unidadStockId).toBeNull();
    for (const lleva of ["suma", "precio-final", "nada"] as const) expect(armarComandoDeOpcionNueva(grupo(lleva), { nombre: "X", importe: "1", unidadStockId: "u1" }).unidadStockId, lleva).toBeNull();
  });
});
