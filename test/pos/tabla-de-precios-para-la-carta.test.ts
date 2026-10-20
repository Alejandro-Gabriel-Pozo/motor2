import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { armarLineaConfigurada, type GrupoParaVender, type OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { tablaDePreciosParaLaCarta, vistaPreviaDeConfiguracion, type TablaDePreciosParaLaCarta } from "../../src/core/pos/precio-de-configuracion";
import { opcionesDelEje, type DiferenciaDePrecio } from "../../src/core/opciones/public";
import { PRODUCTOS_DE_REFERENCIA } from "../setup/referencia-precio-y-carta";

/**
 * Fase 5 de la ola «precio y carta» («carta pareja»): la TABLA DE PRECIOS de la carta (`tablaDePreciosParaLaCarta`, `core/pos/precio-de-configuracion.ts`). Lo central es la PARIDAD celda por celda: el
 * precio de cada celda (columna × fila × lo más barato de cada otro grupo obligatorio, con el descuento de producto sobre la lista compuesta) es EXACTAMENTE lo que muestra el diálogo del POS
 * (`vistaPreviaDeConfiguracion`) y lo que cobra la venta (`armarLineaConfigurada`) para esa misma elección. El oráculo es independiente: prueba TODAS las combinaciones de los demás grupos obligatorios
 * y se queda con la más barata. Propiedad con fast-check: porcentajes sobre la base, precio propio por tamaño y grilla de la sucursal, opciones agotadas, base configurable y descuento con decimales
 * (el redondeo del descuento es justo lo que una suma de partes haría mal).
 */

const monto = (m: number): DiferenciaDePrecio => ({ tipo: "MONTO", monto: m });
const pct = (p: number): DiferenciaDePrecio => ({ tipo: "PORCENTAJE", porcentaje: p });

function opcion(opcionId: string, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId,
    nombre: opcionId.toUpperCase(),
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

type GrupoDeLaCarta = GrupoParaVender & { prefijoEnCarta?: string | null };
const grupo = (grupoId: string, tipo: GrupoParaVender["tipo"], opciones: OpcionParaVender[], extra: Partial<GrupoDeLaCarta> = {}): GrupoDeLaCarta => ({
  grupoId,
  nombre: grupoId,
  tipo,
  activo: true,
  admitido: true,
  cantidadMinima: tipo === "ADICIONAL" ? 0 : 1,
  cantidadMaxima: tipo === "ADICIONAL" ? 3 : 1,
  orden: 0,
  modoPrecio: tipo === "MEDIDA" ? "DIFERENCIA" : null,
  opciones: opciones.map((o, i) => ({ ...o, orden: i })),
  ...extra,
});

/** Todas las combinaciones (una opción por grupo). */
const combinaciones = <T,>(listas: readonly T[][]): T[][] => listas.reduce<T[][]>((acc, l) => acc.flatMap((c) => l.map((x) => [...c, x])), [[]]);

/**
 * El oráculo de una celda: la más barata de TODAS las combinaciones de los demás grupos obligatorios, con la vista previa del POS. Devuelve el precio y la elección. Se combinan las opciones que la
 * carta OFRECE de cada grupo (las de `tabla.grupos`: disponibles hoy y con un precio que se compone solas, el mismo criterio que el «desde»): una opción que sola no se compone (por ejemplo, la que
 * deja la lista en 0) no se ofrece aunque combinada con otra diera un precio.
 */
function oraculo(grupos: readonly GrupoDeLaCarta[], tabla: TablaDePreciosParaLaCarta, elegidasDeLosEjes: string[], precioBase: number, descuento: number | null) {
  const ejes = new Set([tabla.ejes.columnas, tabla.ejes.filas]);
  const otros = tabla.grupos.filter((g) => g.cantidadMinima > 0 && g.tipo !== "ADICIONAL" && !ejes.has(g.grupoId));
  let mejor: { precio: number; elegidas: { opcionId: string; cantidad: number }[] } | null = null;
  for (const combo of combinaciones(otros.map((g) => g.opciones.map((o) => o.opcionId)))) {
    const elegidas = [...elegidasDeLosEjes, ...combo].map((opcionId) => ({ opcionId, cantidad: 1 }));
    const vista = vistaPreviaDeConfiguracion({ grupos, elegidas, precioBase, descuentoDeProducto: descuento, cantidad: 1 });
    if (vista.ok && (mejor === null || vista.precioUnitario < mejor.precio)) mejor = { precio: vista.precioUnitario, elegidas };
  }
  return mejor;
}

/** Revisa cada celda de la tabla contra el oráculo (vista previa) y contra la venta. */
function revisarParidad(grupos: readonly GrupoDeLaCarta[], precioBase: number, descuento: number | null, esBase: boolean) {
  const tabla = tablaDePreciosParaLaCarta({ grupos, precioBase, descuentoDeProducto: descuento, esBase });
  if (tabla === null) return null;
  const eje = (grupoId: string | null) => {
    const g = tabla.grupos.find((x) => x.grupoId === grupoId);
    return g ? opcionesDelEje(g).map((o) => o.opcionId) : [null];
  };
  const columnas = eje(tabla.ejes.columnas);
  const filas = eje(tabla.ejes.filas);
  expect(tabla.celdas.length).toBe(filas.length);
  filas.forEach((fila, f) => {
    expect(tabla.celdas[f]!.length).toBe(columnas.length);
    columnas.forEach((columna, c) => {
      const delOraculo = oraculo(grupos, tabla, [columna, fila].filter((x): x is string => x !== null), precioBase, descuento);
      const celda = tabla.celdas[f]![c]!;
      expect(celda, `celda ${fila ?? "-"} × ${columna ?? "-"}`).toBe(delOraculo?.precio ?? null);
      if (delOraculo === null || celda === null) return;
      const venta = armarLineaConfigurada({ grupos, elegidas: delOraculo.elegidas, precioBase, descuentoDeProducto: descuento, cantidad: 1 });
      expect(venta.ok && venta.linea?.precioUnitario, `la venta de ${fila ?? "-"} × ${columna ?? "-"}`).toBe(celda);
    });
  });
  return tabla;
}

describe("tablaDePreciosParaLaCarta: paridad de cada celda con el POS y con la venta", () => {
  it("PARIDAD (propiedad): cada celda es lo que muestra la vista previa del POS y lo que cobra la venta, con porcentajes, grilla, agotados, base y descuento con redondeo", () => {
    const diferencia = fc.oneof(fc.integer({ min: -30000, max: 50000 }).map((c) => monto(c / 100)), fc.integer({ min: -60, max: 250 }).map((p) => pct(p)), fc.integer({ min: 1, max: 9999 }).map((p) => pct(p / 100)));
    const montoPositivo = fc.integer({ min: 1, max: 900000 }).map((c) => c / 100);
    const arbol = fc.record({
      precioBase: fc.integer({ min: 100, max: 3000000 }).map((c) => c / 100),
      descuento: fc.option(fc.integer({ min: 1, max: 9999 }).map((d) => d / 100), { nil: null }),
      esBase: fc.boolean(),
      absoluto: fc.boolean(),
      medidas: fc.array(fc.record({ dif: diferencia, absoluto: montoPositivo, sucursal: fc.option(montoPositivo, { nil: null }), producto: fc.option(diferencia, { nil: null }), agotada: fc.boolean() }), { minLength: 1, maxLength: 4 }),
      filas: fc.array(fc.record({ dif: diferencia, producto: fc.option(diferencia, { nil: null }), agotada: fc.boolean() }), { minLength: 1, maxLength: 3 }),
      prefijo: fc.boolean(),
      // Los demás grupos obligatorios: incluidos o variantes con montos en centavos (su opción más barata entra en cada celda).
      otros: fc.array(fc.record({ tipo: fc.constantFrom("INCLUIDA" as const, "VARIANTE" as const), montos: fc.array(fc.integer({ min: 0, max: 400000 }).map((c) => c / 100), { minLength: 1, maxLength: 3 }) }), { maxLength: 2 }),
      recargo: fc.option(montoPositivo, { nil: null }),
    });
    fc.assert(
      fc.property(arbol, (a) => {
        // Una base («se vende por opción») tiene su tamaño en precio propio y no admite porcentajes (Fase 4): así lo arma el generador.
        const soloMonto = (d: DiferenciaDePrecio) => (a.esBase && d.tipo === "PORCENTAJE" ? monto(d.porcentaje) : d);
        const absoluto = a.esBase || a.absoluto;
        const grupos: GrupoDeLaCarta[] = [
          grupo(
            "tamano",
            "MEDIDA",
            a.medidas.map((m, i) =>
              opcion(`m${i}`, { diferenciaDeLaVersion: soloMonto(m.dif), precioAbsoluto: m.absoluto, precioDeSucursal: absoluto ? m.sucursal : null, diferenciaDelProducto: m.producto && soloMonto(m.producto), apagadaEnSucursal: m.agotada })
            ),
            { modoPrecio: absoluto ? "ABSOLUTO" : "DIFERENCIA" }
          ),
          grupo("relleno", "VARIANTE", a.filas.map((x, i) => opcion(`f${i}`, { diferenciaDeLaVersion: soloMonto(x.dif), diferenciaDelProducto: x.producto && soloMonto(x.producto), apagadaEnSucursal: x.agotada })), {
            prefijoEnCarta: a.prefijo ? "De" : null,
          }),
          ...a.otros.map((o, k) => grupo(`otro${k}`, o.tipo, o.montos.map((m, i) => opcion(`o${k}-${i}`, { diferenciaDeLaVersion: monto(o.tipo === "INCLUIDA" ? 0 : m) })))),
          ...(a.recargo === null ? [] : [grupo("extras", "ADICIONAL", [opcion("huevo", { diferenciaDeLaVersion: monto(a.recargo), productoAnclaId: "ancla-huevo" })])]),
        ];
        revisarParidad(grupos, a.precioBase, a.descuento, a.esBase);
      }),
      { numRuns: 1000 }
    );
  });

  it("el catálogo de referencia: café en columnas, milanesa de dos ejes con «De», pizzas como base de un eje; con descuento, cada celda con el redondeo de la venta", () => {
    const deReferencia = (nombre: string) => PRODUCTOS_DE_REFERENCIA.find((p) => p.nombre === nombre)!;
    const cafe = deReferencia("Café (descuento de producto 10 %)");
    const tablaCafe = revisarParidad(cafe.grupos, cafe.precioBase, cafe.descuentoDeProducto, false)!;
    expect(tablaCafe.ejes).toEqual({ columnas: "g-tamano-del-cafe", filas: null, sinLugar: [] });
    expect(tablaCafe.celdas).toEqual([[3600, 3690, 3870]]);
    expect(tablaCafe.grupos.map((g) => [g.nombre, g.rol])).toEqual([
      ["Tamaño del Café", "define-el-precio"],
      ["Preparación del café", "adicional"],
      ["Intensidad", "adicional"],
      ["Extras", "adicional"],
    ]);

    const milanesa = deReferencia("Milanesas (M1: terminación con precio absoluto)");
    const conPrefijo = milanesa.grupos.map((g) => (g.nombre === "Milanesas de" ? { ...g, prefijoEnCarta: "De" } : g));
    const tablaMilanesa = revisarParidad(conPrefijo, milanesa.precioBase, null, true)!;
    expect(tablaMilanesa.ejes).toEqual({ columnas: "g-tipo-de-milanesa", filas: "g-milanesas-de", sinLugar: [] });
    expect(tablaMilanesa.celdas).toEqual([
      [20000, 25000],
      [20000, 25000],
    ]);
    // Sin prefijo, «Milanesas de» (sin costo) no es un eje: se lee como aclaración y la base queda de un eje.
    expect(revisarParidad(milanesa.grupos, milanesa.precioBase, null, true)!.ejes).toEqual({ columnas: "g-tipo-de-milanesa", filas: null, sinLugar: [] });

    const pizzas = deReferencia("Pizzas");
    const tablaPizzas = revisarParidad(pizzas.grupos, pizzas.precioBase, 12.5, true)!;
    expect(tablaPizzas.celdas).toEqual([[15750, 17500, 19250, 19250, 21875, 21875]]);
  });

  it("un grupo que cambia el precio y no cabe en dos ejes queda «sin lugar»; un producto que hoy no se puede pedir no tiene tabla", () => {
    const tres = [
      grupo("tamano", "MEDIDA", [opcion("chico"), opcion("grande", { diferenciaDeLaVersion: monto(500) })]),
      grupo("relleno", "VARIANTE", [opcion("carne"), opcion("pollo", { diferenciaDeLaVersion: monto(200) })]),
      grupo("salsa", "VARIANTE", [opcion("tomate"), opcion("crema", { diferenciaDeLaVersion: monto(300) })]),
      // Con prefijo y sin costo, otra variante no es «sin lugar»: se lee como aclaración.
      grupo("coccion", "VARIANTE", [opcion("jugoso"), opcion("cocido")], { prefijoEnCarta: "Punto" }),
    ];
    const tabla = revisarParidad(tres, 1000, null, false)!;
    expect(tabla.ejes).toEqual({ columnas: "tamano", filas: "relleno", sinLugar: ["salsa"] });
    const agotado = [grupo("tamano", "MEDIDA", [opcion("chico", { apagadaEnSucursal: true })])];
    expect(tablaDePreciosParaLaCarta({ grupos: agotado, precioBase: 1000, descuentoDeProducto: null })).toBeNull();
  });
});
