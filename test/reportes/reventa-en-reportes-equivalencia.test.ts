import { describe, expect, it } from "vitest";

import { calcularCostosYMargenesDesde, calcularImpactoInsumosDesde, calcularImpactoRecetasPorPeriodoDesde, resolverCostoRecetaCompleta } from "../../src/core/reportes/costos";
import { capacidadesEnReportes, esReventaEnReportes, type CostoMP, type IngredienteRecetaReporte, type InfoProductoReporte } from "../../src/core/reportes/comun";
import { resolverAccionFaltante } from "../../src/core/reportes/accion-faltante";
import { claseDelProducto, ETIQUETA_DEL_TIPO, TIPOS_FILTRABLES } from "../../src/core/catalogo/filtros-de-productos";
import { NOMBRE_DE_CLASE } from "../../src/core/catalogo/clases-de-producto";
import { pasosDelEspacio, pendientesDelProducto, type AccesoAlEspacio, type HechosDelProducto } from "../../src/core/catalogo/espacio-del-producto";

/**
 * E4-4 de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7, regla R9: «los reportes no cambian de resultado»). Recorre tipo × se produce × clase de uso contra un ORÁCULO escrito aparte
 * (la tabla «lo de siempre», con los literales `tipo === "MP"` / `"PV"` que reemplazan las decisiones migradas) y fija lo nuevo de una Reventa (PV, no se produce, clase REVENTA):
 *  - los productos de siempre (MP y PV, con cualquier clase que NO sea REVENTA) dan EXACTAMENTE lo mismo; el costeo, el margen y el impacto salen idénticos con o sin clase de uso;
 *  - una Reventa se costea con su costo de COMPRA (como el par MP+PV de una receta 1:1), nunca «sin receta»; sin costo de compra queda «costo incompleto» (pendiente de completar: ni se inventa ni cuenta como cero);
 *  - la lista la dice «reventa»; la ficha no le pide receta.
 * Un guardián falla si aparece una forma de producto sin declarar en la tabla.
 */
const TIPOS = ["MP", "PV"] as const;
const SE_PRODUCE = [true, false] as const;
const CLASES_DE_SIEMPRE: ReadonlyArray<string | null | undefined> = [undefined, null, "MATERIA_PRIMA", "INSUMO", "ELABORADO", "VENDIBLE", "otra-cosa"];

/** Lo que cada reporte decidía con los literales (ORÁCULO, escrito aparte del código). */
const DE_SIEMPRE = {
  ventasSinReceta: (tipo: string) => tipo === "PV",
  pvSinVentaNunca: (tipo: string) => tipo === "PV",
  mpEnRecetaSinProveedor: (tipo: string, seProduce: boolean) => tipo === "MP" && !seProduce,
  insumoSinReceta: (tipo: string) => tipo === "MP",
  diferenciasDeAjuste: (tipo: string) => tipo === "MP",
  historialSeCompra: (tipo: string) => tipo === "MP",
  historialSeVende: (tipo: string) => tipo === "PV",
};

function decisionesDeLosReportes(tipo: "MP" | "PV", seProduce: boolean, claseDeUso: string | null | undefined) {
  const c = capacidadesEnReportes({ tipo, seProduce, claseDeUso });
  return {
    ventasSinReceta: c.seVende && c.llevaReceta,
    pvSinVentaNunca: c.seVende,
    mpEnRecetaSinProveedor: c.seCompra && !c.sePuedeProducir,
    insumoSinReceta: c.seCompra && !c.seVende,
    diferenciasDeAjuste: c.seCompra,
    historialSeCompra: c.seCompra,
    historialSeVende: c.seVende,
  };
}

const COMBINACIONES = TIPOS.flatMap((tipo) => SE_PRODUCE.flatMap((seProduce) => CLASES_DE_SIEMPRE.map((claseDeUso) => ({ tipo, seProduce, claseDeUso }))));

