"use client";

import { useState, type FormEvent } from "react";
import { FormConResultado } from "@/components/form-con-resultado";
import { CLAVES_PORTAL_V1, validarValorPortal, ZONAS_PORTAL, type DefinicionClavePortal } from "@/core/carta/portal";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { CampoColor } from "./campo-color";

/**
 * Editor de la apariencia del portal de la empresa (ADR-006). Formulario NO controlado (`FormConResultado`), un campo por clave de
 * `CLAVES_PORTAL_V1` agrupados por zona en `<details>` (solo la primera abierta); el default del catálogo va de placeholder (vacío =
 * default). Como en el editor del tema, el CUERPO se vuelve a montar con `key={version}` (el `actualizadoEn` guardado) porque
 * `FormConResultado` hace `form.reset()` cuando la acción sale bien.
 */
export function EditorPortal({ valoresIniciales, version, accion }: { valoresIniciales: Readonly<Record<string, string>>; version: string; accion: (formData: FormData) => Promise<ResultadoAccion> }) {
  return (
    <FormConResultado accion={accion} className="flex flex-col gap-4">
      <CuerpoEditor key={version} valoresIniciales={valoresIniciales} />
      <div>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
          Guardar apariencia
        </button>
      </div>
    </FormConResultado>
  );
}

const CLASE_INPUT = "rounded border px-2 py-1";

function leerValores(form: HTMLFormElement): Record<string, string> {
  const fd = new FormData(form);
  return Object.fromEntries(CLAVES_PORTAL_V1.map((d) => [d.clave, String(fd.get(d.clave) ?? "")]));
}

function CuerpoEditor({ valoresIniciales }: { valoresIniciales: Readonly<Record<string, string>> }) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(CLAVES_PORTAL_V1.map((d) => [d.clave, valoresIniciales[d.clave] ?? ""])));

  const releer = (e: FormEvent<HTMLDivElement>) => {
    const form = e.currentTarget.closest("form");
    if (form) setValores(leerValores(form));
  };

  return (
    <div onInput={releer} onChange={releer} className="flex min-w-0 flex-col gap-2">
      {ZONAS_PORTAL.map((zona, i) => {
        const campos = CLAVES_PORTAL_V1.filter((d) => d.zona === zona);
        const cargados = campos.filter((d) => valores[d.clave]?.trim()).length;
        return (
          <details key={zona} open={i === 0} className="rounded border p-3" data-zona-portal={zona}>
            <summary className="cursor-pointer text-sm font-medium">
              {zona} <span className="font-normal text-neutral-500">({cargados} de {campos.length} cargados)</span>
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {campos.map((d) => (
                <Campo key={d.clave} d={d as DefinicionClavePortal} inicial={valoresIniciales[d.clave] ?? ""} actual={valores[d.clave] ?? ""} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

const AYUDA: Partial<Record<DefinicionClavePortal["tipo"], string>> = {
  tamanoFuente: "Número = px, o una medida: 0.9rem, 12px, clamp(…).",
  imagen: "URL https:// de la imagen (también sirve pegar el link tal como lo da la sheet: [texto](https://…)).",
  fraccion: "0 = sin oscurecer, 1 = negro. Ayuda a leer las tarjetas sobre una imagen clara.",
  proporcion: "Ancho/alto de la imagen, para que el mapa tenga su forma antes de cargar: 1080/1533, 16/9 o un número (0.7).",
  porcentaje: "Porcentaje del alto del mapa (0 a 100). Cada sucursal puede tener su propio alto en su posición.",
};

function Campo({ d, inicial, actual }: { d: DefinicionClavePortal; inicial: string; actual: string }) {
  const id = `portal-${d.clave}`;
  const r = actual.trim() ? validarValorPortal(d.clave, actual) : null;
  const error = r && !r.ok ? r.mensaje : null;
  const ayuda = AYUDA[d.tipo];
  const describedBy = [ayuda ? `${id}-ayuda` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const placeholder = d.defaultPortal || "sin valor";
  const comun = { id, name: d.clave, defaultValue: inicial, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy } as const;

  let control: React.ReactNode;
  switch (d.tipo) {
    case "color":
      control = <CampoColor comun={comun} etiqueta={d.etiqueta} inicial={inicial} placeholder={placeholder} />;
      break;
    case "porcentaje":
      control = <input {...comun} type="number" min={0} max={100} step="0.01" placeholder={placeholder} className={CLASE_INPUT} />;
      break;
    case "fraccion":
      control = <input {...comun} type="number" min={0} max={1} step="0.05" placeholder={placeholder} className={CLASE_INPUT} />;
      break;
    case "texto":
      control = <input {...comun} type="text" maxLength={d.maximo} placeholder={placeholder} className={CLASE_INPUT} />;
      break;
    case "imagen":
      // Texto con teclado de URL (y no type="url"): la validación nativa trabaría el envío por un campo escondido en un <details> cerrado.
      control = <input {...comun} type="text" inputMode="url" placeholder="https://…" className={CLASE_INPUT} />;
      break;
    default:
      control = <input {...comun} type="text" placeholder={placeholder} className={`${CLASE_INPUT} font-mono text-sm`} />;
  }

  return (
    <div className="flex flex-col gap-1 text-sm" data-campo-portal={d.clave}>
      <label htmlFor={id}>{d.etiqueta}</label>
      {control}
      {ayuda && (
        <p id={`${id}-ayuda`} className="text-xs text-neutral-500">
          {ayuda}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-600">
          No es válido: {error}.
        </p>
      )}
    </div>
  );
}
