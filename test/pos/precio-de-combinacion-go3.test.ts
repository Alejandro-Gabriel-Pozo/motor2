import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { armarLineaConfigurada, type CombinacionesDelProducto, type GrupoParaVender, type OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { opcionesConCombinacionApagada, resumenDePreciosConCombinaciones, vistaPreviaDeConfiguracion } from "../../src/core/pos/precio-de-configuracion";
import { combinacionesDesdeMostrar, combinacionesParaMostrar, type CombinacionesParaMostrar } from "../../src/core/pos/combinacion-elegida";
import type { DiferenciaDePrecio } from "../../src/core/opciones/public";

/**
 * GO-3b (ADR-032, F6 paso U5): los precios PARA MOSTRAR de un producto con EJES (`precio-de-configuracion.ts` con sus combinaciones). Lo central es la PARIDAD con la venta: para cualquier
 * configuración y cualquier juego de combinaciones (propio, tarifa, local, aditiva, apagada), la vista previa da EXACTAMENTE el precio (o el rechazo) de `armarLineaConfigurada` — las dos usan
 * `combinacionElegida`. Además: el «desde» y el precio de cada tamaño con un eje, la opción que cae en una combinación apagada (deshabilitada en el diálogo) y la forma serializable de ida y vuelta.
 *
 * Mutaciones demostradas (rojo y revertidas): no pasar las combinaciones a la vista previa (rojo: «PARIDAD»); no marcar la tarifa apagada en `opcionesConCombinacionApagada` (rojo: «tarifa»).
 */

const monto = (m: number): DiferenciaDePrecio => ({ tipo: "MONTO", monto: m });

function opcion(opcionId: string, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId,
    nombre: opcionId,
    orden: 0,
    activa: true,
    admitida: true,
    apagadaEnSucursal: false,
    cantidadMaxima: 3,
    versionVigenteId: `v-${opcionId}`,
    esNinguna: false,
    productoAnclaId: null,
    diferenciaDeLaVersion: monto(0),
    factorEscala: null,
    consumos: [],
    precioAbsoluto: null,
    diferenciaDelProducto: null,
    precioDeSucursal: null,
    ...extra,
  };
}

/** Café: TAMAÑO (eje 1: chico −300, mediano 0, grande +300), LECHE (eje 2 si `dosEjes`: vaca 0, almendras +400) y un adicional (shot +600). Precio base 2500. */
function cafe(dosEjes: boolean): GrupoParaVender[] {
  return [
    { grupoId: "tamano", nombre: "Tamaño", tipo: "MEDIDA", activo: true, admitido: true, cantidadMinima: 1, cantidadMaxima: 1, orden: 0, modoPrecio: "DIFERENCIA", ejeDeCombinacion: 1, opciones: [opcion("chico", { diferenciaDeLaVersion: monto(-300) }), opcion("mediano"), opcion("grande", { diferenciaDeLaVersion: monto(300) })] },
    {
      grupoId: "leche",
      nombre: "Leche",
      tipo: "VARIANTE",
      activo: true,
      admitido: true,
      cantidadMinima: dosEjes ? 1 : 0,
      cantidadMaxima: 1,
      orden: 1,
      modoPrecio: null,
      ...(dosEjes ? { ejeDeCombinacion: 2 } : {}),
      opciones: [opcion("vaca"), opcion("almendras", { diferenciaDeLaVersion: monto(400) })],
    },
    { grupoId: "extras", nombre: "Extras", tipo: "ADICIONAL", activo: true, admitido: true, cantidadMinima: 0, cantidadMaxima: 3, orden: 2, modoPrecio: null, opciones: [opcion("shot", { diferenciaDeLaVersion: monto(600), productoAnclaId: "ancla" })] },
  ];
}

const mostrar = (filas: CombinacionesParaMostrar["filas"], locales: Partial<CombinacionesParaMostrar["locales"]> = {}): CombinacionesParaMostrar => ({
  nombreDelProducto: "Café",
  filas,
  locales: { porCombinacion: locales.porCombinacion ?? {}, porGrupo: locales.porGrupo ?? {} },
});
const fila = (clave: string, extra: Partial<CombinacionesParaMostrar["filas"][number]> = {}): CombinacionesParaMostrar["filas"][number] => ({ clave, combinacionId: `c-${clave}`, activa: true, precio: null, grupo: null, ...extra });

