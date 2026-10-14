import { numeroDelCampo } from "@/core/datos/numero-tecleado";

/**
 * Lo que mandan los campos de precio y de consumo de una opción (`CamposDeVersion`) armado como los datos de una versión, tal cual los espera la Server Action. NO valida:
 * el guard de `core/features/catalogo/opciones-de-venta.guard.ts` lo hace todo (por eso devuelve `unknown`); acá solo se lee el FormData. Un número mal escrito llega como `NaN`
 * (`numeroDelCampo`) y el servidor lo rechaza con su mensaje, nunca como un 0 falso. Los consumos viajan como JSON en un campo oculto; uno que no se puede leer llega tal cual
 * (texto) y el guard lo rechaza.
 */
export function versionDelFormulario(fd: FormData): { diferencia: unknown; factorEscala: unknown; consumos: unknown } {
  const valor = numeroDelCampo(String(fd.get("valorDiferencia") ?? ""));
  const tipo = String(fd.get("tipoDiferencia") ?? "MONTO");
  const diferencia = tipo === "PORCENTAJE" ? { tipo: "PORCENTAJE", porcentaje: valor } : { tipo: "MONTO", monto: valor };
  const factorTexto = String(fd.get("factorEscala") ?? "").trim();
  const crudo = String(fd.get("consumos") ?? "").trim();
  let consumos: unknown = [];
  if (crudo) {
    try {
      consumos = JSON.parse(crudo) as unknown;
    } catch {
      consumos = crudo;
    }
  }
  return { diferencia, factorEscala: factorTexto === "" ? null : numeroDelCampo(factorTexto), consumos };
}
