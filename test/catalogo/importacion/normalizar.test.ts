import { describe, expect, it } from "vitest";
import { leerXlsx } from "../../../scripts/importacion/leer-xlsx";
import { leerCorrecciones } from "../../../src/core/features/catalogo/importacion/correcciones";
import { descripcionDeCarta, HOJA_CATALOGO, HOJA_PRECIOS, nombreDelExcel, normalizarCatalogo } from "../../../src/core/features/catalogo/importacion/normalizar";
import type { CorreccionNominal, LibroDeEntrada } from "../../../src/core/features/catalogo/importacion/tipos";
import { correccionesDe, hojasDesde, libroDeHojas, libroDesde, MAPEO_DE_LA_ADENDA, xlsxDesde, type ProductoDeFixtura } from "./fixtura-de-catalogo";

/**
 * E1.2 del importador del catálogo: el normalizador y validador (I8, I11, I12) y las correcciones del dueño (A.1). Cada regla de I8 tiene su caso; todos sobre el núcleo puro.
 */
const PIZZA: ProductoDeFixtura = { sku: "PIZZA-MUZZARELLA", categoria: "Pizzas", base: "Pizza", variantes: ["Muzzarella"], precios: { Huinganco: 22000, "Los Miches": 22000 }, descripcion: { Huinganco: "Con orégano" } };
const CAFE: ProductoDeFixtura = { sku: "CAFE-CHICO", categoria: "Confitería", base: "Café", variantes: ["Chico"], precios: { Varvarco: 4000 } };
const BASICO = [PIZZA, CAFE];

const codigos = (r: { errores: readonly { codigo: string }[] }) => r.errores.map((e) => e.codigo);
const normalizar = (libro: LibroDeEntrada, correcciones: CorreccionNominal[] = []) => normalizarCatalogo(libro, correccionesDe({ correcciones }));

/** Modifica una celda (hoja, fila de Excel, índice de columna) de las hojas de la fixtura. */
function conCelda(productos: ProductoDeFixtura[], hoja: string, fila: number, columna: number, valor: string | number | null) {
  const hojas = hojasDesde(productos);
  hojas[hoja][fila - 1][columna] = valor;
  return libroDeHojas(hojas);
}

describe("normalizarCatalogo (E1.2): lo válido", () => {
  it("un producto por SKU (en el orden de «Catálogo») y una fila por (SKU, local), con el precio en centavos desde el texto", () => {
    const r = normalizar(libroDesde(BASICO));
    expect(r.errores).toEqual([]);
    expect(r.productos.map((p) => [p.fila, p.sku, p.nombre, p.categoria])).toEqual([
      [2, "PIZZA-MUZZARELLA", "Pizza Muzzarella", "Pizzas"],
      [3, "CAFE-CHICO", "Café Chico", "Confitería"],
    ]);
    expect(r.filas.map((f) => [f.sku, f.local, f.precioCentavos, f.disponible, f.descripcion.estado])).toEqual([
      ["PIZZA-MUZZARELLA", "Huinganco", BigInt(2200000), true, "VALIDA"],
      ["PIZZA-MUZZARELLA", "Los Miches", BigInt(2200000), true, "AUSENTE"],
      ["CAFE-CHICO", "Varvarco", BigInt(400000), true, "AUSENTE"],
    ]);
  });

  it("el mismo catálogo leído de un .xlsx real (write-excel-file → leerXlsx) da lo mismo que el libro armado a mano", async () => {
    const desdeXlsx = normalizar(leerXlsx(await xlsxDesde(BASICO)));
    const aMano = normalizar(libroDesde(BASICO));
    expect(desdeXlsx.errores).toEqual([]);
    expect(desdeXlsx.productos).toEqual(aMano.productos);
    expect(desdeXlsx.filas).toEqual(aMano.filas);
  });

  it("el nombre: base y variantes no vacías, sin repetir la base", () => {
    expect(nombreDelExcel("Bife", ["Chorizo", "Con papas"])).toBe("Bife Chorizo Con papas");
    expect(nombreDelExcel("Trucha", ["Trucha"])).toBe("Trucha");
    expect(nombreDelExcel("Agua", [])).toBe("Agua");
  });

  it("descripción: el MISMO validador de la carta (hasta 500), ausente si está vacía, y NUL o un emoji partido la invalidan (no se borran en silencio)", () => {
    expect(descripcionDeCarta(null)).toEqual({ estado: "AUSENTE" });
    expect(descripcionDeCarta("   ")).toEqual({ estado: "AUSENTE" });
    expect(descripcionDeCarta("  Con papas  ")).toEqual({ estado: "VALIDA", valor: "Con papas" });
    expect(descripcionDeCarta("x".repeat(500)).estado).toBe("VALIDA");
    expect(descripcionDeCarta("x".repeat(501))).toMatchObject({ estado: "INVALIDA", mensaje: "La descripción no puede superar los 500 caracteres." });
    expect(descripcionDeCarta("con\u0000nul").estado).toBe("INVALIDA");
    expect(descripcionDeCarta("partido \uD83D").estado).toBe("INVALIDA");
    expect(descripcionDeCarta("emoji entero 🍕").estado).toBe("VALIDA");
  });
});

