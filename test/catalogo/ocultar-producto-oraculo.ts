/**
 * ORÁCULO de «Ocultar» (docs/diseno-ocultar-como-pedernal-2026-11-15.md, §10.2): las reglas esperadas ESCRITAS APARTE del código, como
 * tabla legible. NO importa nada de `src/core/catalogo/ocultar-producto.ts` más que los TIPOS y las listas de valores (para recorrer),
 * nunca la lógica: si lo hiciera, el test compararía el código consigo mismo.
 *
 * Cada regla: un id (R-n del diseño), una condición sobre la entrada y el resultado esperado. El test exige que CADA combinación caiga
 * en EXACTAMENTE una regla (sin huecos ni solapes): un hueco es una combinación que nadie decidió (todo nace cerrado), un solape es una
 * contradicción entre reglas.
 */
import type { EntradaDeDecision, MotivoDeRechazo, OperacionDeAdministracion, OperacionDeProducto } from "@/core/catalogo/ocultar-producto";

export type Esperado = "permitido" | MotivoDeRechazo;

export interface Regla {
  readonly id: string;
  readonly texto: string;
  readonly cuando: (e: EntradaDeDecision) => boolean;
  readonly esperado: (e: EntradaDeDecision) => Esperado;
}

const esAdmin = (e: EntradaDeDecision): e is Extract<EntradaDeDecision, { quien: unknown }> => "quien" in e;
const opDeProducto = (e: EntradaDeDecision, ...ops: OperacionDeProducto[]) => !esAdmin(e) && ops.includes(e.operacion);
const opDeAdmin = (e: EntradaDeDecision, ...ops: OperacionDeAdministracion[]) => esAdmin(e) && ops.includes(e.operacion);
const oculto = (e: EntradaDeDecision) => e.hechos.ocultar.empresa || e.hechos.ocultar.local;
const desactivado = (e: EntradaDeDecision) => e.hechos.desactivar === "desactivado";

const LINEA_NUEVA: OperacionDeProducto[] = ["agregar_linea_salon", "agregar_linea_cuenta_mostrador", "venta_directa_mostrador"];
const VISIBILIDAD: OperacionDeProducto[] = ["carta_publica", "selector_pos"];

/** Permiso/alcance de ocultar y mostrar: la empresa solo la administración; el local, su operador o la administración. */
const permisoOcultar = (e: Extract<EntradaDeDecision, { quien: unknown }>): Esperado =>
  e.quien === "sin_permiso"
    ? "SIN_PERMISO"
    : e.alcance === "empresa"
      ? e.quien === "admin_alcance_total" ? "permitido" : "SIN_PERMISO"
      : e.quien === "operador_de_otro_local" ? "FUERA_DE_ALCANCE" : "permitido";

