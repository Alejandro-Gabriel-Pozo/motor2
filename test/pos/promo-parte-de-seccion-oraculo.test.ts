import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TIPOS_DE_CUPO } from "../../src/core/carta/cupos-de-promo";
import { importeDeLinea } from "../../src/core/moneda";
import { TIPOS_DE_GRUPO_DE_OPCIONES } from "../../src/core/opciones/tipos";
import { armarConfiguracionDeEntradaAElegir, type EntradaAElegirLeida } from "../../src/core/pos/configuracion-de-entrada-a-elegir";
import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { opcionesPermitidasEfectivas } from "../../src/core/pos/opciones-permitidas-de-entrada";
import { armarComponenteDeSeccion, clasificarPlatoDeSeccion, type PlatoDeSeccionLeido } from "../../src/core/pos/plato-de-seccion";
import {
  prorratearPrecioPromo,
  totalProrrateado,
  validarYAplanarEleccionPromo,
  type ComponentePromoElegido,
  type CupoDeEntradasDefinicion,
  type CupoPromoDefinicion,
  type OpcionDeEleccionDePromo,
} from "../../src/core/pos/promo-combo";
import {
  MODOS_DE_ENTRADA_DECLARADOS,
  MODOS_DE_PARTE,
  PRECIO_DE_OTRO,
  PRECIO_GUARDADO,
  TIPOS_DE_GRUPO_DECLARADOS,
  TIPOS_DE_PARTE_DECLARADOS,
  UNIDADES,
  esImposible,
  esperado,
  seMandaAlgunaOpcion,
  todasLasCombinaciones,
  type CausaDeRechazo,
  type Combinacion,
} from "./promo-parte-de-seccion.oraculo";

/**
 * Parte de una promo (diseño 2026-11-11, etapa E1a): el ORÁCULO de `promo-parte-de-seccion.oraculo.ts` contra TODAS las combinaciones (menos las imposibles) del código real:
 *  - «Toda la sección»: `clasificarPlatoDeSeccion` (qué se ofrece) → `validarYAplanarEleccionPromo` con un cupo de sección (`conOpciones`) → `armarComponenteDeSeccion` (opciones, versión, origen de stock y peso);
 *  - «Solo estos platos»: el cupo LISTA de GO-3 (`validarYAplanarEleccionPromo`), y con «el mozo elige» `opcionesPermitidasEfectivas` + `armarConfiguracionDeEntradaAElegir`, como el servidor.
 * Para cada combinación aceptada, además: el total cobrado es EXACTAMENTE el precio de la promo (I1) y el peso del reparto es el de la configuración elegida (I8).
 *
 * Mutaciones demostradas (rojo y revertidas, ver el cuerpo del PR): dejar pasar un adicional (sacar el `continue` de ADICIONAL en `opcionesPermitidasEfectivas`); pesar con el precio guardado
 * (`armarComponenteDeSeccion` devolviendo `plato.precioGuardado`); abrir una lista vacía a «todos» (`aplanar`: tratar `elegibles` vacío como «todos»).
 */

const monto = (m: number) => ({ tipo: "MONTO" as const, monto: m });
function opcion(opcionId: string, nombre: string, orden: number, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId, nombre, orden, activa: true, admitida: true, apagadaEnSucursal: false, cantidadMaxima: 3, versionVigenteId: `v-${opcionId}`, esNinguna: false, productoAnclaId: null,
    diferenciaDeLaVersion: monto(0), factorEscala: null, consumos: [], precioAbsoluto: null, diferenciaDelProducto: null, precioDeSucursal: null, ...extra,
  };
}

