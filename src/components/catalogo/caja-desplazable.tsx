import type { ReactNode } from "react";

/**
 * La caja de las tablas de Catálogo (Fase 7, arreglos a 375 px): una tabla ancha se desplaza de costado DENTRO de esta caja en vez de ensanchar la página en el celular. Es una región con nombre y foco de
 * teclado, como pide axe para un área con scroll (`scrollable-region-focusable`): sin eso, quien solo ve (sin botones dentro de la tabla) no podría recorrerla con el teclado. `etiqueta` es el nombre de la
 * región: tiene que ser distinto del de cualquier otra región de la pantalla. Mismo criterio que `TablaDeStock`.
 */
export function CajaDesplazable({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={etiqueta} tabIndex={0} className="overflow-x-auto">
      {children}
    </div>
  );
}