describe("normalizarCatalogo (E1.2): cada regla de I8 es un error con hoja, fila, columna y valor", () => {
  it("encabezado distinto, columna no declarada, hoja no declarada y hoja faltante", () => {
    expect(codigos(normalizar(conCelda(BASICO, HOJA_CATALOGO, 1, 2, "Producto")))).toEqual(["ENCABEZADO_DISTINTO"]);
    const conColumnaDeMas = hojasDesde(BASICO);
    conColumnaDeMas[HOJA_PRECIOS][2][7] = "un dato";
    expect(normalizar(libroDeHojas(conColumnaDeMas)).errores).toEqual([
      { hoja: HOJA_PRECIOS, fila: 3, columna: "H", valor: "un dato", sku: null, codigo: "COLUMNA_NO_DECLARADA", motivo: "la columna no es una de las declaradas" },
    ]);
    const conHojaDeMas = { ...hojasDesde(BASICO), Notas: [["algo"]] };
    expect(codigos(normalizar(libroDeHojas(conHojaDeMas)))).toEqual(["HOJA_NO_DECLARADA"]);
    const sinPrecios = hojasDesde(BASICO);
    delete sinPrecios[HOJA_PRECIOS];
    expect(codigos(normalizar(libroDeHojas(sinPrecios)))).toContain("FALTA_LA_HOJA");
  });

  it("SKU vacío, con minúsculas o espacios, de más de 80 caracteres, repetido, y uno de «Precios por local» que no está en «Catálogo»", () => {
    expect(codigos(normalizar(conCelda(BASICO, HOJA_CATALOGO, 3, 0, null)))).toContain("SKU_VACIO");
    expect(codigos(normalizar(conCelda(BASICO, HOJA_CATALOGO, 3, 0, "cafe chico")))).toContain("SKU_INVALIDO");
    expect(codigos(normalizar(libroDesde([{ ...CAFE, sku: `A${"-B".repeat(40)}` }])))).toContain("SKU_INVALIDO");
    expect(codigos(normalizar(libroDesde([PIZZA, { ...CAFE, sku: PIZZA.sku }])))).toContain("SKU_REPETIDO");
    expect(codigos(normalizar(conCelda(BASICO, HOJA_PRECIOS, 4, 0, "OTRO-SKU")))).toContain("SKU_DESCONOCIDO");
  });

  it("(SKU, local) repetido y un local que no es uno de los 5", () => {
    const repetida = hojasDesde(BASICO);
    repetida[HOJA_PRECIOS].push([...repetida[HOJA_PRECIOS][1]]);
    expect(codigos(normalizar(libroDeHojas(repetida)))).toEqual(["FILA_REPETIDA"]);
    expect(codigos(normalizar(conCelda(BASICO, HOJA_PRECIOS, 4, 2, "Oficinas NQNTUR")))).toEqual(expect.arrayContaining(["LOCAL_DESCONOCIDO"]));
  });

  it("precio no entero, cero, negativo, de texto o sobre el tope de la columna", () => {
    for (const malo of [22000.5, 0, -5, "22000", 1e13]) {
      const r = normalizar(conCelda(BASICO, HOJA_PRECIOS, 2, 3, malo));
      expect(codigos(r), String(malo)).toContain("PRECIO_INVALIDO");
      expect(r.errores.find((e) => e.codigo === "PRECIO_INVALIDO")).toMatchObject({ hoja: HOJA_PRECIOS, fila: 2, columna: "D" });
    }
  });

  it("«Disponible» que no es TRUE ni FALSE, y disponible TRUE sin precio (I7); FALSE sin precio es válido (Ventus)", () => {
    expect(codigos(normalizar(conCelda(BASICO, HOJA_PRECIOS, 2, 4, "SI")))).toEqual(["DISPONIBLE_INVALIDO"]);
    const sinPrecio = normalizar(libroDesde([{ ...CAFE, precios: { Varvarco: null } }]));
    expect(codigos(sinPrecio)).toEqual(["DISPONIBLE_SIN_PRECIO"]);
    const ventus = normalizar(libroDesde([{ ...CAFE, precios: { Varvarco: null }, disponible: { Varvarco: false } }]));
    expect(ventus.errores).toEqual([]);
    expect(ventus.filas[0]).toMatchObject({ precioCentavos: null, disponible: false });
  });

  it("«Catálogo» y «Precios por local» dicen otra cosa (precio de un local, o un precio sin su fila)", () => {
    const r = normalizar(conCelda(BASICO, HOJA_CATALOGO, 2, 8, 25000));
    expect(r.errores).toEqual([expect.objectContaining({ hoja: HOJA_CATALOGO, fila: 2, columna: "I", valor: "25000", codigo: "DISTINTO_DE_PRECIOS_POR_LOCAL" })]);
    expect(codigos(normalizar(conCelda(BASICO, HOJA_CATALOGO, 3, 7, 4000)))).toEqual(["DISTINTO_DE_PRECIOS_POR_LOCAL"]);
    expect(codigos(normalizar(conCelda(BASICO, HOJA_PRECIOS, 4, 1, "Té")))).toEqual(["DISTINTO_DEL_CATALOGO"]);
  });

  it("nombre vacío (falta la base), con caracteres que el catálogo no admite, o repetido sin distinguir mayúsculas", () => {
    expect(codigos(normalizar(conCelda(BASICO, HOJA_CATALOGO, 2, 2, null)))).toContain("BASE_VACIA");
    expect(codigos(normalizar(libroDesde([{ ...PIZZA, base: 'Papas "Los Miches"' }])))).toEqual(["NOMBRE_INVALIDO"]);
    expect(codigos(normalizar(libroDesde([PIZZA, { ...CAFE, base: "PIZZA", variantes: ["muzzarella"] }])))).toEqual(["NOMBRE_REPETIDO"]);
  });

  it("una celda con fórmula sin valor guardado (problema del lector) es un error con su hoja y celda", () => {
    const libro = { ...libroDesde(BASICO), problemas: [{ hoja: HOJA_PRECIOS, celda: "D3", motivo: "celda con fórmula sin valor guardado" }] };
    expect(normalizar(libro).errores).toEqual([{ hoja: HOJA_PRECIOS, fila: 3, columna: "D", valor: null, sku: null, codigo: "CELDA_ILEGIBLE", motivo: "celda con fórmula sin valor guardado" }]);
  });

  it("una categoría sin entrada en el mapeo es error; una entrada del mapeo que el Excel no usa, aviso", () => {
    const r = normalizarCatalogo(libroDesde(BASICO), correccionesDe({ mapeoDeSecciones: { Pizzas: "Pizzas", Tragos: "Bebidas" } }));
    expect(r.errores).toEqual([expect.objectContaining({ codigo: "CATEGORIA_SIN_MAPEO", valor: "Confitería" })]);
    expect(r.avisos).toEqual([expect.objectContaining({ tipo: "MAPEO_SIN_USAR" })]);
    expect(normalizar(libroDesde(BASICO)).avisos.filter((a) => a.tipo === "MAPEO_SIN_USAR")).toHaveLength(Object.keys(MAPEO_DE_LA_ADENDA).length - 2);
  });
});