/** El caso: los grupos de cada tipo de plato (ver `promo-parte-de-seccion.oraculo.ts`); `apagada` apaga en la sucursal la opción que elige DENTRO (Mayo, o Grande). */
function grupos(plato: Combinacion["plato"], apagada: boolean): GrupoParaVender[] {
  const salsa: GrupoParaVender = { grupoId: "g-salsa", nombre: "Salsa", tipo: "VARIANTE", activo: true, admitido: true, cantidadMinima: 0, cantidadMaxima: 1, orden: 0, modoPrecio: null, opciones: [opcion("ketchup", "Ketchup", 1), opcion("mayo", "Mayo", 2, { diferenciaDeLaVersion: monto(500), apagadaEnSucursal: apagada })] };
  const extras = (minimo: number): GrupoParaVender => ({ grupoId: "g-extras", nombre: "Extras", tipo: "ADICIONAL", activo: true, admitido: true, cantidadMinima: minimo, cantidadMaxima: 3, orden: 9, modoPrecio: null, opciones: [opcion("huevo", "Huevo", 1, { productoAnclaId: "p-huevo", diferenciaDeLaVersion: monto(300) })] });
  switch (plato) {
    case "SIN_GRUPOS": return [];
    case "SOLO_OPCIONALES": return [salsa, extras(0)];
    case "ADICIONAL_OBLIGATORIO": return [salsa, extras(1)];
    case "CON_OBLIGATORIO":
      return [{ grupoId: "g-taza", nombre: "Taza", tipo: "MEDIDA", activo: true, admitido: true, cantidadMinima: 1, cantidadMaxima: 1, orden: 0, modoPrecio: "DIFERENCIA", opciones: [opcion("chica", "Chica", 1, { factorEscala: 1 }), opcion("grande", "Grande", 2, { factorEscala: 1, diferenciaDeLaVersion: monto(2000), apagadaEnSucursal: apagada })] }, extras(0)];
    case "BASE_POR_OPCION":
      return [{ grupoId: "g-tam", nombre: "Tamaño", tipo: "MEDIDA", activo: true, admitido: true, cantidadMinima: 1, cantidadMaxima: 1, orden: 0, modoPrecio: "ABSOLUTO", opciones: [opcion("chica", "Chica", 1, { factorEscala: 1, precioAbsoluto: 9000 }), opcion("grande", "Grande", 2, { factorEscala: 1, precioAbsoluto: 15000, apagadaEnSucursal: apagada })] }, extras(0)];
  }
}

/** La opción que elige DENTRO cada plato. */
const OPCION_DENTRO: Record<Combinacion["plato"], string | null> = { SIN_GRUPOS: null, SOLO_OPCIONALES: "mayo", ADICIONAL_OBLIGATORIO: "mayo", CON_OBLIGATORIO: "grande", BASE_POR_OPCION: "grande" };

function leido(c: Combinacion): PlatoDeSeccionLeido {
  const sinOrigen = c.estado === "SIN_ORIGEN_DE_STOCK";
  return {
    productoId: "plato",
    producto: { nombre: "Plato", tipo: "PV", esAnclaDeAdicional: false, seProduce: !sinOrigen, ingredientesDeLaRecetaVigente: sinOrigen ? 0 : 1 },
    precioBase: PRECIO_GUARDADO[c.plato],
    precioGuardado: PRECIO_GUARDADO[c.plato],
    gruposDelProducto: grupos(c.plato, c.opcion === "APAGADA"),
  };
}
const OTRO: PlatoDeSeccionLeido = { productoId: "otro", producto: { nombre: "Otro", tipo: "PV", esAnclaDeAdicional: false, seProduce: true, ingredientesDeLaRecetaVigente: 1 }, precioBase: PRECIO_DE_OTRO, precioGuardado: PRECIO_DE_OTRO, gruposDelProducto: [] };

/** Las opciones que manda el mozo (lo que dice la combinación; la versión vieja es una que ya no es la vigente). */
function mandadas(c: Combinacion): OpcionDeEleccionDePromo[] {
  const v = (id: string): OpcionDeEleccionDePromo => ({ opcionId: id, cantidad: 1, versionDeOpcionId: c.version === "VIGENTE" ? `v-${id}` : "v-vieja" });
  if (c.elegido === "OPCION_FUERA") return [v("huevo")];
  const dentro = OPCION_DENTRO[c.plato];
  return c.elegido === "DENTRO" && dentro !== null ? [v(dentro)] : [];
}

