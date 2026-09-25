/**
 * Resumen de SOLO LECTURA de un bloque de la carta (sección, contenido de un producto, promo, ítem agrupado) para un rol que puede
 * VER la carta pero no EDITARLA: los mismos datos que el formulario, como texto, sin inputs ni botones. Los catálogos chicos de la
 * carta quedan inline (lista + formulario en la misma pantalla, docs/grounding-lista-ver-editar-2026-09-18.md §7.4): la separación
 * ver/editar se resuelve con el nivel de permiso de la pantalla, no con una ficha aparte. Mismo formato de término → definición que
 * la ficha de producto.
 */
export function DatosSoloLectura({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 ${className}`} data-solo-lectura="">
      {children}
    </dl>
  );
}

/** Un dato del resumen; sin valor (null, vacío) muestra «—». `ancho` lo estira a las dos columnas (descripciones). */
export function Dato({ etiqueta, children, ancho = false }: { etiqueta: string; children?: React.ReactNode; ancho?: boolean }) {
  const vacio = children === null || children === undefined || children === "";
  return (
    <div className={`flex flex-col gap-0.5 ${ancho ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs text-neutral-500">{etiqueta}</dt>
      <dd className="text-sm">{vacio ? <span className="text-neutral-500 dark:text-neutral-400">—</span> : children}</dd>
    </div>
  );
}

/** Aviso del encabezado para quien solo ve: por qué no hay formularios ni altas. */
export function AvisoSoloLectura() {
  return (
    <p className="mt-2 rounded border px-3 py-2 text-sm" data-aviso-solo-lectura="">
      Solo lectura: tu rol no tiene permiso para editar la carta.
    </p>
  );
}
