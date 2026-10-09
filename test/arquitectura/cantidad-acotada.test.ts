import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Cantidad acotada (S-28, T11 del endurecimiento; guard GT-15): «cantidad» es parte del recurso. Una lectura que trae TODAS las filas de las tablas que más crecen
 * (`MovimientoStock`, `Operacion`, `ConteoFisico`, `Cuenta`, `CuentaItem`) se vuelve más lenta con cada año de la empresa y, con un rango sin tope, la base compartida de todas
 * las empresas paga el recorrido. Regla: todo `findMany` sobre esas cinco tablas en `src/server/consultas` y `src/server/lecturas` lleva `take`, SALVO los de
 * `SIN_TOPE`, que son los que HOY no lo llevan, cada uno con la razón por la que está acotado de otro modo o con el pendiente declarado. La lista SOLO se achica: un `findMany`
 * nuevo sin `take` falla hasta que alguien lo acote o lo anote acá con su motivo; una entrada que ya lleva `take` (o ya no existe) también falla, pidiendo sacarla.
 *
 * Los `groupBy` quedan fuera: devuelven una fila por clave (producto, sección, proceso…), no por movimiento.
 *
 * Por AST (un comentario o un string no cuenta). La clave es `archivo|modelo.findMany|función que lo contiene`.
 *
 * Mutaciones (cada una pone un caso en rojo): sacar el `take` de rotación de mesas; un `findMany` nuevo sin `take` sobre un modelo de la lista; una entrada de más en la lista.
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src/server/consultas", "src/server/lecturas"];
const MODELOS = new Set(["movimientoStock", "operacion", "conteoFisico", "cuenta", "cuentaItem"]);

const POR_RANGO = "acotado por el rango de fechas del reporte (resolverRangoDeReporte: 366 días como mucho, S-28)";
const POR_DIAS = "acotado por «días atrás» (diasAtrasDeUrl: 366 como mucho, S-28)";
const PENDIENTE = "PENDIENTE declarado (S-28): sin tope ni rango, crece con la historia de la sucursal. ";

/**
 * Los `findMany` de esas tablas que hoy no llevan `take`, con por qué siguen así. Solo se achica. Clave: `archivo|modelo.findMany|función`, con `#2`, `#3`… si la misma función tiene
 * varios del mismo modelo. Los PENDIENTE son los que de verdad crecen sin límite: su arreglo seguro no es un `take` (cortaría el cálculo sin avisar) sino acotar la lectura por clave
 * o por ventana, y queda para la rama «endurecimiento 2» (S-51).
 */
