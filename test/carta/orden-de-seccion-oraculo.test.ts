import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { armarMenuCarta, type EntradaArmarMenu, type ItemAgrupadoEntrada, type ProductoCartaEntrada } from "@/core/carta/armar-menu";
import { MODOS_DE_ORDEN_DE_SECCION, esModoDeOrdenDeSeccion, modoVigente, ordenarRenglonesDeSeccion } from "@/core/carta/public";
import { ORACULO_DE_ORDEN_DE_SECCION, type FilaDelOraculo, type ModoDelOraculo } from "./orden-de-seccion-oraculo";

/**
 * Etapa O1, nivel 10: recorre TODAS las filas del oráculo (`orden-de-seccion-oraculo.ts`, escrito aparte del código) contra la carta real (`armarMenuCarta`) y contra la función pura que decide el orden, con
 * CADA permutación del orden de entrada (el resultado no puede depender de cómo llegan los renglones de la base). Más el GUARDIÁN de dimensiones: falla si aparece un modo nuevo, o una columna nueva en los modelos
 * que ordenan, sin declarar si afecta el orden o no.
 */

/** El valor del modo cargado que representa cada columna del oráculo (`SIN_FILA` = nada cargado). */
const MODO_CARGADO: Record<ModoDelOraculo, string | undefined> = { SIN_FILA: undefined, A_MANO: "A_MANO", ALFABETICO: "ALFABETICO", DESCONOCIDO: "ALFABETICAL" };

function permutaciones<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((resto) => [x, ...resto]));
}

function entradaDeLaFila(fila: FilaDelOraculo, renglones: FilaDelOraculo["renglones"]): EntradaArmarMenu {
  const productos: ProductoCartaEntrada[] = [];
  const agrupados: ItemAgrupadoEntrada[] = [];
  renglones.forEach((r, i) => {
    const contenido = { descripcion: null, tags: [], especial: r.especial === true, orden: r.orden };
    if (r.tipo === "PRODUCTO") productos.push({ id: `p${i}`, nombre: r.nombre, precioVenta: 1000, categoriaNombre: null, seccionCartaId: "s1", contenido });
    else agrupados.push({ id: `a${i}`, nombre: r.nombre, seccionCartaId: "s1", contenido, opciones: [{ productoId: `o${i}`, nombre: `${r.nombre} opción`, precioVenta: 1000, orden: 0 }] });
  });
  const modo = MODO_CARGADO[fila.modo];
  return {
    sucursal: { id: "suc1", nombre: "Central" },
    generadoEn: new Date("2026-11-17T12:00:00.000Z"),
    secciones: [{ id: "s1", nombre: "Sección", titulo: null, descripcion: null, imagenUrl: null, orden: 0 }],
    productos,
    preciosLocales: [],
    promos: [],
    agrupados,
    ...(modo === undefined ? {} : { modosDeOrden: [{ seccionCartaId: "s1", modo }] }),
  };
}

