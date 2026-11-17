import { beforeEach, describe, expect, it, vi } from "vitest";

// El interruptor de las presentaciones está apagado en producción (decisión del dueño, 2026-11-06): se prende SOLO en esta prueba para que el paso «Cómo se compra» sea observable.
vi.mock("../../src/core/catalogo/presentaciones-visibles", async (original) => ({ ...(await original<typeof import("../../src/core/catalogo/presentaciones-visibles")>()), PRESENTACIONES_VISIBLES: true }));

import type { TipoProducto } from "../../src/core/datos/enumerados-del-esquema";
import { productoValidoParaProceso } from "../../src/core/movimientos/transiciones";
import { guardAlicuotaIvaDelProducto } from "../../src/core/features/catalogo/productos.guard";
import { capacidadesDelProducto, pasosDelEspacio, whereSeCompra, type AccesoAlEspacio, type EstadoDelPaso, type PasoDelEspacio } from "../../src/core/catalogo/public";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin, sembrarCatalogoBase } from "../setup/test-db";
import { esperadoPara } from "./capacidades-del-producto-oraculo";

/**
 * E4-2 de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7 y §8): el circuito de COMPRA decide «se puede comprar» con `capacidadesDelProducto(...).seCompra`. Esta prueba recorre TODAS las combinaciones
 * tipo × se produce × clase de uso × consignación contra el ORÁCULO escrito aparte (`capacidades-del-producto-oraculo.ts`) y fija:
 *  (a) `productoValidoParaProceso("COMPRA", …)` da lo del oráculo, y para todo lo que existe hoy (cualquier clase que no sea REVENTA) da lo de SIEMPRE: solo una MP se compra;
 *  (b) la guardia de IVA admite la alícuota de venta donde el oráculo dice que se vende y la de compra donde dice que se compra (una REVENTA, las dos); sin `claseDeUso` es la de siempre;
 *  (c) el `where` del selector (`whereSeCompra`), sobre Postgres real, trae EXACTAMENTE los productos que la función dice que se compran (las combinaciones incoherentes no se pueden guardar: lo impiden los CHECK).
 */
const TIPOS = ["MP", "PV", "mp", "", "SERVICIO"] as const;
const SE_PRODUCE = [true, false] as const;
const CLASES: ReadonlyArray<string | null | undefined> = [undefined, null, "", "MATERIA_PRIMA", "INSUMO", "ELABORADO", "VENDIBLE", "REVENTA", "reventa", "foo"];
const COMBINACIONES = TIPOS.flatMap((tipo) => SE_PRODUCE.flatMap((seProduce) => CLASES.flatMap((claseDeUso) => [false, true].map((esConsignacion) => ({ tipo, seProduce, claseDeUso, esConsignacion })))));

