import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { consumoDeLineaConfigurada, type ConsumoDeOpcionParaVender } from "../../../src/core/movimientos/consumo-de-linea-configurada";
import { armarLineaConfigurada, type GrupoParaVender, type OpcionParaVender } from "../../../src/core/pos/linea-configurada";

/**
 * Ventas con opciones, paso 2 (diseño 2026-10-29): `LineaConfigurada.insumosSinLaBase` es lo que pide lo elegido dentro del precio SIN la receta de la base (el aviso temprano del POS).
 * Propiedad (fast-check): para cualquier elección, `insumosSinLaBase > 0` si y solo si el consumo de las opciones con la base vacía (`consumoDeLineaConfigurada({ base: [] })`) pide algún insumo, y
 * además es exactamente la cantidad de consumos SUMA de las opciones elegidas (oráculo escrito aparte: un REEMPLAZA sin base no cuenta y la «ninguna» aporta cero).
 */
type Clase = "ninguno" | "suma" | "reemplaza" | "suma y reemplaza" | "ninguna";
const CLASES: readonly Clase[] = ["ninguno", "suma", "reemplaza", "suma y reemplaza", "ninguna"];

const consumo = (efecto: "SUMA" | "REEMPLAZA", insumo: string, reemplaza: string | null): ConsumoDeOpcionParaVender => ({
  efecto,
  insumoProductoId: insumo,
  reemplazaAProductoId: reemplaza,
  cantidad: 1,
  unidadStockId: "u1",
  mermaPorcentaje: 0,
  escalaConLaMedida: false,
});

function consumosDe(id: string, clase: Clase): ConsumoDeOpcionParaVender[] {
  if (clase === "suma") return [consumo("SUMA", `Y-${id}`, null)];
  if (clase === "reemplaza") return [consumo("REEMPLAZA", `W-${id}`, `X-${id}`)];
  if (clase === "suma y reemplaza") return [consumo("SUMA", `Y-${id}`, null), consumo("REEMPLAZA", `W-${id}`, `X-${id}`)];
  return [];
}

function opcion(opcionId: string, orden: number, clase: Clase): OpcionParaVender {
  return {
    opcionId,
    nombre: opcionId,
    orden,
    activa: true,
    admitida: true,
    apagadaEnSucursal: false,
    cantidadMaxima: 1,
    versionVigenteId: `v-${opcionId}`,
    esNinguna: clase === "ninguna",
    productoAnclaId: null,
    diferenciaDeLaVersion: { tipo: "MONTO", monto: 0 },
    factorEscala: null,
    consumos: consumosDe(opcionId, clase),
    precioAbsoluto: null,
    diferenciaDelProducto: null,
    precioDeSucursal: null,
  };
}

const TIPOS = ["MEDIDA", "VARIANTE", "INCLUIDA"] as const;

/** Tres grupos (MEDIDA obligatoria, VARIANTE e INCLUIDA opcionales), cada uno con tres opciones de una clase de consumo. */
const eleccionArb = fc.record({
  clases: fc.array(fc.array(fc.constantFrom(...CLASES), { minLength: 3, maxLength: 3 }), { minLength: 3, maxLength: 3 }),
  elegida: fc.tuple(fc.integer({ min: 0, max: 2 }), fc.option(fc.integer({ min: 0, max: 2 }), { nil: null }), fc.option(fc.integer({ min: 0, max: 2 }), { nil: null })),
});

describe("armarLineaConfigurada: insumosSinLaBase", () => {
  it("propiedad: insumosSinLaBase > 0 ⇔ el consumo de las opciones con la base vacía pide algún insumo, y es la cantidad de SUMA elegidas", () => {
    fc.assert(
      fc.property(eleccionArb, ({ clases, elegida }) => {
        const grupos: GrupoParaVender[] = TIPOS.map((tipo, g) => ({
          grupoId: `g${g}`,
          nombre: `Grupo ${g}`,
          tipo,
          activo: true,
          admitido: true,
          cantidadMinima: tipo === "MEDIDA" ? 1 : 0,
          cantidadMaxima: 1,
          orden: g,
          modoPrecio: tipo === "MEDIDA" ? "DIFERENCIA" : null,
          // La «ninguna» de una MEDIDA no existe (un tamaño siempre tiene precio): en ese grupo se reemplaza por una opción sin consumo.
          opciones: clases[g]!.map((c, i) => opcion(`o${g}${i}`, i, tipo === "MEDIDA" && c === "ninguna" ? "ninguno" : c)),
        }));
        const claseDe = (g: number, i: number): Clase => {
          const c = clases[g]![i]!;
          return TIPOS[g] === "MEDIDA" && c === "ninguna" ? "ninguno" : c;
        };
        const indices = [elegida[0], elegida[1], elegida[2]] as const;
        const elegidas = indices.flatMap((i, g) => (i === null ? [] : [{ opcionId: `o${g}${i}`, cantidad: 1, versionDeOpcionId: `v-o${g}${i}` }]));
        const r = armarLineaConfigurada({ grupos, elegidas, precioBase: 1000, descuentoDeProducto: null, cantidad: 2 });
        if (!r.ok || r.linea === null) throw new Error(`se esperaba una línea (la medida es obligatoria): ${JSON.stringify(r)}`);

        // Oráculo aparte: una SUMA por cada opción elegida de clase «suma» o «suma y reemplaza»; el REEMPLAZA sin base y la «ninguna» no aportan.
        const esperado = indices.filter((i, g) => i !== null && ["suma", "suma y reemplaza"].includes(claseDe(g, i))).length;
        expect(r.linea.insumosSinLaBase).toBe(esperado);

        // Y es lo que pide el consumo de las opciones con la base vacía.
        const consumoSinBase = consumoDeLineaConfigurada({
          cantidad: 2,
          sucursalId: "",
          base: [],
          opciones: r.linea.fotos.map((f) => {
            const o = grupos.flatMap((g) => g.opciones).find((x) => x.opcionId === f.opcionId)!;
            return { opcionId: f.opcionId, nombre: f.nombreOpcion, tipo: f.tipoGrupo as "MEDIDA" | "VARIANTE" | "INCLUIDA", ordenDeGrupo: f.orden, ordenDeOpcion: 0, cantidad: f.cantidad, factorEscala: null, consumos: o.esNinguna ? [] : o.consumos };
          }),
          adicionales: [],
        });
        if (!consumoSinBase.ok) throw new Error(consumoSinBase.mensaje);
        expect(r.linea.insumosSinLaBase > 0).toBe(consumoSinBase.pedidos.length > 0);
      }),
      { numRuns: 500 }
    );
  });

  it("ejemplo: una VARIANTE «Coca» que suma una botella pide 1 insumo; «Fanta» sin consumo, 0", () => {
    const grupo = (clase: Clase): GrupoParaVender[] => [
      { grupoId: "g", nombre: "Marca", tipo: "VARIANTE", activo: true, admitido: true, cantidadMinima: 1, cantidadMaxima: 1, orden: 0, modoPrecio: null, opciones: [opcion("o", 0, clase)] },
    ];
    const armar = (clase: Clase) => armarLineaConfigurada({ grupos: grupo(clase), elegidas: [{ opcionId: "o", cantidad: 1, versionDeOpcionId: "v-o" }], precioBase: 2500, descuentoDeProducto: null, cantidad: 1 });
    const coca = armar("suma");
    const fanta = armar("ninguno");
    expect(coca.ok && coca.linea?.insumosSinLaBase).toBe(1);
    expect(fanta.ok && fanta.linea?.insumosSinLaBase).toBe(0);
  });
});
