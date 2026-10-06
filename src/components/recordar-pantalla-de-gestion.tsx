"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { accionDeRuta } from "@/core/navegacion/estructura";
import { CLAVE_PANTALLA_DE_GESTION, type PantallaGuardada } from "@/core/navegacion/pantalla-tras-cambio";

/**
 * Anota en `sessionStorage` (por pestaña, sobrevive a la recarga) la última pantalla de gestión abierta y su sucursal, para que
 * «Administración» en el salón (`EnlaceAdministracion`) vuelva a ella. Solo anota pantallas del menú (las que tienen acción conocida).
 * No dibuja nada.
 */
export function RecordarPantallaDeGestion({ sucursalId }: { sucursalId: string }) {
  const pathname = usePathname();
  const consulta = useSearchParams().toString();

  useEffect(() => {
    if (accionDeRuta(pathname) === null) return;
    const guardada: PantallaGuardada = { sucursalId, ruta: consulta ? `${pathname}?${consulta}` : pathname };
    try {
      sessionStorage.setItem(CLAVE_PANTALLA_DE_GESTION, JSON.stringify(guardada));
    } catch {
      // sin almacenamiento (ventana privada, bloqueado): «Administración» vuelve al inicio, como antes
    }
  }, [pathname, consulta, sucursalId]);

  return null;
}