describe("las decisiones de los reportes contra el oráculo", () => {
  it("recorre todas las combinaciones (sanidad: no pasa en vacío)", () => {
    expect(COMBINACIONES).toHaveLength(TIPOS.length * SE_PRODUCE.length * CLASES_DE_SIEMPRE.length);
  });

  it.each(COMBINACIONES)("MP/PV de siempre: tipo «$tipo», se produce $seProduce, clase «$claseDeUso» decide lo mismo que los literales", ({ tipo, seProduce, claseDeUso }) => {
    expect(decisionesDeLosReportes(tipo, seProduce, claseDeUso)).toEqual({
      ventasSinReceta: DE_SIEMPRE.ventasSinReceta(tipo),
      pvSinVentaNunca: DE_SIEMPRE.pvSinVentaNunca(tipo),
      mpEnRecetaSinProveedor: DE_SIEMPRE.mpEnRecetaSinProveedor(tipo, seProduce),
      insumoSinReceta: DE_SIEMPRE.insumoSinReceta(tipo),
      diferenciasDeAjuste: DE_SIEMPRE.diferenciasDeAjuste(tipo),
      historialSeCompra: DE_SIEMPRE.historialSeCompra(tipo),
      historialSeVende: DE_SIEMPRE.historialSeVende(tipo),
    });
    expect(esReventaEnReportes({ tipo, seProduce, claseDeUso })).toBe(false);
  });

  it("una REVENTA (PV, no se produce) se comporta distinto SOLO donde el diseño lo pide", () => {
    expect(decisionesDeLosReportes("PV", false, "REVENTA")).toEqual({
      ventasSinReceta: false, // se vende de su stock propio: no es una «venta sin receta»
      pvSinVentaNunca: true, // es un producto de venta: sigue en «nunca se vendió»
      mpEnRecetaSinProveedor: true, // se compra y no se produce: sin proveedor es un hueco, como una MP
      insumoSinReceta: false, // se vende tal cual: no es un insumo «sin receta»
      diferenciasDeAjuste: true, // lleva stock propio y se cuenta: entra en diferencias de ajuste
      historialSeCompra: true,
      historialSeVende: true,
    });
    expect(esReventaEnReportes({ tipo: "PV", seProduce: false, claseDeUso: "REVENTA" })).toBe(true);
  });

  it("una REVENTA incoherente (MP, o que se produce) o de un tipo desconocido no es nada: todo nace cerrado", () => {
    for (const [tipo, seProduce] of [["MP", false], ["PV", true], ["SERVICIO", false]] as const) {
      expect(esReventaEnReportes({ tipo: tipo as "MP", seProduce, claseDeUso: "REVENTA" }), `${tipo}/${seProduce}`).toBe(false);
      expect(Object.values(decisionesDeLosReportes(tipo as "MP", seProduce, "REVENTA")).every((v) => v === false), `${tipo}/${seProduce}`).toBe(true);
    }
  });
});

// ── Costos, margen e impacto ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function info(extra: Partial<InfoProductoReporte> & Pick<InfoProductoReporte, "id" | "tipo">): InfoProductoReporte {
  return {
    codigo: extra.id.toUpperCase(),
    nombre: extra.id,
    disponible: true,
    seProduce: false,
    precioVenta: 0,
    categoriaNombre: null,
    categoriaId: null,
    insumoNombre: null,
    grupoNombre: null,
    esNoComestible: false,
    unidadStockNombre: "u",
    esConsignacion: false,
    proveedorConsignacionNombre: null,
    ...extra,
  };
}
const ing = (insumoProductoId: string, cantidad = 1, mermaPorcentaje = 0): IngredienteRecetaReporte => ({ recetaIngredienteId: `i-${insumoProductoId}`, insumoProductoId, insumoNombre: insumoProductoId, cantidad, unidadNombre: "u", mermaPorcentaje, baseDeCantidad: "NETA", cantidadCentral: cantidad, mermaPorcentajeCentral: mermaPorcentaje, calibradoLocal: false });
const costo = (precio: number, proveedor = "Proveedor Uno"): CostoMP => ({ precioPorUnidadStock: precio, proveedorNombre: proveedor, fecha: new Date("2026-11-01T00:00:00Z") });

/** El catálogo de siempre: un PV con receta sobre una MP y una MP que se produce, con o sin clase de uso guardada. */
function catalogoDeSiempre(conClase: boolean) {
  const c = (clase: string) => (conClase ? { claseDeUso: clase } : {});
  const productos = new Map<string, InfoProductoReporte>([
    ["harina", info({ id: "harina", tipo: "MP", ...c("MATERIA_PRIMA") })],
    ["masa", info({ id: "masa", tipo: "MP", seProduce: true, ...c("ELABORADO") })],
    ["pan", info({ id: "pan", tipo: "PV", precioVenta: 100, ...c("VENDIBLE") })],
    ["pizza", info({ id: "pizza", tipo: "PV", precioVenta: 1000, ...c("VENDIBLE") })],
    ["sinReceta", info({ id: "sinReceta", tipo: "PV", precioVenta: 50, ...c("VENDIBLE") })],
  ]);
  const recetas = new Map<string, IngredienteRecetaReporte[]>([
    ["pan", [ing("harina", 2, 10)]],
    ["pizza", [ing("masa", 1), ing("harina", 0.5)]],
    ["masa", [ing("harina", 3)]],
  ]);
  return { productos, recetas };
}