describe("COMPRA: productoValidoParaProceso contra el oráculo", () => {
  it("recorre todas las combinaciones (sanidad: no pasa en vacío)", () => {
    expect(COMBINACIONES).toHaveLength(TIPOS.length * SE_PRODUCE.length * CLASES.length * 2);
  });

  it.each(COMBINACIONES)("tipo «$tipo», se produce $seProduce, clase «$claseDeUso», consignación $esConsignacion", ({ tipo, seProduce, claseDeUso, esConsignacion }) => {
    const r = productoValidoParaProceso("COMPRA", { tipo: tipo as TipoProducto, seProduce, esConsignacion, claseDeUso });
    expect(r).toBe(esperadoPara(tipo, seProduce, claseDeUso).seCompra);
  });

  it("equivalencia con lo de siempre: sin REVENTA, solo una MP se compra (con o sin clase, se produzca o no)", () => {
    for (const claseDeUso of [undefined, null, "MATERIA_PRIMA", "INSUMO", "ELABORADO", "VENDIBLE", "reventa", ""]) {
      for (const seProduce of SE_PRODUCE) {
        expect(productoValidoParaProceso("COMPRA", { tipo: "MP", seProduce, esConsignacion: false, claseDeUso })).toBe(true);
        expect(productoValidoParaProceso("COMPRA", { tipo: "PV", seProduce, esConsignacion: false, claseDeUso })).toBe(false);
      }
    }
    // Sin el campo (como lo llamaban todos hasta ahora).
    expect(productoValidoParaProceso("COMPRA", { tipo: "MP", seProduce: false, esConsignacion: false })).toBe(true);
    expect(productoValidoParaProceso("COMPRA", { tipo: "PV", seProduce: false, esConsignacion: false })).toBe(false);
  });

  it("una REVENTA coherente (PV, no se produce) se compra; incoherente (MP o se produce) y cualquier tipo desconocido, no (todo nace cerrado)", () => {
    expect(productoValidoParaProceso("COMPRA", { tipo: "PV", seProduce: false, esConsignacion: false, claseDeUso: "REVENTA" })).toBe(true);
    expect(productoValidoParaProceso("COMPRA", { tipo: "MP", seProduce: false, esConsignacion: false, claseDeUso: "REVENTA" })).toBe(false);
    expect(productoValidoParaProceso("COMPRA", { tipo: "PV", seProduce: true, esConsignacion: false, claseDeUso: "REVENTA" })).toBe(false);
    expect(productoValidoParaProceso("COMPRA", { tipo: "SERVICIO" as TipoProducto, seProduce: false, esConsignacion: false, claseDeUso: "REVENTA" })).toBe(false);
  });

  it("la REVENTA no altera la regla de PRODUCCION; CONSUMO pasó a admitirla en E4-3a (lleva stock propio, `stock-propio-equivalencia.test.ts`)", () => {
    const reventa = { tipo: "PV" as const, seProduce: false, esConsignacion: false, claseDeUso: "REVENTA" };
    expect(productoValidoParaProceso("PRODUCCION", reventa)).toBe(false);
    expect(productoValidoParaProceso("CONSUMO", reventa)).toBe(true);
  });
});

describe("guardia de IVA del producto contra el oráculo", () => {
  const SE_PRODUCE_DE_ENTRADA = [undefined, true, false] as const;
  const casos = TIPOS.flatMap((tipo) => SE_PRODUCE_DE_ENTRADA.flatMap((seProduce) => CLASES.map((claseDeUso) => ({ tipo, seProduce, claseDeUso }))));

  it.each(casos)("tipo «$tipo», se produce $seProduce, clase «$claseDeUso»: la de venta donde se vende, la de compra donde se compra", ({ tipo, seProduce, claseDeUso }) => {
    // Lo que el oráculo espera: una REVENTA solo cuenta con `seProduce` dicho en false; para MP y PV el «se produce» no cambia la alícuota.
    const esperado = esperadoPara(tipo, seProduce !== false, claseDeUso);
    expect(guardAlicuotaIvaDelProducto({ tipo, seProduce, claseDeUso, alicuotaIvaVenta: "IVA_21" }).ok).toBe(esperado.seVende);
    expect(guardAlicuotaIvaDelProducto({ tipo, seProduce, claseDeUso, alicuotaIvaCompra: "IVA_21" }).ok).toBe(esperado.seCompra);
  });

  it("una REVENTA lleva alícuota de venta Y de compra, a la vez", () => {
    expect(guardAlicuotaIvaDelProducto({ tipo: "PV", seProduce: false, claseDeUso: "REVENTA", alicuotaIvaVenta: "IVA_21", alicuotaIvaCompra: "IVA_10_5" }).ok).toBe(true);
  });

  it("sin clase ni «se produce» (como lo llaman hoy) es lo de siempre: un PV solo venta, una MP solo compra", () => {
    expect(guardAlicuotaIvaDelProducto({ tipo: "PV", alicuotaIvaVenta: "IVA_21", alicuotaIvaCompra: "IVA_21" }).ok).toBe(false);
    expect(guardAlicuotaIvaDelProducto({ tipo: "MP", alicuotaIvaVenta: "IVA_21", alicuotaIvaCompra: "IVA_21" }).ok).toBe(false);
    expect(guardAlicuotaIvaDelProducto({ tipo: "PV", alicuotaIvaVenta: "IVA_21" }).ok).toBe(true);
    expect(guardAlicuotaIvaDelProducto({ tipo: "MP", alicuotaIvaCompra: "IVA_21" }).ok).toBe(true);
  });
});

