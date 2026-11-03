import { describe, expect, it } from "vitest";
import { presentacionDeUnProductoSolo, presentacionDelProducto, type PresentacionCartaV1 } from "../../src/core/carta/presentacion-en-carta";
import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { cartaDeUnProducto } from "../../src/core/pos/precio-de-configuracion";
import { PRODUCTOS_DE_REFERENCIA } from "../setup/referencia-precio-y-carta";

/**
 * ORÁCULO DE LA FORMA DE LA CARTA (modelo unificado, decisión del dueño 2026-10-29; regla de combinaciones del 2026-10-28): qué forma toma un producto con opciones según las dimensiones que la deciden,
 * escrito APARTE del código como dos tablas legibles y recorrido completo contra `presentacionDelProducto` con la tabla de precios real (`cartaDeUnProducto`). 4 primeros grupos × 8 segundos grupos ×
 * 2 modos de venta × 2 valores de «Mostrar el nombre arriba» = 128 combinaciones. `conDescuento` no cambia la forma (solo decide si un recargo dentro del precio se lee exacto: 6f de
 * `presentacion-en-carta.test.ts`) y los precios los fija `test/pos/tabla-de-precios-para-la-carta.test.ts`.
 *
 * Código de cada celda: `simple` · `sin tabla` (hoy no se puede vender) · `CxF` = C columnas de precio con encabezado (0 = una sola sin encabezado) × F filas, con el nombre de título · `CxF·n` = lo mismo
 * pero el título lo decide «Mostrar el nombre arriba» (si no, la base sale oculta, cada opción como un plato).
 */

type Grupo = GrupoParaVender & { prefijoEnCarta: string | null };
const opcion = (opcionId: string, nombre: string, extra: Partial<OpcionParaVender> = {}): OpcionParaVender => ({
  opcionId, nombre, orden: 0, activa: true, admitida: true, apagadaEnSucursal: false, cantidadMaxima: 3, versionVigenteId: `v-${opcionId}`, esNinguna: false, productoAnclaId: null,
  diferenciaDeLaVersion: { tipo: "MONTO", monto: 0 }, factorEscala: null, consumos: [], precioAbsoluto: null, diferenciaDelProducto: null, precioDeSucursal: null, ...extra,
});
const grupo = (grupoId: string, tipo: Grupo["tipo"], opciones: OpcionParaVender[], extra: Partial<Grupo> = {}): Grupo => ({
  grupoId, nombre: grupoId, tipo, activo: true, admitido: true, cantidadMinima: 1, cantidadMaxima: 1, orden: 0, modoPrecio: null, prefijoEnCarta: null, opciones: opciones.map((o, i) => ({ ...o, orden: i })), ...extra,
});
/** Un tamaño con precio ABSOLUTO (da el precio de referencia de una base) y un segundo tamaño por DIFERENCIA. */
const absoluto = (nombres: string[], precios: number[]) => grupo("primero", "MEDIDA", nombres.map((n, i) => opcion(`p${i}`, n, { precioAbsoluto: precios[i]! })), { modoPrecio: "ABSOLUTO" });
const porDiferencia = (nombres: string[], difs: number[]) => grupo("segundo", "MEDIDA", nombres.map((n, i) => opcion(`s${i}`, n, { diferenciaDeLaVersion: { tipo: "MONTO", monto: difs[i]! } })), { modoPrecio: "DIFERENCIA" });
const variante = (nombres: string[], difs: number[], extra: Partial<Grupo> = {}) => grupo("segundo", "VARIANTE", nombres.map((n, i) => opcion(`s${i}`, n, { diferenciaDeLaVersion: { tipo: "MONTO", monto: difs[i]! } })), extra);

const PRIMEROS = {
  ninguno: [],
  "tamaño de 3": [absoluto(["Chico", "Mediano", "Grande"], [4000, 4100, 4300])],
  "tamaño de 4": [absoluto(["T0", "T1", "T2", "T3"], [1000, 1100, 1200, 1300])],
  "tamaño de 3 del mismo precio": [absoluto(["Chico", "Mediano", "Grande"], [5000, 5000, 5000])],
};
const SEGUNDOS = {
  ninguno: [],
  "variante sin costo ni prefijo": [variante(["Solo", "Cortado", "Lágrima"], [0, 0, 0])],
  "variante con costo": [variante(["Jugoso", "A punto", "Cocido"], [0, 200, 300])],
  "variante con prefijo": [variante(["Carne", "Pollo", "Trucha"], [0, 0, 0], { prefijoEnCarta: "De" })],
  "variante opcional": [variante(["Salsa", "Queso", "Huevo"], [100, 200, 300], { cantidadMinima: 0 })],
  incluida: [grupo("segundo", "INCLUIDA", ["Ensalada", "Papas", "Puré"].map((n, i) => opcion(`s${i}`, n)))],
  "segundo tamaño de 3": [porDiferencia(["Taza", "Jarra", "Jarro"], [0, 500, 900])],
  "segundo tamaño de 4": [porDiferencia(["R0", "R1", "R2", "R3"], [0, 200, 400, 600])],
};
type Primero = keyof typeof PRIMEROS;
type Segundo = keyof typeof SEGUNDOS;

