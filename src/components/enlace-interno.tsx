"use client";

import Link from "next/link";
import { createContext, useContext, useMemo } from "react";
import { accionDeRuta } from "@/core/navegacion/estructura";
import type { AccionClave } from "@/core/permisos/acciones";

const AccionesVisiblesContext = createContext<ReadonlySet<AccionClave> | null>(null);

/**
 * Le dice a los `EnlaceInterno` de la pantalla qué acciones de «Ver» tiene el rol del usuario en la sucursal activa. Lo pone el
 * shell de la aplicación (`app-shell.tsx`), que ya las calcula para armar el menú.
 */
export function AccionesVisiblesProvider({ acciones, children }: { acciones: AccionClave[]; children: React.ReactNode }) {
  const conjunto = useMemo(() => new Set(acciones), [acciones]);
  return <AccionesVisiblesContext.Provider value={conjunto}>{children}</AccionesVisiblesContext.Provider>;
}

/**
 * Enlace a OTRA pantalla de la aplicación (un reporte que manda al historial de un producto, una fila que manda a su receta…).
 * Si el rol del usuario no puede ver la pantalla de destino, no se muestra un enlace que termina en «no tenés permiso»: queda el
 * texto, sin enlace. La pantalla de destino igual se protege por su cuenta; esto es solo para no mostrar caminos que no llevan a
 * ningún lado. La acción de cada destino sale de `accionDeRuta` (el menú). Los enlaces dentro de la misma pantalla o familia de
 * pantallas usan `Link` a secas: un test (test/arquitectura/enlaces-con-permiso.test.ts) obliga a usar este para el resto.
 */
export function EnlaceInterno({ href, children, className, ...resto }: React.ComponentProps<typeof Link> & { href: string }) {
  const visibles = useContext(AccionesVisiblesContext);
  const accion = accionDeRuta(href);
  if (visibles && accion && !visibles.has(accion)) {
    return (
      <span title="Tu rol no tiene permiso para abrir esa pantalla" data-sin-permiso="">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className} {...resto}>
      {children}
    </Link>
  );
}
