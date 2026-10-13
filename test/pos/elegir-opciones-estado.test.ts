import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import {
  claveDeConfiguracion,
  elegidasParaPedir,
  estadoInicialElegirOpciones,
  grupoCompleto,
  gruposQueFaltan,
  reducirElegirOpciones,
  resumenDeConfiguracion,
  type AccionElegirOpciones,
  type EstadoElegirOpciones,
} from "../../src/core/pos/elegir-opciones-estado";
import { estadoInicialListaPorAgregar, itemsDeListaPorAgregar, reducirListaPorAgregar } from "../../src/core/pos/agregar-lista-estado";
import { vistaPreviaDeConfiguracion } from "../../src/core/pos/precio-de-configuracion";

/**
 * GO-2d: el estado PURO del diálogo «Elegir opciones» del POS y la línea por configuración de «Por agregar». Propiedades: el ORDEN en que se elige no cambia lo elegido ni el precio;
 * nunca se pasa un tope ni un máximo; lo obligatorio se exige; una opción agotada no se puede elegir. Y la lista: cada configuración es su línea, la misma se acumula, y una línea
 * sin opciones se comporta exactamente como siempre.
 */

function opcion(opcionId: string, nombre: string, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId,
    nombre,
    orden: 0,
    activa: true,
    admitida: true,
    apagadaEnSucursal: false,
    cantidadMaxima: 1,
    versionVigenteId: `v-${opcionId}`,
    esNinguna: false,
    productoAnclaId: null,
    diferenciaDeLaVersion: { tipo: "MONTO", monto: 0 },
    factorEscala: null,
    consumos: [],
    precioAbsoluto: null,
    diferenciaDelProducto: null,
    precioDeSucursal: null,
    ...extra,
  };
}
const grupo = (grupoId: string, tipo: GrupoParaVender["tipo"], cantidadMinima: number, cantidadMaxima: number, opciones: OpcionParaVender[]): GrupoParaVender => ({
  grupoId,
  nombre: grupoId,
  tipo,
  activo: true,
  admitido: true,
  cantidadMinima,
  cantidadMaxima,
  orden: 0,
  modoPrecio: tipo === "MEDIDA" ? "DIFERENCIA" : null,
  opciones,
});

const TAMANO = grupo("Tamaño", "MEDIDA", 1, 1, [opcion("chico", "Chico", { diferenciaDeLaVersion: { tipo: "MONTO", monto: -300 } }), opcion("mediano", "Mediano"), opcion("grande", "Grande", { diferenciaDeLaVersion: { tipo: "MONTO", monto: 300 } })]);
const LECHE = grupo("Preparación", "VARIANTE", 0, 1, [opcion("solo", "Solo"), opcion("con-leche", "Con leche", { diferenciaDeLaVersion: { tipo: "MONTO", monto: 400 } })]);
const GUARNICION = grupo("Guarnición", "INCLUIDA", 1, 1, [opcion("papas", "Papas fritas", { apagadaEnSucursal: true }), opcion("pure", "Puré"), opcion("sin", "Sin guarnición", { esNinguna: true })]);
const EXTRAS = grupo("Adicionales", "ADICIONAL", 0, 3, [opcion("huevo", "Huevo frito", { cantidadMaxima: 2, diferenciaDeLaVersion: { tipo: "MONTO", monto: 600 }, productoAnclaId: "a-huevo" }), opcion("queso", "Queso", { cantidadMaxima: 3, diferenciaDeLaVersion: { tipo: "MONTO", monto: 500 }, productoAnclaId: "a-queso" })]);
const GRUPOS = [TAMANO, LECHE, GUARNICION, EXTRAS];

const correr = (acciones: AccionElegirOpciones[], desde: EstadoElegirOpciones = estadoInicialElegirOpciones()) => acciones.reduce(reducirElegirOpciones, desde);