describe("costos, margen e impacto: los productos de siempre dan EXACTAMENTE lo mismo (R9)", () => {
  const costosAhora = new Map<string, CostoMP>([["harina", costo(20)]]);
  const costosAntes = new Map<string, CostoMP>([["harina", costo(10)]]);

  it("el costeo y el margen salen idénticos con o sin clase de uso guardada", () => {
    const sin = catalogoDeSiempre(false);
    const con = catalogoDeSiempre(true);
    const filasSin = calcularCostosYMargenesDesde(sin.productos, sin.recetas, costosAhora);
    const filasCon = calcularCostosYMargenesDesde(con.productos, con.recetas, costosAhora);
    expect(filasCon).toEqual(filasSin);
    // Sanidad: no es vacío y las cuentas son las de siempre (pan: 2 × 1,1 × 20 = 44, sobre el 40 % objetivo; el PV sin receta sigue «sin receta»).
    const pan = filasSin.find((f) => f.productoId === "pan")!;
    expect([pan.costo, pan.estado]).toEqual([44, "FOOD_COST_ALTO"]);
    expect(filasSin.find((f) => f.productoId === "sinReceta")!.estado).toBe("SIN_RECETA");
  });

  it("el costo completo de una receta y el impacto del cambio de precio salen idénticos con o sin clase de uso", () => {
    const sin = catalogoDeSiempre(false);
    const con = catalogoDeSiempre(true);
    for (const id of ["pan", "pizza", "sinReceta", "harina"]) {
      expect(resolverCostoRecetaCompleta(id, con.productos, con.recetas, costosAhora), id).toEqual(resolverCostoRecetaCompleta(id, sin.productos, sin.recetas, costosAhora));
    }
    const impactoSin = calcularImpactoRecetasPorPeriodoDesde(sin.productos, sin.recetas, costosAhora, costosAntes, false);
    const impactoCon = calcularImpactoRecetasPorPeriodoDesde(con.productos, con.recetas, costosAhora, costosAntes, false);
    expect(impactoCon).toEqual(impactoSin);
    expect(impactoSin.map((f) => f.productoId).sort()).toEqual(["pan", "pizza"]);
  });
});

