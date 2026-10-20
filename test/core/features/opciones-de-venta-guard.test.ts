import { describe, expect, it } from "vitest";
import {
  guardComandoAgregarVersionDeOpcion,
  guardComandoCrearGrupoDeOpciones,
  guardComandoCrearOpcionDeGrupo,
  guardComandoEditarGrupoDeOpciones,
  guardComandoEditarOpcionDeGrupo,
  guardComandoFijarAdmisionDeGrupo,
} from "../../../src/core/features/catalogo/opciones-de-venta.guard";
import { MENSAJE_SUCURSAL_CAMBIADA, guardComandoApagarOpcionEnSucursal, guardComandoFijarPrecioLocalDeOpcion } from "../../../src/core/features/catalogo/opciones-por-sucursal.guard";
import { validarFactorDeEscala, validarPorcentajeDeDiferencia } from "../../../src/core/datos/porcentaje-y-factor";
import type { ResultadoDato } from "../../../src/core/datos/resultado";

/**
 * GO-2a: los guards de comando del catálogo de opciones de venta y de lo que decide cada sucursal. Una Server Action es una puerta HTTP: acá se prueba que lo que puede llegar
 * (NaN, ±Infinity, un texto, 3 decimales en un importe, 5 en un porcentaje, -100 %, 1000 %, listas por encima del tope, ids que no son texto) se RECHAZA con un mensaje, sin
 * redondear, antes de tocar la base. Un caso por rechazo y el camino feliz de cada comando.
 */

function rechazo<T>(r: ResultadoDato<T>): string {
  if (r.ok) throw new Error(`se esperaba un rechazo y se aceptó: ${JSON.stringify(r.valor)}`);
  expect(r.mensaje.trim().length).toBeGreaterThan(10);
  return r.mensaje;
}

const RAROS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "abc", {}, [], true];
const IDS_RAROS = [undefined, null, "", 1, {}, [], "x".repeat(65)];

const VERSION = { diferencia: { tipo: "MONTO", monto: 150 }, factorEscala: null, consumos: [{ efecto: "REEMPLAZA", insumoProductoId: "mp-almendras", reemplazaAProductoId: "mp-leche", cantidad: 0.2 }] };

describe("validadores centrales: porcentaje de diferencia y factor de escala", () => {
  it("porcentaje: -100 < p ≤ 999,9999 y hasta 4 decimales; se rechaza, no se redondea", () => {
    expect(validarPorcentajeDeDiferencia("12,5", { etiqueta: "El porcentaje" })).toEqual({ ok: true, valor: 12.5 });
    expect(validarPorcentajeDeDiferencia(-99.9999, { etiqueta: "El porcentaje" })).toEqual({ ok: true, valor: -99.9999 });
    expect(validarPorcentajeDeDiferencia(999.9999, { etiqueta: "El porcentaje" })).toEqual({ ok: true, valor: 999.9999 });
    expect(validarPorcentajeDeDiferencia(null, { etiqueta: "El porcentaje", obligatorio: false })).toEqual({ ok: true, valor: null });
    expect(rechazo(validarPorcentajeDeDiferencia(null, { etiqueta: "El porcentaje" }))).toBe("Falta el porcentaje.");
    expect(rechazo(validarPorcentajeDeDiferencia(-100, { etiqueta: "El porcentaje" }))).toMatch(/mayor que -100/);
    expect(rechazo(validarPorcentajeDeDiferencia(1000, { etiqueta: "El porcentaje" }))).toMatch(/999,9999/);
    expect(rechazo(validarPorcentajeDeDiferencia(1.00001, { etiqueta: "El porcentaje" }))).toMatch(/4 decimales/);
    for (const raro of RAROS) expect(validarPorcentajeDeDiferencia(raro, { etiqueta: "El porcentaje" }).ok, String(raro)).toBe(false);
  });

  it("factor: 0 < f ≤ 10 y hasta 4 decimales", () => {
    expect(validarFactorDeEscala(1.5, { etiqueta: "El factor" })).toEqual({ ok: true, valor: 1.5 });
    expect(validarFactorDeEscala(10, { etiqueta: "El factor" })).toEqual({ ok: true, valor: 10 });
    expect(validarFactorDeEscala(undefined, { etiqueta: "El factor", obligatorio: false })).toEqual({ ok: true, valor: null });
    expect(rechazo(validarFactorDeEscala(undefined, { etiqueta: "El factor" }))).toBe("Falta el factor.");
    expect(rechazo(validarFactorDeEscala(0, { etiqueta: "El factor" }))).toMatch(/mayor que cero/);
    expect(rechazo(validarFactorDeEscala(-1, { etiqueta: "El factor" }))).toMatch(/mayor que cero/);
    expect(rechazo(validarFactorDeEscala(10.0001, { etiqueta: "El factor" }))).toMatch(/superar 10/);
    expect(rechazo(validarFactorDeEscala(0.00001, { etiqueta: "El factor" }))).toMatch(/4 decimales/);
    for (const raro of RAROS) expect(validarFactorDeEscala(raro, { etiqueta: "El factor" }).ok, String(raro)).toBe(false);
  });
});

