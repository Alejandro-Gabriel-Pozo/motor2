"use client";

import { useState } from "react";

interface Props {
  id?: string;
  /** Modo no-controlado (formularios con <form action={serverAction}>, FormData nativo) — el valor real viaja en un <input type="hidden"> con este name. */
  name?: string;
  /** Modo controlado (la mayoría de los forms del proyecto, que ya manejan estado propio). */
  value?: string;
  /** Valor inicial en modo no-controlado. */
  defaultValue?: string;
  onChange?: (valor: string) => void;
  required?: boolean;
  placeholder?: string;
  /** Nombre accesible del campo cuando no hay un `<label>` asociado (un placeholder desaparece al tipear y no es un nombre confiable para un lector de pantalla). */
  ariaLabel?: string;
  /** Ej. "$" — se muestra al costado del campo, nunca dentro del valor editable (mismo criterio que ERPNext/Dolibarr: el símbolo no es parte de lo que se tipea). */
  prefijo?: string;
  /** "normal" (px-3 py-2, campo de formulario apilado) o "compacto" (px-2 py-1.5 text-sm, campo dentro de una fila). */
  tamano?: "normal" | "compacto";
  className?: string;
}

/**
 * Reemplazo de `<input type="number">` para plata y cantidades — hallazgo
 * de la diligencia de motor2 ("esto no es propio de un ERP", el spinner
 * nativo del navegador). Verificado contra ERPNext y Dolibarr: ninguno de
 * los dos usa `type="number"` para estos campos — los dos son texto con
 * separador de miles al mostrar, sin flechitas, todo el valor seleccionado
 * al hacer foco.
 *
 * Mientras el campo tiene el foco se ve el número crudo tal cual se tipea
 * (sin reformatear en cada tecla, para no pelear con la posición del
 * cursor); al salir del campo se muestra formateado en es-AR. Acepta coma
 * o punto como separador decimal al tipear — si aparecen los dos, el
 * último es el decimal, el resto se descarta como separador de miles.
 */
function normalizar(texto: string): string {
  const t = texto.trim();
  if (!t) return "";
  const negativo = t.startsWith("-");
  const sinSigno = negativo ? t.slice(1) : t;
  const ultimaComa = sinSigno.lastIndexOf(",");
  const ultimoPunto = sinSigno.lastIndexOf(".");
  let limpio: string;
  if (ultimaComa > ultimoPunto) {
    limpio = sinSigno.replace(/\./g, "").replace(",", ".");
  } else if (ultimoPunto > ultimaComa) {
    limpio = sinSigno.replace(/,/g, "");
  } else {
    limpio = sinSigno;
  }
  limpio = limpio.replace(/[^0-9.]/g, "");
  return (negativo ? "-" : "") + limpio;
}

function formatear(valor: string): string {
  if (!valor) return "";
  const n = Number(valor);
  if (Number.isNaN(n)) return valor;
  return n.toLocaleString("es-AR", { maximumFractionDigits: 4 });
}

export function CampoNumero({ id, name, value, defaultValue, onChange, required, placeholder, ariaLabel, prefijo, tamano = "normal", className }: Props) {
  const controlado = value !== undefined;
  const [interno, setInterno] = useState(defaultValue ?? "");
  const valorReal = controlado ? (value ?? "") : interno;

  const [texto, setTexto] = useState(() => formatear(valorReal));
  const [enFoco, setEnFoco] = useState(false);
  // Reformatea cuando `valorReal` cambia desde AFUERA (ej. reset tras
  // submit) mientras el campo no tiene foco — ajustar estado durante el
  // render en vez de en un efecto (mismo criterio que onFocus/onBlur más
  // abajo, que ya hacen lo mismo de forma directa): evita el round-trip
  // extra de un efecto para lo que es, en los hechos, sincronizar con un
  // prop externo, no con un sistema externo real.
  const [valorRealSincronizado, setValorRealSincronizado] = useState(valorReal);
  if (!enFoco && valorReal !== valorRealSincronizado) {
    setValorRealSincronizado(valorReal);
    setTexto(formatear(valorReal));
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      {name && <input type="hidden" name={name} value={valorReal} onChange={() => {}} />}
      {prefijo && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-neutral-500 dark:text-neutral-400">{prefijo}</span>}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={texto}
        placeholder={placeholder}
        aria-label={ariaLabel}
        required={required}
        onFocus={(e) => {
          setEnFoco(true);
          setTexto(valorReal);
          e.target.select();
        }}
        onChange={(e) => {
          setTexto(e.target.value);
          const limpio = normalizar(e.target.value);
          if (controlado) onChange?.(limpio);
          else setInterno(limpio);
        }}
        onBlur={() => {
          setEnFoco(false);
          setTexto(formatear(valorReal));
        }}
        className={`w-full rounded border text-right text-sm ${tamano === "compacto" ? "px-2 py-1.5" : "px-3 py-2"} ${prefijo ? "pl-5" : ""}`}
      />
    </div>
  );
}
