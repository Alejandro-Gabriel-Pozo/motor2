"use client";

import { useMemo, useState, type FormEvent } from "react";
import { fuenteCartaSerif } from "@/components/carta-publica/fuente-carta";
import { PortalVista } from "@/components/carta-publica/portal-vista";
import { FormConResultado } from "@/components/form-con-resultado";
import type { EntradaVistaPreviaPortal } from "@/core/carta/admin-consulta";
import { decidirLayoutPortal, resolverEstiloPortal } from "@/core/carta/public";
import { CLAVES_PORTAL_V1, validarValorPortal, ZONAS_PORTAL, type DefinicionClavePortal } from "@/core/carta/portal";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { CampoColor } from "./campo-color";

/**
 * Editor de la apariencia del portal de la empresa (ADR-006). Formulario NO controlado (`FormConResultado`), un campo por clave de
 * `CLAVES_PORTAL_V1` agrupados por zona en `<details>` (solo la primera abierta); el default del catálogo va de placeholder (vacío =
 * default). Como en el editor del tema, el CUERPO se vuelve a montar con `key={version}` (el `actualizadoEn` guardado) porque
 * `FormConResultado` hace `form.reset()` cuando la acción sale bien.
 *
 * Al lado, la vista previa en vivo: es el MISMO `PortalVista` del portal público (`modo="vista-previa"`), y un `onInput` en el cuerpo
 * vuelve a leer el `FormData` para resolver el estilo con `resolverEstiloPortal` (lo inválido cae al default, como en el portal).
 */
interface Props {
  valoresIniciales: Readonly<Record<string, string>>;
  version: string;
  accion: (formData: FormData) => Promise<ResultadoAccion>;
  empresaNombre: string;
  /** Lo que el portal muestra hoy (publicadas y activas), en su orden. */
  sucursales: readonly EntradaVistaPreviaPortal[];
  /** URL de la carta de cada sucursal, por slug (otro host: la vista previa abre en pestaña nueva). */
  urlsPorSlug: Readonly<Record<string, string>>;
}

export function EditorPortal({ valoresIniciales, version, accion, empresaNombre, sucursales, urlsPorSlug }: Props) {
  return (
    <FormConResultado accion={accion} className="flex flex-col gap-4">
      <CuerpoEditor key={version} valoresIniciales={valoresIniciales} empresaNombre={empresaNombre} sucursales={sucursales} urlsPorSlug={urlsPorSlug} />
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

function CuerpoEditor({ valoresIniciales, empresaNombre, sucursales, urlsPorSlug }: Omit<Props, "version" | "accion">) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(CLAVES_PORTAL_V1.map((d) => [d.clave, valoresIniciales[d.clave] ?? ""])));

  const estilo = useMemo(() => resolverEstiloPortal(valores), [valores]);
  const layout = useMemo(() => decidirLayoutPortal(sucursales, estilo.imagenFondo), [sucursales, estilo.imagenFondo]);

  const releer = (e: FormEvent<HTMLDivElement>) => {
    const form = e.currentTarget.closest("form");
    if (form) setValores(leerValores(form));
  };

  return (
    <div onInput={releer} onChange={releer} className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="flex min-w-0 flex-col gap-2">
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

      <section aria-labelledby="titulo-vista-previa-portal" className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
        <h2 id="titulo-vista-previa-portal" className="text-sm font-medium">
          Vista previa
        </h2>
        <div className={`carta-shell ${fuenteCartaSerif.variable} overflow-hidden rounded border`} data-vista-previa-portal>
          <PortalVista sucursales={sucursales} empresaNombre={empresaNombre} estilo={estilo} hrefDe={(slug) => urlsPorSlug[slug] ?? "#"} modo="vista-previa" />
        </div>
        <p className="text-xs text-neutral-500" data-modo-portal={layout.modo}>
          {textoDelModo(layout.modo, layout.enMapa.length, layout.enGrilla.length, Boolean(estilo.imagenFondo), sucursales.length)}
        </p>
      </section>
    </div>
  );
}

function textoDelModo(modo: "mapa" | "grilla", enMapa: number, enGrilla: number, hayImagen: boolean, total: number): string {
  if (total === 0) return "Ninguna sucursal está publicada todavía: el portal muestra «Todavía no hay cartas publicadas».";
  if (modo === "mapa") {
    return `Se ve como mapa: ${enMapa} ${enMapa === 1 ? "tarjeta sobre la imagen" : "tarjetas sobre la imagen"}${enGrilla ? ` y ${enGrilla} en lista debajo (sin posición)` : ""}. Las posiciones son las guardadas.`;
  }
  return hayImagen
    ? "Se ve como lista: la imagen está cargada pero ninguna sucursal tiene posición (x, y y ancho) en «Posición en el mapa del portal», más abajo."
    : "Se ve como lista: para verlo como mapa cargá la URL de la imagen del mapa y la posición de al menos una sucursal (más abajo).";
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