describe("guardComandoCrearGrupoDeOpciones y guardComandoEditarGrupoDeOpciones", () => {
  const alta = { nombre: "  Tamaño  ", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 };

  it("camino feliz: el nombre recortado", () => {
    // Fase 4 (ADR-035): el alta sin «se lee en la carta como» lo deja en null (sin prefijo).
    expect(guardComandoCrearGrupoDeOpciones(alta)).toEqual({ ok: true, valor: { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, prefijoEnCarta: null } });
  });

  it("nombre vacío, de más de 80 o sin letras; tipo desconocido; cantidades fuera de rango o no enteras", () => {
    expect(rechazo(guardComandoCrearGrupoDeOpciones({ ...alta, nombre: "   " }))).toMatch(/vacío/);
    expect(rechazo(guardComandoCrearGrupoDeOpciones({ ...alta, nombre: "x".repeat(81) }))).toMatch(/80/);
    expect(rechazo(guardComandoCrearGrupoDeOpciones({ ...alta, nombre: "..." }))).toMatch(/letra o un número/);
    expect(rechazo(guardComandoCrearGrupoDeOpciones({ ...alta, tipo: "TAMANIO" }))).toMatch(/tipo de grupo/);
    expect(rechazo(guardComandoCrearGrupoDeOpciones({ ...alta, cantidadMinima: -1 }))).toMatch(/entre 0 y 10/);
    expect(rechazo(guardComandoCrearGrupoDeOpciones({ ...alta, cantidadMaxima: 11 }))).toMatch(/entre 1 y 10/);
    expect(rechazo(guardComandoCrearGrupoDeOpciones({ ...alta, cantidadMaxima: 1.5 }))).toMatch(/entero/);
    for (const raro of RAROS) expect(guardComandoCrearGrupoDeOpciones({ ...alta, cantidadMinima: raro }).ok, String(raro)).toBe(false);
    expect(rechazo(guardComandoCrearGrupoDeOpciones({ ...alta, cantidadMinima: undefined }))).toMatch(/no es un número válido/);
  });

  it("la edición exige el id del grupo, una versión esperada entera ≥ 1 y «activo» booleano", () => {
    const edicion = { grupoId: "g1", versionEsperada: 3, nombre: "Tamaño", cantidadMinima: 1, cantidadMaxima: 1, activo: false };
    expect(guardComandoEditarGrupoDeOpciones(edicion)).toEqual({ ok: true, valor: edicion });
    for (const grupoId of IDS_RAROS) expect(rechazo(guardComandoEditarGrupoDeOpciones({ ...edicion, grupoId }))).toMatch(/No se encontró el grupo/);
    for (const versionEsperada of [0, -1, 1.5, Number.NaN, "x", null]) {
      expect(rechazo(guardComandoEditarGrupoDeOpciones({ ...edicion, versionEsperada })), String(versionEsperada)).toMatch(/recargá la pantalla/);
    }
    expect(rechazo(guardComandoEditarGrupoDeOpciones({ ...edicion, activo: "no" }))).toMatch(/sí o no/);
  });
});

