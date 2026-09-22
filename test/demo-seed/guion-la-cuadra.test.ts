import { describe, expect, it } from "vitest";
import { crearGeneradorAleatorio } from "../../scripts/demo-seed/prng";
import { calcularTotalesEsperados, validarGuion, type EventoDemo, type GuionDemo } from "../../scripts/demo-seed/guion";
import { generarGuionLaCuadra, necesidadSemanal, generarMultiplicadoresSemanales, construirMultiplicadoresPorPV, CONFIG_LA_CUADRA_DEFAULT } from "../../scripts/demo-seed/guion-la-cuadra";
import { PRODUCTOS } from "../../scripts/seed-demo-pizzeria-data";

const PRECIO_VENTA_POR_CODIGO = new Map(PRODUCTOS.filter((p) => p.tipo === "PV" && p.activo).map((p) => [p.codigo, p.precioVenta]));

function porTipo<T extends EventoDemo["tipo"]>(guion: GuionDemo, tipo: T): Extract<EventoDemo, { tipo: T }>[] {
  return guion.eventos.filter((e): e is Extract<EventoDemo, { tipo: T }> => e.tipo === tipo);
}

describe("generarGuionLaCuadra", () => {
  it("es determinístico: la misma semilla da SIEMPRE el mismo guion", () => {
    const guionA = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(2026));
    const guionB = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(2026));
    expect(guionA).toEqual(guionB);
  });

  it("semillas distintas dan guiones distintos", () => {
    const guionA = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const guionB = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(2));
    expect(guionA).not.toEqual(guionB);
  });

  it("el guion resultante pasa validarGuion sin problemas (refs únicas, orden cronológico, referencias resueltas)", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    expect(validarGuion(guion)).toEqual([]);
  });

  it("rechaza una configuración que no deja tramo ordenado real después del desorden", () => {
    expect(() => generarGuionLaCuadra({ semanas: 8, semanasDeDesorden: 5 }, crearGeneradorAleatorio(1))).toThrow();
  });

  it("genera eventos de VENTA todos los días de las 26 semanas (salvo días sin ninguna venta > 0, algo raro pero posible)", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const ventas = porTipo(guion, "VENTA");
    expect(ventas.length).toBeGreaterThan(300); // 26 semanas × 7 días × ~2 secciones, con margen
  });

  it("las ventas del tramo de desorden vienen marcadas sinCostoCongelado; las del tramo ordenado no", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const ventas = porTipo(guion, "VENTA");
    const deDesorden = ventas.filter((v) => v.semana < CONFIG_LA_CUADRA_DEFAULT.semanasDeDesorden);
    const deOrden = ventas.filter((v) => v.semana >= CONFIG_LA_CUADRA_DEFAULT.semanasDeDesorden);
    expect(deDesorden.length).toBeGreaterThan(0);
    expect(deOrden.length).toBeGreaterThan(0);
    expect(deDesorden.every((v) => v.sinCostoCongelado === true)).toBe(true);
    expect(deOrden.every((v) => !v.sinCostoCongelado)).toBe(true);
  });

  it("carga la receta de PV020 tarde (dentro del tramo de desorden), no en la semana 0 — el mecanismo de 'ventas sin costo congelado'", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const recetas = porTipo(guion, "CREAR_RECETA");
    expect(recetas).toHaveLength(1);
    expect(recetas[0]!.productoCodigo).toBe("PV020");
    expect(recetas[0]!.semana).toBeGreaterThan(0);
    expect(recetas[0]!.semana).toBeLessThan(CONFIG_LA_CUADRA_DEFAULT.semanasDeDesorden);
  });

  it("tiene exactamente 3 conteos físicos, con los tres perfiles pedidos por §5 (bien calibrado / ruidoso por lote / merma real), uno en cada extremo de la ventana", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const conteos = porTipo(guion, "CONTEO_FISICO");
    expect(conteos).toHaveLength(3);
    conteos.sort((a, b) => a.semana - b.semana);
    // Bien calibrado: cerca del inicio, ajuste chico.
    expect(Math.abs(conteos[0]!.ajusteRelativo)).toBeLessThan(1);
    // Merma real: cerca del final (últimas semanas de la ventana de 6 meses).
    expect(conteos[2]!.semana).toBeGreaterThan(CONFIG_LA_CUADRA_DEFAULT.semanas - 6);
    expect(Math.abs(conteos[2]!.ajusteRelativo)).toBeGreaterThan(1);
    // Los tres en secciones/productos distintos.
    expect(new Set(conteos.map((c) => c.productoCodigo)).size).toBe(3);
  });

  it("tiene exactamente 1 merma", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    expect(porTipo(guion, "MERMA")).toHaveLength(1);
  });

  it("tiene exactamente 1 anulación y 1 corrección de compra, sobre compras DISTINTAS, en la semana siguiente a cuando se sembraron", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const anulaciones = porTipo(guion, "ANULAR_COMPRA");
    const correcciones = porTipo(guion, "CORREGIR_COMPRA");
    expect(anulaciones).toHaveLength(1);
    expect(correcciones).toHaveLength(1);
    expect(anulaciones[0]!.refCompra).not.toBe(correcciones[0]!.refCompra);
    expect(anulaciones[0]!.semana).toBe(correcciones[0]!.semana);
  });

  it("siembra stock inicial (día -1 de la semana 0), antes de la primera venta — sin esto, el domingo de la semana 0 se queda sin stock (las primeras compras programadas recién caen martes/miércoles)", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const stockInicial = guion.eventos.filter((e) => e.diaSemana === -1);
    expect(stockInicial.length).toBeGreaterThan(0);
    expect(stockInicial.every((e) => e.semana === 0)).toBe(true);
    // Es el PRIMER evento del guion en orden (día -1 < día 0): valida el orden cronológico también acá.
    expect(guion.eventos[0]!.diaSemana).toBe(-1);
    // Cubre MP directos (compra) y los intermedios que se producen (MPZ01/MPZ02/PV030).
    const compraInicial = stockInicial.find((e) => e.tipo === "COMPRA");
    expect(compraInicial).toBeDefined();
    const produccionInicial = stockInicial.filter((e) => e.tipo === "PRODUCCION").map((e) => (e as { productoCodigo: string }).productoCodigo);
    expect(produccionInicial).toEqual(expect.arrayContaining(["MPZ01", "MPZ02", "PV030"]));
  });

  it("al menos un lote de compra queda con loteVencimiento cargado", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const compras = porTipo(guion, "COMPRA");
    const conVencimiento = compras.flatMap((c) => c.items).filter((it) => it.loteVencimiento);
    expect(conVencimiento.length).toBeGreaterThan(0);
  });

  it("el bug del proveedor alternativo está corregido: cuando MP001 sale de un proveedor distinto del habitual, esa compra es SU PROPIA Operación (no mezclada con el resto de PRV_HARINAS)", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    // Fuera del stock inicial (día -1): esa compra agrupa TODO lo que hace falta tener a mano antes de arrancar, de
    // cualquier proveedor de referencia — no es la sustitución periódica que este test verifica.
    const compras = porTipo(guion, "COMPRA").filter((c) => c.nroFactura !== "STOCK-INICIAL");
    const conMP001 = compras.filter((c) => c.items.some((it) => it.productoCodigo === "MP001"));
    // Tiene que haber al menos una compra de MP001 a un proveedor que NO es PRV_HARINAS (la sustitución se disparó alguna vez en 26 semanas).
    const sustituidas = conMP001.filter((c) => c.proveedorCodigo !== "PRV_HARINAS");
    expect(sustituidas.length).toBeGreaterThan(0);
    for (const c of sustituidas) {
      // Esa Operación queda a nombre del proveedor REAL (no del habitual), y con SOLO ese insumo — nunca mezclada.
      expect(c.proveedorCodigo).not.toBe("PRV_HARINAS");
      expect(c.items).toHaveLength(1);
      expect(c.items[0]!.productoCodigo).toBe("MP001");
    }
  });

  it("los precios de compra suben con el tiempo (inflación de la serie): el promedio del último mes es mayor que el del primero, para un insumo de compra frecuente", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const comprasMuzza = porTipo(guion, "COMPRA")
      .flatMap((c) => c.items.map((it) => ({ semana: c.semana, ...it })))
      .filter((it) => it.productoCodigo === "MP006");
    const primerMes = comprasMuzza.filter((it) => it.semana < 4);
    const ultimoMes = comprasMuzza.filter((it) => it.semana >= CONFIG_LA_CUADRA_DEFAULT.semanas - 4);
    const promedio = (xs: typeof comprasMuzza) => xs.reduce((a, b) => a + b.precioUnitario, 0) / xs.length;
    expect(promedio(ultimoMes)).toBeGreaterThan(promedio(primerMes));
  });

  it("calcularTotalesEsperados corre sin tirar error sobre el guion completo, y da totales positivos y razonables", () => {
    const guion = generarGuionLaCuadra(CONFIG_LA_CUADRA_DEFAULT, crearGeneradorAleatorio(1));
    const totales = calcularTotalesEsperados(guion, PRECIO_VENTA_POR_CODIGO);
    expect(totales.compras.totalGastado).toBeGreaterThan(0);
    expect(totales.compras.cantidadCompras).toBeGreaterThan(0);
    expect(totales.ventas.totalFacturado).toBeGreaterThan(0);
    // La anulación excluyó una compra: cantidadCompras cuenta menos que la cantidad TOTAL de eventos COMPRA del guion.
    expect(totales.compras.cantidadCompras).toBeLessThan(porTipo(guion, "COMPRA").length);
  });
});

describe("necesidadSemanal", () => {
  it("nunca da cantidades negativas ni NaN, para cualquier semana del guion default", () => {
    const rand = crearGeneradorAleatorio(1);
    const multiplicadores = construirMultiplicadoresPorPV(rand, CONFIG_LA_CUADRA_DEFAULT.semanas);
    for (let semana = 0; semana < CONFIG_LA_CUADRA_DEFAULT.semanas; semana++) {
      const { directa, produccion } = necesidadSemanal(semana, multiplicadores);
      for (const v of Object.values(directa)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(v)).toBe(false);
      }
      for (const v of Object.values(produccion)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("generarMultiplicadoresSemanales", () => {
  it("es determinístico y queda acotado a [0.45, 1.8]", () => {
    const a = generarMultiplicadoresSemanales(crearGeneradorAleatorio(5), 26);
    const b = generarMultiplicadoresSemanales(crearGeneradorAleatorio(5), 26);
    expect(a).toEqual(b);
    for (const m of a) {
      expect(m).toBeGreaterThanOrEqual(0.45);
      expect(m).toBeLessThanOrEqual(1.8);
    }
  });
});
