import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { leerOraculoDeComprobante } from "../setup/oraculo-comprobante-unico";

/**
 * GUARDIÁN de dimensiones nuevas del número de factura único (Compras, etapa 1; regla «Combinaciones» del dueño, AGENTS.md). El oráculo `docs/oraculo-combinaciones-compras-etapa-1-2026-11-03.md` declara las dimensiones
 * que cambian el resultado (N, L, P, O) y las que no; `test/movimientos/combinaciones-comprobante-unico.test.ts` recorre las 32 combinaciones contra la base. Este guardián falla si:
 *  (a) la tabla de enumeración tiene otras columnas que N, L, P, O y Resultado;
 *  (b) la tabla no es exactamente el producto cartesiano de los valores declarados en «Dimensiones que cambian el resultado» (filas repetidas, faltantes o con un valor no declarado, o un resultado distinto de ACEPTA / RECHAZA);
 *  (c) el CÓDIGO que decide la clave del comprobante (`hayComprobanteVigenteEnLaEmpresa`) lee un campo en un `where`, o recibe un argumento, que acá no está mapeado a una dimensión del oráculo o a «no afecta» con motivo
 *      (y a una fila de «Dimensiones que NO cambian el resultado»), o si una entrada declarada ya no existe en el código.
 * Es el único lugar donde se lee la fuente: agregar `letra: null` al `where`, o un argumento `sucursalId`, deja este test en rojo hasta que alguien decida si cambia el resultado (y entonces se amplía el oráculo).
 */
const RAIZ = join(__dirname, "../..");
const ARCHIVO = "src/server/persistencia/compras/comprobante-en-la-empresa.ts";
const FUNCION = "hayComprobanteVigenteEnLaEmpresa";

const oraculo = leerOraculoDeComprobante();
const COLUMNAS_DECLARADAS = ["N", "L", "P", "O", "Resultado"];
const RESULTADOS = ["ACEPTA", "RECHAZA"];

type Dimension = "N" | "L" | "P" | "O";
interface Declaracion {
  /** Dimensiones del oráculo a las que responde (si cambia el resultado). Vacío = no afecta. */
  dimensiones: readonly Dimension[];
  /** Si no afecta (o no es una dimensión de negocio): un fragmento del texto de la fila de «Dimensiones que NO cambian el resultado» que lo justifica; `INFRA` = plomería sin semántica de negocio. */
  noAfecta?: string;
  motivo: string;
}

/** Cada entrada que el código lee o recibe → a qué dimensión del oráculo responde, o por qué no afecta. */
const DECLARADAS: Readonly<Record<string, Declaracion>> = {
  "param:tx": { dimensiones: [], noAfecta: "INFRA", motivo: "la transacción abierta con la base de verificación de la empresa (lee todas las sucursales); no es una decisión de negocio" },
  "param:args": { dimensiones: [], noAfecta: "INFRA", motivo: "el contenedor de los argumentos, que se inventarían uno por uno (`arg:*`)" },
  "arg:empresaId": { dimensiones: [], noAfecta: "Otra empresa", motivo: "el cerrojo es por empresa y el RLS aísla las lecturas: otra empresa no se ve" },
  "arg:proveedorId": { dimensiones: [], noAfecta: "Otro proveedor", motivo: "la clave es por proveedor: otro proveedor con el mismo número no choca" },
  "arg:nroFactura": { dimensiones: ["N", "L"], motivo: "el número es la clave; normalizado, incluye la letra («A:1-1234» contra «1-1234»), de ahí L" },
  "arg:excluirFacturaId": { dimensiones: ["O"], motivo: "la corrección excluye a la propia factura (su cabecera y la compra de sus partes); la compra nueva no excluye nada" },
  "where:facturaProveedor.proveedorId": { dimensiones: [], noAfecta: "Otro proveedor", motivo: "misma clave por proveedor, en la cabecera de la factura repartida" },
  "where:facturaProveedor.nroFacturaNormalizado": { dimensiones: ["N", "L"], motivo: "la clave normalizada (con la letra como prefijo) de la cabecera: N = REPETIDO_FACTURA_REPARTIDA, L" },
  "where:facturaProveedor.id": { dimensiones: ["O"], motivo: "excluye a la factura que se corrige (`excluirFacturaId`)" },
  "where:facturaProveedor.anuladaEn": { dimensiones: [], noAfecta: "ANULADO", motivo: "solo cuentan las cabeceras vigentes" },
  "where:operacion.proceso": { dimensiones: ["N"], motivo: "solo las compras simples cuentan como comprobante (N = REPETIDO_MISMA_SUCURSAL / REPETIDO_OTRA_SUCURSAL)" },
  "where:operacion.proveedorId": { dimensiones: [], noAfecta: "Otro proveedor", motivo: "misma clave por proveedor, en la compra simple" },
  "where:operacion.anuladaEn": { dimensiones: [], noAfecta: "ANULADO", motivo: "solo cuentan las compras vigentes" },
  "where:operacion.nroFactura": { dimensiones: ["N", "L"], motivo: "la preselección por el último grupo de dígitos; la comparación exacta normaliza (con la letra) en el código" },
  "where:operacion.NOT": { dimensiones: ["O"], motivo: "excluye la compra de las partes de la factura que se corrige (`excluirFacturaId`)" },
};

