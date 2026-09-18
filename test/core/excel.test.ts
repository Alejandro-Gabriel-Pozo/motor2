import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { generarExcel, nombreDeArchivo, nombreDeHoja } from "@/core/excel";

// Sin base de datos ni Excel: se genera el .xlsx real y se inspecciona su XML
// (un .xlsx es un zip). Es el mismo código que corre en el navegador.
async function abrir(blob: Blob) {
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return {
    hoja: strFromU8(zip["xl/worksheets/sheet1.xml"]),
    textos: strFromU8(zip["xl/sharedStrings.xml"]),
    libro: strFromU8(zip["xl/workbook.xml"]),
  };
}

const ETIQUETAS = ["Producto", "Precio venta", "Costo", "Estado"];

describe("generarExcel", () => {
  it("un number se guarda como número (sin tipo texto), con punto decimal interno y sin depender de la configuración regional", async () => {
    const { hoja } = await abrir(await generarExcel("Costos", ETIQUETAS, [["PV026", 12800, 5262.44, "Food cost alto"]]));
    expect(hoja).toContain('<c r="B2"><v>12800</v></c>');
    expect(hoja).toContain('<c r="C2"><v>5262.44</v></c>');
  });

  it("un number negativo (ej. un ajuste de stock de -5) o 0 quedan intactos", async () => {
    const { hoja } = await abrir(await generarExcel("Ajustes", ETIQUETAS, [["a", -5, 0, "x"]]));
    expect(hoja).toContain('<c r="B2"><v>-5</v></c>');
    expect(hoja).toContain('<c r="C2"><v>0</v></c>');
  });

  it.each(["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1:A9)", '=HYPERLINK("http://x","y")'])(
    "un texto que dispararía una fórmula se guarda como texto, no como fórmula: %s",
    async (texto) => {
      const { hoja, textos } = await abrir(await generarExcel("X", ["Nombre"], [[texto]]));
      expect(hoja).not.toContain("<f>");
      expect(hoja).toContain('<c r="A2" t="s">'); // t="s" = cadena compartida
      expect(textos).toContain(`<t>${texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</t>`);
    }
  );

  it("null, undefined y '' no generan celda", async () => {
    const { hoja } = await abrir(await generarExcel("X", ["a", "b", "c", "d"], [["fijo", null, undefined, ""]]));
    expect(hoja).toContain('<c r="A2"');
    expect(hoja).not.toContain('r="B2"');
    expect(hoja).not.toContain('r="C2"');
    expect(hoja).not.toContain('r="D2"');
  });

  it("un number no finito (NaN, Infinity) no genera celda en vez de escribir un valor inválido", async () => {
    const { hoja } = await abrir(await generarExcel("X", ["a", "b"], [[Number.NaN, Number.POSITIVE_INFINITY]]));
    expect(hoja).not.toContain('r="A2"');
    expect(hoja).not.toContain('r="B2"');
  });

  it("escapa los caracteres especiales de XML en los textos", async () => {
    const { textos } = await abrir(await generarExcel("X", ["Nombre"], [["Pan & <Queso>"]]));
    expect(textos).toContain("Pan &amp; &lt;Queso&gt;");
  });

  it("sin filas genera un archivo válido, solo con el encabezado", async () => {
    const blob = await generarExcel("Vacío", ["A", "B"], []);
    expect(blob.size).toBeGreaterThan(0);
    const { hoja } = await abrir(blob);
    expect(hoja).toContain('r="A1"');
    expect(hoja).not.toContain('r="A2"');
  });

  it("un texto de más de 32767 caracteres (límite de celda de Excel) se corta con '…'", async () => {
    const { textos } = await abrir(await generarExcel("X", ["Nombre"], [["x".repeat(40000)]]));
    const guardado = textos.match(/<t>(x+…)<\/t>/)?.[1] ?? "";
    expect(guardado).toHaveLength(32767);
  });

  it("un texto justo en el límite no se toca", async () => {
    const { textos } = await abrir(await generarExcel("X", ["Nombre"], [["y".repeat(32767)]]));
    expect(textos).toContain(`<t>${"y".repeat(32767)}</t>`);
    expect(textos).not.toContain("…");
  });

  it("la hoja lleva el nombre pedido, saneado", async () => {
    const { libro } = await abrir(await generarExcel("costos: y/márgenes [x]", ["a"], [["b"]]));
    expect(libro).toContain('name="costos  y márgenes  x"');
  });
});

describe("nombreDeHoja", () => {
  it("quita los caracteres que Excel no admite en el nombre de una hoja", () => {
    expect(nombreDeHoja("a[b]c:d*e?f/g\\h")).toBe("a b c d e f g h");
  });

  it("corta a 31 caracteres, el máximo de Excel", () => {
    expect(nombreDeHoja("x".repeat(50))).toHaveLength(31);
  });

  it("si queda vacío usa un nombre por defecto", () => {
    expect(nombreDeHoja("   ")).toBe("Reporte");
    expect(nombreDeHoja("")).toBe("Reporte");
  });

  it("quita un apóstrofo al principio o al final, también el que queda al cortar a 31 caracteres", () => {
    expect(nombreDeHoja("'abc'")).toBe("abc");
    expect(nombreDeHoja("historial-D'")).toBe("historial-D");
    expect(nombreDeHoja(`${"x".repeat(30)}'x`)).toBe("x".repeat(30));
    expect(nombreDeHoja("D'Oro")).toBe("D'Oro");
    expect(nombreDeHoja("'")).toBe("Reporte");
  });
});

describe("nombreDeArchivo", () => {
  it("reemplaza los caracteres que Windows no admite en un nombre de archivo", () => {
    expect(nombreDeArchivo("ventas-categoria-Lácteos/Quesos")).toBe("ventas-categoria-Lácteos-Quesos");
    expect(nombreDeArchivo('a\\b:c*d?e"f<g>h|i')).toBe("a-b-c-d-e-f-g-h-i");
  });

  it("no toca un nombre normal", () => {
    expect(nombreDeArchivo("compras-por-proveedor")).toBe("compras-por-proveedor");
  });

  it("corta a 120 caracteres y usa un nombre por defecto si queda vacío", () => {
    expect(nombreDeArchivo("a".repeat(200))).toHaveLength(120);
    expect(nombreDeArchivo("   ")).toBe("reporte");
  });
});