/** Las unidades de cada fila: el plato bajo prueba y, con DISTINTOS, 1 unidad del otro plato. */
function unidadesDeLasFilas(c: Combinacion): { plato: number; otro: number } {
  const total = UNIDADES[c.total];
  return c.repeticion === "MISMO_PLATO_X2" ? { plato: total, otro: 0 } : { plato: total - 1, otro: 1 };
}

const PRECIO_DE_LA_PROMO = 50000;
type Real = { acepta: true; peso: number | null } | { acepta: false; causa: CausaDeRechazo | `SIN_CLASIFICAR:${string}` };

/** Clasifica el rechazo de la validación de la elección (la que no lleva código de los de siempre) por el mensaje. */
function causaDeLaValidacion(r: { mensaje: string; codigo?: string }): Real {
  if (r.codigo === "ENTRADA_NO_DISPONIBLE" || /no es una opción válida/.test(r.mensaje)) return { acepta: false, causa: "NO_SE_OFRECE" };
  if (/no se eligen opciones/.test(r.mensaje)) return { acepta: false, causa: "FIJAS_CON_OPCIONES" };
  if (/Elegí al menos/.test(r.mensaje)) return { acepta: false, causa: "CUPO_MIN" };
  if (/Como máximo/.test(r.mensaje)) return { acepta: false, causa: "CUPO_MAX" };
  return { acepta: false, causa: `SIN_CLASIFICAR:${r.mensaje}` };
}

function causaDelArmado(codigo: string, mensaje: string): Real {
  if (codigo === "OPCION_NO_PERMITIDA_EN_PROMO" || codigo === "OPCION_CAMBIO" || codigo === "OPCIONES_INVALIDAS") return { acepta: false, causa: codigo };
  if (codigo === "ENTRADA_NO_DISPONIBLE") return { acepta: false, causa: "SIN_ORIGEN_DE_STOCK" };
  return { acepta: false, causa: `SIN_CLASIFICAR:${codigo} ${mensaje}` };
}

/** El reparto de la promo con los pesos que dio el armado: tiene que sumar EXACTO el precio de la promo (I1). */
function sumaDelReparto(componentes: readonly ComponentePromoElegido[]): number {
  const prorrateo = prorratearPrecioPromo(PRECIO_DE_LA_PROMO, componentes);
  if (!prorrateo.ok) throw new Error(prorrateo.mensaje);
  expect(prorrateo.filas.reduce((s, f) => s + importeDeLinea(f.cantidad, f.precioUnitario), 0)).toBeCloseTo(PRECIO_DE_LA_PROMO, 2);
  return totalProrrateado(prorrateo.filas);
}

