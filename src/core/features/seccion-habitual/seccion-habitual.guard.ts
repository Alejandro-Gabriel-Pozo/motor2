import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";

const id = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Guard de la feature «Sección habitual» (convención "guard por feature", ver src/core/features/compras/compra.guard.ts;
 * docs/plan-seccion-habitual-stock-2026-09-25.md, C2). Solo FORMATO de lo que llega del formulario: un producto y una sección
 * elegidos (ids de texto no vacíos, recortados; cualquier otra cosa cuenta como "no elegido"). Puro: sin Prisma ni permisos — que el
 * producto sea un PV y la sección, una activa de la sucursal, lo resuelve la Server Action (`setSeccionHabitual`) contra la base.
 */
export function guardSeccionHabitual(datos: { productoId: unknown; seccionId: unknown }): ResultadoDato<{ productoId: string; seccionId: string }> {
  const productoId = id(datos.productoId);
  if (!productoId) return rechazar("vacio", "Elegí un producto.");
  const seccionId = id(datos.seccionId);
  if (!seccionId) return rechazar("vacio", "Elegí la sección habitual.");
  return aceptar({ productoId, seccionId });
}
