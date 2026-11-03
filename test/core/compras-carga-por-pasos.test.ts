import { describe, expect, it } from "vitest";
import {
  PASOS_DE_COMPRA,
  avisoDeImporteCero,
  avisoDeUnidadNoVigente,
  avisosDeImporteCero,
  cantidadEnStock,
  decidirUnidadDePrecarga,
  etiquetaDeUnidad,
  mensajeFinalDeCompra,
  pasoAnterior,
  pasoSiguiente,
  precioPorUnidad,
  seMuestraElPesoReal,
  unidadEfectiva,
  validarPasoDonde,
  validarPasoFactura,
  validarPasoLineas,
  type LineaParaValidar,
  type UnidadesDeCompraDelProducto,
} from "../../src/core/compras/public";
import { PARTES_DE_NUMERO_VACIAS, estadoDelNumeroTecleado, partesDeNumeroGuardado, soloDigitos } from "../../src/core/datos/numero-comprobante";

/** Lógica pura de la Compra por pasos (etapa 1 de Compras, paso 6) y el armado del número que muestra la pantalla. Sin base. */

const unidades: UnidadesDeCompraDelProducto = {
  unidadStockNombre: "unidad",
  porDefecto: { unidadCompraId: "u", nombre: "unidad", factor: 1 },
  presentaciones: [{ unidadCompraId: "c", nombre: "caja", factor: 12 }],
};
const numeroOk = { letra: "A", puntoDeVenta: "23", numero: "237728" };
const linea = (cambios: Partial<LineaParaValidar> = {}): LineaParaValidar => ({ productoId: "p", nombre: "Harina", cantidad: "2", loteVencimiento: "", referenciaProveedor: "HAR-1", yaVinculado: false, unidadSinConfirmar: false, ...cambios });

describe("pasos", () => {
  it("son cinco, en orden, y anterior/siguiente se quedan en los extremos", () => {
    expect(PASOS_DE_COMPRA.map((p) => p.id)).toEqual(["FACTURA", "LINEAS", "DONDE", "PAGO", "REVISAR"]);
    expect(pasoSiguiente("FACTURA")).toBe("LINEAS");
    expect(pasoSiguiente("REVISAR")).toBe("REVISAR");
    expect(pasoAnterior("LINEAS")).toBe("FACTURA");
    expect(pasoAnterior("FACTURA")).toBe("FACTURA");
  });
});

describe("validarPasoFactura", () => {
  const base = { proveedorId: "prov", fecha: "2026-11-03", hoy: "2026-11-03", numero: numeroOk };
  it("completa: sin error (la fecha de hoy vale)", () => expect(validarPasoFactura(base)).toBeNull());
  it("sin proveedor", () => expect(validarPasoFactura({ ...base, proveedorId: "" })?.mensaje).toBe("Elegí el proveedor."));
  it("sin fecha, fecha inexistente y fecha futura", () => {
    expect(validarPasoFactura({ ...base, fecha: "" })?.mensaje).toMatch(/fecha/);
    expect(validarPasoFactura({ ...base, fecha: "2026-02-30" })?.mensaje).toMatch(/no existe/);
    expect(validarPasoFactura({ ...base, fecha: "2026-11-04" })?.mensaje).toMatch(/posterior a hoy/);
  });
  it("número vacío, a medias o con ceros", () => {
    expect(validarPasoFactura({ ...base, numero: PARTES_DE_NUMERO_VACIAS })?.mensaje).toMatch(/Falta el número/);
    expect(validarPasoFactura({ ...base, numero: { ...numeroOk, letra: "" } })?.mensaje).toMatch(/letra/);
    expect(validarPasoFactura({ ...base, numero: { ...numeroOk, puntoDeVenta: "" } })?.mensaje).toMatch(/punto de venta/);
    expect(validarPasoFactura({ ...base, numero: { ...numeroOk, numero: "0" } })?.mensaje).toMatch(/no puede ser 0/);
  });
});