/** Las propiedades de primer nivel de un objeto `where`, entrando por los `...(cond ? { … } : {})`. */
function clavesDeWhere(nodo: ts.Node): string[] {
  const claves: string[] = [];
  const recorrer = (n: ts.Node) => {
    if (ts.isParenthesizedExpression(n)) return recorrer(n.expression);
    if (ts.isConditionalExpression(n)) {
      recorrer(n.whenTrue);
      recorrer(n.whenFalse);
      return;
    }
    if (!ts.isObjectLiteralExpression(n)) return;
    for (const p of n.properties) {
      if (ts.isSpreadAssignment(p)) recorrer(p.expression);
      else if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name) claves.push(p.name.getText());
      else claves.push(`(${ts.SyntaxKind[p.kind]})`);
    }
  };
  recorrer(nodo);
  return claves;
}

/** Lo que `hayComprobanteVigenteEnLaEmpresa` recibe y lee, leído de la fuente real. */
function inventarioDelCodigo(fuente: string): string[] {
  const sf = ts.createSourceFile(ARCHIVO, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const funcion = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === FUNCION);
  if (!funcion) throw new Error(`No se encontró la función ${FUNCION} en ${ARCHIVO}.`);
  const entradas: string[] = [];
  for (const p of funcion.parameters) {
    entradas.push(`param:${p.name.getText()}`);
    if (p.type && ts.isTypeLiteralNode(p.type)) for (const m of p.type.members) if (m.name) entradas.push(`arg:${m.name.getText()}`);
  }
  const visitar = (n: ts.Node) => {
    // `tx.<modelo>.<método>({ where: … })`
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isPropertyAccessExpression(n.expression.expression)) {
      const modelo = n.expression.expression.name.text;
      const arg = n.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText() === "where") for (const clave of clavesDeWhere(prop.initializer)) entradas.push(`where:${modelo}.${clave}`);
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  if (funcion.body) visitar(funcion.body);
  return [...new Set(entradas)].sort();
}

const producto = (listas: string[][]): string[][] => listas.reduce<string[][]>((acc, valores) => acc.flatMap((fila) => valores.map((v) => [...fila, v])), [[]]);

describe("combinaciones del número de factura único: dimensiones declaradas (guardián)", () => {
  it("(a) la enumeración tiene exactamente las columnas N, L, P, O y Resultado", () => {
    expect(oraculo.columnas, "una columna nueva es una dimensión nueva: declarala en «Dimensiones que cambian el resultado» y ampliá el test").toEqual(COLUMNAS_DECLARADAS);
    expect(Object.keys(oraculo.dimensiones), "las dimensiones declaradas y las columnas de la enumeración tienen que ser las mismas").toEqual(COLUMNAS_DECLARADAS.slice(0, 4));
  });

  it("(b) la enumeración es el producto cartesiano de los valores declarados: sin filas repetidas, faltantes ni con valores no declarados", () => {
    const dims = COLUMNAS_DECLARADAS.slice(0, 4);
    for (const d of dims) expect(oraculo.dimensiones[d]?.length, `la dimensión ${d} no declara valores`).toBeGreaterThan(0);
    const esperadas = producto(dims.map((d) => oraculo.dimensiones[d]!)).map((f) => f.join("|"));
    const reales = oraculo.filas.map((f) => dims.map((d) => f[d]).join("|"));
    expect(reales.length, `la tabla debería tener ${esperadas.length} filas`).toBe(esperadas.length);
    // Tamaño del producto con el número literal (convención I3 del arnés de matrices): agregar un valor a una dimensión exige actualizar este número a propósito.
    const TAMANO_LITERAL = 4 * 2 * 2 * 2; // N × L × P × O = 32
    const msgTamano = "agregar un valor a una dimensión (N, L, P, O) cambia el tamaño del producto: actualizá este número a propósito (4 * 2 * 2 * 2 = 32)";
    expect(dims.map((d) => oraculo.dimensiones[d]!.length).reduce((a, b) => a * b, 1), msgTamano).toBe(TAMANO_LITERAL);
    expect(oraculo.filas.length, msgTamano).toBe(TAMANO_LITERAL);
    expect(new Set(reales).size, "hay filas repetidas").toBe(reales.length);
    expect([...reales].sort(), "faltan combinaciones o hay valores no declarados").toEqual([...esperadas].sort());
    for (const f of oraculo.filas) expect(RESULTADOS, `resultado inválido en ${dims.map((d) => f[d]).join("/")}`).toContain(f.Resultado);
  });

  it("(c) todo lo que el código lee o recibe para decidir la clave está declarado, y cada declaración sigue existiendo", () => {
    const fuente = readFileSync(join(RAIZ, ARCHIVO), "utf8");
    const reales = inventarioDelCodigo(fuente);
    const declaradas = Object.keys(DECLARADAS).sort();
    const sinDeclarar = reales.filter((r) => !(r in DECLARADAS));
    const sobrantes = declaradas.filter((d) => !reales.includes(d));
    expect(sinDeclarar, `${FUNCION} lee o recibe algo que no está declarado: decidí si cambia el resultado, agregalo a DECLARADAS y, si cambia, ampliá el oráculo (dimensión nueva)`).toEqual([]);
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