describe("guardComandoCrearOpcionDeGrupo, guardComandoEditarOpcionDeGrupo y guardComandoAgregarVersionDeOpcion", () => {
  const alta = { grupoId: "g1", nombre: "Almendras", orden: 2, esNinguna: false, version: VERSION, ancla: null };

  it("camino feliz: la merma y «escala con el tamaño» toman su valor por defecto", () => {
    expect(guardComandoCrearOpcionDeGrupo(alta)).toEqual({
      ok: true,
      valor: {
        grupoId: "g1",
        nombre: "Almendras",
        orden: 2,
        esNinguna: false,
        ancla: null,
        version: {
          diferencia: { tipo: "MONTO", monto: 150 },
          factorEscala: null,
          consumos: [{ efecto: "REEMPLAZA", insumoProductoId: "mp-almendras", reemplazaAProductoId: "mp-leche", cantidad: 0.2, mermaPorcentaje: 0, escalaConLaMedida: false }],
        },
      },
    });
    expect(guardComandoCrearOpcionDeGrupo({ ...alta, ancla: { unidadStockId: "u1" } })).toMatchObject({ ok: true, valor: { ancla: { unidadStockId: "u1" } } });
    expect(guardComandoCrearOpcionDeGrupo({ ...alta, version: { ...VERSION, diferencia: { tipo: "PORCENTAJE", porcentaje: "8,5" } } })).toMatchObject({ ok: true, valor: { version: { diferencia: { tipo: "PORCENTAJE", porcentaje: 8.5 } } } });
  });

  it("la diferencia: monto con 3 decimales, porcentaje de -100, de 1000, con 5 decimales, o sin tipo, se rechaza", () => {
    const con = (diferencia: unknown) => guardComandoCrearOpcionDeGrupo({ ...alta, version: { ...VERSION, diferencia } });
    expect(rechazo(con({ tipo: "MONTO", monto: 10.005 }))).toMatch(/2 decimales/);
    expect(rechazo(con({ tipo: "MONTO", monto: 1e12 }))).toMatch(/demasiado grande/);
    expect(rechazo(con({ tipo: "PORCENTAJE", porcentaje: -100 }))).toMatch(/mayor que -100/);
    expect(rechazo(con({ tipo: "PORCENTAJE", porcentaje: 1000 }))).toMatch(/999,9999/);
    expect(rechazo(con({ tipo: "PORCENTAJE", porcentaje: 1.00001 }))).toMatch(/4 decimales/);
    expect(rechazo(con({ tipo: "OTRO", monto: 1 }))).toMatch(/monto o un porcentaje/);
    expect(rechazo(con(null))).toMatch(/no es válida/);
    for (const raro of RAROS) expect(con({ tipo: "MONTO", monto: raro }).ok, String(raro)).toBe(false);
  });

  it("el factor y los consumos: fuera de rango, con decimales de más, de forma rara o por encima del tope", () => {
    const conVersion = (version: unknown) => guardComandoCrearOpcionDeGrupo({ ...alta, version });
    expect(rechazo(conVersion({ ...VERSION, factorEscala: 0 }))).toMatch(/mayor que cero/);
    expect(rechazo(conVersion({ ...VERSION, factorEscala: 10.5 }))).toMatch(/superar 10/);
    expect(rechazo(conVersion({ ...VERSION, consumos: "x" }))).toMatch(/no son una lista/);
    expect(rechazo(conVersion({ ...VERSION, consumos: Array.from({ length: 51 }, () => VERSION.consumos[0]) }))).toMatch(/más de 50/);
    const conConsumo = (c: Record<string, unknown>) => conVersion({ ...VERSION, consumos: [{ ...VERSION.consumos[0], ...c }] });
    expect(rechazo(conConsumo({ efecto: "RESTA" }))).toMatch(/suma o reemplaza/);
    expect(rechazo(conConsumo({ insumoProductoId: 5 }))).toMatch(/insumo válido/);
    expect(rechazo(conConsumo({ reemplazaAProductoId: "" }))).toMatch(/reemplazado válido/);
    expect(rechazo(conConsumo({ cantidad: 0 }))).toMatch(/cantidad/);
    expect(rechazo(conConsumo({ cantidad: 0.00001 }))).toMatch(/4 decimales/);
    expect(rechazo(conConsumo({ cantidad: Number.POSITIVE_INFINITY }))).toMatch(/cantidad/);
    expect(rechazo(conConsumo({ mermaPorcentaje: 100.5 }))).toMatch(/merma/);
    expect(rechazo(conConsumo({ mermaPorcentaje: 1.005 }))).toMatch(/merma/);
    expect(rechazo(conConsumo({ escalaConLaMedida: "sí" }))).toMatch(/sí o no/);
    expect(rechazo(conVersion({ ...VERSION, consumos: [7] }))).toMatch(/línea 1 del consumo no es válida/);
    expect(rechazo(conVersion(null))).toMatch(/versión no son válidos/);
  });

  it("los ids, el orden, «ninguna» y el ancla", () => {
    for (const grupoId of IDS_RAROS) expect(guardComandoCrearOpcionDeGrupo({ ...alta, grupoId }).ok).toBe(false);
    expect(rechazo(guardComandoCrearOpcionDeGrupo({ ...alta, orden: -1 }))).toMatch(/orden/);
    expect(rechazo(guardComandoCrearOpcionDeGrupo({ ...alta, esNinguna: 1 }))).toMatch(/sí o no/);
    expect(rechazo(guardComandoCrearOpcionDeGrupo({ ...alta, ancla: "u1" }))).toMatch(/producto de respaldo/);
    expect(rechazo(guardComandoCrearOpcionDeGrupo({ ...alta, ancla: { unidadStockId: "" } }))).toMatch(/unidad del producto de respaldo/);
  });

  it("editar una opción y agregar una versión exigen una versión o un número esperado entero ≥ 1", () => {
    const edicion = { opcionId: "o1", versionEsperada: 1, nombre: "Almendras", orden: 0, activa: true };
    expect(guardComandoEditarOpcionDeGrupo(edicion)).toEqual({ ok: true, valor: edicion });
    expect(rechazo(guardComandoEditarOpcionDeGrupo({ ...edicion, opcionId: 7 }))).toMatch(/No se encontró la opción/);
    expect(rechazo(guardComandoEditarOpcionDeGrupo({ ...edicion, versionEsperada: 0 }))).toMatch(/recargá/);
    expect(rechazo(guardComandoEditarOpcionDeGrupo({ ...edicion, activa: null }))).toMatch(/sí o no/);
    expect(guardComandoAgregarVersionDeOpcion({ opcionId: "o1", numeroEsperado: 4, version: VERSION }).ok).toBe(true);
    expect(rechazo(guardComandoAgregarVersionDeOpcion({ opcionId: "o1", numeroEsperado: 0, version: VERSION }))).toMatch(/recargá/);
    expect(rechazo(guardComandoAgregarVersionDeOpcion({ opcionId: "o1", numeroEsperado: Number.NaN, version: VERSION }))).toMatch(/recargá/);
  });
});

