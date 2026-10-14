import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { armarLineaConfigurada, type GrupoParaVender, type OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { opcionDisponible, resumenDePrecios, vistaPreviaDeConfiguracion } from "../../src/core/pos/precio-de-configuracion";
import type { DiferenciaDePrecio } from "../../src/core/opciones/public";

/**
 * GO-2d: los PRECIOS PARA MOSTRAR de un producto con opciones (`core/pos/precio-de-configuracion.ts`). Lo central es la PARIDAD: lo que la pantalla muestra antes de confirmar es
 * EXACTAMENTE lo que la venta arma (`armarLineaConfigurada`), para cualquier configuración (propiedad con fast-check). Si alguien cambia la regla del precio en un lado y no en el
 * otro, este test queda rojo. Además: el «desde», los tamaños con su precio final, que una opción agotada no se ofrece, que un grupo obligatorio sin opciones deja el producto sin
 * poder venderse y que el descuento de producto nunca toca al adicional.
 */

const monto = (m: number): DiferenciaDePrecio => ({ tipo: "MONTO", monto: m });
const pct = (p: number): DiferenciaDePrecio => ({ tipo: "PORCENTAJE", porcentaje: p });

function opcion(opcionId: string, nombre: string, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId,
    nombre,
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

function grupo(grupoId: string, tipo: GrupoParaVender["tipo"], opciones: OpcionParaVender[], extra: Partial<GrupoParaVender> = {}): GrupoParaVender {
  return { grupoId, nombre: grupoId, tipo, activo: true, admitido: true, cantidadMinima: tipo === "MEDIDA" || tipo === "INCLUIDA" ? 1 : 0, cantidadMaxima: tipo === "ADICIONAL" ? 3 : 1, orden: 0, modoPrecio: tipo === "MEDIDA" ? "DIFERENCIA" : null, opciones, ...extra };
}

/** El café del prototipo: precio base 2.500; Chico −300, Mediano 0, Grande +300; leche +400; guarnición incluida; huevo frito +600. */
function cafe(extra: { tamano?: Partial<GrupoParaVender>; chico?: Partial<OpcionParaVender>; grande?: Partial<OpcionParaVender> } = {}): GrupoParaVender[] {
  return [
    grupo("Tamaño", "MEDIDA", [opcion("chico", "Chico", { diferenciaDeLaVersion: monto(-300), factorEscala: 0.75, ...extra.chico }), opcion("mediano", "Mediano"), opcion("grande", "Grande", { diferenciaDeLaVersion: monto(300), ...extra.grande })], extra.tamano),
    grupo("Preparación", "VARIANTE", [opcion("solo", "Solo"), opcion("con-leche", "Con leche", { diferenciaDeLaVersion: monto(400) })]),
    grupo("Guarnición", "INCLUIDA", [opcion("papas", "Papas fritas"), opcion("pure", "Puré"), opcion("sin", "Sin guarnición", { esNinguna: true })]),
    grupo("Adicionales", "ADICIONAL", [opcion("huevo", "Huevo frito", { diferenciaDeLaVersion: monto(600), productoAnclaId: "ancla-huevo" })]),
  ];
}

describe("resumenDePrecios", () => {
  it("el café: «desde» es el tamaño más barato con lo obligatorio, y cada tamaño con su precio final", () => {
    const r = resumenDePrecios({ grupos: cafe(), precioBase: 2500, descuentoDeProducto: null });
    expect(r).toMatchObject({ desde: 2200, hayVariacion: true, vendible: true });
    expect(r.grupos.find((g) => g.tipo === "MEDIDA")!.opciones.map((o) => [o.nombre, o.precioFinal])).toEqual([["Chico", 2200], ["Mediano", 2500], ["Grande", 2800]]);
    expect(r.grupos.find((g) => g.tipo === "VARIANTE")!.opciones.map((o) => [o.nombre, o.diferencia])).toEqual([["Solo", 0], ["Con leche", 400]]);
    expect(r.grupos.find((g) => g.tipo === "ADICIONAL")!.opciones.map((o) => [o.nombre, o.diferencia])).toEqual([["Huevo frito", 600]]);
  });

  it("precio propio por tamaño y la grilla de la sucursal le gana; el descuento de producto va en el tamaño, nunca en el recargo", () => {
    const grupos = cafe({ tamano: { modoPrecio: "ABSOLUTO" }, chico: { precioAbsoluto: 2000 }, grande: { precioAbsoluto: 3100, precioDeSucursal: 3000 } });
    grupos[0] = { ...grupos[0]!, opciones: grupos[0]!.opciones.map((o) => (o.opcionId === "mediano" ? { ...o, precioAbsoluto: 2600 } : o)) };
    const r = resumenDePrecios({ grupos, precioBase: 2500, descuentoDeProducto: 10 });
    expect(r.grupos[0]!.opciones.map((o) => o.precioFinal)).toEqual([1800, 2340, 2700]);
    expect(r.desde).toBe(1800);
    expect(r.grupos.find((g) => g.tipo === "ADICIONAL")!.opciones[0]!.diferencia).toBe(600);
  });

  it("una opción agotada en la sucursal no se ofrece; si un grupo obligatorio se queda sin ninguna, el producto no se puede vender", () => {
    const grupos = cafe();
    grupos[2] = { ...grupos[2]!, opciones: grupos[2]!.opciones.map((o) => ({ ...o, apagadaEnSucursal: o.opcionId !== "pure" })) };
    const r = resumenDePrecios({ grupos, precioBase: 2500, descuentoDeProducto: null });
    expect(r.grupos.find((g) => g.tipo === "INCLUIDA")!.opciones.map((o) => o.nombre)).toEqual(["Puré"]);
    expect(r.vendible).toBe(true);
    const sinNinguna = cafe();
    sinNinguna[2] = { ...sinNinguna[2]!, opciones: sinNinguna[2]!.opciones.map((o) => ({ ...o, apagadaEnSucursal: true })) };
    expect(resumenDePrecios({ grupos: sinNinguna, precioBase: 2500, descuentoDeProducto: null })).toMatchObject({ vendible: false, desde: null });
    // Un tamaño sin precio cargado (precio propio sin el precio) tampoco se ofrece.
    const sinPrecio = cafe({ tamano: { modoPrecio: "ABSOLUTO" } });
    expect(resumenDePrecios({ grupos: sinPrecio, precioBase: 2500, descuentoDeProducto: null })).toMatchObject({ vendible: false, desde: null });
  });

  it("un grupo obligatorio apagado para la empresa deja el producto sin vender; uno opcional apagado no cuenta; sin grupos, el precio de siempre", () => {
    const apagado = cafe();
    apagado[2] = { ...apagado[2]!, activo: false };
    expect(resumenDePrecios({ grupos: apagado, precioBase: 2500, descuentoDeProducto: null }).vendible).toBe(false);
    const opcionalApagado = cafe();
    opcionalApagado[1] = { ...opcionalApagado[1]!, activo: false };
    expect(resumenDePrecios({ grupos: opcionalApagado, precioBase: 2500, descuentoDeProducto: null })).toMatchObject({ vendible: true, desde: 2200 });
    expect(resumenDePrecios({ grupos: [], precioBase: 2500, descuentoDeProducto: 20 })).toEqual({ grupos: [], desde: 2000, hayVariacion: false, vendible: true });
  });

  it("opcionDisponible: prendida, admitida y no agotada", () => {
    expect(opcionDisponible({ activa: true, admitida: true, apagadaEnSucursal: false })).toBe(true);
    expect(opcionDisponible({ activa: false, admitida: true, apagadaEnSucursal: false })).toBe(false);
    expect(opcionDisponible({ activa: true, admitida: false, apagadaEnSucursal: false })).toBe(false);
    expect(opcionDisponible({ activa: true, admitida: true, apagadaEnSucursal: true })).toBe(false);
  });
});

describe("vistaPreviaDeConfiguracion", () => {
  it("Café mediano con leche y dos huevos fritos: 2.900 por café y 1.200 de adicionales, por 2 cafés", () => {
    const r = vistaPreviaDeConfiguracion({
      grupos: cafe(),
      elegidas: [{ opcionId: "mediano", cantidad: 1 }, { opcionId: "con-leche", cantidad: 1 }, { opcionId: "papas", cantidad: 1 }, { opcionId: "huevo", cantidad: 2 }],
      precioBase: 2500,
      descuentoDeProducto: null,
      cantidad: 2,
    });
    expect(r).toEqual({ ok: true, precioUnitario: 2900, precioLista: null, adicionales: [{ opcionId: "huevo", nombre: "Huevo frito", cantidad: 4, precioUnitario: 600 }], total: 8200 });
  });

  it("lo que falta elegir vuelve con el código y el mensaje de la venta", () => {
    expect(vistaPreviaDeConfiguracion({ grupos: cafe(), elegidas: [{ opcionId: "papas", cantidad: 1 }], precioBase: 2500, descuentoDeProducto: null, cantidad: 1 })).toMatchObject({
      ok: false,
      codigo: "GRUPO_MINIMO_NO_ALCANZADO",
      mensaje: "Elegí al menos 1 opción de «Tamaño».",
    });
  });

  it("PARIDAD (propiedad): para cualquier configuración, la vista previa da EXACTAMENTE lo que arma la venta", () => {
    const diferencia = fc.oneof(fc.integer({ min: -50000, max: 50000 }).map((c) => monto(c / 100)), fc.integer({ min: -99, max: 300 }).map((p) => pct(p)));
    const montoPositivo = fc.integer({ min: 1, max: 900000 }).map((c) => c / 100);
    const arbol = fc.record({
      precioBase: fc.integer({ min: 100, max: 2000000 }).map((c) => c / 100),
      descuento: fc.option(fc.integer({ min: 1, max: 60 }), { nil: null }),
      cantidad: fc.integer({ min: 1, max: 5 }),
      absoluto: fc.boolean(),
      medidas: fc.array(fc.record({ dif: diferencia, absoluto: fc.option(montoPositivo, { nil: null }), sucursal: fc.option(montoPositivo, { nil: null }), producto: fc.option(diferencia, { nil: null }) }), { minLength: 1, maxLength: 3 }),
      variantes: fc.array(fc.record({ dif: diferencia, producto: fc.option(diferencia, { nil: null }) }), { minLength: 1, maxLength: 3 }),
      recargos: fc.array(montoPositivo, { minLength: 1, maxLength: 2 }),
      elegirMedida: fc.nat(),
      elegirVariante: fc.option(fc.nat(), { nil: null }),
      adicional: fc.option(fc.record({ i: fc.nat(), k: fc.integer({ min: 1, max: 3 }) }), { nil: null }),
    });
    fc.assert(
      fc.property(arbol, (a) => {
        const grupos: GrupoParaVender[] = [
          grupo("m", "MEDIDA", a.medidas.map((x, i) => opcion(`m${i}`, `M${i}`, { diferenciaDeLaVersion: x.dif, precioAbsoluto: x.absoluto, precioDeSucursal: a.absoluto ? x.sucursal : null, diferenciaDelProducto: x.producto, factorEscala: 1 })), {
            modoPrecio: a.absoluto ? "ABSOLUTO" : "DIFERENCIA",
          }),
          grupo("v", "VARIANTE", a.variantes.map((x, i) => opcion(`v${i}`, `V${i}`, { diferenciaDeLaVersion: x.dif, diferenciaDelProducto: x.producto }))),
          grupo("a", "ADICIONAL", a.recargos.map((r, i) => opcion(`a${i}`, `A${i}`, { diferenciaDeLaVersion: monto(r), productoAnclaId: `ancla-${i}` }))),
        ];
        const elegidas = [
          { opcionId: `m${a.elegirMedida % a.medidas.length}`, cantidad: 1 },
          ...(a.elegirVariante === null ? [] : [{ opcionId: `v${a.elegirVariante % a.variantes.length}`, cantidad: 1 }]),
          ...(a.adicional === null ? [] : [{ opcionId: `a${a.adicional.i % a.recargos.length}`, cantidad: a.adicional.k }]),
        ];
        const venta = armarLineaConfigurada({ grupos, elegidas, precioBase: a.precioBase, descuentoDeProducto: a.descuento, cantidad: a.cantidad });
        const vista = vistaPreviaDeConfiguracion({ grupos, elegidas, precioBase: a.precioBase, descuentoDeProducto: a.descuento, cantidad: a.cantidad });
        if (!venta.ok) {
          expect(vista).toMatchObject({ ok: false, codigo: venta.codigo, mensaje: venta.mensaje });
          return;
        }
        expect(vista.ok).toBe(true);
        if (!vista.ok || venta.linea === null) return;
        expect(vista.precioUnitario).toBe(venta.linea.precioUnitario);
        expect(vista.precioLista).toBe(venta.linea.precioCartaUnitario);
        expect(vista.adicionales.map((x) => [x.opcionId, x.cantidad, x.precioUnitario])).toEqual(venta.linea.adicionales.map((x) => [x.opcionId, x.cantidad, x.precioUnitario]));
      }),
      { numRuns: 400 }
    );
  });
});