describe("correcciones nominales (A.1, I12): se aplican solo si el Excel trae lo registrado", () => {
  const nombre: CorreccionNominal = { tipo: "nombre", sku: "PIZZA-MUZZARELLA", valorEnElExcel: "Pizza Muzzarella", valorACargar: "Pizza de muzzarella", fecha: "2026-10-28", motivo: "x" };
  const precio: CorreccionNominal = { tipo: "precioUnico", sku: "PIZZA-MUZZARELLA", preciosEnElExcel: { Huinganco: 22000, "Los Miches": 22000 }, valorACargar: 21000, fecha: "2026-10-28", motivo: "x" };

  it("nombre: se aplica; si el Excel trae otro nombre, error (no se aplica en silencio)", () => {
    const r = normalizar(libroDesde(BASICO), [nombre]);
    expect(r.errores).toEqual([]);
    expect(r.productos[0]).toMatchObject({ nombre: "Pizza de muzzarella", nombreCorregido: true, nombreEnElExcel: "Pizza Muzzarella" });
    const otro = normalizar(libroDesde([{ ...PIZZA, variantes: ["Fugazzeta"] }, CAFE]), [{ ...nombre, sku: "PIZZA-MUZZARELLA" }]);
    expect(codigos(otro)).toEqual(["CORRECCION_NO_COINCIDE"]);
    expect(otro.productos[0].nombre).toBe("Pizza Fugazzeta");
  });

  it("el nombre corregido también se valida (charset de catálogo)", () => {
    expect(codigos(normalizar(libroDesde(BASICO), [{ ...nombre, valorACargar: 'Pizza "rica"' }]))).toEqual(["NOMBRE_INVALIDO"]);
  });

  it("precio único: se registra en centavos si los precios del Excel coinciden EXACTO (mismos locales y precios); si no, error", () => {
    const r = normalizar(libroDesde(BASICO), [precio]);
    expect(r.errores).toEqual([]);
    expect(r.preciosUnicosCorregidos.get("PIZZA-MUZZARELLA")?.centavos).toBe(BigInt(2100000));
    expect(codigos(normalizar(libroDesde(BASICO), [{ ...precio, preciosEnElExcel: { Huinganco: 22000 } }]))).toEqual(["CORRECCION_NO_COINCIDE"]);
    expect(codigos(normalizar(libroDesde(BASICO), [{ ...precio, preciosEnElExcel: { Huinganco: 22000, "Los Miches": 25000 } }]))).toEqual(["CORRECCION_NO_COINCIDE"]);
  });

  it("una corrección de un SKU que el Excel no trae es aviso", () => {
    const r = normalizar(libroDesde(BASICO), [{ ...precio, sku: "NO-ESTA" }]);
    expect(r.errores).toEqual([]);
    expect(r.avisos).toContainEqual({ tipo: "CORRECCION_SIN_USAR", sku: "NO-ESTA", detalle: "la corrección «precioUnico» es de un SKU que el Excel no trae" });
  });
});