describe("número tecleado", () => {
  it("vacío, a medias y válido (con ceros)", () => {
    expect(estadoDelNumeroTecleado(PARTES_DE_NUMERO_VACIAS)).toEqual({ tipo: "vacio" });
    expect(estadoDelNumeroTecleado({ letra: "A", puntoDeVenta: "", numero: "" }).tipo).toBe("error");
    expect(estadoDelNumeroTecleado(numeroOk)).toEqual({ tipo: "valido", numero: "A-00023-00237728" });
    expect(estadoDelNumeroTecleado({ letra: "b", puntoDeVenta: "1", numero: "1" })).toEqual({ tipo: "valido", numero: "B-00001-00000001" });
  });
  it("soloDigitos deja dígitos y corta al máximo", () => {
    expect(soloDigitos("12a3-4", 5)).toBe("1234");
    expect(soloDigitos("123456789", 5)).toBe("12345");
  });
  it("partesDeNumeroGuardado: canónico sí; texto libre o vacío, null", () => {
    expect(partesDeNumeroGuardado("A-00023-00237728")).toEqual({ letra: "A", puntoDeVenta: "00023", numero: "00237728" });
    expect(partesDeNumeroGuardado("FAC 123")).toBeNull();
    expect(partesDeNumeroGuardado(null)).toBeNull();
    expect(partesDeNumeroGuardado("")).toBeNull();
  });
});

describe("validarPasoLineas", () => {
  it("sin líneas o con todas vacías: pide cargar un insumo", () => {
    expect(validarPasoLineas([])?.mensaje).toMatch(/al menos un insumo/);
    expect(validarPasoLineas([linea({ productoId: "", nombre: "", cantidad: "", referenciaProveedor: "" })])?.mensaje).toMatch(/al menos un insumo/);
  });
  it("una línea completa pasa; una fila vacía a su lado se ignora", () => {
    expect(validarPasoLineas([linea(), linea({ productoId: "", nombre: "", cantidad: "", referenciaProveedor: "" })])).toBeNull();
  });
  it("cantidad faltante, cero, negativa o no numérica frenan con el índice de la fila", () => {
    expect(validarPasoLineas([linea(), linea({ cantidad: "" })])).toMatchObject({ fila: 1, mensaje: expect.stringMatching(/Falta la cantidad/) });
    for (const cantidad of ["0", "-1", "abc"]) expect(validarPasoLineas([linea({ cantidad })])?.fila).toBe(0);
  });
  it("cantidad sin producto frena", () => expect(validarPasoLineas([linea({ productoId: "", nombre: "" })])?.mensaje).toMatch(/Elegí el insumo/));
  it("vencimiento inexistente frena y marca el campo", () => expect(validarPasoLineas([linea({ loteVencimiento: "2026-02-30" })])).toMatchObject({ fila: 0, campo: "vencimiento" }));
  it("primera compra sin cómo lo llama el proveedor frena; si ya está vinculado, no", () => {
    expect(validarPasoLineas([linea({ referenciaProveedor: "  " })])?.mensaje).toMatch(/cómo lo llama el proveedor|Escribí cómo lo llama/);
    expect(validarPasoLineas([linea({ referenciaProveedor: "", yaVinculado: true })])).toBeNull();
  });
  it("la unidad sin confirmar frena", () => expect(validarPasoLineas([linea({ unidadSinConfirmar: true })])?.mensaje).toBe("Confirmá la unidad de «Harina»."));
});

describe("validarPasoDonde", () => {
  it("exige el depósito", () => {
    expect(validarPasoDonde({ seccionId: "" })?.mensaje).toMatch(/depósito/);
    expect(validarPasoDonde({ seccionId: "s" })).toBeNull();
  });
});

