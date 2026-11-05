import { describe, expect, it } from "vitest";
import { importeDeLinea } from "../../src/core/moneda";
import { validarYAplanarEleccionPromo, prorratearPrecioPromo, totalProrrateado, type CupoDeEntradasDefinicion, type OpcionDeEleccionDePromo } from "../../src/core/pos/promo-combo";
import { configuracionMinimaDeGruposEfectivos, opcionesPermitidasEfectivas } from "../../src/core/pos/opciones-permitidas-de-entrada";
import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { armarConfiguracionDeEntradaAElegir, type EntradaAElegirLeida } from "../../src/core/pos/configuracion-de-entrada-a-elegir";
import { esperado, seMandoAlgunaOpcion, todasLasCombinaciones, type Combinacion } from "./promo-a-elegir.oraculo";

/**
 * Promo «a elegir», ORÁCULO de combinaciones (etapa N1 PR A, docs/diseno-promo-subconjunto-2026-11-04.md §10). Recorre TODAS las combinaciones de `promo-a-elegir.oraculo.ts` (288) contra el código real:
 * `validarYAplanarEleccionPromo` (la forma de la elección) + `armarConfiguracionDeEntradaAElegir` (lo permitido y las reglas del grupo) y compara con la tabla escrita aparte. Además: la función de lo
 * permitido efectivo (paridad del selector y del servidor: es UNA sola) y el invariante I4 (cualquier combinación aceptada cobra exactamente el precio de la promo).
 *
 * Mutaciones demostradas (rojo y revertidas): pasar a `armarLineaConfigurada` los grupos SIN filtrar (rojo: R1); filtrar solo por la lista de la entrada y no por `apagadaEnSucursal` (rojo: «Puré apagado»); quitar
 * el rechazo de `opciones` en una entrada FIJAS de `aplanarCupoDeEntradas` (rojo: R0); abrir un grupo obligatorio sin opciones efectivas (rojo: «falla cerrado»).
 */

const monto = (m: number) => ({ tipo: "MONTO" as const, monto: m });
function opcion(opcionId: string, nombre: string, orden: number, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId, nombre, orden, activa: true, admitida: true, apagadaEnSucursal: false, cantidadMaxima: 3, versionVigenteId: `v-${opcionId}`, esNinguna: false, productoAnclaId: null,
    diferenciaDeLaVersion: monto(0), factorEscala: null, consumos: [], precioAbsoluto: null, diferenciaDelProducto: null, precioDeSucursal: null, ...extra,
  };
}
function bife(pureApagado = false): GrupoParaVender[] {
  return [
    { grupoId: "g-prep", nombre: "Preparación", tipo: "MEDIDA", activo: true, admitido: true, cantidadMinima: 1, cantidadMaxima: 1, orden: 0, modoPrecio: "DIFERENCIA", opciones: [opcion("criolla", "A la criolla", 1, { factorEscala: 1 }), opcion("chimi", "Con chimichurri", 2, { factorEscala: 1, diferenciaDeLaVersion: monto(2000) })] },
    { grupoId: "g-guarn", nombre: "Guarnición", tipo: "VARIANTE", activo: true, admitido: true, cantidadMinima: 1, cantidadMaxima: 2, orden: 1, modoPrecio: null, opciones: [opcion("pure", "Puré", 1, { apagadaEnSucursal: pureApagado }), opcion("ensalada", "Ensalada", 2), opcion("papas", "Papas fritas", 3, { diferenciaDeLaVersion: monto(500) })] },
    { grupoId: "g-extras", nombre: "Extras", tipo: "ADICIONAL", activo: true, admitido: true, cantidadMinima: 0, cantidadMaxima: 3, orden: 2, modoPrecio: null, opciones: [opcion("huevo", "Huevo", 1, { productoAnclaId: "p-huevo", diferenciaDeLaVersion: monto(300) })] },
  ];
}
const PERMITIDAS = [{ opcionId: "criolla", cantidad: 1 }, { opcionId: "pure", cantidad: 2 }, { opcionId: "ensalada", cantidad: 1 }];
const producto = { id: "bife", nombre: "Bife", tipo: "PV", precioVenta: 18000, seProduce: true, alicuota: null, esAnclaDeAdicional: false, ingredientesDeLaRecetaVigente: 1 };

