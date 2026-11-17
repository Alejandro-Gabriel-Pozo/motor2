import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidirConfirmacionDeRecepcion, decidirRegistroDeControl, estadoInicialDeLaParte, validarControlDeLinea, validarEntradasDeRecepcion } from "../../src/core/compras/public";
import type { EntradaDeConfirmacionDeRecepcion } from "../../src/core/compras/public";
import { modulosEfectivos } from "../../src/core/modulos/clausura";
import { denegacionDeModulo } from "../../src/core/permisos/modulo-de-la-accion";
import { ACCIONES, nivelMinimoDeAccion } from "../../src/core/permisos/acciones";
import { nivelAlcanzaElPiso, nivelDe } from "../../src/core/permisos/jerarquia";
import { ROL_EMPRESA_GERENTE } from "../../src/core/permisos/rol-empresa";
import { dimensionesDelOraculo, productoCartesiano, tablaDelOraculo, type TablaDelOraculo } from "./oraculo-una-sola-compra";

/**
 * Lector del oráculo de la recepción separada de compras (`docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md`). Las tablas de reglas viven APARTE del código; este archivo solo las PARSEA y traduce cada fila a la entrada de
 * las reglas reales (no copia ningún resultado esperado). Lo usan el test exhaustivo de las reglas puras, el de integración y el guardián de dimensiones declaradas. Reutiliza el lector de `oraculo-una-sola-compra.ts`.
 */
const RUTA_DEL_ORACULO = join(__dirname, "../../docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md");
const TEXTO_DEL_ORACULO_DE_RECEPCION = readFileSync(RUTA_DEL_ORACULO, "utf8");

export const dimensionesDeRecepcion = (): Record<string, string[]> => dimensionesDelOraculo(TEXTO_DEL_ORACULO_DE_RECEPCION);
export const tablaDeRecepcion = (seccion: string): TablaDelOraculo => tablaDelOraculo(seccion, TEXTO_DEL_ORACULO_DE_RECEPCION);
export { productoCartesiano };

export type FilaDeConfirmacion = { M: string; O: string; P: string; E: string; S: string };

/** La entrada de la regla pura de confirmar para una fila del oráculo. */
function entradaDeLaRegla(f: Pick<FilaDeConfirmacion, "P" | "E" | "S">): EntradaDeConfirmacionDeRecepcion {
  return {
    esDeLaSucursalDelActor: f.P === "PROPIA",
    facturaAnulada: f.E === "ANULADA",
    estadoDeLaParte: f.E === "RECIBIDA" ? "RECIBIDA" : "PENDIENTE",
    seccion: f.S as EntradaDeConfirmacionDeRecepcion["seccion"],
  };
}

/** La puerta de la Server Action (guard): módulo → piso del rol, con las funciones reales del acceso. `null` = pasa. */
export function puertaDeAcceso(f: Pick<FilaDeConfirmacion, "M" | "O">, accion: "compra_recibir" | "compra_controlar_recepcion" = "compra_recibir"): "RECHAZA_MODULO_NO_ACTIVO" | "RECHAZA_SIN_PERMISO" | null {
  const efectivos = modulosEfectivos(f.M === "ENCENDIDO" ? ["compras", "recepcion_de_compras"] : ["compras"]);
  if (denegacionDeModulo("recepcion_de_compras", efectivos)) return "RECHAZA_MODULO_NO_ACTIVO";
  const nivel = nivelDe({ rolEmpresa: f.O === "GERENTE" ? ROL_EMPRESA_GERENTE : null, esAdminEnElContexto: f.O === "ADMINISTRADOR" });
  if (!nivelAlcanzaElPiso(nivel, nivelMinimoDeAccion(accion))) return "RECHAZA_SIN_PERMISO";
  // PISOS-65 (2026-11-17): `compra_recibir` bajó a piso operario y nace cerrada (de fábrica solo `admin`): el OPERADOR de fábrica no tiene la fila. Lo que decide es la semilla, no el piso.
  const semilla = ACCIONES.find((a) => a.clave === accion)!.rolesEditarSemilla as readonly string[];
  if (f.O === "OPERADOR" && !semilla.includes("operador")) return "RECHAZA_SIN_PERMISO";
  return null;
}