describe("reducirElegirOpciones", () => {
  it("en un grupo de una sola elección, elegir reemplaza (como un radio); una agotada no se puede elegir", () => {
    const e = correr([
      { tipo: "elegir", grupo: TAMANO, opcionId: "chico" },
      { tipo: "elegir", grupo: TAMANO, opcionId: "grande" },
      { tipo: "elegir", grupo: GUARNICION, opcionId: "papas" },
    ]);
    expect(e.elegidas).toEqual({ grande: 1 });
    expect(gruposQueFaltan(e, GRUPOS).map((g) => g.nombre)).toEqual(["Guarnición"]);
  });

  it("en uno de varias, se suma sin pasar el tope de la opción ni el máximo del grupo, y se resta", () => {
    const sumar = (opcionId: string): AccionElegirOpciones => ({ tipo: "sumar", grupo: EXTRAS, opcionId });
    const e = correr([sumar("huevo"), sumar("huevo"), sumar("huevo"), sumar("queso"), sumar("queso")]);
    expect(e.elegidas).toEqual({ huevo: 2, queso: 1 });
    expect(grupoCompleto(e, EXTRAS)).toBe(true);
    expect(correr([{ tipo: "restar", opcionId: "huevo" }, { tipo: "restar", opcionId: "queso" }], e).elegidas).toEqual({ huevo: 1 });
  });

  it("la cantidad del producto va de 1 en 1 y nunca baja de 1", () => {
    expect(correr([{ tipo: "cantidad", delta: -1 }]).cantidad).toBe(1);
    expect(correr([{ tipo: "cantidad", delta: 1 }, { tipo: "cantidad", delta: 1 }]).cantidad).toBe(3);
  });

  it("precargar (lo más pedido, «Otro igual») deja solo lo que hoy se puede elegir, con su tope", () => {
    const e = correr([{ tipo: "precargar", grupos: GRUPOS, elegidas: [{ opcionId: "mediano", cantidad: 1 }, { opcionId: "papas", cantidad: 1 }, { opcionId: "huevo", cantidad: 5 }, { opcionId: "fantasma", cantidad: 1 }] }]);
    expect(e.elegidas).toEqual({ mediano: 1, huevo: 2 });
  });

  it("lo que se pide va en el orden del producto, con la versión que el mozo vio", () => {
    const e = correr([
      { tipo: "sumar", grupo: EXTRAS, opcionId: "queso" },
      { tipo: "elegir", grupo: GUARNICION, opcionId: "pure" },
      { tipo: "elegir", grupo: TAMANO, opcionId: "mediano" },
    ]);
    expect(elegidasParaPedir(e, GRUPOS)).toEqual([
      { opcionId: "mediano", cantidad: 1, versionDeOpcionId: "v-mediano" },
      { opcionId: "pure", cantidad: 1, versionDeOpcionId: "v-pure" },
      { opcionId: "queso", cantidad: 1, versionDeOpcionId: "v-queso" },
    ]);
  });

  it("PROPIEDAD: el orden en que se elige no cambia lo elegido ni el precio; nunca se pasa un tope; sin lo obligatorio no hay total", () => {
    const eleccion = fc.record({
      tamano: fc.option(fc.constantFrom("chico", "mediano", "grande"), { nil: null }),
      leche: fc.option(fc.constantFrom("solo", "con-leche"), { nil: null }),
      guarnicion: fc.option(fc.constantFrom("papas", "pure", "sin"), { nil: null }),
      huevos: fc.integer({ min: 0, max: 2 }),
      quesos: fc.integer({ min: 0, max: 1 }),
      extraSumas: fc.integer({ min: 0, max: 4 }),
    });
    fc.assert(
      fc.property(eleccion, fc.integer({ min: 0, max: 1_000_000 }), (x, semilla) => {
        const acciones: AccionElegirOpciones[] = [
          ...(x.tamano ? [{ tipo: "elegir" as const, grupo: TAMANO, opcionId: x.tamano }] : []),
          ...(x.leche ? [{ tipo: "elegir" as const, grupo: LECHE, opcionId: x.leche }] : []),
          ...(x.guarnicion ? [{ tipo: "elegir" as const, grupo: GUARNICION, opcionId: x.guarnicion }] : []),
          ...Array.from({ length: x.huevos }, () => ({ tipo: "sumar" as const, grupo: EXTRAS, opcionId: "huevo" })),
          ...Array.from({ length: x.quesos }, () => ({ tipo: "sumar" as const, grupo: EXTRAS, opcionId: "queso" })),
        ];
        // Otro orden de las MISMAS acciones (una permutación determinística por la semilla).
        const otroOrden = acciones.map((a, i) => ({ a, k: (i * 7919 + semilla) % 1009 })).sort((p, q) => p.k - q.k).map((p) => p.a);
        const e = correr(acciones);
        expect(correr(otroOrden).elegidas).toEqual(e.elegidas);
        // Sumar de más nunca pasa los topes (2 huevos; 3 en total en el grupo).
        const conDeMas = correr(Array.from({ length: x.extraSumas }, () => ({ tipo: "sumar" as const, grupo: EXTRAS, opcionId: "huevo" })), e);
        expect(conDeMas.elegidas.huevo ?? 0).toBeLessThanOrEqual(2);
        expect((conDeMas.elegidas.huevo ?? 0) + (conDeMas.elegidas.queso ?? 0)).toBeLessThanOrEqual(3);
        // La agotada nunca queda elegida.
        expect(e.elegidas.papas).toBeUndefined();
        const precio = (y: EstadoElegirOpciones) => vistaPreviaDeConfiguracion({ grupos: GRUPOS, elegidas: elegidasParaPedir(y, GRUPOS), precioBase: 2500, descuentoDeProducto: null, cantidad: 2 });
        expect(precio(correr(otroOrden))).toEqual(precio(e));
        if (gruposQueFaltan(e, GRUPOS).length > 0) expect(precio(e).ok).toBe(false);
        else expect(precio(e).ok).toBe(true);
      }),
      { numRuns: 400 }
    );
  });
});

