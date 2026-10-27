import type { ReactNode } from "react";

/**
 * La tabla de las pantallas de Stock (Fase 7, arreglos a 375 y 1280 px): va dentro de una caja que se desplaza de costado (una región con nombre y foco de teclado, como pide axe para un área con
 * scroll), así una tabla ancha no ensancha la página en el celular; y separa las columnas (antes las celdas iban pegadas: «MínimoDiferenciaEstado») sin cortar los encabezados en dos renglones.
 * `etiqueta` es el nombre de la región: tiene que ser distinto del de cualquier otra región de la pantalla.
 */
export function TablaDeStock({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={etiqueta} tabIndex={0} className="relative overflow-x-auto">
      <table className="w-full text-sm [&_td]:px-2 [&_td:first-child]:pl-0 [&_th]:px-2 [&_th]:whitespace-nowrap [&_th:first-child]:pl-0">{children}</table>
    </div>
  );
}