const SIN_TOPE: Record<string, string> = {
  "src/server/consultas/reportes/consignacion.ts|movimientoStock.findMany|generarReporteConsignacion":
    PENDIENTE + "El período es opcional (por defecto «desde siempre», saldo acumulado): toda LIQUIDACION_CONSIGNACION de la sucursal. Arreglo: sumar en la base (groupBy por proveedor).",
  "src/server/consultas/reportes/costo-historico.ts|movimientoStock.findMany|reconstruirCostosDeVenta":
    "Solo las compras DENTRO del rango pedido (primerDia..ultimoDia, el mismo del reporte que lo llama); lo anterior lo cubre la «semilla» DISTINCT ON de abajo. " + POR_RANGO,
  "src/server/consultas/reportes/descuentos-clientes.ts|movimientoStock.findMany|obtenerReporteDescuentosClientes": "Ventas con cliente de la sucursal en [desde, hasta]: " + POR_RANGO,
  "src/server/consultas/reportes/descuentos-productos.ts|cuentaItem.findMany|obtenerReporteDescuentosProductos": "Ítems de las operaciones de la sucursal en [desde, hasta]: " + POR_RANGO,
  "src/server/consultas/reportes/descuentos-productos.ts|movimientoStock.findMany|obtenerReporteDescuentosProductos":
    "Solo las ventas de las operaciones (`operacionId in`) que arrojó la consulta anterior, que está acotada por rango: " + POR_RANGO,
  "src/server/consultas/reportes/devoluciones.ts|movimientoStock.findMany|generarReporteDevoluciones": "Devoluciones desde hace N días: " + POR_DIAS,
  "src/server/consultas/reportes/diferencias-ajustes.ts|movimientoStock.findMany|generarReporteDiferenciasAjustes":
    PENDIENTE + "Todo AJUSTE y CONTROL de la sucursal desde siempre (el reporte pide el último de cada producto). Arreglo: groupBy por producto con _max de la fecha y _sum.",
  "src/server/consultas/reportes/historial-producto.ts|conteoFisico.findMany|obtenerHistorialProducto":
    "Los conteos de UN producto (y sección) de la sucursal; el rango «todo» del historial es a propósito el de un solo producto, no el de la sucursal. Acotado por producto.",
  "src/server/consultas/reportes/huecos-catalogo.ts|movimientoStock.findMany|generarReporteHuecosCatalogo":
    PENDIENTE + "Un findMany con `distinct` por producto sobre todas las VENTAS de la sucursal. Arreglo (una línea): groupBy por producto, que agrupa la base; cambia el conteo de consultas que fija reportes-c0.golden.txt (findMany×1 → groupBy×1), una regeneración declarada que esta tanda no tenía prevista.",
  "src/server/consultas/reportes/margen-promociones.ts|cuentaItem.findMany|obtenerReporteMargenPromociones": "Solo los ítems de las operaciones (`operacionId in`) de las promos del rango: " + POR_RANGO,
  "src/server/consultas/reportes/margen-promociones.ts|movimientoStock.findMany|obtenerReporteMargenPromociones": "Ventas con promo de la sucursal en [desde, hasta]: " + POR_RANGO,
  "src/server/consultas/reportes/perdidas.ts|movimientoStock.findMany|generarReportePerdidas": "Mermas y consumos desde hace N días: " + POR_DIAS,
  "src/server/consultas/reportes/periodo.ts|movimientoStock.findMany|cargarLineasDelPeriodoDeSucursales": "Las líneas de [desde, hasta] de las sucursales pedidas: " + POR_RANGO,
  "src/server/consultas/reportes/rendimiento-recetas.ts|conteoFisico.findMany|cargarCandidatosAnclaDePools": "Conteos RESUELTOS de los productos de los pools en [desde, hasta]: " + POR_RANGO,
  "src/server/consultas/reportes/rendimiento-recetas.ts|movimientoStock.findMany|cargarCandidatosAnclaDePools": "Movimientos entre el primer y el último corte, que son días del rango: " + POR_RANGO,
  "src/server/consultas/reportes/rendimiento-recetas.ts|movimientoStock.findMany|cargarEntradasDeLaVentana": "Compras y producciones de la ventana [desde, hasta]: " + POR_RANGO,
  "src/server/consultas/reportes/rendimiento-recetas.ts|movimientoStock.findMany|cargarTramos": "Consumos, controles y ajustes dentro de los tramos entre anclas, que están dentro del rango: " + POR_RANGO,
  "src/server/consultas/reportes/rendimiento-recetas.ts|movimientoStock.findMany|cargarTramos#2": "Ventas dentro de los tramos entre anclas, que están dentro del rango: " + POR_RANGO,
  "src/server/consultas/reportes/rendimiento-recetas.ts|movimientoStock.findMany|cargarVentasDeLaVentana": "Ventas de la ventana [desde, hasta]: " + POR_RANGO,
  "src/server/consultas/reportes/vencimientos.ts|conteoFisico.findMany|generarConciliacionVencimientos":
    PENDIENTE + "Todos los conteos por lote de la sucursal (la conciliación compara jornadas consecutivas). Arreglo: acotar a una ventana de fechas con `ahora` inyectado (hoy la función no lo recibe).",
  "src/server/consultas/reportes/vencimientos.ts|movimientoStock.findMany|sumarVentasYConsumosPorVentana":
    "Ventas y consumos de los productos cuyos lotes desaparecieron, entre los días de dos conteos consecutivos: acotado por esas ventanas (que dependen de los conteos de arriba, pendiente).",
  "src/server/consultas/stock/consolidado.ts|conteoFisico.findMany|calcularStockConsolidado":
    PENDIENTE + "Todos los conteos de la sucursal: el armado se queda con el último válido de cada producto/sección/lote. Un `take` cortaría conteos viejos y cambiaría el estado de stock sin avisar; el arreglo es DISTINCT ON por clave en SQL.",
  "src/server/consultas/stock/consolidado.ts|movimientoStock.findMany|calcularStockConsolidado":
    "Los movimientos posteriores al último conteo de cada clave, en tandas de 500 claves: acotado por clave y por esa fecha (crece solo con los conteos viejos, ver el pendiente de arriba).",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

function funcionQueContiene(nodo: ts.Node): string {
  let nombre = "(módulo)";
  for (let p: ts.Node | undefined = nodo.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) nombre = p.name.text;
  }
  return nombre;
}