/** «Toda la sección»: lo que haría la lectura de la sección y después el servidor. */
function correrTodaLaSeccion(c: Combinacion): Real {
  const platos = new Map<string, PlatoDeSeccionLeido>([["plato", leido(c)], ["otro", OTRO]]);
  const elegibles = new Set<string>();
  const conOpciones = new Set<string>();
  for (const [id, plato] of platos) {
    if (id === "plato" && c.estado === "APAGADO") continue; // la sucursal lo apagó: la lectura de la sección no lo trae
    const clasificado = clasificarPlatoDeSeccion(plato.gruposDelProducto);
    if (clasificado.tipo === "NO_SE_OFRECE") continue;
    elegibles.add(id);
    if (clasificado.tipo === "CON_OPCIONES") conOpciones.add(id);
  }
  const cupo: CupoPromoDefinicion = { seccionCartaId: "sec", nombreSeccion: "Platos", cantidadMinima: 3, cantidadMaximaCupo: 4, elegibles, conOpciones };
  const { plato: unidadesPlato, otro: unidadesOtro } = unidadesDeLasFilas(c);
  const opciones = mandadas(c);
  const productoId = c.elegido === "PLATO_FUERA" ? "ajeno" : "plato";
  const elegidos = [{ productoId, cantidad: unidadesPlato, ...(opciones.length > 0 ? { opciones } : {}) }, ...(unidadesOtro > 0 ? [{ productoId: "otro", cantidad: unidadesOtro }] : [])];
  const validacion = validarYAplanarEleccionPromo([cupo], [{ seccionCartaId: "sec", elegidos }]);
  if (!validacion.ok) return causaDeLaValidacion(validacion);
  const componentes: ComponentePromoElegido[] = [];
  let peso: number | null = null;
  for (const comp of validacion.componentes) {
    const armado = armarComponenteDeSeccion(platos.get(comp.productoId)!, comp.opciones);
    if (!armado.ok) return causaDelArmado(armado.codigo, armado.mensaje);
    if (comp.productoId === "plato") peso = armado.precioDeLista;
    componentes.push({ productoId: comp.productoId, cantidad: comp.cantidad, precioCarta: armado.precioDeLista, ...(comp.claveComponente !== undefined ? { claveComponente: comp.claveComponente } : {}) });
  }
  expect(sumaDelReparto(componentes)).toBe(PRECIO_DE_LA_PROMO);
  return { acepta: true, peso };
}

/** «Solo estos platos»: el cupo LISTA con la entrada del plato (si la lectura la trae) y el otro plato fijo. */
function correrSoloEstos(c: Combinacion): Real {
  const aElegir = c.modo === "SOLO_ESTOS_A_ELEGIR";
  const gruposDelProducto = grupos(c.plato, c.opcion === "APAGADA");
  // Todas las opciones de los grupos que no son adicionales, con su tope: lo que el dueño tilda para «el mozo elige» (el subconjunto de permitidas se prueba en promo-a-elegir-oraculo.test.ts).
  const permitidas = gruposDelProducto.filter((g) => g.tipo !== "ADICIONAL").flatMap((g) => g.opciones.map((o) => ({ opcionId: o.opcionId, cantidad: o.cantidadMaxima })));
  const efectivas = aElegir ? opcionesPermitidasEfectivas(gruposDelProducto, permitidas) : null;
  // La lectura de la sucursal: una entrada se trae solo si está disponible, con origen de stock y se puede armar (un adicional obligatorio, o «a elegir» sin nada que elegir, no se puede).
  const seTrae = c.estado === "DISPONIBLE" && c.plato !== "ADICIONAL_OBLIGATORIO" && (efectivas === null || efectivas.ok);
  const entradas = new Map<string, { entradaId: string; productoId: string; claveComponente: string; aElegir?: boolean }>([["e-otro", { entradaId: "e-otro", productoId: "otro", claveComponente: "otro" }]]);
  if (seTrae) entradas.set("e1", { entradaId: "e1", productoId: "plato", claveComponente: aElegir ? "plato#@e1" : "plato", ...(aElegir ? { aElegir: true } : {}) });
  const cupo: CupoDeEntradasDefinicion = { cupoId: "cupo", tipo: "LISTA", nombre: "Platos", cantidadMinima: 3, cantidadMaximaCupo: 4, entradas };
  const { plato: unidadesPlato, otro: unidadesOtro } = unidadesDeLasFilas(c);
  const opciones = mandadas(c);
  const entradaId = c.elegido === "PLATO_FUERA" ? "e-ajena" : "e1";
  const manda = aElegir ? { opciones } : opciones.length > 0 ? { opciones } : {};
  const elegidos = [{ entradaId, cantidad: unidadesPlato, ...manda }, ...(unidadesOtro > 0 ? [{ entradaId: "e-otro", cantidad: unidadesOtro }] : [])];
  const validacion = validarYAplanarEleccionPromo([cupo], [{ cupoId: "cupo", elegidos }]);
  if (!validacion.ok) return causaDeLaValidacion(validacion);
  const componentes: ComponentePromoElegido[] = [];
  let peso: number | null = null;
  for (const comp of validacion.componentes) {
    let precioCarta = comp.productoId === "otro" ? PRECIO_DE_OTRO : PRECIO_GUARDADO[c.plato];
    if (comp.opciones !== undefined && efectivas !== null && efectivas.ok) {
      const entrada: EntradaAElegirLeida = {
        entradaId: "e1", productoId: "plato", precioBase: PRECIO_GUARDADO[c.plato], grupos: efectivas.grupos, gruposDelProducto,
        producto: { nombre: "Plato", tipo: "PV", esAnclaDeAdicional: false, seProduce: true, ingredientesDeLaRecetaVigente: 1 },
      };
      const armado = armarConfiguracionDeEntradaAElegir(entrada, comp.opciones);
      if (!armado.ok) return causaDelArmado(armado.codigo, armado.mensaje);
      precioCarta = armado.precioDeLista;
      peso = precioCarta;
    }
    componentes.push({ productoId: comp.productoId, cantidad: comp.cantidad, precioCarta, ...(comp.claveComponente !== undefined ? { claveComponente: comp.claveComponente } : {}) });
  }
  expect(sumaDelReparto(componentes)).toBe(PRECIO_DE_LA_PROMO);
  return { acepta: true, peso };
}

