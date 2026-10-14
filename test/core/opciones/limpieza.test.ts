import { describe, expect, it } from "vitest";
import { candidatosALimpiar, productosAfectados, type GrupoParaLimpiar, type VentasRecientes } from "../../../src/core/opciones/public";

/**
 * OPCIONES-LIMPIEZA (G2): la regla PURA de «Limpiar» (`candidatosALimpiar`, `productosAfectados`). Sin base: qué grupos y opciones en uso se proponen archivar con cada criterio, que un
 * grupo candidato no repite sus opciones aparte, y la vista previa de productos sin repetir.
 */
const nunca: VentasRecientes = { d30: false, d90: false, d180: false };
const hace100Dias: VentasRecientes = { d30: false, d90: false, d180: true };
const hoy: VentasRecientes = { d30: true, d90: true, d180: true };

const GRUPOS: GrupoParaLimpiar[] = [
  // Usado por el café y el cortado; «Almendras» no se vende hace 100 días; «Avena» no la admite nadie y nunca se vendió.
  {
    id: "leche",
    nombre: "Leche",
    productoIds: ["cafe", "cortado"],
    opciones: [
      { id: "vaca", nombre: "De vaca", productoIds: ["cafe", "cortado"], ventas: hoy },
      { id: "almendras", nombre: "Almendras", productoIds: ["cafe"], ventas: hace100Dias },
      { id: "avena", nombre: "Avena", productoIds: [], ventas: nunca },
    ],
  },
  // Nadie lo usa y nunca se vendió.
  { id: "salsas", nombre: "Salsas", productoIds: [], opciones: [{ id: "picante", nombre: "Picante", productoIds: [], ventas: nunca }] },
  // Lo usa el té, pero no se vende hace 100 días.
  { id: "endulzante", nombre: "Endulzante", productoIds: ["te"], opciones: [{ id: "miel", nombre: "Miel", productoIds: ["te"], ventas: hace100Dias }] },
  // Sin opciones en uso (todas archivadas) y sin productos.
  { id: "vacio", nombre: "Vacío", productoIds: [], opciones: [] },
];

const ids = (c: ReturnType<typeof candidatosALimpiar>) => ({ grupos: c.grupos.map((g) => g.id), opciones: c.opciones.map((o) => `${o.grupo.id}/${o.opcion.id}`) });

describe("candidatosALimpiar", () => {
  it("«Sin productos»: los grupos que nadie usa y, en un grupo usado, las opciones que nadie admite", () => {
    expect(ids(candidatosALimpiar(GRUPOS, "SIN_PRODUCTOS"))).toEqual({ grupos: ["salsas", "vacio"], opciones: ["leche/avena"] });
  });

  it("«Sin ventas»: el período decide; un grupo con ventas en el período no es candidato, pero sus opciones sin ventas sí", () => {
    expect(ids(candidatosALimpiar(GRUPOS, "SIN_VENTAS_30"))).toEqual({ grupos: ["salsas", "endulzante", "vacio"], opciones: ["leche/almendras", "leche/avena"] });
    expect(ids(candidatosALimpiar(GRUPOS, "SIN_VENTAS_90"))).toEqual({ grupos: ["salsas", "endulzante", "vacio"], opciones: ["leche/almendras", "leche/avena"] });
    expect(ids(candidatosALimpiar(GRUPOS, "SIN_VENTAS_180"))).toEqual({ grupos: ["salsas", "vacio"], opciones: ["leche/avena"] });
  });

  it("un grupo candidato no lista sus opciones aparte (archivar el grupo ya las saca de la venta)", () => {
    const c = candidatosALimpiar(GRUPOS, "SIN_PRODUCTOS");
    expect(c.opciones.some((o) => o.grupo.id === "salsas")).toBe(false);
  });
});

describe("productosAfectados (la vista previa)", () => {
  it("los productos de los grupos y de las opciones elegidos, sin repetir y ordenados", () => {
    expect(productosAfectados(GRUPOS, { grupoIds: new Set(["endulzante"]), opcionIds: new Set(["almendras", "vaca"]) })).toEqual(["cafe", "cortado", "te"]);
    expect(productosAfectados(GRUPOS, { grupoIds: new Set(["salsas"]), opcionIds: new Set(["avena"]) })).toEqual([]);
    expect(productosAfectados(GRUPOS, { grupoIds: new Set(), opcionIds: new Set() })).toEqual([]);
  });
});