describe("unidades", () => {
  it("unidadEfectiva: vacío o la por defecto → por defecto; presentación activa → esa; desconocida → por defecto", () => {
    expect(unidadEfectiva(unidades, "")).toBe(unidades.porDefecto);
    expect(unidadEfectiva(unidades, "u")).toBe(unidades.porDefecto);
    expect(unidadEfectiva(unidades, "c")).toBe(unidades.presentaciones[0]);
    expect(unidadEfectiva(unidades, "desactivada")).toBe(unidades.porDefecto);
  });
  it("etiquetaDeUnidad", () => {
    expect(etiquetaDeUnidad(unidades.porDefecto)).toBe("unidad");
    expect(etiquetaDeUnidad(unidades.presentaciones[0])).toBe("caja (×12)");
  });
  it("decidirUnidadDePrecarga: caja activa → caja; la por defecto o sin dato → vacía y vigente; desactivada → vacía y NO vigente", () => {
    expect(decidirUnidadDePrecarga("c", unidades)).toEqual({ unidadCompraId: "c", vigente: true });
    expect(decidirUnidadDePrecarga("u", unidades)).toEqual({ unidadCompraId: "", vigente: true });
    expect(decidirUnidadDePrecarga("", unidades)).toEqual({ unidadCompraId: "", vigente: true });
    expect(decidirUnidadDePrecarga("desactivada", unidades)).toEqual({ unidadCompraId: "", vigente: false });
    expect(decidirUnidadDePrecarga("c", { ...unidades, presentaciones: [] })).toEqual({ unidadCompraId: "", vigente: false });
  });
  it("el aviso de unidad no vigente", () => expect(avisoDeUnidadNoVigente("caja")).toBe("La última vez se compró en caja, que ya no está activa: confirmá la unidad."));
});

describe("precios para mostrar", () => {
  it("cantidadEnStock: cantidad × factor, o el peso real si viene", () => {
    expect(cantidadEnStock({ cantidad: 2, factor: 12, pesoReal: undefined })).toBe(24);
    expect(cantidadEnStock({ cantidad: 2, factor: 12, pesoReal: 23.5 })).toBe(23.5);
    expect(cantidadEnStock({ cantidad: 2, factor: 12, pesoReal: 0 })).toBe(24);
    expect(cantidadEnStock({ cantidad: undefined, factor: 12, pesoReal: undefined })).toBeNull();
    expect(cantidadEnStock({ cantidad: 0, factor: 12, pesoReal: undefined })).toBeNull();
  });
  it("precioPorUnidad: importe / cantidad; sin dato → null; importe 0 → 0", () => {
    expect(precioPorUnidad(2400, 2)).toBe(1200);
    expect(precioPorUnidad(2400, 24)).toBe(100);
    expect(precioPorUnidad(100, 3)).toBe(33.3333);
    expect(precioPorUnidad(0, 2)).toBe(0);
    expect(precioPorUnidad(undefined, 2)).toBeNull();
    expect(precioPorUnidad(100, 0)).toBeNull();
    expect(precioPorUnidad(100, null)).toBeNull();
    expect(precioPorUnidad(Number.NaN, 2)).toBeNull();
  });
  it("el peso real se muestra siempre (hoy)", () => expect(seMuestraElPesoReal()).toBe(true));
});

describe("revisión", () => {
  it("un aviso por cada línea con importe 0 o vacío, con el nombre; las que tienen importe no avisan; sin cantidad no cuenta", () => {
    const avisos = avisosDeImporteCero([
      { nombre: "Harina", cantidad: "2", importe: "0" },
      { nombre: "Sal", cantidad: "1", importe: "" },
      { nombre: "Azúcar", cantidad: "1", importe: "100" },
      { nombre: "Aceite", cantidad: "", importe: "0" },
    ]);
    expect(avisos).toEqual([avisoDeImporteCero("Harina"), avisoDeImporteCero("Sal")]);
    expect(avisos[0]).toBe('Importe 0: la compra se guarda, pero no actualiza el costo de "Harina".');
  });
  it("mensajeFinalDeCompra suma los avisos al mensaje del servidor", () => {
    expect(mensajeFinalDeCompra("Compra registrada.", [])).toBe("Compra registrada.");
    expect(mensajeFinalDeCompra("Compra registrada.", ["A.", "B."])).toBe("Compra registrada. A. B.");
  });
});
