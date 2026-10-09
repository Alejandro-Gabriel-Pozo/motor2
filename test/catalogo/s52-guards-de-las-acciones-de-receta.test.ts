import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import {
  actualizarCabeceraDeReceta,
  actualizarIngredienteDeReceta,
  actualizarPasoDeReceta,
  agregarIngredienteAReceta,
  agregarPasoAReceta,
  insertarPasoEnReceta,
  quitarIngredienteDeReceta,
  quitarPasoDeReceta,
  reordenarPasosDeReceta,
} from "../../src/server/actions/catalogo/recetas";
import {
  actualizarIngredienteDeRecetaPropia,
  agregarIngredienteARecetaPropia,
  copiarRecetaPropiaDeOtraSucursal,
  crearRecetaPropiaDesdeLaCentral,
  quitarIngredienteDeRecetaPropia,
} from "../../src/server/actions/catalogo/receta-sucursal";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";

type Resp = { ok: boolean; mensaje: string };
type Accion = (...args: unknown[]) => Promise<Resp>;
const sinTipos = (f: unknown) => f as Accion;

/**
 * S-52 (GT-11; fila O.192 de `docs/pureza-integracion.md`): las 14 acciones puntuales de receta (9 de la central y 5 de la receta propia de la sucursal) tienen su `guardComando…` con rango EN LA PUERTA.
 * Se llaman SIN tipos: desde la red llega cualquier cosa. Lo que se prueba, en este orden:
 *  1. la versión que vio la pantalla (6 de las 14 reciben solo eso o una posición): negativa, no entera, NaN, ±Infinity, `1e308`, mayor que el tope, texto, omitida → el texto de siempre, sin escribir;
 *  2. el orden de un paso, la posición de un paso nuevo y la secuencia de un reordenamiento: rango entero y razonable;
 *  3. el dato del cambio (cantidad, merma, sustitutos, minutos, orden, tiempos): el MISMO validador de siempre, pero ahora también ANTES de armar el cambio (un `null` ya no reventaba con un error crudo);
 *  4. el ORDEN de los mensajes no cambió: un producto inexistente sigue ganando sobre un dato fuera de rango, y un insumo o un paso que no está en la receta, sobre unos cambios mal armados;
 *  5. controles: lo válido sigue funcionando (no se endureció de más).
 */
