import { describe, expect, it } from "vitest";
import {
  CLASES_COMPRABLES,
  CLASES_DE_PRODUCTO,
  cuentaEnElFoodCost,
  decidirSobreClase,
  DESCRIPCION_DE_CLASE,
  esClaseComprable,
  esClaseDeProducto,
  MOTIVOS_DE_RECHAZO_DE_CLASE,
  NOMBRE_DE_CLASE,
  OPERACIONES_DE_CLASE,
  seConsumeLaClase,
  vendeLaClase,
  type EntradaDeClase,
} from "@/core/catalogo/clases-de-producto";
import { FILAS_DEL_ORACULO, ORDEN_DE_PEDERNAL, REGLAS_POR_OPERACION, TEXTOS_DE_PEDERNAL } from "./clases-de-producto-oraculo";

/** Docs: docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md §10.1. Núcleo puro sin base: el recorrido es exhaustivo. */
function* todasLasEntradas(): Generator<EntradaDeClase> {
  for (const clase of CLASES_DE_PRODUCTO) for (const operacion of OPERACIONES_DE_CLASE) for (const seProduce of [false, true]) yield { clase, operacion, hechos: { seProduce } };
}

describe("decidirSobreClase contra el oráculo (recorrido exhaustivo)", () => {
  it("son 5 clases × 9 operaciones × 2 valores de «se produce» = 90 combinaciones", () => {
    expect([...todasLasEntradas()]).toHaveLength(90);
  });

  it("cada combinación da lo que dice el oráculo: permitida, o rechazada con el motivo esperado", () => {
    for (const e of todasLasEntradas()) {
      const regla = REGLAS_POR_OPERACION[e.operacion];
      const esperado = regla.permitido(FILAS_DEL_ORACULO[e.clase], e.clase, e.hechos.seProduce) ? "permitido" : regla.motivo(e.clase);
      const real = decidirSobreClase(e);
      expect(real.ok ? "permitido" : real.motivo, `${e.operacion} / ${e.clase} / seProduce=${e.hechos.seProduce} (${regla.texto})`).toBe(esperado);
    }
  });

  it("«se produce» solo cambia una decisión: el stock propio del vendible", () => {
    for (const e of todasLasEntradas()) {
      const otro: EntradaDeClase = { ...e, hechos: { seProduce: !e.hechos.seProduce } };
      const cambia = JSON.stringify(decidirSobreClase(otro)) !== JSON.stringify(decidirSobreClase(e));
      expect(cambia, `${e.operacion} / ${e.clase}`).toBe(e.operacion === "tener_stock_propio" && e.clase === "VENDIBLE");
    }
  });

  it("los motivos son un conjunto cerrado: todos los motivos de datos aparecen en el recorrido, más los dos de entrada desconocida", () => {
    const usados = new Set<string>();
    for (const e of todasLasEntradas()) {
      const d = decidirSobreClase(e);
      if (!d.ok) usados.add(d.motivo);
    }
    usados.add("CLASE_DESCONOCIDA");
    usados.add("OPERACION_DESCONOCIDA");
    expect([...usados].sort()).toEqual([...MOTIVOS_DE_RECHAZO_DE_CLASE].sort());
  });

  it("falla cerrado: una clase o una operación desconocida (llegadas de afuera) se rechaza", () => {
    const hechos = { seProduce: false };
    expect(decidirSobreClase({ clase: "SERVICIO", operacion: "vender", hechos } as unknown as EntradaDeClase)).toEqual({ ok: false, motivo: "CLASE_DESCONOCIDA" });
    expect(decidirSobreClase({ clase: undefined, operacion: "vender", hechos } as unknown as EntradaDeClase)).toEqual({ ok: false, motivo: "CLASE_DESCONOCIDA" });
    expect(decidirSobreClase({ clase: "REVENTA", operacion: "inventada", hechos } as unknown as EntradaDeClase)).toEqual({ ok: false, motivo: "OPERACION_DESCONOCIDA" });
    expect(decidirSobreClase({ clase: "REVENTA", operacion: undefined, hechos } as unknown as EntradaDeClase)).toEqual({ ok: false, motivo: "OPERACION_DESCONOCIDA" });
  });

  it("es repetible: la misma entrada da siempre la misma decisión (idempotencia de una función pura)", () => {
    for (const e of todasLasEntradas()) expect(decidirSobreClase(e)).toEqual(decidirSobreClase({ ...e, hechos: { ...e.hechos } }));
  });

  it("no hay estado compartido: dos llamadas intercaladas (concurrencia de una función pura) no se pisan", () => {
    const a: EntradaDeClase = { clase: "INSUMO", operacion: "entrar_en_receta", hechos: { seProduce: false } };
    const b: EntradaDeClase = { clase: "MATERIA_PRIMA", operacion: "entrar_en_receta", hechos: { seProduce: false } };
    const resultados = [a, b, a, b].map(decidirSobreClase);
    expect(resultados).toEqual([{ ok: false, motivo: "COMPONENTE_ES_INSUMO" }, { ok: true }, { ok: false, motivo: "COMPONENTE_ES_INSUMO" }, { ok: true }]);
  });
});

describe("las cinco clases y sus textos (literales de Pedernal)", () => {
  it("son cinco, en el orden de Pedernal", () => {
    expect([...CLASES_DE_PRODUCTO]).toEqual([...ORDEN_DE_PEDERNAL]);
  });
  it("el nombre y la descripción corta de cada clase son los de Pedernal, palabra por palabra", () => {
    for (const clase of CLASES_DE_PRODUCTO) {
      expect(NOMBRE_DE_CLASE[clase]).toBe(TEXTOS_DE_PEDERNAL[clase].nombre);
      expect(DESCRIPCION_DE_CLASE[clase]).toBe(TEXTOS_DE_PEDERNAL[clase].descripcion);
    }
  });
  it("esClaseDeProducto es lista de permitidos: solo los cinco valores exactos", () => {
    for (const c of CLASES_DE_PRODUCTO) expect(esClaseDeProducto(c)).toBe(true);
    for (const raro of ["", "materia_prima", " REVENTA", "REVENTA ", "SERVICIO", "BIEN", null, undefined, 3, {}]) expect(esClaseDeProducto(raro)).toBe(false);
  });
  it("los predicados sueltos coinciden con el oráculo", () => {
    for (const c of CLASES_DE_PRODUCTO) {
      const fila = FILAS_DEL_ORACULO[c];
      expect(vendeLaClase(c)).toBe(fila.vende);
      expect(esClaseComprable(c)).toBe(fila.seCompra);
      expect(seConsumeLaClase(c)).toBe(fila.loConsumeUnaOpcion);
      expect(cuentaEnElFoodCost(c)).toBe(fila.cuentaEnElFoodCost);
    }
    expect([...CLASES_COMPRABLES]).toEqual(["MATERIA_PRIMA", "INSUMO", "REVENTA"]);
  });
  it("una clase que vende no puede ser la que se produce sin receta, ni una comprable que lleve receta (coherencia entre columnas)", () => {
    for (const c of CLASES_DE_PRODUCTO) {
      const f = FILAS_DEL_ORACULO[c];
      expect(f.llevaReceta, c).toBe(f.sePuedeProducir); // lo que se produce lleva receta y viceversa
      expect(f.seCompra && f.llevaReceta, c).toBe(false); // lo que se compra no lleva composición propia
    }
  });
});
