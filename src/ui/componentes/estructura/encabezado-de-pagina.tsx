import type { ReactNode } from "react";

/**
 * Lo que queda ARRIBA al desplazar el contenido (acciones principales, filtros): desde `md` se pega al borde superior del área que se desplaza (`sticky top-0`, sobre el papel
 * de la pantalla y con un filo inferior); en celular no se pega (se desplaza el documento y el encabezado del shell tampoco queda fijo: 844 px de alto no sobran). Va ANTES del
 * contenido en el DOM (orden de foco natural) y es un grupo con nombre para el lector de pantalla.
 */
export function EncabezadoDePagina({ children, etiqueta }: { children: ReactNode; etiqueta: string }) {
  return (
    <div role="group" aria-label={etiqueta} className="z-10 bg-papel md:sticky md:top-0 md:-mx-6 md:border-b md:border-borde md:px-6 md:py-3">
      {children}
    </div>
  );
}
