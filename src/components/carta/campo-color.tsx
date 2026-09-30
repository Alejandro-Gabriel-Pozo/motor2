"use client";

import { useRef, useState } from "react";

const CLASE_INPUT = "rounded border px-2 py-1";

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
 */
export function CampoColor({ comun, etiqueta, inicial, placeholder }: { comun: { id: string; name: string; defaultValue: string }; etiqueta: string; inicial: string; placeholder: string }) {
  const texto = useRef<HTMLInputElement>(null);
  const [actual, setActual] = useState(inicial);
  const hex = hexDelSwatch(actual);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
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
          className="h-8 w-10 shrink-0 cursor-pointer rounded border"
        />
        <input {...comun} ref={texto} type="text" placeholder={placeholder} onInput={(e) => setActual(e.currentTarget.value)} className={`${CLASE_INPUT} min-w-0 flex-1 font-mono text-sm`} />
      </div>
      {actual.trim() && !hex && <p className="text-xs text-neutral-500">Formato avanzado: el selector no lo muestra.</p>}
    </div>
  );
}
