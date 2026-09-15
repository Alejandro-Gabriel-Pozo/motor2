"use client";

import { useEffect, useRef, useState } from "react";
import { buscarProductosSelector, type FiltroSelectorProducto, type ProductoOpcion } from "@/server/actions/productos";

interface Props {
  id?: string;
  value: string;
  onChange: (productoId: string) => void;
  filtro?: FiltroSelectorProducto;
  placeholder?: string;
  required?: boolean;
  /** Para precargar la etiqueta visible cuando `value` ya viene elegido desde afuera (ej. editar). */
  etiquetaInicial?: string;
  /** Cualquier valor que cambie cuando el formulario padre se resetea (ej. un contador tras un submit exitoso) — limpia el texto visible, que si no queda "pegado" aunque `value` vuelva a "". */
  limpiarSenal?: unknown;
  className?: string;
}

/**
 * Combobox con búsqueda server-side (`buscarProductosSelector`, tope de 20
 * resultados) — reemplaza los `<select>` que antes se poblaban con
 * `listarProductos()` sin límite en cada carga de página (catálogo entero
 * a cada `<select>`, hallazgo de la diligencia de motor2).
 *
 * `value` es el `productoId` real; un `<input>` oculto lo expone para que
 * `required` siga bloqueando el submit nativo como con el `<select>`
 * anterior — el `<input>` visible es solo el término de búsqueda.
 */
export function SelectorProducto({ id, value, onChange, filtro, placeholder = "Código o nombre…", required, etiquetaInicial, limpiarSenal, className }: Props) {
  const [query, setQuery] = useState(etiquetaInicial ?? "");
  const [opciones, setOpciones] = useState<ProductoOpcion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function alClicFuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", alClicFuera);
    return () => document.removeEventListener("mousedown", alClicFuera);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- se dispara a propósito solo cuando el padre cambia limpiarSenal, no en cada render.
  useEffect(() => {
    if (limpiarSenal !== undefined) setQuery("");
  }, [limpiarSenal]);

  function buscar(termino: string) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setCargando(true);
      const res = await buscarProductosSelector(termino, filtro);
      setOpciones(res);
      setResaltado(0);
      setCargando(false);
    }, 250);
  }

  function elegir(op: ProductoOpcion) {
    onChange(op.id);
    setQuery(`${op.codigo} — ${op.nombre}`);
    setAbierto(false);
  }

  function alTeclado(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!abierto) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setResaltado((r) => Math.min(r + 1, opciones.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((r) => Math.max(r - 1, 0));
    } else if (e.key === "Enter") {
      if (opciones[resaltado]) {
        e.preventDefault();
        elegir(opciones[resaltado]);
      }
    } else if (e.key === "Escape") {
      setAbierto(false);
    }
  }

  return (
    <div ref={contenedorRef} className={`relative ${className ?? ""}`}>
      <input type="hidden" required={required} value={value} onChange={() => {}} />
      <input
        id={id}
        type="text"
        value={query}
        onFocus={() => {
          setAbierto(true);
          buscar(query);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange(""); // el texto ya no corresponde al producto elegido antes
          setAbierto(true);
          buscar(e.target.value);
        }}
        onKeyDown={alTeclado}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={abierto}
        aria-autocomplete="list"
        className="w-full rounded border px-2 py-1.5 text-sm"
      />
      {abierto && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border bg-white text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {cargando && <li className="px-2 py-1.5 text-neutral-500">Buscando…</li>}
          {!cargando && !opciones.length && <li className="px-2 py-1.5 text-neutral-500">Sin resultados.</li>}
          {!cargando &&
            opciones.map((op, i) => (
              <li
                key={op.id}
                role="option"
                aria-selected={i === resaltado}
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(op);
                }}
                onMouseEnter={() => setResaltado(i)}
                className={`cursor-pointer px-2 py-1.5 ${i === resaltado ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
              >
                {op.codigo} — {op.nombre}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