function entradaLeida(pureApagado: boolean): EntradaAElegirLeida | null {
  const grupos = bife(pureApagado);
  const efectivos = opcionesPermitidasEfectivas(grupos, PERMITIDAS);
  if (!efectivos.ok) return null;
  return { entradaId: "e1", productoId: "bife", producto: { ...producto, opciones: { grupos, anclaDeOpcionId: null, esBase: false } } as never, precioBase: 18000, grupos: efectivos.grupos, gruposDelProducto: grupos };
}

function elegidas(c: Combinacion): OpcionDeEleccionDePromo[] {
  const v = (id: string, cantidad = 1, version: string = c.version === "VIGENTE" ? `v-${id}` : "v-vieja"): OpcionDeEleccionDePromo => ({ opcionId: id, cantidad, versionDeOpcionId: version });
  const preparacion = { CRIOLLA: [v("criolla")], CHIMICHURRI: [v("chimi")], NADA: [] }[c.preparacion];
  const guarnicion = { NADA: [], PURE: [v("pure")], PURE_Y_ENSALADA: [v("pure"), v("ensalada")], ENSALADA_X2: [v("ensalada", 2)], PURE_X2_Y_ENSALADA: [v("pure", 2), v("ensalada")], PAPAS: [v("papas")] }[c.guarnicion];
  return [...preparacion, ...guarnicion, ...(c.extra === "CON_HUEVO" ? [v("huevo")] : [])];
}

/** Lo que haría el servidor (`agregarItemsCasoDeUso`) con una entrada y una elección: la forma, y después lo permitido y las reglas del grupo. */
function correr(c: Combinacion): { acepta: true; precioDeLista: number } | { acepta: false; codigo: string } {
  const aElegir = c.modo === "A_ELEGIR";
  const leida = aElegir ? entradaLeida(c.pure === "APAGADO") : null;
  const cupo: CupoDeEntradasDefinicion = {
    cupoId: "cupo", tipo: "LISTA", nombre: "Platos principales", cantidadMinima: 1, cantidadMaximaCupo: 1,
    entradas: new Map([["e1", { entradaId: "e1", productoId: "bife", claveComponente: aElegir ? "bife#@e1" : "bife", ...(aElegir ? { aElegir: true } : {}) }]]),
  };
  const mandadas = elegidas(c);
  const eleccion = { cupoId: "cupo", elegidos: [{ entradaId: "e1", cantidad: 1, ...(seMandoAlgunaOpcion(c) || aElegir ? { opciones: mandadas } : {}) }] };
  // Una entrada FIJAS fija (sin configuración): el mozo no manda `opciones` salvo que se las invente.
  const forma = validarYAplanarEleccionPromo([cupo], [seMandoAlgunaOpcion(c) || aElegir ? eleccion : { cupoId: "cupo", elegidos: [{ entradaId: "e1", cantidad: 1 }] }]);
  if (!forma.ok) return { acepta: false, codigo: "FIJA_RECHAZA_OPCIONES" };
  if (!aElegir) return { acepta: true, precioDeLista: 18000 };
  if (leida === null) return { acepta: false, codigo: "ENTRADA_NO_DISPONIBLE" };
  const componente = forma.componentes[0]!;
  const armada = armarConfiguracionDeEntradaAElegir(leida, componente.opciones!);
  return armada.ok ? { acepta: true, precioDeLista: armada.precioDeLista } : { acepta: false, codigo: armada.codigo };
}

