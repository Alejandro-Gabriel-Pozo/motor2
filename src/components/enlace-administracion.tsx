"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import type { AccionClave } from "@/core/permisos/acciones";
import { CLAVE_PANTALLA_DE_GESTION, leerPantallaGuardada, pantallaDeRegreso } from "@/core/navegacion/pantalla-tras-cambio";
import { IndicadorDeEnlace } from "./indicador-de-enlace";

const sinSuscripcion = () => () => {};
const leerAlmacenado = () => {
  try {
    return sessionStorage.getItem(CLAVE_PANTALLA_DE_GESTION);
  } catch {
    return null;
  }
};
const delServidor = () => null;

/**
 * «Administración» en el encabezado del salón: vuelve a la última pantalla de gestión de esta pestaña (con sus filtros) si hay una y el
 * rol todavía la ve; si no, a `inicio`. El primer dibujo (servidor e hidratación) lleva a `inicio`; recién ahí se lee `sessionStorage`.
 */
export function EnlaceAdministracion({ inicio, sucursalId, acciones }: { inicio: string; sucursalId: string; acciones: AccionClave[] }) {
  const almacenado = useSyncExternalStore(sinSuscripcion, leerAlmacenado, delServidor);
  const href = useMemo(() => pantallaDeRegreso(leerPantallaGuardada(almacenado), sucursalId, new Set(acciones), inicio), [almacenado, sucursalId, acciones, inicio]);
  return (
    <Link href={href} className="underline hover:text-[var(--ink)]">
      Administración
      <IndicadorDeEnlace />
    </Link>
  );
}
