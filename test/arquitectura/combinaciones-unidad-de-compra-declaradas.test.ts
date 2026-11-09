import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { leerOraculoDeUnidadDeCompra } from "../setup/oraculo-unidad-de-compra";

/**
 * GUARDIÁN de dimensiones nuevas de la unidad de compra (Compras, etapa 2a; regla «Combinaciones» del dueño, AGENTS.md). El oráculo `docs/oraculo-combinaciones-compras-etapa-2a-2026-11-04.md` declara las dimensiones
 * que cambian el resultado (U, M, R, F, T) y las que no; `test/movimientos/combinaciones-unidad-de-compra.test.ts` recorre las 32 combinaciones contra la base. Este guardián falla si:
 *  (a) la tabla de enumeración tiene otras columnas que U, M, R, F, T y Resultado;
 *  (b) la tabla no es el producto cartesiano de los valores declarados (filas repetidas, faltantes o con un valor no declarado), o un resultado no es ACEPTA / RECHAZA / IMPOSIBLE;
 *  (c) el CÓDIGO que decide la regla — los parámetros de `guardPesoRealPorMagnitud`, los campos de la línea tecleada (`DatosLineaCompra`) y los del renglón que se escribe (`RenglonAEscribir`) — tiene una entrada que acá no está
 *      mapeada a una dimensión del oráculo o a «no afecta» con motivo (y a una fila de «Dimensiones que NO cambian el resultado»), o si una entrada declarada ya no existe en el código.
 * Agregar un campo a la línea de compra o al renglón (un descuento, otra cantidad, una letra), o un parámetro a la regla, deja este test en rojo hasta que alguien decida si cambia el resultado (y entonces se amplía el oráculo).
 */
const RAIZ = join(__dirname, "../..");
const oraculo = leerOraculoDeUnidadDeCompra();
const COLUMNAS_DECLARADAS = ["U", "M", "R", "F", "T", "Resultado"];
const RESULTADOS = ["ACEPTA", "RECHAZA", "IMPOSIBLE"];

type Dimension = "U" | "M" | "R" | "F" | "T";
interface Declaracion {
  /** Dimensiones del oráculo a las que responde (si cambia el resultado). Vacío = no afecta. */
  dimensiones: readonly Dimension[];
  /** Si no afecta: un fragmento del texto de la fila de «Dimensiones que NO cambian el resultado» que lo justifica; `INFRA` = plomería sin semántica de negocio. */
  noAfecta?: string;
  motivo: string;
}

const DECLARADAS: Readonly<Record<string, Declaracion>> = {
  "regla:productoNombre": { dimensiones: [], noAfecta: "INFRA", motivo: "solo arma el texto del mensaje de rechazo" },
  "regla:pesoReal": { dimensiones: ["R"], motivo: "con o sin cantidad real: sin ella no hay nada que rechazar" },
  "regla:magnitudDeCompra": { dimensiones: ["M", "U"], motivo: "el tipo de la unidad de compra; igual que el de stock cuando la unidad es la misma (U = IGUAL_A_STOCK)" },
  "regla:magnitudDeStock": { dimensiones: ["M", "U"], motivo: "el tipo de la unidad de stock del producto" },
  "linea:cantidad": { dimensiones: [], noAfecta: "Con o sin precio", motivo: "lo comprado: se guarda tal cual (cantidadCompra) y no decide el rechazo" },
  "linea:precioTotal": { dimensiones: [], noAfecta: "Con o sin precio", motivo: "el importe no interviene en la unidad ni en lo comprado" },
  "linea:pesoReal": { dimensiones: ["R"], motivo: "la cantidad real que se teclea" },
  "renglon:productoId": { dimensiones: [], noAfecta: "Otro proveedor", motivo: "el producto no cambia la regla: lo que decide es el tipo de sus unidades (M)" },
  "renglon:cantidadStock": { dimensiones: [], noAfecta: "Con o sin precio", motivo: "la cantidad que entra al stock no se toca en esta etapa" },
  "renglon:precioPorUnidadStock": { dimensiones: [], noAfecta: "Con o sin precio", motivo: "el precio por unidad de stock no se toca en esta etapa" },
  "renglon:loteVencimiento": { dimensiones: [], noAfecta: "Con o sin precio", motivo: "el lote no interviene en la unidad de compra" },
  "renglon:detalle": { dimensiones: [], noAfecta: "INFRA", motivo: "el texto de conversión que se copia a cada movimiento" },
  "renglon:precioTotal": { dimensiones: [], noAfecta: "Con o sin precio", motivo: "el importe no interviene en la unidad ni en lo comprado" },
  "renglon:unidadCompraId": { dimensiones: ["F", "U"], motivo: "se guarda en el renglón solo en una factura repartida (F); es la unidad de compra (U)" },
  "renglon:cantidadCompra": { dimensiones: ["F"], motivo: "se guarda en el renglón solo en una factura repartida (F)" },
};

