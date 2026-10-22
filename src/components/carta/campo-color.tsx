"use client";

import { useRef, useState, type ReactNode } from "react";
import { Campo } from "@/ui/primitivas/campo";

const RE_HEX6 = /^#[0-9a-f]{6}$/i;
const RE_HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const hexDelSwatch = (v: string): string | null => {
  const t = v.trim();
  if (RE_HEX6.test(t)) return t.toLowerCase();
  const m = RE_HEX3.exec(t);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase() : null;
};

/**
 * Color: el campo de texto (con `name`) es el valor; el selector nativo (sin `name`) solo escribe en él. Si el texto no es un hex
 * (oklch, rgb, un nombre, claro/oscuro), el selector queda en un gris neutro y se avisa "formato avanzado".
 *
 * El rótulo, el texto de ayuda y el error los dibuja `Campo` (el de texto lleva el nombre por la etiqueta de este componente, atada con `htmlFor`); el selector nativo del color queda a mano a
 * propósito: `<input type="color">` no tiene primitiva (el navegador dibuja su propio selector y exige un valor `#rrggbb`, por eso el `#808080` de abajo no es un color de la interfaz).
 */
export function CampoColor({ id, name, inicial, etiqueta, placeholder, ayuda, error }: { id: string; name: string; inicial: string; etiqueta: string; placeholder: string; ayuda?: string; error: ReactNode }) {
  const texto = useRef<HTMLInputElement>(null);
  const [actual, setActual] = useState(inicial);
  const hex = hexDelSwatch(actual);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {etiqueta}
      </label>
      <div className="flex items-start gap-2">
        <input
          type="color"
          aria-label={`${etiqueta}: selector de color`}
          value={hex ?? "#808080"}
          onInput={(e) => {
            // Antes de que el onInput del cuerpo relea el FormData (este handler corre primero: es el del elemento).
            if (texto.current) texto.current.value = e.currentTarget.value;
            setActual(e.currentTarget.value);
          }}
          onChange={() => {}}
          className="h-11 w-10 shrink-0 cursor-pointer rounded border border-borde-control md:h-9"
        />
        <div className="min-w-0 flex-1">
          <Campo
            nombradoPorFuera
            id={id}
            name={name}
            ref={texto}
            type="text"
            defaultValue={inicial}
            placeholder={placeholder}
            onInput={(e) => setActual(e.currentTarget.value)}
            ayuda={[ayuda, actual.trim() && !hex ? "Formato avanzado: el selector no lo muestra." : null].filter(Boolean).join(" ") || undefined}
            error={error}
          />
        </div>
      </div>
    </div>
  );
}