describe("vista previa con combinaciones (GO-3b, U5)", () => {
  it("PARIDAD (propiedad): con cualquier juego de combinaciones, la vista previa da EXACTAMENTE el precio (o el código del rechazo) de la venta", () => {
    const precio = fc.integer({ min: 1, max: 900000 }).map((c) => c / 100);
    const definicion = fc.record({
      activa: fc.boolean(),
      tipo: fc.constantFrom("ADITIVA", "PROPIO", "GRUPO"),
      precio,
      grupoActivo: fc.boolean(),
      local: fc.option(precio, { nil: null }),
    });
    const arbol = fc.record({
      dosEjes: fc.boolean(),
      // Una definición (o ninguna fila) por cada par posible de los ejes.
      definiciones: fc.array(fc.option(definicion, { nil: null }), { minLength: 6, maxLength: 6 }),
      tamano: fc.constantFrom("chico", "mediano", "grande"),
      leche: fc.option(fc.constantFrom("vaca", "almendras"), { nil: null }),
      shot: fc.integer({ min: 0, max: 3 }),
      descuento: fc.option(fc.integer({ min: 1, max: 60 }), { nil: null }),
      cantidad: fc.integer({ min: 1, max: 4 }),
    });
    fc.assert(
      fc.property(arbol, (a) => {
        const grupos = cafe(a.dosEjes);
        const pares = a.dosEjes ? ["chico", "mediano", "grande"].flatMap((t) => ["vaca", "almendras"].map((l) => `${t}|${l}`)) : ["chico|", "mediano|", "grande|"];
        const filas: CombinacionesParaMostrar["filas"] = [];
        const porCombinacion: Record<string, number> = {};
        const porGrupo: Record<string, number> = {};
        pares.forEach((clave, i) => {
          const d = a.definiciones[i];
          if (!d) return;
          const grupo = d.tipo === "GRUPO" ? { grupoDePrecioId: `g-${i}`, nombre: `Tarifa ${i}`, precio: d.precio, activo: d.grupoActivo } : null;
          filas.push(fila(clave, { activa: d.activa, precio: d.tipo === "PROPIO" ? d.precio : null, grupo }));
          if (d.local !== null && d.tipo !== "ADITIVA") {
            if (grupo) porGrupo[grupo.grupoDePrecioId] = d.local;
            else porCombinacion[`c-${clave}`] = d.local;
          }
        });
        const paraMostrar = mostrar(filas, { porCombinacion, porGrupo });
        const elegidas = [{ opcionId: a.tamano, cantidad: 1 }, ...(a.leche ? [{ opcionId: a.leche, cantidad: 1 }] : a.dosEjes ? [{ opcionId: "vaca", cantidad: 1 }] : []), ...(a.shot ? [{ opcionId: "shot", cantidad: a.shot }] : [])];
        const base = { grupos, elegidas, precioBase: 2500, descuentoDeProducto: a.descuento, cantidad: a.cantidad };
        const venta = armarLineaConfigurada({ ...base, combinaciones: combinacionesDesdeMostrar(paraMostrar) });
        const vista = vistaPreviaDeConfiguracion({ ...base, combinaciones: paraMostrar });
        if (!venta.ok) {
          expect(vista.ok).toBe(false);
          if (!vista.ok) expect(vista.codigo).toBe(venta.codigo);
          return;
        }
        expect(vista.ok, JSON.stringify(vista)).toBe(true);
        if (!vista.ok || !venta.linea) return;
        expect([vista.precioUnitario, vista.precioLista]).toEqual([venta.linea.precioUnitario, venta.linea.precioCartaUnitario]);
        expect(vista.adicionales.map((x) => [x.opcionId, x.cantidad, x.precioUnitario])).toEqual(venta.linea.adicionales.map((x) => [x.opcionId, x.cantidad, x.precioUnitario]));
      }),
      { numRuns: 400 },
    );
  });

  it("un producto con ejes y sin las combinaciones falla cerrado, como la venta", () => {
    const v = vistaPreviaDeConfiguracion({ grupos: cafe(false), elegidas: [{ opcionId: "grande", cantidad: 1 }], precioBase: 2500, descuentoDeProducto: null, cantidad: 1 });
    expect(v).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
  });

  it("la forma serializable va y vuelve sin perder nada de lo que decide el precio (la receta no viaja)", () => {
    const original: CombinacionesDelProducto = {
      nombreDelProducto: "Café",
      filas: new Map([["grande|", { combinacionId: "c1", activa: true, precio: 1400, grupo: null, recetaDeCombinacionVersionId: "r1" }]]),
      locales: { porCombinacion: new Map([["c1", 1450]]), porGrupo: new Map() },
    };
    const ida = combinacionesParaMostrar(original);
    expect(JSON.parse(JSON.stringify(ida))).toEqual(ida);
    const vuelta = combinacionesDesdeMostrar(ida);
    expect(vuelta.filas.get("grande|")).toEqual({ combinacionId: "c1", activa: true, precio: 1400, grupo: null, recetaDeCombinacionVersionId: null });
    expect(vuelta.locales.porCombinacion.get("c1")).toBe(1450);
  });
});