function parseo(archivo: string): ts.SourceFile {
  return ts.createSourceFile(archivo, readFileSync(join(RAIZ, archivo), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function camposDeInterfaz(archivo: string, nombre: string): string[] {
  const interfaz = parseo(archivo).statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === nombre);
  if (!interfaz) throw new Error(`No se encontró la interfaz ${nombre} en ${archivo}.`);
  return interfaz.members.map((m) => m.name?.getText() ?? `(${ts.SyntaxKind[m.kind]})`);
}

function parametrosDeFuncion(archivo: string, nombre: string): string[] {
  const f = parseo(archivo).statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === nombre);
  if (!f) throw new Error(`No se encontró la función ${nombre} en ${archivo}.`);
  return f.parameters.map((p) => p.name.getText());
}

function inventarioDelCodigo(): string[] {
  return [
    ...parametrosDeFuncion("src/core/features/compras/compra.guard.ts", "guardPesoRealPorMagnitud").map((p) => `regla:${p}`),
    ...camposDeInterfaz("src/core/features/compras/compra.schema.ts", "DatosLineaCompra").map((c) => `linea:${c}`),
    ...camposDeInterfaz("src/server/persistencia/compras/escribir-factura-proveedor.ts", "RenglonAEscribir").map((c) => `renglon:${c}`),
  ].sort();
}

const producto = (listas: string[][]): string[][] => listas.reduce<string[][]>((acc, valores) => acc.flatMap((fila) => valores.map((v) => [...fila, v])), [[]]);

describe("combinaciones de la unidad de compra: dimensiones declaradas (guardián)", () => {
  it("(a) la enumeración tiene exactamente las columnas U, M, R, F, T y Resultado", () => {
    expect(oraculo.columnas, "una columna nueva es una dimensión nueva: declarala en «Dimensiones que cambian el resultado» y ampliá el test").toEqual(COLUMNAS_DECLARADAS);
    expect(Object.keys(oraculo.dimensiones), "las dimensiones declaradas y las columnas de la enumeración tienen que ser las mismas").toEqual(COLUMNAS_DECLARADAS.slice(0, 5));
  });

  it("(b) la enumeración es el producto cartesiano de los valores declarados: sin filas repetidas, faltantes ni con valores no declarados", () => {
    const dims = COLUMNAS_DECLARADAS.slice(0, 5);
    for (const d of dims) expect(oraculo.dimensiones[d]?.length, `la dimensión ${d} no declara valores`).toBeGreaterThan(0);
    const esperadas = producto(dims.map((d) => oraculo.dimensiones[d]!)).map((f) => f.join("|"));
    const reales = oraculo.filas.map((f) => dims.map((d) => f[d]).join("|"));
    expect(reales.length, `la tabla debería tener ${esperadas.length} filas`).toBe(esperadas.length);
    // Tamaño del producto con el número literal (convención I3 del arnés de matrices): agregar un valor a una dimensión exige actualizar este número a propósito.
    const TAMANO_LITERAL = 2 * 2 * 2 * 2 * 2; // U × M × R × F × T = 32
    const msgTamano = "agregar un valor a una dimensión (U, M, R, F, T) cambia el tamaño del producto: actualizá este número a propósito (2 * 2 * 2 * 2 * 2 = 32)";
    expect(dims.map((d) => oraculo.dimensiones[d]!.length).reduce((a, b) => a * b, 1), msgTamano).toBe(TAMANO_LITERAL);
    expect(oraculo.filas.length, msgTamano).toBe(TAMANO_LITERAL);
    expect(new Set(reales).size, "hay filas repetidas").toBe(reales.length);
    expect([...reales].sort(), "faltan combinaciones o hay valores no declarados").toEqual([...esperadas].sort());
    for (const f of oraculo.filas) expect(RESULTADOS, `resultado inválido en ${dims.map((d) => f[d]).join("/")}`).toContain(f.Resultado);
  });

  it("(c) todo lo que el código lee o recibe para decidir la regla está declarado, y cada declaración sigue existiendo", () => {
    const reales = inventarioDelCodigo();
    const declaradas = Object.keys(DECLARADAS).sort();
    const sinDeclarar = reales.filter((r) => !(r in DECLARADAS));
    const sobrantes = declaradas.filter((d) => !reales.includes(d));
    expect(sinDeclarar, "la regla o la línea de compra tiene algo que no está declarado: decidí si cambia el resultado, agregalo a DECLARADAS y, si cambia, ampliá el oráculo (dimensión nueva)").toEqual([]);
    expect(sobrantes, "hay declaraciones que el código ya no tiene: sacalas").toEqual([]);
  });

  it("(c) cada declaración apunta a una dimensión que existe en el oráculo o a una fila real de «no cambian el resultado»", () => {
    for (const [clave, d] of Object.entries(DECLARADAS)) {
      expect(d.motivo.length, `${clave}: falta el motivo`).toBeGreaterThan(10);
      for (const dim of d.dimensiones) expect(Object.keys(oraculo.dimensiones), `${clave}: dimensión ${dim} inexistente en el oráculo`).toContain(dim);
      if (d.dimensiones.length === 0) {
        expect(d.noAfecta, `${clave}: no afecta ninguna dimensión, tiene que decir cuál fila de «no cambian el resultado» lo justifica (o INFRA)`).toBeTruthy();
        if (d.noAfecta !== "INFRA") expect(oraculo.noAfectan.some((f) => f.toLowerCase().includes(d.noAfecta!.toLowerCase())), `${clave}: «${d.noAfecta}» no está en el oráculo`).toBe(true);
      }
    }
  });
});