function correr(c: Combinacion): Real {
  return c.modo === "TODA_LA_SECCION" ? correrTodaLaSeccion(c) : correrSoloEstos(c);
}

describe("parte de promo: el oráculo contra TODAS las combinaciones", () => {
  const combinaciones = todasLasCombinaciones().filter((c) => !esImposible(c));

  it("son 3.780 combinaciones (4.320 brutas menos las 540 imposibles) y ninguna queda sin regla", () => {
    expect(todasLasCombinaciones()).toHaveLength(4320);
    expect(combinaciones).toHaveLength(3780);
    for (const c of combinaciones) expect(esperado(c), JSON.stringify(c)).toBeDefined();
  });

  it("el código real acepta o rechaza EXACTAMENTE lo que dice la tabla, con su causa", () => {
    const discrepancias: string[] = [];
    for (const c of combinaciones) {
      const e = esperado(c);
      const real = correr(c);
      const iguales = e.acepta ? real.acepta : !real.acepta && real.causa === e.causa;
      if (!iguales) discrepancias.push(`${JSON.stringify(c)} → esperaba ${JSON.stringify(e)}, dio ${JSON.stringify(real)}`);
    }
    expect(discrepancias).toEqual([]);
  });

  it("I8 e I1: lo aceptado pesa con el precio de lista de la configuración ELEGIDA (nunca el guardado) y cobra EXACTO el precio de la promo", () => {
    let conPeso = 0;
    let conPesoDistintoDelGuardado = 0;
    for (const c of combinaciones) {
      const e = esperado(c);
      if (!e.acepta) continue;
      const real = correr(c); // `correr` ya verifica que el reparto suma el precio de la promo
      if (!real.acepta) throw new Error(JSON.stringify(c));
      expect(real.peso, JSON.stringify(c)).toBe(e.peso);
      if (e.peso !== null) {
        conPeso++;
        if (e.peso !== PRECIO_GUARDADO[c.plato]) conPesoDistintoDelGuardado++;
      }
    }
    // Hay casos que de verdad distinguen el peso de la configuración del guardado (Grande, Mayo, la base por opción): si no, la mutación «pesar con el guardado» pasaría inadvertida.
    expect(conPeso).toBeGreaterThan(0);
    expect(conPesoDistintoDelGuardado).toBeGreaterThan(0);
  });

  it("el 2x1 (CONFIRMADA): todas las unidades del mismo plato en una fila se aceptan igual que repartidas entre dos platos", () => {
    for (const c of combinaciones) {
      if (c.repeticion !== "MISMO_PLATO_X2") continue;
      expect(esperado(c), JSON.stringify(c)).toEqual(esperado({ ...c, repeticion: "DISTINTOS" }));
    }
  });
});