describe("costos de una REVENTA: su costo de compra, nunca «sin receta» (R9)", () => {
  const reventa = (extra: Partial<InfoProductoReporte> = {}) => info({ id: "gaseosa", tipo: "PV", claseDeUso: "REVENTA", precioVenta: 1500, ...extra });
  const armar = (r: InfoProductoReporte) => new Map<string, InfoProductoReporte>([["gaseosa", r]]);
  const sinRecetas = new Map<string, IngredienteRecetaReporte[]>();

  it("con costo de compra: costo = lo que costó comprarla, margen y food cost contra su precio, estado OK", () => {
    const [fila] = calcularCostosYMargenesDesde(armar(reventa()), sinRecetas, new Map([["gaseosa", costo(600)]]));
    expect([fila.costo, fila.margen, fila.margenPct, fila.foodCostPct, fila.costoIncompleto, fila.estado]).toEqual([600, 900, 60, 40, false, "OK"]);
    // Una receta propia (que no debería tener) se ignora: se costea de su compra.
    const conReceta = calcularCostosYMargenesDesde(armar(reventa()), new Map([["gaseosa", [ing("harina", 9)]]]), new Map([["gaseosa", costo(600)]]));
    expect(conReceta[0].costo).toBe(600);
  });

  it("el costo es el de la compra MÁS RECIENTE (el mapa de costos ya trae la vigente) y no depende de la cantidad", () => {
    const [a] = calcularCostosYMargenesDesde(armar(reventa()), sinRecetas, new Map([["gaseosa", costo(600)]]));
    const [b] = calcularCostosYMargenesDesde(armar(reventa()), sinRecetas, new Map([["gaseosa", costo(750)]]));
    expect([a.costo, b.costo]).toEqual([600, 750]);
  });

  it("SIN costo de compra: costo incompleto (pendiente de completar), sin costo ni margen inventados ni en cero, y la acción lleva a cargar la compra", () => {
    const [fila] = calcularCostosYMargenesDesde(armar(reventa()), sinRecetas, new Map());
    expect([fila.costo, fila.margen, fila.costoIncompleto, fila.estado]).toEqual([null, null, true, "COSTO_INCOMPLETO"]);
    expect(fila.estado).not.toBe("SIN_RECETA");
    expect(fila.componentes).toHaveLength(1);
    expect(fila.componentes[0].sinPrecio).toBe(true);
    // Texto y ruta que ya existen (los de una MP sin precio): ningún texto nuevo.
    expect(resolverAccionFaltante(fila)).toEqual({ href: "/movimientos/compra?productoId=gaseosa", etiqueta: 'Costo incompleto — falta precio de "gaseosa"' });
  });

  it("SIN precio de venta: «sin precio de venta» (no se vende hasta cargarlo), aunque tenga costo", () => {
    const [fila] = calcularCostosYMargenesDesde(armar(reventa({ precioVenta: 0 })), sinRecetas, new Map([["gaseosa", costo(600)]]));
    expect([fila.estado, fila.costo, fila.margen]).toEqual(["SIN_PRECIO_VENTA", 600, null]);
  });

  it("food cost y no comestible: el packaging que se revende cuenta en el costo y no en el food cost, como el par MP+PV", () => {
    const [fila] = calcularCostosYMargenesDesde(armar(reventa({ esNoComestible: true })), sinRecetas, new Map([["gaseosa", costo(600)]]));
    expect([fila.costo, fila.costoNoComestible, fila.foodCostPct]).toEqual([600, 600, 0]);
  });

  it("es el MISMO resultado que el par de siempre (una MP + un PV con receta 1:1)", () => {
    const par = new Map<string, InfoProductoReporte>([
      ["mp", info({ id: "mp", tipo: "MP", nombre: "gaseosa" })],
      ["pv", info({ id: "pv", tipo: "PV", nombre: "gaseosa", precioVenta: 1500 })],
    ]);
    const [delPar] = calcularCostosYMargenesDesde(par, new Map([["pv", [ing("mp")]]]), new Map([["mp", costo(600)]]));
    const [laReventa] = calcularCostosYMargenesDesde(armar(reventa()), sinRecetas, new Map([["gaseosa", costo(600)]]));
    const comparable = (f: typeof delPar) => ({ costo: f.costo, margen: f.margen, margenPct: f.margenPct, foodCostPct: f.foodCostPct, precioSugerido: f.precioSugerido, estado: f.estado, costoIncompleto: f.costoIncompleto });
    expect(comparable(laReventa)).toEqual(comparable(delPar));
  });

  it("el costo reconstruido de un día (`resolverCostoRecetaCompleta`) es el de compra de ese día; sin compra, null (no cero)", () => {
    expect(resolverCostoRecetaCompleta("gaseosa", armar(reventa()), sinRecetas, new Map([["gaseosa", costo(600)]]))).toBe(600);
    expect(resolverCostoRecetaCompleta("gaseosa", armar(reventa()), sinRecetas, new Map())).toBeNull();
    // Solo comida: una Reventa no comestible no cuenta.
    expect(resolverCostoRecetaCompleta("gaseosa", armar(reventa({ esNoComestible: true })), sinRecetas, new Map([["gaseosa", costo(600)]]), true)).toBe(0);
  });

  it("un cambio de precio de su compra aparece en el impacto de costos, como el del par", () => {
    const filas = calcularImpactoRecetasPorPeriodoDesde(armar(reventa()), sinRecetas, new Map([["gaseosa", costo(700)]]), new Map([["gaseosa", costo(600)]]), false);
    expect(filas.map((f) => [f.productoId, f.costoAntes, f.costoActual, f.deltaCosto])).toEqual([["gaseosa", 600, 700, 100]]);
    // Sin cambio de precio no aparece.
    expect(calcularImpactoRecetasPorPeriodoDesde(armar(reventa()), sinRecetas, new Map([["gaseosa", costo(600)]]), new Map([["gaseosa", costo(600)]]), false)).toEqual([]);
  });

  it("el impacto por insumo la muestra con su propio nombre (como la MP del par)", () => {
    const filas = calcularCostosYMargenesDesde(armar(reventa()), sinRecetas, new Map([["gaseosa", costo(600)]]));
    expect(calcularImpactoInsumosDesde(filas).map((f) => [f.insumoProductoId, f.platos, f.costoUnitario])).toEqual([["gaseosa", ["gaseosa"], 600]]);
  });
});

// ── Lista y ficha ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** La clase de siempre (ORÁCULO): lo que decía `claseDelProducto` con los literales. */
function claseDeSiempre(tipo: "MP" | "PV", seProduce: boolean, respalda: boolean) {
  if (tipo === "PV") return respalda ? "respaldo" : "venta";
  return seProduce ? "se-produce" : "materia-prima";
}

