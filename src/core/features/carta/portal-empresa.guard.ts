import { validarMarcaParaGuardar, validarValoresPortal } from "@/core/carta/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoGuardarPortalEmpresa } from "./portal-empresa.schema";

/**
 * Guard de la feature «portal de la empresa» (convención «guard por feature», 2026-09-25; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Formato del comando,
 * ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa("carta_portal", …)`, así que el rechazo por permiso sigue llegando antes que el
 * de formato. Puro: sin Prisma ni permisos.
 *
 * Es EXACTAMENTE la validación que antes era lo primero de `guardarPortalEmpresa` (no lee nada antes): `validarValoresPortal` normaliza, ignora lo que no es del
 * catálogo y, si hay errores, devuelve hasta 5 juntos en un mismo mensaje, que pasa tal cual.
 */
export function guardComandoGuardarPortalEmpresa(valores: Readonly<Record<string, unknown>>): ResultadoDato<ComandoGuardarPortalEmpresa> {
  const validados = validarValoresPortal(valores);
  if (!validados.ok) return rechazar("formato", validados.mensaje);
  // Marca del portal (`docs/diseno-marca-del-portal-2026-11-13.md`): con el marcador `portal_marca_derivada = «si»` el color de marca tiene que ser `#rrggbb` en minúsculas (M1), el texto sobre él tiene que llegar a 4,5:1 (M2)
  // y él contra el fondo claro a 3:1 (M3); si no, se rechaza ANTES de escribir y el mensaje dice qué hacer (decisión del dueño 2026-11-13: «Se rechaza y dice qué hacer (Recomendada)»). Sin marcador, el guardado de siempre.
  if (validados.valor.portal_marca_derivada === "si") {
    const marca = validarMarcaParaGuardar(validados.valor.portal_color_marca);
    if (!marca.ok) return rechazar("formato", `Color de marca del portal: ${marca.mensaje}`);
  }
  return aceptar({ valores: validados.valor });
}