describe("GUARDIÁN: lo que cambia qué entra en una parte tiene que estar declarado", () => {
  const claves = (o: object) => Object.keys(o).sort();

  it("los tipos de parte (`TIPOS_DE_CUPO`) están todos declarados: un tipo nuevo obliga a decidir si cambia lo que se acepta", () => {
    expect(claves(TIPOS_DE_PARTE_DECLARADOS)).toEqual([...TIPOS_DE_CUPO].sort());
  });

  it("los modos de una entrada (el CHECK `EntradaDeCupo_modo_de_opciones_chk` de la base) están todos declarados", () => {
    const sql = readFileSync(new URL("../../prisma/migrations/20261105120000_promo_entrada_a_elegir/migration.sql", import.meta.url), "utf8");
    const check = /"EntradaDeCupo_modo_de_opciones_chk" CHECK \("modoDeOpciones" IN \(([^)]*)\)\)/.exec(sql);
    expect(check, "el CHECK de modoDeOpciones tiene que seguir en la migración").not.toBeNull();
    const valores = [...check![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
    expect(claves(MODOS_DE_ENTRADA_DECLARADOS)).toEqual(valores);
  });

  it("los tipos de grupo de opciones (`GrupoDeOpciones.tipo`) están todos declarados", () => {
    expect(claves(TIPOS_DE_GRUPO_DECLARADOS)).toEqual([...TIPOS_DE_GRUPO_DE_OPCIONES].sort());
  });

  it("los modos de parte de la tabla cubren los tipos de parte con efecto y los modos de entrada", () => {
    expect([...MODOS_DE_PARTE]).toEqual(["TODA_LA_SECCION", "SOLO_ESTOS_FIJAS", "SOLO_ESTOS_A_ELEGIR"]);
    // «mandar opciones» tiene que seguir siendo una pregunta con respuesta en cada combinación (si no, la regla 3 quedaría sin probar).
    expect(todasLasCombinaciones().some((c) => seMandaAlgunaOpcion(c))).toBe(true);
  });
});

describe("una parte SIN ningún plato elegible hoy y con mínimo mayor que 0 nunca se abre a «todos» (I12, falla cerrado)", () => {
  const vacias: { nombre: string; cupo: CupoPromoDefinicion | CupoDeEntradasDefinicion; elecciones: (productoOEntrada: string) => unknown[] }[] = [
    { nombre: "«Toda la sección» con todos los platos apagados", cupo: { seccionCartaId: "sec", nombreSeccion: "Platos", cantidadMinima: 1, cantidadMaximaCupo: 2, elegibles: new Set(), conOpciones: new Set() }, elecciones: (id) => [{ seccionCartaId: "sec", elegidos: [{ productoId: id, cantidad: 1 }] }] },
    { nombre: "«Solo estos platos» sin ninguna entrada elegible", cupo: { cupoId: "cupo", tipo: "LISTA", nombre: "Platos", cantidadMinima: 1, cantidadMaximaCupo: 2, entradas: new Map() }, elecciones: (id) => [{ cupoId: "cupo", elegidos: [{ entradaId: id, cantidad: 1 }] }] },
  ];
  for (const { nombre, cupo, elecciones } of vacias) {
    it(`${nombre}: cualquier plato que mande el cliente se rechaza, y sin elegir nada falla el mínimo`, () => {
      for (const id of ["plato", "otro", "cualquiera", ""]) expect(validarYAplanarEleccionPromo([cupo], elecciones(id) as never), id).toMatchObject({ ok: false });
      expect(validarYAplanarEleccionPromo([cupo], [])).toMatchObject({ ok: false, mensaje: expect.stringContaining("Elegí al menos 1") });
    });
  }
});
