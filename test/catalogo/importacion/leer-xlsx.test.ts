import { strToU8, zipSync } from "fflate";
import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import { ErrorDeLectura, leerXlsx, letraDeColumna, TOPE_DEL_ARCHIVO_EN_BYTES, TOPE_DESCOMPRIMIDO_EN_BYTES, type CeldaLeida, type HojaLeida } from "../../../scripts/importacion/leer-xlsx";

/**
 * E1.1 del importador del catálogo (docs/diseno-importador-de-catalogo-2026-10-28.md): el lector mínimo de .xlsx. Los archivos se arman en el test con `write-excel-file` (el que ya usa el
 * proyecto para exportar), nunca un binario en el repositorio; los casos que esa librería no genera (texto en línea, fórmula de texto con su valor, un error de Excel, un zip hostil) se
 * arman a mano con `fflate`.
 */
const aBytes = async (b: Promise<Buffer>) => new Uint8Array(await b);
const celda = (hoja: HojaLeida, fila: number, columna: number): CeldaLeida | undefined => hoja.filas.find((f) => f.numero === fila)?.celdas.get(columna);

/** Un .xlsx mínimo armado a mano: el libro, sus relaciones y las hojas dadas (nombre → XML de `sheetData`). */
function libroAMano(hojas: Record<string, string>, extra: Record<string, Uint8Array> = {}): Uint8Array {
  const nombres = Object.keys(hojas);
  const archivos: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres
        .map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships>${nombres.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
    ),
    ...extra,
  };
  nombres.forEach((n, i) => {
    archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<worksheet><sheetData>${hojas[n]}</sheetData></worksheet>`);
  });
  return zipSync(archivos);
}

describe("leerXlsx (E1.1)", () => {
  it("lee varias hojas por nombre, en orden, con texto (cadenas compartidas), números con su texto exacto y booleanos; solo las celdas con valor", async () => {
    const bytes = await aBytes(
      writeXlsxFile([
        {
          sheet: "Catálogo",
          data: [
            ["SKU", "Precio", "Activo", null, "Nota"],
            ["PIZZA-MUZZA", 22000, true, null, "Con «comillas» & ampersand <ok>"],
            [null, null, null, null, null],
            ["CAFE", 4100.5, false, "", "Café con leche"],
          ],
        },
        { sheet: "Precios por local", data: [["Local"], ["Los Miches"]] },
      ]).toBuffer(),
    );
    const libro = leerXlsx(bytes);
    expect(libro.problemas).toEqual([]);
    expect(libro.hojas.map((h) => h.nombre)).toEqual(["Catálogo", "Precios por local"]);
    const [cat, precios] = libro.hojas;
    expect(cat.filas.map((f) => f.numero)).toEqual([1, 2, 4]);
    expect(celda(cat, 2, 0)).toEqual({ tipo: "texto", valor: "PIZZA-MUZZA" });
    expect(celda(cat, 2, 1)).toEqual({ tipo: "numero", valor: "22000" });
    expect(celda(cat, 2, 2)).toEqual({ tipo: "booleano", valor: true });
    expect(celda(cat, 2, 3)).toBeUndefined();
    expect(celda(cat, 2, 4)).toEqual({ tipo: "texto", valor: "Con «comillas» & ampersand <ok>" });
    expect(celda(cat, 4, 1)).toEqual({ tipo: "numero", valor: "4100.5" });
    expect(celda(cat, 4, 2)).toEqual({ tipo: "booleano", valor: false });
    expect(celda(cat, 4, 3)).toBeUndefined();
    expect(celda(precios, 2, 0)).toEqual({ tipo: "texto", valor: "Los Miches" });
  });

  it("una fórmula SIN valor guardado no se inventa: es un problema con hoja y celda (y la celda no se lee)", async () => {
    const bytes = await aBytes(writeXlsxFile([["Precio"], [{ type: "Formula", value: "SUM(A1:A1)" }]], { sheet: "Precios por local" }).toBuffer());
    const libro = leerXlsx(bytes);
    expect(libro.problemas).toEqual([{ hoja: "Precios por local", celda: "A2", motivo: "celda con fórmula sin valor guardado" }]);
    expect(celda(libro.hojas[0], 2, 0)).toBeUndefined();
  });

  it("texto en línea (inlineStr, con entidades numéricas), fórmula con su valor guardado (str y número), error de Excel y celdas sin referencia", () => {
    const bytes = libroAMano({
      Hoja: [
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Categor&#237;a</t></is></c><c r="B1" t="inlineStr"><is><r><t>Pro</t></r><r><t xml:space="preserve">ducto </t></r></is></c></row>',
        '<row r="2"><c r="A2" t="str"><f>A1&amp;"x"</f><v>Categoríax</v></c><c r="B2"><f>1+1</f><v>2</v></c><c r="C2" t="e"><v>#N/A</v></c><c r="D2" s="2" t="n"/><c r="E2" s="2" t="n"></c></row>',
        '<row><c t="inlineStr"><is><t>sin ref</t></is></c><c><v>7</v></c></row>',
      ].join(""),
    });
    const libro = leerXlsx(bytes);
    const hoja = libro.hojas[0];
    expect(celda(hoja, 1, 0)).toEqual({ tipo: "texto", valor: "Categoría" });
    expect(celda(hoja, 1, 1)).toEqual({ tipo: "texto", valor: "Producto " });
    expect(celda(hoja, 2, 0)).toEqual({ tipo: "texto", valor: "Categoríax" });
    expect(celda(hoja, 2, 1)).toEqual({ tipo: "numero", valor: "2" });
    expect(celda(hoja, 2, 2)).toBeUndefined();
    expect(hoja.filas.find((f) => f.numero === 2)?.celdas.size).toBe(2);
    expect(celda(hoja, 3, 0)).toEqual({ tipo: "texto", valor: "sin ref" });
    expect(celda(hoja, 3, 1)).toEqual({ tipo: "numero", valor: "7" });
    expect(libro.problemas).toEqual([{ hoja: "Hoja", celda: "C2", motivo: "error de Excel en la celda: #N/A" }]);
  });

  it("rechaza lo que no es un libro: no es un zip, le falta el libro, una hoja declarada sin contenido", () => {
    expect(() => leerXlsx(strToU8("hola, no soy un zip"))).toThrow(ErrorDeLectura);
    expect(() => leerXlsx(zipSync({ "otra/cosa.xml": strToU8("<x/>") }))).toThrow(/le falta el libro/);
    const sinHoja = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Fantasma" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet9.xml"/></Relationships>'),
    });
    expect(() => leerXlsx(sinHoja)).toThrow(/Fantasma/);
  });

  it("topes: un archivo demasiado grande y un zip cuyo contenido descomprimido supera el tope se rechazan sin leerlos", () => {
    expect(() => leerXlsx(new Uint8Array(TOPE_DEL_ARCHIVO_EN_BYTES + 1))).toThrow(/pesa más/);
    // Una «bomba»: una hoja de ceros que se comprime a casi nada.
    const bomba = libroAMano({ Hoja: "" }, { "xl/worksheets/sheet2.xml": new Uint8Array(TOPE_DESCOMPRIMIDO_EN_BYTES + 10) });
    expect(bomba.length).toBeLessThan(TOPE_DEL_ARCHIVO_EN_BYTES);
    expect(() => leerXlsx(bomba)).toThrow(/tope de lectura/);
  });

  it("letraDeColumna: A, Z, AA, AZ, BA", () => {
    expect([0, 25, 26, 51, 52].map(letraDeColumna)).toEqual(["A", "Z", "AA", "AZ", "BA"]);
  });
});
