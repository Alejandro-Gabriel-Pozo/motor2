import type { AccionClave } from "@/core/permisos/acciones";
import { accionDeRuta, itemDeRuta } from "./estructura";
import { rutaInternaSegura } from "./volver";

/**
 * A qué pantalla ir al cambiar de sucursal: la MISMA en la que se estaba, si existe y el rol la puede ver en la sucursal nueva; si no,
 * `null` (quien llama manda a la raíz, que decide por la cookie nueva). Solo puede devolver el `href` de un ítem conocido del menú, nunca
 * la ruta que llegó: así un argumento malicioso no puede sacar del sitio ni llevar a una ruta que no es del menú, y se descartan la
 * consulta y el ancla (pueden traer ids de la sucursal anterior) y los ids de la ruta (`/mesas/abc` → `/mesas`, `/catalogo/recetas/x` → la lista).
 * `puedeVer` son las acciones que el rol puede ver EN LA SUCURSAL NUEVA (no en la de la cookie).
 */
export function pantallaTrasCambiarSucursal(actual: string | null | undefined, puedeVer: ReadonlySet<AccionClave>): string | null {
  const segura = rutaInternaSegura(actual);
  if (segura === null) return null;
  const item = itemDeRuta(segura);
  if (item === null || !puedeVer.has(item.accion)) return null;
  return item.href;
}

/** La última pantalla de gestión que se abrió en esta pestaña (la guarda `RecordarPantallaDeGestion`). */
export interface PantallaGuardada {
  sucursalId: string;
  ruta: string;
}

const RUTA_DEL_SALON = "/mesas";

/**
 * A dónde lleva «Administración» desde el salón: a la última pantalla de gestión (con su consulta) si hay una guardada, es segura, no es
 * del salón y el rol la puede ver; si se estaba en OTRA sucursal, se aplica la regla de `pantallaTrasCambiarSucursal`; si no hay nada
 * que recordar, a `inicio`. Lo guardado vino del navegador: se revalida entero acá, no se confía en que lo escribió la aplicación.
 */
export function pantallaDeRegreso(guardada: PantallaGuardada | null, sucursalActual: string, puedeVer: ReadonlySet<AccionClave>, inicio: string): string {
  if (!guardada) return inicio;
  const ruta = rutaInternaSegura(guardada.ruta);
  if (ruta === null) return inicio;
  const camino = ruta.split(/[?#]/)[0].replace(/\/+$/, "");
  if (camino === RUTA_DEL_SALON || camino.startsWith(`${RUTA_DEL_SALON}/`)) return inicio;

  if (guardada.sucursalId !== sucursalActual) return pantallaTrasCambiarSucursal(ruta, puedeVer) ?? inicio;

  const accion = accionDeRuta(ruta);
  return accion !== null && puedeVer.has(accion) ? ruta : inicio;
}

/** La clave de `sessionStorage` (por pestaña) donde se guarda la `PantallaGuardada`. */
export const CLAVE_PANTALLA_DE_GESTION = "motor2.pantalla-de-gestion";

/** Lo que dejó escrito `RecordarPantallaDeGestion`, ya validado en su forma; `null` si no hay nada o no es una `PantallaGuardada`. */
export function leerPantallaGuardada(crudo: string | null): PantallaGuardada | null {
  if (!crudo) return null;
  try {
    const valor: unknown = JSON.parse(crudo);
    if (typeof valor !== "object" || valor === null) return null;
    const { sucursalId, ruta } = valor as Record<string, unknown>;
    return typeof sucursalId === "string" && typeof ruta === "string" ? { sucursalId, ruta } : null;
  } catch {
    return null;
  }
}