export const ORACULO: readonly Regla[] = [
  // --- Lo que se ve (R-1, R-2): aparece solo si está activo Y visible. El desactivado gana como motivo (decisión técnica 7).
  { id: "R-1", texto: "carta y selector: activo y visible → aparece", cuando: (e) => opDeProducto(e, ...VISIBILIDAD) && !desactivado(e) && !oculto(e), esperado: () => "permitido" },
  { id: "R-2a", texto: "carta y selector: desactivado → no aparece", cuando: (e) => opDeProducto(e, ...VISIBILIDAD) && desactivado(e), esperado: () => "PRODUCTO_DESACTIVADO" },
  { id: "R-2b", texto: "carta y selector: activo pero oculto → no aparece", cuando: (e) => opDeProducto(e, ...VISIBILIDAD) && !desactivado(e) && oculto(e), esperado: () => "PRODUCTO_OCULTO" },
  // --- Línea nueva (R-3, R-4).
  { id: "R-3", texto: "línea nueva, activo y visible → se agrega", cuando: (e) => opDeProducto(e, ...LINEA_NUEVA) && !desactivado(e) && !oculto(e), esperado: () => "permitido" },
  { id: "R-4", texto: "línea nueva, desactivado → rechazo «desactivado» (como hoy; gana sobre oculto)", cuando: (e) => opDeProducto(e, ...LINEA_NUEVA) && desactivado(e), esperado: () => "PRODUCTO_DESACTIVADO" },
  { id: "R-3b", texto: "línea nueva, activo pero oculto → «Este producto está oculto.»", cuando: (e) => opDeProducto(e, ...LINEA_NUEVA) && !desactivado(e) && oculto(e), esperado: () => "PRODUCTO_OCULTO" },
  // --- Cobrar lo ya cargado (R-5).
  { id: "R-5a", texto: "cobrar línea ya cargada: se cobra aunque esté oculto", cuando: (e) => opDeProducto(e, "cobrar_linea_ya_cargada") && !desactivado(e), esperado: () => "permitido" },
  { id: "R-5b", texto: "cobrar línea ya cargada con el producto desactivado: rechaza como hoy (Desactivar no cambia)", cuando: (e) => opDeProducto(e, "cobrar_linea_ya_cargada") && desactivado(e), esperado: () => "PRODUCTO_DESACTIVADO" },
  // --- Movimientos de stock (R-6, R-7). D3 es el saldo FINAL de la operación.
  { id: "R-6a", texto: "entrada que suma: oculto y saldo final por encima de cero → rechazo", cuando: (e) => opDeProducto(e, "entrada_que_suma") && !desactivado(e) && oculto(e) && e.hechos.saldo === "positivo", esperado: () => "PRODUCTO_OCULTO" },
  { id: "R-6b", texto: "entrada que suma: visible, o saldo final que no pasa de cero → permitido", cuando: (e) => opDeProducto(e, "entrada_que_suma") && !desactivado(e) && !(oculto(e) && e.hechos.saldo === "positivo"), esperado: () => "permitido" },
  { id: "R-6c", texto: "entrada que suma con el producto desactivado: rechaza como hoy", cuando: (e) => opDeProducto(e, "entrada_que_suma") && desactivado(e), esperado: () => "PRODUCTO_DESACTIVADO" },
  { id: "R-7a", texto: "salida que resta / corregir negativo hasta cero: permitido aunque esté oculto", cuando: (e) => opDeProducto(e, "salida_que_resta", "corregir_negativo_hasta_cero") && !desactivado(e), esperado: () => "permitido" },
  { id: "R-7b", texto: "salida que resta / corregir con el producto desactivado: rechaza como hoy", cuando: (e) => opDeProducto(e, "salida_que_resta", "corregir_negativo_hasta_cero") && desactivado(e), esperado: () => "PRODUCTO_DESACTIVADO" },
  // --- Anular (R-8, R-9, O-11).
  { id: "R-8", texto: "anular venta: oculto y el producto quedaría con saldo por encima de cero → rechazo «oculto»", cuando: (e) => opDeProducto(e, "anular_venta") && oculto(e) && e.hechos.saldo === "positivo", esperado: () => "PRODUCTO_OCULTO" },
  { id: "R-9", texto: "anular venta: visible (aunque esté desactivado), o saldo final que no pasa de cero → permitido (O-11)", cuando: (e) => opDeProducto(e, "anular_venta") && !(oculto(e) && e.hechos.saldo === "positivo"), esperado: () => "permitido" },
  // --- Contar (R-10).
  { id: "R-10a", texto: "contar: activo y visible → permitido", cuando: (e) => opDeProducto(e, "contar") && !desactivado(e) && !oculto(e), esperado: () => "permitido" },
  { id: "R-10b", texto: "contar: desactivado → rechazo (como hoy)", cuando: (e) => opDeProducto(e, "contar") && desactivado(e), esperado: () => "PRODUCTO_DESACTIVADO" },
  { id: "R-10c", texto: "contar: activo pero oculto → rechazo", cuando: (e) => opDeProducto(e, "contar") && !desactivado(e) && oculto(e), esperado: () => "PRODUCTO_OCULTO" },
  // --- Ocultar y mostrar (R-11 a R-15, R-17).
  { id: "R-13/14", texto: "ocultar: sin permiso, la empresa sin ser administración, o un local ajeno → rechazo antes de mirar el stock", cuando: (e) => opDeAdmin(e, "ocultar") && esAdmin(e) && permisoOcultar(e) !== "permitido", esperado: (e) => (esAdmin(e) ? permisoOcultar(e) : "SIN_PERMISO") },
  { id: "R-11", texto: "ocultar con permiso y saldo distinto de cero (también negativo) → rechazo por existencia", cuando: (e) => opDeAdmin(e, "ocultar") && esAdmin(e) && permisoOcultar(e) === "permitido" && e.hechos.saldo !== "cero", esperado: () => "TIENE_EXISTENCIA" },
  { id: "R-12/17", texto: "ocultar con permiso y saldo cero → se oculta (no mira recetas ni Desactivar)", cuando: (e) => opDeAdmin(e, "ocultar") && esAdmin(e) && permisoOcultar(e) === "permitido" && e.hechos.saldo === "cero", esperado: () => "permitido" },
  { id: "R-15a", texto: "mostrar: sin permiso o fuera de alcance → rechazo", cuando: (e) => opDeAdmin(e, "mostrar") && esAdmin(e) && permisoOcultar(e) !== "permitido", esperado: (e) => (esAdmin(e) ? permisoOcultar(e) : "SIN_PERMISO") },
  { id: "R-15b", texto: "mostrar desde un local lo que la empresa oculta → rechazo", cuando: (e) => opDeAdmin(e, "mostrar") && esAdmin(e) && permisoOcultar(e) === "permitido" && e.alcance === "local" && e.hechos.ocultar.empresa, esperado: () => "EMPRESA_LO_OCULTA" },
  { id: "R-15c", texto: "mostrar con permiso, sin condiciones de stock → permitido", cuando: (e) => opDeAdmin(e, "mostrar") && esAdmin(e) && permisoOcultar(e) === "permitido" && !(e.alcance === "local" && e.hechos.ocultar.empresa), esperado: () => "permitido" },
  // --- Desactivar y activar (R-16, no cambia).
  { id: "R-16p", texto: "desactivar / activar: sin permiso o local ajeno → rechazo", cuando: (e) => opDeAdmin(e, "desactivar", "activar") && esAdmin(e) && (e.quien === "sin_permiso" || e.quien === "operador_de_otro_local"), esperado: (e) => (esAdmin(e) && e.quien === "sin_permiso" ? "SIN_PERMISO" : "FUERA_DE_ALCANCE") },
  { id: "R-16a", texto: "desactivar con permiso: receta vigente → bloqueo", cuando: (e) => opDeAdmin(e, "desactivar") && esAdmin(e) && e.quien !== "sin_permiso" && e.quien !== "operador_de_otro_local" && e.hechos.enRecetaVigente, esperado: () => "EN_RECETA_VIGENTE" },
  { id: "R-16b", texto: "desactivar con permiso, sin receta: saldo distinto de cero → bloqueo", cuando: (e) => opDeAdmin(e, "desactivar") && esAdmin(e) && e.quien !== "sin_permiso" && e.quien !== "operador_de_otro_local" && !e.hechos.enRecetaVigente && e.hechos.saldo !== "cero", esperado: () => "TIENE_EXISTENCIA" },
  { id: "R-16c", texto: "desactivar con permiso, sin receta y en cero → se desactiva", cuando: (e) => opDeAdmin(e, "desactivar") && esAdmin(e) && e.quien !== "sin_permiso" && e.quien !== "operador_de_otro_local" && !e.hechos.enRecetaVigente && e.hechos.saldo === "cero", esperado: () => "permitido" },
  { id: "R-16d", texto: "activar con permiso: sin condiciones de stock ni de Ocultar → permitido", cuando: (e) => opDeAdmin(e, "activar") && esAdmin(e) && e.quien !== "sin_permiso" && e.quien !== "operador_de_otro_local", esperado: () => "permitido" },
];