describe("guardComandoFijarAdmisionDeGrupo", () => {
  const opcion = { opcionId: "o1", versionEsperada: 0, cantidadMaxima: 1, precioAbsoluto: 2800, diferencia: null, activo: true };
  const admision = { productoId: "p1", grupoId: "g1", versionEsperada: 0, orden: 0, cantidadMinima: null, cantidadMaxima: null, modoPrecio: "ABSOLUTO", activo: true, opciones: [opcion] };

  it("camino feliz y valores por defecto (tope 1, activa)", () => {
    expect(guardComandoFijarAdmisionDeGrupo(admision)).toEqual({ ok: true, valor: admision });
    expect(guardComandoFijarAdmisionDeGrupo({ ...admision, modoPrecio: undefined, opciones: [{ opcionId: "o1", versionEsperada: 2, precioAbsoluto: null }] })).toEqual({
      ok: true,
      valor: { ...admision, modoPrecio: null, opciones: [{ opcionId: "o1", versionEsperada: 2, cantidadMaxima: 1, precioAbsoluto: null, diferencia: null, activo: true }] },
    });
  });

  it("rechazos: ids, versión, cantidades, modo, «activo», la lista y cada opción", () => {
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, productoId: null }))).toMatch(/producto/);
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, grupoId: {} }))).toMatch(/grupo/);
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, versionEsperada: -1 }))).toMatch(/recargá/);
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, cantidadMinima: 11 }))).toMatch(/mínimo/);
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, cantidadMaxima: 0 }))).toMatch(/máximo/);
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, modoPrecio: "FIJO" }))).toMatch(/modo de precio/);
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, activo: undefined }))).toMatch(/sí o no/);
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, opciones: {} }))).toMatch(/no son una lista/);
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, opciones: Array.from({ length: 101 }, () => opcion) }))).toMatch(/más de 100/);
    const conOpcion = (o: Record<string, unknown>) => guardComandoFijarAdmisionDeGrupo({ ...admision, opciones: [{ ...opcion, ...o }] });
    expect(rechazo(conOpcion({ opcionId: "" }))).toMatch(/opción 1 no es válida/);
    expect(rechazo(conOpcion({ versionEsperada: 1.5 }))).toMatch(/recargá/);
    expect(rechazo(conOpcion({ cantidadMaxima: 11 }))).toMatch(/tope/);
    expect(rechazo(conOpcion({ precioAbsoluto: 0 }))).toMatch(/mayor que cero/);
    expect(rechazo(conOpcion({ precioAbsoluto: 10.005 }))).toMatch(/2 decimales/);
    expect(rechazo(conOpcion({ precioAbsoluto: Number.NaN }))).toMatch(/no es un número válido/);
    expect(rechazo(conOpcion({ diferencia: { tipo: "PORCENTAJE", porcentaje: -100 } }))).toMatch(/mayor que -100/);
    expect(rechazo(conOpcion({ activo: "sí" }))).toMatch(/sí o no/);
    expect(rechazo(guardComandoFijarAdmisionDeGrupo({ ...admision, opciones: [null] }))).toMatch(/opción 1 no es válida/);
  });
});