describe("O1: el oráculo del orden de los renglones de una sección", () => {
  it("el oráculo no está vacío y cubre cada modo, cada tipo de renglón, empates y ★", () => {
    expect(ORACULO_DE_ORDEN_DE_SECCION.length).toBeGreaterThanOrEqual(12);
    for (const modo of ["SIN_FILA", "A_MANO", "ALFABETICO", "DESCONOCIDO"] as const) expect(ORACULO_DE_ORDEN_DE_SECCION.some((f) => f.modo === modo), `modo ${modo}`).toBe(true);
    expect(ORACULO_DE_ORDEN_DE_SECCION.some((f) => f.renglones.some((r) => r.tipo === "ITEM_AGRUPADO"))).toBe(true);
    expect(ORACULO_DE_ORDEN_DE_SECCION.some((f) => new Set(f.renglones.map((r) => r.orden)).size < f.renglones.length)).toBe(true);
    expect(ORACULO_DE_ORDEN_DE_SECCION.some((f) => f.renglones.some((r) => r.especial))).toBe(true);
  });

  it("cada fila tiene nombres distintos (así el resultado esperado es único) y los mismos renglones que su esperado", () => {
    for (const fila of ORACULO_DE_ORDEN_DE_SECCION) {
      const nombres = fila.renglones.map((r) => r.nombre);
      expect(new Set(nombres).size, fila.id).toBe(nombres.length);
      expect([...nombres].sort(), fila.id).toEqual([...fila.esperado].sort());
    }
  });

  for (const fila of ORACULO_DE_ORDEN_DE_SECCION) {
    it(`${fila.id}: ${fila.regla} (todas las permutaciones de la entrada)`, () => {
      for (const entrada of permutaciones(fila.renglones)) {
        // La carta real.
        const items = armarMenuCarta(entradaDeLaFila(fila, entrada)).carta.secciones.flatMap((s) => s.items).map((i) => i.nombre);
        expect(items, `carta con entrada ${entrada.map((r) => r.nombre).join(",")}`).toEqual([...fila.esperado]);
        // La función pura que decide, sola.
        const puro = ordenarRenglonesDeSeccion(entrada, MODO_CARGADO[fila.modo], (r) => ({ nombre: r.nombre, orden: r.orden })).map((r) => r.nombre);
        expect(puro, `función pura con entrada ${entrada.map((r) => r.nombre).join(",")}`).toEqual([...fila.esperado]);
      }
    });
  }

  it("sin fila (o con `modosDeOrden` vacío) la carta sale IDÉNTICA: la ausencia no cambia nada", () => {
    for (const fila of ORACULO_DE_ORDEN_DE_SECCION.filter((f) => f.modo === "SIN_FILA" || f.modo === "A_MANO")) {
      const sin = armarMenuCarta(entradaDeLaFila({ ...fila, modo: "SIN_FILA" }, fila.renglones)).carta;
      const vacio = armarMenuCarta({ ...entradaDeLaFila({ ...fila, modo: "SIN_FILA" }, fila.renglones), modosDeOrden: [] }).carta;
      const aMano = armarMenuCarta(entradaDeLaFila({ ...fila, modo: "A_MANO" }, fila.renglones)).carta;
      expect(vacio, fila.id).toEqual(sin);
      expect(aMano, fila.id).toEqual(sin);
    }
  });

  it("la lista de modos es cerrada: solo ALFABETICO y A_MANO son modos; todo lo demás cae a A_MANO", () => {
    expect([...MODOS_DE_ORDEN_DE_SECCION].sort()).toEqual(["ALFABETICO", "A_MANO"]);
    for (const x of [undefined, null, "", "alfabetico", "ALFABETICAL", 0, {}, ["ALFABETICO"]]) {
      expect(esModoDeOrdenDeSeccion(x), String(x)).toBe(false);
      expect(modoVigente(x), String(x)).toBe("A_MANO");
    }
    expect(modoVigente("ALFABETICO")).toBe("ALFABETICO");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GUARDIÁN DE DIMENSIONES
// ---------------------------------------------------------------------------------------------------------------------

interface Declaracion {
  afecta: boolean;
  motivo: string;
}

const RAIZ = join(__dirname, "../..");
const SCHEMA = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");

/** Los campos (columnas y relaciones) de un modelo de `schema.prisma`. */
function camposDelModelo(modelo: string): string[] {
  const bloque = new RegExp(`^model ${modelo} \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\}`, "m").exec(SCHEMA);
  if (!bloque) throw new Error(`No encontré el modelo ${modelo} en schema.prisma`);
  return bloque[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("//") && !l.startsWith("@@"))
    .map((l) => l.split(/\s+/)[0]);
}

/** Cada columna de los modelos que ordenan: ¿cambia cómo sale la sección? Una columna nueva sin declarar rompe este test. */
const COLUMNAS: Record<string, Record<string, Declaracion>> = {
  ModoDeOrdenDeSeccionCarta: {
    id: { afecta: false, motivo: "identidad de la fila (la manda la aplicación: clave del alta)." },
    empresaId: { afecta: false, motivo: "aislamiento por empresa." },
    empresa: { afecta: false, motivo: "relación de empresaId." },
    sucursalId: { afecta: true, motivo: "el modo es de UNA sucursal: otra sucursal no lo ve." },
    sucursal: { afecta: false, motivo: "relación de sucursalId." },
    seccionCartaId: { afecta: true, motivo: "a qué sección aplica el modo." },
    seccionCarta: { afecta: false, motivo: "relación de seccionCartaId." },
    modo: { afecta: true, motivo: "DIMENSIÓN MODO: recorrida por el oráculo (sin fila, a mano, alfabético, desconocido)." },
    actualizadoPorId: { afecta: false, motivo: "trazabilidad: quién lo cambió por última vez." },
    actualizadoEn: { afecta: false, motivo: "trazabilidad: cuándo cambió por última vez." },
    version: { afecta: false, motivo: "control de versión del cambio de modo; no cambia cómo sale la carta." },
    creadoEn: { afecta: false, motivo: "trazabilidad: cuándo se creó la fila." },
  },
  ContenidoCartaProducto: {
    id: { afecta: false, motivo: "identidad de la fila." },
    empresaId: { afecta: false, motivo: "aislamiento por empresa." },
    empresa: { afecta: false, motivo: "relación de empresaId." },
    sucursalId: { afecta: true, motivo: "la carta es propia de cada sucursal: el renglón es de UNA." },
    sucursal: { afecta: false, motivo: "relación de sucursalId." },
    productoId: { afecta: true, motivo: "clave `{PRODUCTO, productoId}` del renglón." },
    producto: { afecta: false, motivo: "relación de productoId." },
    visibleEnCarta: { afecta: true, motivo: "DIMENSIÓN oculto: un renglón no visible no entra a la lista (lo cubre el test de integración)." },
    seccionCartaId: { afecta: true, motivo: "decide en qué sección está el renglón." },
    seccionCarta: { afecta: false, motivo: "relación de seccionCartaId." },
    descripcion: { afecta: false, motivo: "texto de cara al cliente; no participa del orden." },
    tags: { afecta: false, motivo: "etiquetas; no participan del orden." },
    especial: { afecta: false, motivo: "★: NO participa del orden (decisión del diseño: no se toca); lo cubren R12 y R13." },
    orden: { afecta: true, motivo: "el orden a mano; lo ignora el modo alfabético (R4) y se conserva al pasar a alfabético." },
    mostrarNombreArriba: { afecta: false, motivo: "cómo se lee un producto base; no cambia su lugar en la sección." },
    nombreEnCarta: { afecta: true, motivo: "el nombre que se compara en el modo alfabético es el que ve el comensal (nombre en la carta o el del producto)." },
    generoCartaId: { afecta: false, motivo: "carpeta del POS; no cambia el orden de la carta pública." },
    generoCarta: { afecta: false, motivo: "relación de generoCartaId." },
    actualizadoEn: { afecta: false, motivo: "trazabilidad." },
  },
  ItemAgrupadoCarta: {
    id: { afecta: false, motivo: "identidad; es la clave `{ITEM_AGRUPADO, id}` del renglón." },
    empresaId: { afecta: false, motivo: "aislamiento por empresa." },
    empresa: { afecta: false, motivo: "relación de empresaId." },
    sucursalId: { afecta: true, motivo: "la carta es propia de cada sucursal." },
    sucursal: { afecta: false, motivo: "relación de sucursalId." },
    nombre: { afecta: true, motivo: "el nombre que se compara en el modo alfabético." },
    seccionCartaId: { afecta: true, motivo: "decide en qué sección está el renglón." },
    seccionCarta: { afecta: false, motivo: "relación de seccionCartaId." },
    descripcion: { afecta: false, motivo: "texto de cara al cliente." },
    tags: { afecta: false, motivo: "etiquetas." },
    especial: { afecta: false, motivo: "★: NO participa del orden (R12, R13)." },
    orden: { afecta: true, motivo: "el orden a mano, en la misma escala que el de los productos (R7)." },
    activo: { afecta: true, motivo: "DIMENSIÓN inactivo: un ítem apagado no entra a la lista (lo cubre el test de integración)." },
    generoCartaId: { afecta: false, motivo: "carpeta del POS." },
    generoCarta: { afecta: false, motivo: "relación de generoCartaId." },
    creadoEn: { afecta: false, motivo: "trazabilidad." },
    actualizadoEn: { afecta: false, motivo: "trazabilidad." },
    opciones: { afecta: false, motivo: "las opciones se ordenan dentro del ítem, no el ítem en la sección." },
  },
};

describe("O1: guardián de dimensiones (una columna o un modo nuevo sin declarar rompe este test)", () => {
  it("cada columna de los tres modelos está declarada con su motivo, y no sobra ninguna declaración", () => {
    for (const [modelo, declaradas] of Object.entries(COLUMNAS)) {
      const reales = camposDelModelo(modelo);
      const sinDeclarar = reales.filter((c) => !(c in declaradas));
      expect(sinDeclarar, `${modelo}: columnas nuevas sin declarar si afectan el orden (agregalas a COLUMNAS con su motivo, y una fila al oráculo si afectan)`).toEqual([]);
      const sobran = Object.keys(declaradas).filter((c) => !reales.includes(c));
      expect(sobran, `${modelo}: declaraciones de columnas que ya no existen`).toEqual([]);
      for (const [campo, d] of Object.entries(declaradas)) expect(d.motivo.trim().length, `${modelo}.${campo}: falta el motivo`).toBeGreaterThanOrEqual(5);
    }
  });

  it("cada modo de la lista cerrada aparece en el oráculo (un modo nuevo exige una fila)", () => {
    const usados = new Set(ORACULO_DE_ORDEN_DE_SECCION.map((f) => MODO_CARGADO[f.modo]));
    for (const modo of MODOS_DE_ORDEN_DE_SECCION) expect(usados.has(modo), `el modo ${modo} no tiene fila en el oráculo`).toBe(true);
  });

  it("los modos de la base (CHECK) son EXACTAMENTE los de la lista cerrada del código", () => {
    const sql = readFileSync(join(RAIZ, "prisma/migrations/20261117160000_modo_de_orden_de_seccion_carta/migration.sql"), "utf8");
    const check = /"ModoDeOrdenDeSeccionCarta_modo_chk" CHECK \("modo" IN \(([^)]*)\)\)/.exec(sql);
    expect(check).not.toBeNull();
    const enLaBase = [...check![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(enLaBase).toEqual([...MODOS_DE_ORDEN_DE_SECCION].sort());
  });
});