/** Lo que las reglas reales deciden para una fila de «Confirmar la recepción». */
export function resultadoDeConfirmar(f: FilaDeConfirmacion): string {
  const puerta = puertaDeAcceso(f);
  if (puerta) return puerta;
  const decision = decidirConfirmacionDeRecepcion(entradaDeLaRegla(f));
  return decision.ok ? (decision.yaRecibida ? "CONFIRMA_YA_RECIBIDA" : "CONFIRMA") : `RECHAZA_${decision.codigo}`;
}

/** Lo que las reglas reales deciden para una fila de «Cargar la factura». */
export function resultadoDeCargar(f: { M: string; R: string }): string {
  return estadoInicialDeLaParte({ moduloEncendido: f.M === "ENCENDIDO", hayPartesAjenas: f.R === "REPARTIDA" }) === "PENDIENTE" ? "PARTE_PENDIENTE_SIN_STOCK" : "PARTE_RECIBIDA_CON_STOCK";
}

// ------------------------------------------------------------------------------------------------
// N3-b: el control por línea y las entradas de stock
// ------------------------------------------------------------------------------------------------

/** El valor de cada nivel de la dimensión de la condición, de la observación y de la cantidad según remito, tal como llegarían al servidor. */
const CONDICION_DE_PRUEBA: Record<string, unknown> = { CONFORME: "CONFORME", CON_OBSERVACIONES: "CON_OBSERVACIONES", RECHAZADA: "RECHAZADA", FUERA_DE_LISTA: "DEVUELTA" };
const OBSERVACION_DE_PRUEBA: Record<string, unknown> = { SIN: undefined, VALIDA: "Llegó con la caja rota", INVALIDA: "Caja <rota>" };
const CANTIDAD_SEGUN_REMITO_DE_PRUEBA: Record<string, unknown> = { SIN: undefined, VALIDA: 9.5, INVALIDA: 0 };

export type FilaDeControl = { C: string; B: string; Q: string };

/** Lo que la regla real decide para una fila de «Registrar el control de una línea». */
export function resultadoDeControlDeLinea(f: FilaDeControl): string {
  const r = validarControlDeLinea({ condicion: CONDICION_DE_PRUEBA[f.C], observacion: OBSERVACION_DE_PRUEBA[f.B], cantidadSegunRemito: CANTIDAD_SEGUN_REMITO_DE_PRUEBA[f.Q] });
  return r.ok ? "GUARDA" : `RECHAZA_${r.codigo}`;
}

export type FilaDePuertaDeControl = { M: string; O: string; P: string; E: string };

/** Lo que las reglas reales deciden para una fila de «Registrar el control: puerta y estado». */
export function resultadoDePuertaDeControl(f: FilaDePuertaDeControl): string {
  const puerta = puertaDeAcceso(f, "compra_controlar_recepcion");
  if (puerta) return puerta;
  const d = decidirRegistroDeControl({ esDeLaSucursalDelActor: f.P === "PROPIA", facturaAnulada: f.E === "ANULADA", estadoDeLaParte: f.E === "RECIBIDA" ? "RECIBIDA" : "PENDIENTE" });
  return d.ok ? "GUARDA" : `RECHAZA_${d.codigo}`;
}

/** Los destinos de stock de cada valor de la dimensión N para dos renglones (r1 y r2) y dos secciones. */
const ENTRADAS_DE_PRUEBA: Record<string, { renglonId: string; seccionId: string }[]> = {
  UNA_SECCION: [{ renglonId: "r1", seccionId: "s1" }, { renglonId: "r2", seccionId: "s2" }],
  DOS_SECCIONES: [{ renglonId: "r1", seccionId: "s1" }, { renglonId: "r1", seccionId: "s2" }, { renglonId: "r2", seccionId: "s2" }],
  MISMA_SECCION_DOS_VECES: [{ renglonId: "r1", seccionId: "s1" }, { renglonId: "r1", seccionId: "s1" }, { renglonId: "r2", seccionId: "s2" }],
};

export type FilaDeEntradas = { N: string; K: string };

/** Lo que la regla real decide para una fila de «Entradas de la confirmación». La dimensión K (el control) NO entra en la regla: es justamente lo que el oráculo declara que no cambia el resultado. */
export function resultadoDeEntradas(f: FilaDeEntradas): string {
  const r = validarEntradasDeRecepcion(["r1", "r2"], ENTRADAS_DE_PRUEBA[f.N]!);
  return r.ok ? "CONFIRMA" : `RECHAZA_${r.codigo}`;
}