describe("promo «a elegir»: el oráculo contra TODAS las combinaciones", () => {
  const combinaciones = todasLasCombinaciones();
  it("son 288 y ninguna combinación queda sin regla", () => {
    expect(combinaciones).toHaveLength(288);
    for (const c of combinaciones) expect(esperado(c), JSON.stringify(c)).toBeDefined();
  });

  it("el código real acepta o rechaza EXACTAMENTE lo que dice la tabla, con su código", () => {
    const discrepancias: string[] = [];
    for (const c of combinaciones) {
      const e = esperado(c);
      const real = correr(c);
      const iguales = e.acepta ? real.acepta : !real.acepta && real.codigo === e.codigo;
      if (!iguales) discrepancias.push(`${JSON.stringify(c)} → esperaba ${JSON.stringify(e)}, dio ${JSON.stringify(real)}`);
    }
    expect(discrepancias).toEqual([]);
  });

  it("I4: toda combinación aceptada cobra exactamente el precio de la promo (el reparto cambia, el total no) y ningún precio de lista es 0", () => {
    const totales = new Set<number>();
    let aceptadas = 0;
    for (const c of combinaciones) {
      if (c.modo !== "A_ELEGIR" || !esperado(c).acepta) continue;
      aceptadas++;
      const real = correr(c);
      if (!real.acepta) throw new Error(JSON.stringify(c));
      expect(real.precioDeLista).toBeGreaterThan(0);
      // Un bife (precio de lista de su configuración) más un agua fija de 1500 a $ 55.000.
      const prorrateo = prorratearPrecioPromo(55000, [{ productoId: "bife", cantidad: 1, precioCarta: real.precioDeLista, claveComponente: "k" }, { productoId: "agua", cantidad: 1, precioCarta: 1500 }]);
      if (!prorrateo.ok) throw new Error(prorrateo.mensaje);
      totales.add(totalProrrateado(prorrateo.filas));
      expect(prorrateo.filas.reduce((s, f) => s + importeDeLinea(f.cantidad, f.precioUnitario), 0)).toBeCloseTo(55000, 2);
    }
    expect(aceptadas).toBeGreaterThan(0);
    expect([...totales]).toEqual([55000]);
  });
});

describe("opciones permitidas efectivas (la función ÚNICA del selector y del servidor)", () => {
  it("son las permitidas ∩ las del producto ∩ las no apagadas, sin adicionales; el tope de la entrada baja el del producto, nunca lo sube", () => {
    const r = opcionesPermitidasEfectivas(bife(), [...PERMITIDAS, { opcionId: "huevo", cantidad: 1 }, { opcionId: "no-existe", cantidad: 1 }]);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.grupos.map((g) => [g.grupoId, g.opciones.map((o) => [o.opcionId, o.cantidadMaxima])])).toEqual([
      ["g-prep", [["criolla", 1]]],
      ["g-guarn", [["pure", 2], ["ensalada", 1]]],
    ]);
    const alto = opcionesPermitidasEfectivas(bife(), [{ opcionId: "pure", cantidad: 10 }, { opcionId: "criolla", cantidad: 1 }]);
    if (!alto.ok) throw new Error(alto.motivo);
    expect(alto.grupos[1]!.opciones[0]!.cantidadMaxima, "el tope del producto (3) no sube").toBe(3);
  });

  it("falla CERRADO: un grupo obligatorio sin ninguna opción activa (apagada, o no permitida), o con menos unidades que su mínimo, deja la entrada sin elegir", () => {
    const apagadas = bife();
    apagadas[1]!.opciones = apagadas[1]!.opciones.map((o) => ({ ...o, apagadaEnSucursal: o.opcionId !== "papas" }));
    expect(opcionesPermitidasEfectivas(apagadas, PERMITIDAS)).toMatchObject({ ok: false });
    expect(opcionesPermitidasEfectivas(bife(), [{ opcionId: "criolla", cantidad: 1 }])).toMatchObject({ ok: false });
    const exigente = bife();
    exigente[1]!.cantidadMinima = 3;
    expect(opcionesPermitidasEfectivas(exigente, [{ opcionId: "criolla", cantidad: 1 }, { opcionId: "pure", cantidad: 1 }, { opcionId: "ensalada", cantidad: 1 }, { opcionId: "papas", cantidad: 1 }])).toMatchObject({ ok: true });
    expect(opcionesPermitidasEfectivas(exigente, [{ opcionId: "criolla", cantidad: 1 }, { opcionId: "pure", cantidad: 1 }, { opcionId: "ensalada", cantidad: 1 }])).toMatchObject({ ok: false });
    exigente[1]!.cantidadMinima = 4;
    expect(opcionesPermitidasEfectivas(exigente, [{ opcionId: "criolla", cantidad: 1 }, { opcionId: "pure", cantidad: 1 }, { opcionId: "ensalada", cantidad: 1 }])).toMatchObject({ ok: false });
    expect(opcionesPermitidasEfectivas([], PERMITIDAS)).toMatchObject({ ok: false });
  });

  it("un adicional obligatorio, o un grupo apagado para la empresa que es obligatorio, también falla cerrado", () => {
    const g = bife();
    g[2]!.cantidadMinima = 1;
    expect(opcionesPermitidasEfectivas(g, PERMITIDAS)).toMatchObject({ ok: false });
    const apagado = bife();
    apagado[0]!.activo = false;
    expect(opcionesPermitidasEfectivas(apagado, PERMITIDAS)).toMatchObject({ ok: false });
  });

  it("la configuración mínima toma, por grupo, las primeras opciones hasta el mínimo y nada de los grupos opcionales", () => {
    const r = opcionesPermitidasEfectivas(bife(), PERMITIDAS);
    if (!r.ok) throw new Error(r.motivo);
    expect(configuracionMinimaDeGruposEfectivos(r.grupos)).toEqual([{ opcionId: "criolla", cantidad: 1 }, { opcionId: "pure", cantidad: 1 }]);
  });
});

