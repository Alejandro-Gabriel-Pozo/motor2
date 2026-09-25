"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buscarProductosSelector, type FiltroSelectorProducto, type ProductoOpcion } from "@/server/actions/catalogo/productos";
import { useLeerServidor } from "@/lib/use-leer-servidor";

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
  /**
   * Sin las variantes `dark:` de la lista desplegable: para pantallas que no tienen modo oscuro y quedan claras aunque el sistema
   * esté en oscuro (el salón, `.pos-shell`). Sin esto, con el sistema en oscuro la lista se pintaba de fondo oscuro con la tinta
   * oscura del salón encima.
   */
  siempreClaro?: boolean;
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
export function SelectorProducto({ id, value, onChange, filtro, placeholder = "Código o nombre…", required, etiquetaInicial, limpiarSenal, className, siempreClaro }: Props) {
  const [query, setQuery] = useState(etiquetaInicial ?? "");
  const [opciones, setOpciones] = useState<ProductoOpcion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(false);
  const leer = useLeerServidor();
  const [resaltado, setResaltado] = useState(0);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listboxId = useId();

  useEffect(() => {
    function alClicFuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", alClicFuera);
    return () => document.removeEventListener("mousedown", alClicFuera);
  }, []);

  // Limpia `query` cuando el padre cambia `limpiarSenal` (ej. tras un
  // submit exitoso) — ajustar estado durante el render en vez de en un
  // efecto, mismo criterio que CampoNumero: no hace falta un round-trip
  // extra para sincronizar con un valor que ya viene del padre.
  const [limpiarSenalPrevia, setLimpiarSenalPrevia] = useState(limpiarSenal);
  if (limpiarSenal !== limpiarSenalPrevia) {
    setLimpiarSenalPrevia(limpiarSenal);
    if (limpiarSenal !== undefined) setQuery("");
  }

  function buscar(termino: string) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setCargando(true);
      setErrorBusqueda(false);
      const res = await leer(() => buscarProductosSelector(termino, filtro), () => setErrorBusqueda(true));
      setOpciones(res ?? []);
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

  // La lista (role="listbox") solo existe cuando hay opciones que mostrar: un listbox sin opciones no es válido (axe aria-required-children), así que
  // «Buscando…», el error y «Sin resultados.» son avisos aparte (role="status"/"alert") y no `<li>` sueltos adentro del listbox.
  const hayLista = !cargando && opciones.length > 0;
  const idOpcion = (i: number) => `${listboxId}-op-${i}`;

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
        aria-expanded={abierto && hayLista}
        aria-autocomplete="list"
        aria-controls={abierto && hayLista ? listboxId : undefined}
        aria-activedescendant={abierto && hayLista && resaltado < opciones.length ? idOpcion(resaltado) : undefined}
        className="w-full rounded border px-2 py-1.5 text-sm"
      />
      {abierto && (
        <div className={`absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border bg-white text-sm shadow-lg ${siempreClaro ? "" : "dark:border-neutral-700 dark:bg-neutral-900"}`}>
          {cargando && (
            <p role="status" className="px-2 py-1.5 text-neutral-500">
              Buscando…
            </p>
          )}
          {!cargando && errorBusqueda && (
            <p role="alert" className="px-2 py-1.5 text-red-600">
              No se pudo buscar. Revisá tu conexión; si venís trabajando hace rato, tu sesión pudo haber vencido: recargá la página.
            </p>
          )}
          {!cargando && !errorBusqueda && !opciones.length && (
            <p role="status" className="px-2 py-1.5 text-neutral-500">
              Sin resultados.
            </p>
          )}
          {hayLista && (
            <ul id={listboxId} role="listbox">
              {opciones.map((op, i) => (
                <li
                  key={op.id}
                  id={idOpcion(i)}
                  role="option"
                  aria-selected={i === resaltado}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    elegir(op);
                  }}
                  onMouseEnter={() => setResaltado(i)}
                  className={`cursor-pointer px-2 py-1.5 ${i === resaltado ? `bg-neutral-100 ${siempreClaro ? "" : "dark:bg-neutral-800"}` : ""}`}
                >
                  {op.codigo} — {op.nombre}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