describe("la lista de productos: la clase de cada fila", () => {
  const FORMAS = TIPOS.flatMap((tipo) => SE_PRODUCE.flatMap((seProduce) => [true, false].flatMap((respalda) => CLASES_DE_SIEMPRE.map((claseDeUso) => ({ tipo, seProduce, respalda, claseDeUso })))));

  it.each(FORMAS)("de siempre: tipo «$tipo», se produce $seProduce, respalda $respalda, clase «$claseDeUso»", ({ tipo, seProduce, respalda, claseDeUso }) => {
    expect(claseDelProducto({ tipo, seProduce, respaldaUnaOpcion: respalda, claseDeUso })).toBe(claseDeSiempre(tipo, seProduce, respalda));
    expect(claseDelProducto({ tipo, seProduce, respaldaUnaOpcion: respalda })).toBe(claseDeSiempre(tipo, seProduce, respalda)); // sin el dato nuevo, como lo llamaban todos
  });

  it("una Reventa se dice «reventa» con el nombre de clase que ya existe; una incoherente, no", () => {
    expect(claseDelProducto({ tipo: "PV", seProduce: false, respaldaUnaOpcion: false, claseDeUso: "REVENTA" })).toBe("reventa");
    expect(ETIQUETA_DEL_TIPO.reventa).toBe(NOMBRE_DE_CLASE.REVENTA);
    expect(TIPOS_FILTRABLES).toContain("reventa");
    expect(claseDelProducto({ tipo: "MP", seProduce: false, respaldaUnaOpcion: false, claseDeUso: "REVENTA" })).toBe("materia-prima");
    expect(claseDelProducto({ tipo: "PV", seProduce: true, respaldaUnaOpcion: false, claseDeUso: "REVENTA" })).toBe("venta");
  });
});

describe("la ficha de un producto: los pasos y lo que falta", () => {
  const ACCESO: AccesoAlEspacio = { datos: true, ver: true, opciones: true, receta: "si", carta: "si" };
  const hechos = (extra: Partial<HechosDelProducto>): HechosDelProducto => ({
    tipo: "PV",
    seProduce: false,
    esAnclaDeAdicional: false,
    modoDeVenta: "DIRECTO" as HechosDelProducto["modoDeVenta"],
    precioDeVenta: 100,
    opciones: { vendibleAca: true },
    receta: { rechazo: "sin receta no se vende" },
    carta: { estado: "visible" },
    ...extra,
  });
  const pasosDe = (h: HechosDelProducto) => pasosDelEspacio("p1", h, ACCESO, pendientesDelProducto(h)).map((p) => p.paso);

  it("MP y PV de siempre: los mismos pasos y los mismos pendientes con o sin clase", () => {
    for (const base of [hechos({}), hechos({ seProduce: true }), hechos({ tipo: "MP" }), hechos({ tipo: "MP", seProduce: true })]) {
      for (const claseDeUso of [undefined, null, "VENDIBLE", "MATERIA_PRIMA", "ELABORADO", "INSUMO"]) {
        const h = { ...base, claseDeUso };
        expect(pasosDe(h)).toEqual(pasosDe(base));
        expect(pendientesDelProducto(h)).toEqual(pendientesDelProducto(base));
      }
    }
    expect(pasosDe(hechos({}))).toEqual(["datos", "precios", "opciones", "receta", "en-la-carta"]); // el PV de siempre lleva receta
    expect(pasosDe(hechos({ tipo: "MP", seProduce: true }))).toEqual(["datos", "receta"]);
  });

  it("una Reventa no tiene el paso de receta ni lo pide («sin receta no se vende» no le corresponde) y conserva los de venta", () => {
    const h = hechos({ claseDeUso: "REVENTA" });
    expect(pasosDe(h)).toEqual(["datos", "precios", "opciones", "en-la-carta"]);
    expect(pendientesDelProducto(h).receta).toEqual({ tipo: "sin-dato" });
    // El PV común con el mismo dato de receta sí lo pide.
    expect(pendientesDelProducto(hechos({ claseDeUso: "VENDIBLE" })).receta).toEqual({ tipo: "pendiente", texto: "sin receta no se vende" });
  });

  it("a una Reventa sin precio le falta el precio (pendiente de completar), como a cualquier producto de venta", () => {
    expect(pendientesDelProducto(hechos({ claseDeUso: "REVENTA", precioDeVenta: 0 })).precios).toEqual({ tipo: "pendiente", texto: "Falta el precio de venta" });
  });
});