// EL ORÁCULO: una fila por primer grupo, una columna por segundo grupo (en el orden de SEGUNDOS: ninguno, sin costo, con costo, prefijo, opcional, incluida, 2.º tamaño de 3, 2.º tamaño de 4).
// Dos tamaños en un mismo producto no se pueden vender («Un producto admite una sola medida por línea», MEDIDAS_MULTIPLES): con un primer tamaño, un segundo tamaño da `sin tabla`.
const DIRECTO: Record<Primero, string[]> = {
  ninguno: ["simple", "simple", "0x3", "0x3", "simple", "simple", "3x1", "0x4"],
  "tamaño de 3": ["3x1", "3x3", "3x3", "3x3", "3x1", "3x1", "sin tabla", "sin tabla"],
  "tamaño de 4": ["0x4", "3x4", "3x4", "3x4", "0x4", "0x4", "sin tabla", "sin tabla"],
  // Un tamaño que cuesta lo mismo en todas sus opciones no define el precio: en un directo es una aclaración, como si no estuviera.
  "tamaño de 3 del mismo precio": ["simple", "simple", "0x3", "0x3", "simple", "simple", "sin tabla", "sin tabla"],
};
const BASE: Record<Primero, string[]> = {
  // Sin un tamaño con precio absoluto no hay precio de referencia: la base no se puede vender.
  ninguno: Array(8).fill("sin tabla"),
  // En una base la variante sin costo ni prefijo sigue siendo una aclaración (la base queda de un eje: sale oculta); la que tiene costo o prefijo es la fila.
  "tamaño de 3": ["0x3·n", "0x3·n", "3x3", "3x3", "0x3·n", "0x3·n", "sin tabla", "sin tabla"],
  "tamaño de 4": ["0x4·n", "0x4·n", "3x4", "3x4", "0x4·n", "0x4·n", "sin tabla", "sin tabla"],
  // El tamaño de igual precio es el eje de una base (nombra cada configuración).
  "tamaño de 3 del mismo precio": ["0x3·n", "0x3·n", "3x3", "3x3", "0x3·n", "0x3·n", "sin tabla", "sin tabla"],
};
const CONTEOS = { simple: 16, "sin tabla": 40, "con título": 60, "oculta (sin título)": 12 };

type Medida = { forma: "simple" | "sin tabla" } | { forma: "tabla"; titulo: boolean; columnas: number; filas: number };
function esperar(codigo: string, nombreArriba: boolean): Medida {
  if (codigo === "simple" || codigo === "sin tabla") return { forma: codigo };
  const [, c, f, n] = /^(\d+)x(\d+)(·n)?$/.exec(codigo)!;
  return { forma: "tabla", titulo: n ? nombreArriba : true, columnas: Number(c), filas: Number(f) };
}
function formaReal(grupos: Grupo[], esBase: boolean, mostrarNombreArriba: boolean): PresentacionCartaV1 | null {
  const { tabla } = cartaDeUnProducto({ grupos, precioBase: 4000, descuentoDeProducto: null, esBase });
  return tabla ? presentacionDeUnProductoSolo({ tabla, esBase, mostrarNombreArriba, conDescuento: false }) : null;
}
const medir = (p: PresentacionCartaV1 | null): Medida => (p === null ? { forma: "sin tabla" } : p.forma === "simple" ? { forma: "simple" } : { forma: "tabla", titulo: p.titulo, columnas: p.columnas.length, filas: p.filas.length });