describe("la forma de la elección «a elegir»", () => {
  const cupo = (extra: Record<string, unknown> = {}): CupoDeEntradasDefinicion => ({
    cupoId: "cupo", tipo: "LISTA", nombre: "Platos", cantidadMinima: 1, cantidadMaximaCupo: 2,
    entradas: new Map([["e1", { entradaId: "e1", productoId: "bife", claveComponente: "bife#@e1", aElegir: true, ...extra }]]),
  });
  const o = (id: string) => ({ opcionId: id, cantidad: 1, versionDeOpcionId: `v-${id}` });

  it("la misma entrada con DOS configuraciones distintas son dos componentes (dos líneas); con la MISMA, se rechaza como repetida", () => {
    const dos = validarYAplanarEleccionPromo([cupo()], [{ cupoId: "cupo", elegidos: [{ entradaId: "e1", cantidad: 1, opciones: [o("criolla"), o("pure")] }, { entradaId: "e1", cantidad: 1, opciones: [o("criolla"), o("ensalada")] }] }]);
    expect(dos.ok && dos.componentes.map((c) => c.claveComponente)).toEqual(["bife#criolla=1;pure=1", "bife#criolla=1;ensalada=1"].map((k) => k.replace(/^bife#(.*)$/, (_, cfg: string) => `bife#${cfg.split(";").sort().join(";")}`)));
    const repetida = validarYAplanarEleccionPromo([cupo()], [{ cupoId: "cupo", elegidos: [{ entradaId: "e1", cantidad: 1, opciones: [o("pure"), o("criolla")] }, { entradaId: "e1", cantidad: 1, opciones: [o("criolla"), o("pure")] }] }]);
    expect(repetida).toMatchObject({ ok: false });
  });

  it("una opción repetida dentro de una configuración, o una forma rota de `opciones`, se rechazan", () => {
    expect(validarYAplanarEleccionPromo([cupo()], [{ cupoId: "cupo", elegidos: [{ entradaId: "e1", cantidad: 1, opciones: [o("pure"), o("pure")] }] }])).toMatchObject({ ok: false });
    expect(validarYAplanarEleccionPromo([cupo()], [{ cupoId: "cupo", elegidos: [{ entradaId: "e1", cantidad: 1, opciones: "pure" as never }] }])).toMatchObject({ ok: false, mensaje: "La elección de la promo tiene un formato inválido." });
    expect(validarYAplanarEleccionPromo([cupo()], [{ cupoId: "cupo", elegidos: [{ entradaId: "e1", cantidad: 1, opciones: [{ opcionId: "pure", cantidad: 1 } as never] }] }])).toMatchObject({ ok: false });
  });

  it("una entrada «a elegir» nunca es un componente fijo (el mozo tiene que elegir), aunque sea la única y el mínimo sea igual al máximo", () => {
    const sola = { ...cupo(), cantidadMaximaCupo: 1 };
    const sin = validarYAplanarEleccionPromo([sola], [{ cupoId: "cupo", elegidos: [] }]);
    expect(sin).toMatchObject({ ok: false });
  });
});
