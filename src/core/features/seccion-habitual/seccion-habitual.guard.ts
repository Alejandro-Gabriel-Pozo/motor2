import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoEliminarSeccionHabitual, ComandoSeccionHabitual } from "./seccion-habitual.schema";

const id = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Guard de la feature «Sección habitual» (convención "guard por feature", ver src/core/features/compras/compra.guard.ts;
 * docs/plan-seccion-habitual-stock-2026-09-25.md, C2). Solo FORMATO de lo que llega del formulario: un producto y una sección
 * elegidos (ids de texto no vacíos, recortados; cualquier otra cosa cuenta como "no elegido"). Puro: sin Prisma ni permisos — que el
 * producto sea un PV y la sección, una activa de la sucursal, lo resuelve el caso de uso (`set-seccion-habitual.ts`) contra la base.
 *
 * Hito 4 de la pureza (bloque C, paso H4C-20): se llamaba `guardSeccionHabitual`; pasa a `guardComandoSeccionHabitual` porque `acciones-migradas-con-guard` solo
 * reconoce los guards con el prefijo `guardComando` (mismo cuerpo, mismos textos). Lo llama la Server Action DENTRO de su `conPermiso(…)`.
 */
export function guardComandoSeccionHabitual(datos: { productoId: unknown; seccionId: unknown }): ResultadoDato<ComandoSeccionHabitual> {
  const productoId = id(datos.productoId);
  if (!productoId) return rechazar("vacio", "Elegí un producto.");
  const seccionId = id(datos.seccionId);
  if (!seccionId) return rechazar("vacio", "Elegí la sección habitual.");
  return aceptar({ productoId, seccionId });
}

/**
 * Guard de «quitar la sección habitual» (Hito 4, H4C-20): EXACTAMENTE lo que antes hacía `eliminarSeccionHabitual` antes de leer la fila — un id que no es texto
 * no se busca y responde el mismo «No se encontró esa sección habitual.» que una fila que no existe (sin recortar: el id se busca tal cual, como antes).
 */
export function guardComandoEliminarSeccionHabitual(datos: { id: unknown }): ResultadoDato<ComandoEliminarSeccionHabitual> {
  if (typeof datos.id !== "string") return rechazar("formato", "No se encontró esa sección habitual.");
  return aceptar({ id: datos.id });
}