describe("oráculo de la forma de la carta: las 128 combinaciones", () => {
  const combinaciones = (Object.keys(PRIMEROS) as Primero[]).flatMap((primero) =>
    (Object.keys(SEGUNDOS) as Segundo[]).flatMap((segundo, j) => [false, true].flatMap((esBase) => [false, true].map((nombreArriba) => ({ primero, segundo, j, esBase, nombreArriba })))),
  );
  const codigoDe = (c: (typeof combinaciones)[number]) => (c.esBase ? BASE : DIRECTO)[c.primero][c.j]!;

  it("son 128 y cada una da lo que dice la tabla (forma, título, columnas y filas)", () => {
    expect(combinaciones).toHaveLength(128);
    const distintas = combinaciones.flatMap((c) => {
      const esperado = JSON.stringify(esperar(codigoDe(c), c.nombreArriba));
      const real = JSON.stringify(medir(formaReal([...PRIMEROS[c.primero], ...SEGUNDOS[c.segundo]], c.esBase, c.nombreArriba)));
      return real === esperado ? [] : [`${c.esBase ? "base" : "directo"} · ${c.primero} + ${c.segundo} · nombre arriba=${c.nombreArriba}: esperaba ${esperado} y da ${real}`];
    });
    expect(distintas).toEqual([]);
  });

  it("conteos declarados: sin forma, sin tabla, tablas con título y bases ocultas", () => {
    const medidas = combinaciones.map((c) => esperar(codigoDe(c), c.nombreArriba));
    const cuenta = (f: (m: Medida) => boolean) => medidas.filter(f).length;
    expect({
      simple: cuenta((m) => m.forma === "simple"),
      "sin tabla": cuenta((m) => m.forma === "sin tabla"),
      "con título": cuenta((m) => m.forma === "tabla" && m.titulo),
      "oculta (sin título)": cuenta((m) => m.forma === "tabla" && !m.titulo),
    }).toEqual(CONTEOS);
  });

  it("«Mostrar el nombre arriba» solo importa en una base de un eje", () => {
    const cambian = combinaciones.filter((c) => c.nombreArriba).flatMap((c) => {
      const grupos = [...PRIMEROS[c.primero], ...SEGUNDOS[c.segundo]];
      return JSON.stringify(medir(formaReal(grupos, c.esBase, true))) === JSON.stringify(medir(formaReal(grupos, c.esBase, false))) ? [] : [`${c.esBase ? "base" : "directo"} · ${c.primero} + ${c.segundo}`];
    });
    expect(cambian).toEqual(combinaciones.filter((c) => c.nombreArriba && codigoDe(c).endsWith("·n")).map((c) => `base · ${c.primero} + ${c.segundo}`));
  });
});

describe("oráculo: filas literales de los productos de producción (café, milanesa, pizza, bife)", () => {
  const filas = (p: PresentacionCartaV1 | null) => (p?.forma === "tabla" ? p.filas.map((f) => [f.rotulo, f.celdas]) : null);
  const deReferencia = (nombre: string) => PRODUCTOS_DE_REFERENCIA.find((p) => p.nombre.startsWith(nombre))!.grupos as Grupo[];

  it("Café (directo) con Solo / Cortado / Lágrima: grilla de tres columnas, sin prefijo y sin la aclaración de la variante", () => {
    expect(formaReal([...PRIMEROS["tamaño de 3"], ...SEGUNDOS["variante sin costo ni prefijo"]], false, false)).toEqual({
      forma: "tabla",
      titulo: true,
      columnas: ["Chico", "Mediano", "Grande"],
      filas: ["Solo", "Cortado", "Lágrima"].map((rotulo) => ({ rotulo, celdas: [4000, 4100, 4300] })),
      aclaraciones: [],
    });
  });

  it("Milanesa (base de producción): oculta, cada tipo como un plato; la proteína, una aclaración", () => {
    const forma = formaReal(deReferencia("Milanesas (M1"), true, false);
    expect(filas(forma)).toEqual([["Simple", [20000]], ["Napolitana", [25000]]]);
    expect(forma).toMatchObject({ titulo: false, columnas: [], aclaraciones: [{ tipo: "eleccion", rotulo: "Milanesas de", opciones: ["carne", "pollo"] }] });
  });

  it("Pizza (base de producción): oculta, las seis pizzas como platos con su precio final", () => {
    const forma = formaReal(deReferencia("Pizzas"), true, false);
    expect(filas(forma)).toEqual([["Pizza muzzarella", [18000]], ["Pizza de verduras asadas", [20000]], ["Pizza fugazzeta", [22000]], ["Pizza napolitana", [22000]], ["Pizza con papas fritas", [25000]], ["Pizza bomba", [25000]]]);
    expect(forma).toMatchObject({ titulo: false, columnas: [] });
  });

  it("Bife (directo, sin ejes): el nombre y su precio, con la guarnición y los extras debajo", () => {
    expect(formaReal(deReferencia("Bife a la criolla"), false, false)).toEqual({
      forma: "simple",
      aclaraciones: [
        { tipo: "eleccion", rotulo: "Guarnición", opciones: ["ensalada", "papas fritas", "puré"] },
        { tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] },
      ],
    });
  });
});

// Guardián: una entrada nueva de la forma obliga a declarar acá si cambia la forma (falla en `tsc`: falta una clave del registro).
const DIMENSIONES_DE_LA_ENTRADA: Record<keyof Parameters<typeof presentacionDelProducto>[0], string> = {
  tabla: "CAMBIA: los ejes y los precios de cada celda (primer y segundo grupo)",
  esBase: "CAMBIA: directo o base",
  mostrarNombreArriba: "CAMBIA: el título de una base de un eje",
  conDescuento: "NO cambia la forma: solo decide si un recargo dentro del precio se lee exacto (6f de presentacion-en-carta.test.ts)",
};
describe("guardián de las dimensiones", () => {
  it("cada entrada de la forma está declarada con su motivo", () => {
    expect(Object.keys(DIMENSIONES_DE_LA_ENTRADA).sort()).toEqual(["conDescuento", "esBase", "mostrarNombreArriba", "tabla"]);
    for (const motivo of Object.values(DIMENSIONES_DE_LA_ENTRADA)) expect(motivo).toMatch(/CAMBIA|NO cambia/);
  });
});