describe("clave y resumen de una configuración", () => {
  it("la clave no depende del orden y distingue cantidades", () => {
    expect(claveDeConfiguracion("cafe", [{ opcionId: "b", cantidad: 1 }, { opcionId: "a", cantidad: 2 }])).toBe(claveDeConfiguracion("cafe", [{ opcionId: "a", cantidad: 2 }, { opcionId: "b", cantidad: 1 }]));
    expect(claveDeConfiguracion("cafe", [{ opcionId: "a", cantidad: 1 }])).not.toBe(claveDeConfiguracion("cafe", [{ opcionId: "a", cantidad: 2 }]));
    expect(claveDeConfiguracion("cafe", [])).not.toBe(claveDeConfiguracion("te", []));
  });

  it("«Café · Mediano · Con leche · Puré» y aparte «+ Huevo frito ×2»", () => {
    expect(resumenDeConfiguracion("Café", GRUPOS, [{ opcionId: "huevo", cantidad: 2 }, { opcionId: "pure", cantidad: 1 }, { opcionId: "con-leche", cantidad: 1 }, { opcionId: "mediano", cantidad: 1 }])).toEqual({
      titulo: "Café · Mediano · Con leche · Puré",
      adicionales: ["+ Huevo frito ×2"],
    });
    expect(resumenDeConfiguracion("Milanesa", GRUPOS, [{ opcionId: "sin", cantidad: 1 }]).titulo).toBe("Milanesa · Sin guarnición");
  });
});

describe("«Por agregar» con configuraciones", () => {
  const opcionesDe = (...ids: string[]) => ids.map((opcionId) => ({ opcionId, cantidad: 1, versionDeOpcionId: `v-${opcionId}` }));
  const sumarConf = (ids: string[], cantidad = 1) => ({ tipo: "sumarConfiguracion" as const, productoId: "cafe", clave: claveDeConfiguracion("cafe", opcionesDe(...ids)), opciones: opcionesDe(...ids), cantidad, tope: 30 });

  it("cada configuración es su línea, la misma se acumula, y la línea sin opciones del mismo producto es otra", () => {
    let e = estadoInicialListaPorAgregar();
    e = reducirListaPorAgregar(e, sumarConf(["mediano", "con-leche"]));
    e = reducirListaPorAgregar(e, sumarConf(["con-leche", "mediano"], 2));
    e = reducirListaPorAgregar(e, sumarConf(["grande"]));
    e = reducirListaPorAgregar(e, { tipo: "sumarProducto", productoId: "cafe", tope: 30 });
    expect(e.lineas.map((l) => [l.clave ?? "suelto", l.cantidad])).toEqual([
      [claveDeConfiguracion("cafe", opcionesDe("mediano", "con-leche")), 3],
      [claveDeConfiguracion("cafe", opcionesDe("grande")), 1],
      ["suelto", 1],
    ]);
    expect(itemsDeListaPorAgregar(e)).toEqual([
      { productoId: "cafe", cantidad: 3, opciones: opcionesDe("mediano", "con-leche") },
      { productoId: "cafe", cantidad: 1, opciones: opcionesDe("grande") },
      { productoId: "cafe", cantidad: 1 },
    ]);
  });

  it("las acciones de siempre (sin clave) tocan SOLO la línea sin opciones; con clave, solo la de esa configuración", () => {
    let e = estadoInicialListaPorAgregar();
    e = reducirListaPorAgregar(e, sumarConf(["mediano"]));
    e = reducirListaPorAgregar(e, { tipo: "sumarProducto", productoId: "cafe", tope: 30 });
    e = reducirListaPorAgregar(e, { tipo: "incrementar", productoId: "cafe" });
    e = reducirListaPorAgregar(e, { tipo: "incrementar", productoId: "cafe", clave: claveDeConfiguracion("cafe", opcionesDe("mediano")) });
    e = reducirListaPorAgregar(e, { tipo: "incrementar", productoId: "cafe", clave: claveDeConfiguracion("cafe", opcionesDe("mediano")) });
    expect(e.lineas.map((l) => [l.clave ? "conf" : "suelto", l.cantidad])).toEqual([["conf", 3], ["suelto", 2]]);
    e = reducirListaPorAgregar(e, { tipo: "quitarLinea", productoId: "cafe" });
    expect(e.lineas.map((l) => (l.clave ? "conf" : "suelto"))).toEqual(["conf"]);
    e = reducirListaPorAgregar(e, { tipo: "quitarLinea", productoId: "cafe", clave: claveDeConfiguracion("cafe", opcionesDe("mediano")) });
    expect(e.lineas).toEqual([]);
  });

  it("con la lista llena no entra una configuración NUEVA, pero la que ya está se acumula", () => {
    let e = estadoInicialListaPorAgregar();
    e = reducirListaPorAgregar(e, { ...sumarConf(["chico"]), tope: 1 });
    e = reducirListaPorAgregar(e, { ...sumarConf(["grande"]), tope: 1 });
    e = reducirListaPorAgregar(e, { ...sumarConf(["chico"]), tope: 1 });
    expect(e.lineas.map((l) => l.cantidad)).toEqual([2]);
  });
});
