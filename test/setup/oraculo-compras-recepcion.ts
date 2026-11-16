import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidirConfirmacionDeRecepcion, estadoInicialDeLaParte } from "../../src/core/compras/public";
import type { EntradaDeConfirmacionDeRecepcion } from "../../src/core/compras/public";
import { modulosEfectivos } from "../../src/core/modulos/clausura";
import { denegacionDeModulo } from "../../src/core/permisos/modulo-de-la-accion";
import { nivelMinimoDeAccion } from "../../src/core/permisos/acciones";
import { nivelAlcanzaElPiso, nivelDe } from "../../src/core/permisos/jerarquia";
import { ROL_EMPRESA_GERENTE } from "../../src/core/permisos/rol-empresa";
import { dimensionesDelOraculo, productoCartesiano, tablaDelOraculo, type TablaDelOraculo } from "./oraculo-una-sola-compra";

/**
 * Lector del oráculo de la recepción separada de compras (`docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md`). Las tablas de reglas viven APARTE del código; este archivo solo las PARSEA y traduce cada fila a la entrada de
 * las reglas reales (no copia ningún resultado esperado). Lo usan el test exhaustivo de las reglas puras, el de integración y el guardián de dimensiones declaradas. Reutiliza el lector de `oraculo-una-sola-compra.ts`.
 */
const RUTA_DEL_ORACULO = join(__dirname, "../../docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md");
export const TEXTO_DEL_ORACULO_DE_RECEPCION = readFileSync(RUTA_DEL_ORACULO, "utf8");

export const dimensionesDeRecepcion = (): Record<string, string[]> => dimensionesDelOraculo(TEXTO_DEL_ORACULO_DE_RECEPCION);
export const tablaDeRecepcion = (seccion: string): TablaDelOraculo => tablaDelOraculo(seccion, TEXTO_DEL_ORACULO_DE_RECEPCION);
export { productoCartesiano };

/** Los días fijos con que se evalúan las reglas: la factura del 10, hoy es el 15. */
export const DIA_FACTURA = "2026-11-10";
export const HOY = "2026-11-15";
export const DIA_DE_STOCK: Record<string, string> = { VALIDA: "2026-11-12", ANTERIOR_A_LA_FACTURA: "2026-11-09", FUTURA: "2026-11-16" };

export type FilaDeConfirmacion = { M: string; O: string; P: string; E: string; S: string; F: string };

/** La entrada de la regla pura de confirmar para una fila del oráculo. */
export function entradaDeLaRegla(f: Pick<FilaDeConfirmacion, "P" | "E" | "S" | "F">): EntradaDeConfirmacionDeRecepcion {
  return {
    esDeLaSucursalDelActor: f.P === "PROPIA",
    facturaAnulada: f.E === "ANULADA",
    estadoDeLaParte: f.E === "RECIBIDA" ? "RECIBIDA" : "PENDIENTE",
    seccion: f.S as EntradaDeConfirmacionDeRecepcion["seccion"],
    diaFactura: DIA_FACTURA,
    diaStock: DIA_DE_STOCK[f.F]!,
    hoy: HOY,
  };
}

/** La puerta de la Server Action (guard): módulo → piso del rol, con las funciones reales del acceso. `null` = pasa. */
export function puertaDeAcceso(f: Pick<FilaDeConfirmacion, "M" | "O">): "RECHAZA_MODULO_NO_ACTIVO" | "RECHAZA_SIN_PERMISO" | null {
  const efectivos = modulosEfectivos(f.M === "ENCENDIDO" ? ["compras", "recepcion_de_compras"] : ["compras"]);
  if (denegacionDeModulo("recepcion_de_compras", efectivos)) return "RECHAZA_MODULO_NO_ACTIVO";
  const nivel = nivelDe({ rolEmpresa: f.O === "GERENTE" ? ROL_EMPRESA_GERENTE : null, esAdminEnElContexto: f.O === "ADMINISTRADOR" });
  return nivelAlcanzaElPiso(nivel, nivelMinimoDeAccion("compra_recibir")) ? null : "RECHAZA_SIN_PERMISO";
}

/** Lo que las reglas reales deciden para una fila de «Confirmar la recepción». */
export function resultadoDeConfirmar(f: FilaDeConfirmacion): string {
  const puerta = puertaDeAcceso(f);
  if (puerta) return puerta;
  const decision = decidirConfirmacionDeRecepcion(entradaDeLaRegla(f));
  return decision.ok ? "CONFIRMA" : `RECHAZA_${decision.codigo}`;
}

/** Lo que las reglas reales deciden para una fila de «Cargar la factura». */
export function resultadoDeCargar(f: { M: string; R: string }): string {
  return estadoInicialDeLaParte({ moduloEncendido: f.M === "ENCENDIDO", hayPartesAjenas: f.R === "REPARTIDA" }) === "PENDIENTE" ? "PARTE_PENDIENTE_SIN_STOCK" : "PARTE_RECIBIDA_CON_STOCK";
}