describe("el paso «Cómo se compra» de la ficha (pasosDelEspacio) contra el oráculo", () => {
  const ACCESO: AccesoAlEspacio = { datos: true, ver: true, opciones: true, receta: "si", carta: "si" };
  const SIN_DATO: Record<PasoDelEspacio, EstadoDelPaso> = { datos: { tipo: "sin-dato" }, precios: { tipo: "sin-dato" }, opciones: { tipo: "sin-dato" }, compra: { tipo: "sin-dato" }, receta: { tipo: "sin-dato" }, "en-la-carta": { tipo: "sin-dato" } };
  const formas = (["MP", "PV"] as const).flatMap((tipo) => SE_PRODUCE.flatMap((seProduce) => CLASES.map((claseDeUso) => ({ tipo, seProduce, claseDeUso }))));

  it.each(formas)("tipo «$tipo», se produce $seProduce, clase «$claseDeUso»: el paso aparece si se compra (con las presentaciones prendidas en la prueba)", ({ tipo, seProduce, claseDeUso }) => {
    const pasos = pasosDelEspacio("p1", { tipo, seProduce, claseDeUso, esAnclaDeAdicional: false }, ACCESO, SIN_DATO);
    expect(pasos.some((p) => p.paso === "compra")).toBe(esperadoPara(tipo, seProduce, claseDeUso).seCompra);
  });
});

describe("el where del selector de COMPRA (whereSeCompra) contra la función, sobre Postgres real", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("trae exactamente los productos que `capacidadesDelProducto` dice que se compran, en cada combinación que la base admite", async () => {
    const { kg } = await sembrarCatalogoBase();
    // Lo que los CHECK de la base dejan guardar: MP (sin clase, MATERIA_PRIMA, INSUMO; ELABORADO solo si se produce) y PV (sin clase, VENDIBLE; REVENTA solo si no se produce).
    const forma: Array<{ tipo: "MP" | "PV"; seProduce: boolean; claseDeUso: string | null }> = [
      { tipo: "MP", seProduce: false, claseDeUso: null },
      { tipo: "MP", seProduce: false, claseDeUso: "MATERIA_PRIMA" },
      { tipo: "MP", seProduce: false, claseDeUso: "INSUMO" },
      { tipo: "MP", seProduce: true, claseDeUso: null },
      { tipo: "MP", seProduce: true, claseDeUso: "ELABORADO" },
      { tipo: "PV", seProduce: false, claseDeUso: null },
      { tipo: "PV", seProduce: false, claseDeUso: "VENDIBLE" },
      { tipo: "PV", seProduce: false, claseDeUso: "REVENTA" },
      { tipo: "PV", seProduce: true, claseDeUso: null },
      { tipo: "PV", seProduce: true, claseDeUso: "VENDIBLE" },
    ];
    for (const [i, f] of forma.entries()) {
      await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, codigo: `X${i}`, nombre: `Producto ${i}`, tipo: f.tipo, seProduce: f.seProduce, claseDeUso: f.claseDeUso, unidadStockId: kg.id } });
    }
    const traidos = await prismaAdmin.producto.findMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID, AND: [whereSeCompra()] }, select: { codigo: true } });
    const esperados = forma.flatMap((f, i) => (capacidadesDelProducto(f).seCompra ? [`X${i}`] : []));
    expect(traidos.map((p) => p.codigo).sort()).toEqual(esperados.sort());
    expect(esperados).toContain("X7"); // la REVENTA entra al selector
    expect(esperados).not.toContain("X5"); // un PV común no
  });
});