describe("leerCorrecciones: forma cerrada", () => {
  const valido = {
    version: 1,
    reglaDePrecioUnico: { regla: "MAS_FRECUENTE_Y_SI_EMPATAN_EL_MAYOR", fecha: "2026-10-28", motivo: "Decisión del dueño" },
    correcciones: [{ tipo: "precioUnico", sku: "A", preciosEnElExcel: { Huinganco: 3000, "Los Miches": 25000 }, valorACargar: 3000, fecha: "2026-10-28", motivo: "Dejar el 3000" }],
    mapeoDeSecciones: { Pizzas: "Pizzas", Minutas: null },
  };

  it("acepta el archivo válido", () => {
    const r = leerCorrecciones(valido);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.correcciones.reglaDePrecioUnico?.regla).toBe("MAS_FRECUENTE_Y_SI_EMPATAN_EL_MAYOR");
  });

  it.each([
    ["una clave desconocida", { ...valido, extra: 1 }],
    ["versión distinta", { ...valido, version: 2 }],
    ["otra regla", { ...valido, reglaDePrecioUnico: { ...valido.reglaDePrecioUnico, regla: "EL_MENOR" } }],
    ["precio con decimales", { ...valido, correcciones: [{ ...valido.correcciones[0], valorACargar: 3000.5 }] }],
    ["precio como texto", { ...valido, correcciones: [{ ...valido.correcciones[0], valorACargar: "3000" }] }],
    ["local que no es de los 5", { ...valido, correcciones: [{ ...valido.correcciones[0], preciosEnElExcel: { Neuquén: 3000 } }] }],
    ["sin fecha", { ...valido, correcciones: [{ ...valido.correcciones[0], fecha: "28/10/2026" }] }],
    ["sin motivo", { ...valido, correcciones: [{ ...valido.correcciones[0], motivo: " " }] }],
    ["corrección repetida", { ...valido, correcciones: [valido.correcciones[0], valido.correcciones[0]] }],
    ["tipo desconocido", { ...valido, correcciones: [{ ...valido.correcciones[0], tipo: "descripcion" }] }],
    ["sin mapeo", { ...valido, mapeoDeSecciones: undefined }],
    ["sección vacía en el mapeo", { ...valido, mapeoDeSecciones: { Pizzas: "" } }],
  ])("rechaza %s", (_, json) => {
    const r = leerCorrecciones(JSON.parse(JSON.stringify(json)));
    expect(r.ok).toBe(false);
  });

  it("sin la regla, la regla queda sin aceptar (null)", () => {
    const r = leerCorrecciones({ ...valido, reglaDePrecioUnico: undefined });
    expect(r.ok && r.correcciones.reglaDePrecioUnico).toBeNull();
  });
});