describe("S-52: los guards de la puerta de las acciones de receta", () => {
  let centralId: string;
  let kgId: string;
  let pvId: string;
  let harinaId: string;
  let quesoId: string;
  const MENSAJE_VERSION = "La versión de la receta que se esperaba no es válida.";
  const linea = (insumoProductoId: string, extra: object = {}) => ({ insumoProductoId, cantidad: 1, unidadId: kgId, mermaPorcentaje: 0, ...extra });
  const paso = (orden: number, extra: object = {}) => ({ orden, instruccion: `Paso ${orden}`, ...extra });
  /** Las versiones de la receta CENTRAL (las de la propia de la sucursal se cuentan aparte). */
  const versiones = () => prisma.recetaVersion.count({ where: { productoId: pvId, sucursalId: null } });
  const versionesPropias = () => prisma.recetaVersion.count({ where: { productoId: pvId, sucursalId: centralId } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    kgId = (await sembrarCatalogoBase()).kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_H", nombre: "Harina", tipo: "MP", unidadStockId: kgId }, centralId)).id;
    quesoId = (await sembrarProductoDisponible({ codigo: "MP_Q", nombre: "Queso", tipo: "MP", unidadStockId: kgId }, centralId)).id;
    pvId = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, centralId)).id;
    __setCookieDeTestParaSucursal(centralId);
    expect((await guardarRecetaACiegas(pvId, [linea(harinaId)], [paso(1), paso(2)])).ok).toBe(true); // central v1: harina y dos pasos
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  // 1. La versión que vio la pantalla
  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  const VERSIONES_MALAS: [string, unknown][] = [
    ["negativa", -1],
    ["no entera", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["1e308 (antes pasaba el formato y volvía como «la receta cambió… partiste de la 1e+308»)", 1e308],
    ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["mayor que el tope", 1_000_001],
    ["texto", "1"],
    ["omitida", undefined],
    ["null", null],
  ];

  const CON_VERSION: [string, (v: unknown) => Promise<Resp>][] = [
    ["agregarIngredienteAReceta", (v) => sinTipos(agregarIngredienteAReceta)(pvId, linea(quesoId), v)],
    ["actualizarIngredienteDeReceta", (v) => sinTipos(actualizarIngredienteDeReceta)(pvId, harinaId, { cantidad: 2, unidadId: kgId }, v)],
    ["quitarIngredienteDeReceta", (v) => sinTipos(quitarIngredienteDeReceta)(pvId, harinaId, v)],
    ["agregarPasoAReceta", (v) => sinTipos(agregarPasoAReceta)(pvId, paso(3), v)],
    ["actualizarPasoDeReceta", (v) => sinTipos(actualizarPasoDeReceta)(pvId, 1, { instruccion: "Otra" }, v)],
    ["quitarPasoDeReceta", (v) => sinTipos(quitarPasoDeReceta)(pvId, 1, v)],
    ["reordenarPasosDeReceta", (v) => sinTipos(reordenarPasosDeReceta)(pvId, [2, 1], v)],
    ["insertarPasoEnReceta", (v) => sinTipos(insertarPasoEnReceta)(pvId, 1, { instruccion: "Nuevo" }, v)],
    ["actualizarCabeceraDeReceta", (v) => sinTipos(actualizarCabeceraDeReceta)(pvId, { racionesCantidad: 4 }, v)],
    ["crearRecetaPropiaDesdeLaCentral", (v) => sinTipos(crearRecetaPropiaDesdeLaCentral)(pvId, v, false)],
    ["agregarIngredienteARecetaPropia", (v) => sinTipos(agregarIngredienteARecetaPropia)(pvId, linea(quesoId), v, false)],
    ["actualizarIngredienteDeRecetaPropia", (v) => sinTipos(actualizarIngredienteDeRecetaPropia)(pvId, harinaId, { cantidad: 2, unidadId: kgId }, v, false)],
    ["quitarIngredienteDeRecetaPropia", (v) => sinTipos(quitarIngredienteDeRecetaPropia)(pvId, harinaId, v, false)],
    ["copiarRecetaPropiaDeOtraSucursal", (v) => sinTipos(copiarRecetaPropiaDeOtraSucursal)(pvId, "otra-sucursal", true, v, false)],
  ];

  it.each(CON_VERSION)("%s: una versión vista fuera de rango se rechaza con el texto de siempre y no escribe nada", async (_nombre, llamar) => {
    for (const [cual, v] of VERSIONES_MALAS) {
      expect(await llamar(v), cual).toEqual({ ok: false, mensaje: MENSAJE_VERSION });
    }
    expect(await versiones()).toBe(1);
    expect(await prisma.recetaSucursal.count()).toBe(0);
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  // 2. El orden de un paso, la posición de un paso nuevo y la secuencia
  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  it("quitarPasoDeReceta: el orden del paso tiene que ser un entero entre 1 y el tope (antes 0, un negativo o 1e308 guardaban una versión idéntica)", async () => {
    for (const orden of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e308, 100_001, "1", null, undefined]) {
      expect(await sinTipos(quitarPasoDeReceta)(pvId, orden, 1), String(orden)).toEqual({ ok: false, mensaje: "El número de paso no es válido." });
    }
    expect(await versiones()).toBe(1);
    expect((await quitarPasoDeReceta(pvId, 2, 1)).ok).toBe(true); // control
  });

  it("insertarPasoEnReceta: la posición es un entero entre 0 y el tope (antes un negativo o 1e308 se recortaban a una punta)", async () => {
    for (const posicion of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e308, 100_001, "1", null, undefined]) {
      expect(await sinTipos(insertarPasoEnReceta)(pvId, posicion, { instruccion: "Nuevo" }, 1), String(posicion)).toEqual({ ok: false, mensaje: "La posición del paso no es válida." });
    }
    expect(await versiones()).toBe(1);
    expect((await insertarPasoEnReceta(pvId, 0, { instruccion: "Al principio" }, 1)).ok).toBe(true); // control: 0 se recorta a la primera
  });

  it("reordenarPasosDeReceta: una secuencia que no es una lista, es larguísima o trae algo que no es un orden se rechaza con el texto de una que no es permutación", async () => {
    const MENSAJE = "La secuencia de pasos no es válida (faltan, sobran o se repiten pasos).";
    const larga = Array.from({ length: 101 }, (_, i) => i + 1);
    for (const secuencia of [null, undefined, "12", { length: 2 }, larga, [1, 1], [1, 3], [Number.NaN, 1], [1e308, 2], [-1, 2], [1.5, 2], ["1", "2"]]) {
      expect(await sinTipos(reordenarPasosDeReceta)(pvId, secuencia, 1), JSON.stringify(secuencia)).toEqual({ ok: false, mensaje: MENSAJE });
    }
    expect(await versiones()).toBe(1);
    expect((await reordenarPasosDeReceta(pvId, [2, 1], 1)).ok).toBe(true); // control
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  // 3. El dato del cambio
  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("el dato del cambio", () => {
    const CANTIDADES: [unknown, string][] = [
      [Number.NaN, "Cada ingrediente necesita una cantidad mayor a 0."],
      [0, "Cada ingrediente necesita una cantidad mayor a 0."],
      [-1, "Cada ingrediente necesita una cantidad mayor a 0."],
      [Number.POSITIVE_INFINITY, "Cada ingrediente necesita una cantidad válida."],
      [1e308, "La cantidad de un ingrediente es demasiado grande."],
      ["abc", "Cada ingrediente necesita una cantidad mayor a 0."],
    ];

    it.each(CANTIDADES)("agregar un ingrediente con cantidad %s → %s, sin escribir (central y propia)", async (cantidad, mensaje) => {
      expect(await sinTipos(agregarIngredienteAReceta)(pvId, linea(quesoId, { cantidad }), 1)).toEqual({ ok: false, mensaje });
      // La receta propia parte de la central: se crea primero (versión vista 0: todavía no había propia).
      expect((await crearRecetaPropiaDesdeLaCentral(pvId, 0, false)).ok).toBe(true);
      expect(await sinTipos(agregarIngredienteARecetaPropia)(pvId, linea(quesoId, { cantidad }), 1, true)).toEqual({ ok: false, mensaje });
      expect(await versiones()).toBe(1);
      expect(await versionesPropias()).toBe(1);
    });

    it.each(CANTIDADES)("editar un ingrediente con cantidad %s → %s, sin escribir (central y propia)", async (cantidad, mensaje) => {
      expect(await sinTipos(actualizarIngredienteDeReceta)(pvId, harinaId, { cantidad, unidadId: kgId }, 1)).toEqual({ ok: false, mensaje });
      // La receta propia parte de la central: se crea primero.
      expect((await crearRecetaPropiaDesdeLaCentral(pvId, 0, false)).ok).toBe(true);
      expect(await sinTipos(actualizarIngredienteDeRecetaPropia)(pvId, harinaId, { cantidad, unidadId: kgId }, 1, true)).toEqual({ ok: false, mensaje });
      expect(await versionesPropias()).toBe(1);
    });

    it("la merma (negativa, NaN, enorme) y los sustitutos (más del tope) de un ingrediente se rechazan", async () => {
      const agregar = (extra: object) => sinTipos(agregarIngredienteAReceta)(pvId, linea(quesoId, extra), 1);
      expect(await agregar({ mermaPorcentaje: -1 })).toEqual({ ok: false, mensaje: "La merma no puede ser negativa." });
      expect(await agregar({ mermaPorcentaje: Number.NaN })).toMatchObject({ ok: false });
      expect((await agregar({ mermaPorcentaje: 1e6 })).mensaje).toBe("La merma no puede superar 1000.");
      expect((await agregar({ insumoSustitutoIds: Array.from({ length: 21 }, (_, i) => `s${i}`) })).mensaje).toBe("Los sustitutos de un ingrediente no pueden ser más de 20 por vez.");
      expect(await versiones()).toBe(1);
    });

    it("un ingrediente o unos cambios que no son un objeto (o sin insumo o unidad) ya no revientan con un error crudo: se rechazan con un texto", async () => {
      for (const ingrediente of [null, undefined, 7, "x", {}, { insumoProductoId: quesoId }, { insumoProductoId: quesoId, cantidad: 1, unidadId: kgId, insumoSustitutoIds: "x" }]) {
        const r = await sinTipos(agregarIngredienteAReceta)(pvId, ingrediente, 1);
        expect(r.ok, JSON.stringify(ingrediente)).toBe(false);
        expect(r.mensaje).not.toMatch(/Cannot read|undefined|null/);
      }
      for (const cambios of [null, undefined, 7, { cantidad: 1 }]) {
        const r = await sinTipos(actualizarIngredienteDeReceta)(pvId, harinaId, cambios, 1);
        expect(r.ok, JSON.stringify(cambios)).toBe(false);
        expect(r.mensaje).not.toMatch(/Cannot read|undefined|null/);
      }
      expect(await versiones()).toBe(1);
    });

    it("los minutos (negativos, NaN, no enteros, enormes), el orden y la instrucción de un paso se rechazan al agregar, editar e insertar", async () => {
      const MINUTOS: [unknown, string][] = [
        [-1, "Los minutos de un paso no pueden ser negativos."],
        [Number.NaN, "Los minutos de un paso no son un número válido."],
        [1.5, "Los minutos de un paso tienen que ser un número entero razonable."],
        [1e9, "Los minutos de un paso tienen que ser un número entero razonable."],
      ];
      for (const [minutos, mensaje] of MINUTOS) {
        expect(await sinTipos(agregarPasoAReceta)(pvId, paso(3, { minutos }), 1), `agregar ${minutos}`).toEqual({ ok: false, mensaje });
        expect(await sinTipos(actualizarPasoDeReceta)(pvId, 1, { instruccion: "Otra", minutos }, 1), `editar ${minutos}`).toEqual({ ok: false, mensaje });
        expect(await sinTipos(insertarPasoEnReceta)(pvId, 1, { instruccion: "Nuevo", minutos }, 1), `insertar ${minutos}`).toEqual({ ok: false, mensaje });
      }
      expect(await sinTipos(agregarPasoAReceta)(pvId, paso(0), 1)).toEqual({ ok: false, mensaje: "Cada paso necesita un orden mayor a 0." });
      expect(await sinTipos(agregarPasoAReceta)(pvId, paso(1e9), 1)).toEqual({ ok: false, mensaje: "El orden de un paso tiene que ser un número entero razonable." });
      expect(await sinTipos(agregarPasoAReceta)(pvId, paso(3, { instruccion: "   " }), 1)).toEqual({ ok: false, mensaje: "Cada paso necesita una instrucción." });
      for (const p of [null, undefined, 7, {}, { orden: 3 }]) expect((await sinTipos(agregarPasoAReceta)(pvId, p, 1)).ok, JSON.stringify(p)).toBe(false);
      expect(await versiones()).toBe(1);
    });

    it("la cabecera: raciones y tiempos negativos, NaN, no enteros o enormes se rechazan; una cabecera que no es un objeto ya no borra la ficha en silencio", async () => {
      const CABECERAS: [object, string][] = [
        [{ racionesCantidad: -1 }, "La cantidad de raciones no puede ser negativa."],
        [{ racionesCantidad: 2.5 }, "La cantidad de raciones tiene que ser un número entero."],
        [{ tiempoPreparacionMinutos: Number.NaN }, "El tiempo de preparación no es un número válido."],
        [{ tiempoCoccionMinutos: 1e9 }, "El tiempo de cocción no puede superar 100000."],
      ];
      for (const [cabecera, mensaje] of CABECERAS) expect(await sinTipos(actualizarCabeceraDeReceta)(pvId, cabecera, 1), JSON.stringify(cabecera)).toEqual({ ok: false, mensaje });
      for (const cabecera of [null, undefined, 7, "x"]) expect((await sinTipos(actualizarCabeceraDeReceta)(pvId, cabecera, 1)).ok, String(cabecera)).toBe(false);
      expect(await versiones()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  // 4. El orden de los mensajes no cambió
  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("el orden de los mensajes", () => {
    it("un producto inexistente gana sobre un dato fuera de rango (el guard se aplica DESPUÉS de leer el producto)", async () => {
      const NO_ENCONTRADO = { ok: false, mensaje: "No se encontró el producto." };
      expect(await sinTipos(agregarIngredienteAReceta)("no-existe", linea(quesoId, { cantidad: Number.NaN }), 0)).toEqual(NO_ENCONTRADO);
      expect(await sinTipos(agregarPasoAReceta)("no-existe", paso(3, { minutos: -5 }), 0)).toEqual(NO_ENCONTRADO);
      expect(await sinTipos(insertarPasoEnReceta)("no-existe", 1, { instruccion: "x", minutos: -5 }, 0)).toEqual(NO_ENCONTRADO);
      expect(await sinTipos(agregarIngredienteARecetaPropia)("no-existe", linea(quesoId, { cantidad: Number.NaN }), 0, false)).toEqual(NO_ENCONTRADO);
    });

    it("la versión inválida sigue ganando sobre un producto inexistente (se aplica en el mismo lugar que siempre: dentro del permiso y antes de leer el producto)", async () => {
      expect(await sinTipos(agregarIngredienteAReceta)("no-existe", linea(quesoId, { cantidad: Number.NaN }), -1)).toEqual({ ok: false, mensaje: MENSAJE_VERSION });
    });

    it("un insumo o un paso que NO está en la receta gana sobre unos cambios mal armados; la cabecera sin receta, sobre una cabecera mal armada", async () => {
      expect(await sinTipos(actualizarIngredienteDeReceta)(pvId, quesoId, null, 1)).toEqual({ ok: false, mensaje: "Ese insumo no está en la receta vigente." });
      expect(await sinTipos(actualizarPasoDeReceta)(pvId, 99, null, 1)).toEqual({ ok: false, mensaje: "Ese paso no está en la receta vigente." });
      const sinReceta = (await sembrarProductoDisponible({ codigo: "PV_SIN", nombre: "Sin receta", tipo: "PV", unidadStockId: kgId, precioVenta: 1 }, centralId)).id;
      expect((await sinTipos(actualizarCabeceraDeReceta)(sinReceta, null, 0)).mensaje).toMatch(/Todavía no hay ninguna receta/);
    });

    it("un insumo duplicado gana sobre un ingrediente fuera de rango (el orden de los chequeos de la propia acción)", async () => {
      expect(await sinTipos(agregarIngredienteAReceta)(pvId, linea(harinaId, { cantidad: Number.NaN }), 1)).toEqual({ ok: false, mensaje: "Ese insumo ya está en la receta." });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  // 5. Controles
  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  it("controles: lo válido sigue funcionando, con y sin los valores del borde (cantidad 0,001; merma 1000; minutos 0; versión 1)", async () => {
    expect((await agregarIngredienteAReceta(pvId, linea(quesoId, { cantidad: 0.01, mermaPorcentaje: 1000 }), 1)).ok).toBe(true); // v2
    expect((await actualizarIngredienteDeReceta(pvId, quesoId, { cantidad: 2, unidadId: kgId }, 2)).ok).toBe(true); // v3
    expect((await agregarPasoAReceta(pvId, paso(3, { minutos: 0 }), 3)).ok).toBe(true); // v4
    expect((await actualizarPasoDeReceta(pvId, 3, { instruccion: "Hornear", minutos: 20 }, 4)).ok).toBe(true); // v5
    expect((await actualizarCabeceraDeReceta(pvId, { racionesCantidad: 4, tiempoCoccionMinutos: 30 }, 5)).ok).toBe(true); // v6
    expect((await quitarIngredienteDeReceta(pvId, quesoId, 6)).ok).toBe(true); // v7
    expect(await versiones()).toBe(7);
  });
});