/** Cada `findMany` sobre un modelo de la lista: `{ clave, conTake }`. */
function findManySinTope(codigo: string, ruta: string): { clave: string; conTake: boolean }[] {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const salida: { clave: string; conTake: boolean }[] = [];
  const repetidas = new Map<string, number>();
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "findMany" && ts.isPropertyAccessExpression(n.expression.expression)) {
      const modelo = n.expression.expression.name.text;
      if (MODELOS.has(modelo)) {
        const args = n.arguments[0];
        const conTake = !!args && ts.isObjectLiteralExpression(args) && args.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === "take");
        const base = `${ruta}|${modelo}.findMany|${funcionQueContiene(n)}`;
        const ordinal = (repetidas.get(base) ?? 0) + 1;
        repetidas.set(base, ordinal);
        salida.push({ clave: ordinal === 1 ? base : `${base}#${ordinal}`, conTake });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return salida;
}

const todos = CARPETAS.flatMap((c) => archivos(join(RAIZ, c)))
  .map((r) => relative(RAIZ, r).split(sep).join("/"))
  .flatMap((ruta) => findManySinTope(readFileSync(join(RAIZ, ruta), "utf8"), ruta));

describe("GT-15 — todo findMany sobre las tablas que más crecen lleva take", () => {
  it("sanidad: el recorrido ve findMany de esas tablas (no pasa en vacío)", () => {
    expect(todos.length).toBeGreaterThan(15);
    expect(todos.some((t) => t.conTake)).toBe(true);
  });

  it("el detector (con fuentes sintéticas)", () => {
    expect(findManySinTope("export async function f(db) { return db.movimientoStock.findMany({ where: {}, take: 10 }); }", "x.ts")).toEqual([{ clave: "x.ts|movimientoStock.findMany|f", conTake: true }]);
    expect(findManySinTope("export const g = (db) => db.cuenta.findMany({ where: {} });", "x.ts")).toEqual([{ clave: "x.ts|cuenta.findMany|g", conTake: false }]);
    expect(findManySinTope("export function h(db) { return db.producto.findMany({}); }", "x.ts")).toEqual([]);
    expect(findManySinTope("// db.cuenta.findMany({})\nexport const s = 'db.cuenta.findMany({})';", "x.ts")).toEqual([]);
  });

  it("los findMany sin take son exactamente los de SIN_TOPE", () => {
    const sinTake = todos.filter((t) => !t.conTake).map((t) => t.clave).sort();
    expect(sinTake, "un findMany nuevo sobre estas tablas lleva `take` (o se anota en SIN_TOPE con su motivo); uno que ya lo lleva sale de la lista").toEqual(Object.keys(SIN_TOPE).sort());
  });

  it("cada entrada de SIN_TOPE tiene su motivo", () => {
    for (const [clave, motivo] of Object.entries(SIN_TOPE)) expect(motivo.length, clave).toBeGreaterThan(40);
  });
});