describe("opciones por sucursal: el eco de la sucursal va PRIMERO", () => {
  it("apagar: eco, id y booleano", () => {
    const base = { sucursalId: "s-a", sucursalActivaId: "s-a", opcionId: "o1", apagada: true };
    expect(guardComandoApagarOpcionEnSucursal(base)).toEqual({ ok: true, valor: { opcionId: "o1", apagada: true } });
    expect(rechazo(guardComandoApagarOpcionEnSucursal({ ...base, sucursalId: "s-b", opcionId: 7 }))).toBe(MENSAJE_SUCURSAL_CAMBIADA);
    expect(rechazo(guardComandoApagarOpcionEnSucursal({ ...base, sucursalId: undefined }))).toBe(MENSAJE_SUCURSAL_CAMBIADA);
    expect(rechazo(guardComandoApagarOpcionEnSucursal({ ...base, opcionId: null }))).toMatch(/opción/);
    expect(rechazo(guardComandoApagarOpcionEnSucursal({ ...base, apagada: "true" }))).toMatch(/apagada o prendida/);
  });

  it("precio local: eco, ids, el precio que se vio y el nuevo (0,01 o más, hasta 2 decimales); `null` da de baja", () => {
    const base = { sucursalId: "s-a", sucursalActivaId: "s-a", productoId: "p1", opcionId: "o1", esperado: { precio: 3000, habilitado: true }, precio: 3200.5 };
    expect(guardComandoFijarPrecioLocalDeOpcion(base)).toEqual({ ok: true, valor: { productoId: "p1", opcionId: "o1", esperado: { precio: 3000, habilitado: true }, precio: 3200.5 } });
    expect(guardComandoFijarPrecioLocalDeOpcion({ ...base, esperado: null, precio: null })).toEqual({ ok: true, valor: { productoId: "p1", opcionId: "o1", esperado: null, precio: null } });
    expect(rechazo(guardComandoFijarPrecioLocalDeOpcion({ ...base, sucursalId: "s-b" }))).toBe(MENSAJE_SUCURSAL_CAMBIADA);
    expect(rechazo(guardComandoFijarPrecioLocalDeOpcion({ ...base, productoId: "" }))).toMatch(/producto/);
    expect(rechazo(guardComandoFijarPrecioLocalDeOpcion({ ...base, opcionId: [] }))).toMatch(/opción/);
    expect(rechazo(guardComandoFijarPrecioLocalDeOpcion({ ...base, esperado: "3000" }))).toMatch(/recargala/);
    expect(rechazo(guardComandoFijarPrecioLocalDeOpcion({ ...base, esperado: { precio: 3000 } }))).toMatch(/recargala/);
    expect(rechazo(guardComandoFijarPrecioLocalDeOpcion({ ...base, esperado: { precio: 0, habilitado: true } }))).toMatch(/mayor que cero/);
    expect(rechazo(guardComandoFijarPrecioLocalDeOpcion({ ...base, precio: 0 }))).toMatch(/mayor que cero/);
    expect(rechazo(guardComandoFijarPrecioLocalDeOpcion({ ...base, precio: 10.001 }))).toMatch(/2 decimales/);
    expect(rechazo(guardComandoFijarPrecioLocalDeOpcion({ ...base, precio: -5 }))).toMatch(/negativo/);
    for (const raro of RAROS) expect(guardComandoFijarPrecioLocalDeOpcion({ ...base, precio: raro }).ok, String(raro)).toBe(false);
  });
});
