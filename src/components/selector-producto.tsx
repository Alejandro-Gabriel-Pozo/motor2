"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buscarProductosSelector, type ProductoOpcion } from "@/server/actions/catalogo/productos";
import type { FiltroSelectorProducto } from "@/core/catalogo/public";
import { useLeerServidor } from "@/lib/use-leer-servidor";
import { Aviso } from "@/ui/primitivas/aviso";
import { Campo } from "@/ui/primitivas/campo";

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
   * El nombre del campo para un lector de pantalla, si la pantalla no lo nombra con un `<label>` (que lo envuelva o con `htmlFor` al `id`). Sin él, el nombre lo pone esa etiqueta de afuera
   * (`nombradoPorFuera` de `Campo`): así lo usan hoy todas las pantallas.
   */
  "aria-label"?: string;
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
export function SelectorProducto({ id, value, onChange, filtro, placeholder = "Código o nombre…", required, etiquetaInicial, limpiarSenal, className, "aria-label": ariaLabel }: Props) {
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
    // `setTimeout` (Node, vía ReturnType de arriba) tipa su callback como `() => void`: el cuerpo async va en un IIFE marcado
    // `void` — `leer` nunca rechaza, fire-and-forget explícito, no una promesa sin manejar.
    debounceRef.current = setTimeout(() => {
      void (async () => {
        setCargando(true);
        setErrorBusqueda(false);
        const res = await leer(() => buscarProductosSelector(termino, filtro), () => setErrorBusqueda(true));
        setOpciones(res ?? []);
        setResaltado(0);
        setCargando(false);
      })();
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
  // Con `aria-label` el campo se nombra solo; sin él lo nombra el `<label>` de la pantalla. (La regla `campos-con-nombre` mira un solo archivo: no ve el `<label>` de afuera, y por eso el nombre va en un
  // spread, que es el límite que ella misma documenta.)
  const nombre = ariaLabel ? { "aria-label": ariaLabel } : { nombradoPorFuera: true as const };

  return (
    <div ref={contenedorRef} className={`relative ${className ?? ""}`}>
      <input type="hidden" required={required} value={value} onChange={() => {}} />
      <Campo
        {...nombre}
        id={id}
        tamano="compacto"
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
      />
      {abierto && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-borde-control bg-superficie text-sm shadow-lg shadow-sombra">
          {cargando && (
            <div className="px-2 py-1.5">
              <Aviso variante="informacion" forma="en-linea">
                Buscando…
              </Aviso>
            </div>
          )}
          {!cargando && errorBusqueda && (
            <div className="px-2 py-1.5">
              <Aviso variante="error" forma="en-linea">
                No se pudo buscar. Revisá tu conexión; si venís trabajando hace rato, tu sesión pudo haber vencido: recargá la página.
              </Aviso>
            </div>
          )}
          {!cargando && !errorBusqueda && !opciones.length && (
            <div className="px-2 py-1.5">
              <Aviso variante="informacion" forma="en-linea">
                Sin resultados.
              </Aviso>
            </div>
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
                  className={`cursor-pointer px-2 py-1.5 max-md:py-3 ${i === resaltado ? "bg-superficie-suave" : ""}`}
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