describe("lo que el diálogo muestra (GO-3b, U5)", () => {
  it("con UN eje: cada tamaño con el precio de SU combinación, el apagado no se ofrece y el «desde» es el más barato que se puede pedir", () => {
    const combinaciones = mostrar([fila("chico|", { activa: false }), fila("grande|", { precio: 2600 })]);
    const r = resumenDePreciosConCombinaciones({ grupos: cafe(false), precioBase: 2500, descuentoDeProducto: null, combinaciones });
    expect(r.grupos.find((g) => g.grupoId === "tamano")!.opciones.map((o) => [o.opcionId, o.precioFinal])).toEqual([
      ["mediano", 2500],
      ["grande", 2600],
    ]);
    expect(r).toMatchObject({ desde: 2500, vendible: true });
    // Todas apagadas: no se puede vender.
    const todas = mostrar(["chico|", "mediano|", "grande|"].map((c) => fila(c, { activa: false })));
    expect(resumenDePreciosConCombinaciones({ grupos: cafe(false), precioBase: 2500, descuentoDeProducto: null, combinaciones: todas })).toMatchObject({ vendible: false, desde: null });
  });

  it("con DOS ejes: el «desde» recorre los pares (el más barato que existe y se puede pedir)", () => {
    const combinaciones = mostrar([fila("chico|vaca", { activa: false }), fila("chico|almendras", { precio: 2000 })]);
    expect(resumenDePreciosConCombinaciones({ grupos: cafe(true), precioBase: 2500, descuentoDeProducto: null, combinaciones }).desde).toBe(2000);
  });

  it("opcionesConCombinacionApagada: con un eje, las apagadas (o con la tarifa apagada); con dos, según lo elegido en el otro eje", () => {
    const tarifaApagada = { grupoDePrecioId: "t", nombre: "T", precio: 3000, activo: false };
    const uno = mostrar([fila("chico|", { activa: false }), fila("grande|", { grupo: tarifaApagada }), fila("mediano|", { precio: 2400 })]);
    expect([...opcionesConCombinacionApagada(cafe(false), [], uno)].sort()).toEqual(["chico", "grande"]);
    const dos = mostrar([fila("grande|almendras", { activa: false }), fila("chico|vaca", { activa: false })]);
    expect([...opcionesConCombinacionApagada(cafe(true), [], dos)]).toEqual([]);
    expect([...opcionesConCombinacionApagada(cafe(true), [{ opcionId: "almendras" }], dos)]).toEqual(["grande"]);
    expect([...opcionesConCombinacionApagada(cafe(true), [{ opcionId: "grande" }], dos)]).toEqual(["almendras"]);
    expect(opcionesConCombinacionApagada(cafe(true), [{ opcionId: "grande" }], undefined).size).toBe(0);
  });
});
