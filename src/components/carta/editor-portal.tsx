"use client";

import { useMemo, useRef, useState, type FormEvent, type PointerEvent as PointerEventReact } from "react";
import { clasesFuentesCarta } from "@/components/carta-publica/fuente-carta";
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
 *
 * Las tarjetas del mapa se ARRASTRAN con mouse o lápiz: al soltar se guarda la posición con `mover`. Los números de «Posición en el
 * mapa del portal» de cada sucursal son la alternativa sin arrastre (teclado, táctil). Un clic sin arrastrar sigue abriendo la carta.
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
  /** Guarda la posición (centro, % del mapa) de una sucursal ya ubicada. */
  mover: (sucursalId: string, x: number, y: number) => Promise<ResultadoAccion>;
}

export function EditorPortal({ valoresIniciales, version, accion, empresaNombre, sucursales, urlsPorSlug, mover }: Props) {
  return (
    <FormConResultado accion={accion} className="flex flex-col gap-4">
      <CuerpoEditor key={version} valoresIniciales={valoresIniciales} empresaNombre={empresaNombre} sucursales={sucursales} urlsPorSlug={urlsPorSlug} mover={mover} />
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

const UMBRAL_ARRASTRE_PX = 4;
const acotar = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;

interface Arrastre {
  slug: string;
  id: string;
  ancho: number;
  alto: number;
  clienteX: number;
  clienteY: number;
  x: number;
  y: number;
  movio: boolean;
}

function CuerpoEditor({ valoresIniciales, empresaNombre, sucursales: guardadas, urlsPorSlug, mover }: Omit<Props, "version" | "accion">) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(CLAVES_PORTAL_V1.map((d) => [d.clave, valoresIniciales[d.clave] ?? ""])));
  // Posiciones arrastradas que todavía no volvieron del servidor; se descartan cuando llegan las guardadas (o si falla el guardado).
  const [movidas, setMovidas] = useState<Record<string, { x: number; y: number }>>({});
  const [anteriores, setAnteriores] = useState(guardadas);
  if (anteriores !== guardadas) {
    setAnteriores(guardadas);
    setMovidas({});
  }
  const [arrastrando, setArrastrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const activo = useRef(false);

  const sucursales = useMemo(
    () => guardadas.map((s) => (s.posicion && movidas[s.slug] ? { ...s, posicion: { ...s.posicion, ...movidas[s.slug] } } : s)),
    [guardadas, movidas],
  );
  const estilo = useMemo(() => resolverEstiloPortal(valores), [valores]);
  const layout = useMemo(() => decidirLayoutPortal(sucursales, estilo.imagenFondo), [sucursales, estilo.imagenFondo]);

  const releer = (e: FormEvent<HTMLDivElement>) => {
    const form = e.currentTarget.closest("form");
    if (form) setValores(leerValores(form));
  };

  const alPresionar = (e: PointerEventReact<HTMLDivElement>) => {
    // Solo mouse y lápiz: con el dedo, tocar una tarjeta mientras se scrollea la página no debe moverla (para eso están los números).
    if (e.button !== 0 || e.pointerType === "touch" || activo.current) return;
    if (!(e.target instanceof Element)) return;
    const li = e.target.closest<HTMLElement>("[data-portal-slug]");
    const mapa = li?.closest<HTMLElement>(".portal-mapa");
    const entrada = sucursales.find((s) => s.slug === li?.dataset.portalSlug);
    if (!mapa || !entrada?.posicion) return;
    const contenedor = e.currentTarget;
    const rect = mapa.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const a: Arrastre = { slug: entrada.slug, id: entrada.id, ancho: rect.width, alto: rect.height, clienteX: e.clientX, clienteY: e.clientY, x: entrada.posicion.x, y: entrada.posicion.y, movio: false };
    activo.current = true;

    const destino = (ev: globalThis.PointerEvent) => ({
      x: acotar(a.x + ((ev.clientX - a.clienteX) / a.ancho) * 100),
      y: acotar(a.y + ((ev.clientY - a.clienteY) / a.alto) * 100),
    });
    const descartar = () => setMovidas((m) => Object.fromEntries(Object.entries(m).filter(([slug]) => slug !== a.slug)));

    const mientras = (ev: globalThis.PointerEvent) => {
      if (!a.movio && Math.hypot(ev.clientX - a.clienteX, ev.clientY - a.clienteY) < UMBRAL_ARRASTRE_PX) return;
      if (!a.movio) {
        a.movio = true;
        setArrastrando(true);
      }
      const d = destino(ev);
      setMovidas((m) => ({ ...m, [a.slug]: d }));
    };
    const terminar = (ev: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", mientras);
      window.removeEventListener("pointerup", terminar);
      window.removeEventListener("pointercancel", terminar);
      activo.current = false;
      setArrastrando(false);
      if (!a.movio) return;
      // El «click» que sigue a soltar sobre el link no tiene que abrir la carta.
      const sinClic = (c: Event) => {
        c.preventDefault();
        c.stopPropagation();
      };
      contenedor.addEventListener("click", sinClic, { capture: true, once: true });
      setTimeout(() => contenedor.removeEventListener("click", sinClic, { capture: true }), 0);
      if (ev.type === "pointercancel") return descartar();
      const d = destino(ev);
      void mover(a.id, d.x, d.y).then((r) => {
        setAviso(r.mensaje);
        if (!r.ok) descartar();
      });
    };
    window.addEventListener("pointermove", mientras);
    window.addEventListener("pointerup", terminar);
    window.addEventListener("pointercancel", terminar);
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
        <div className={`carta-shell ${clasesFuentesCarta} overflow-hidden rounded border`} data-vista-previa-portal data-arrastrando={arrastrando ? "" : undefined} onPointerDown={alPresionar}>
          <PortalVista sucursales={sucursales} empresaNombre={empresaNombre} estilo={estilo} hrefDe={(slug) => urlsPorSlug[slug] ?? "#"} modo="vista-previa" />
        </div>
        <p className="text-xs text-neutral-500" data-modo-portal={layout.modo}>
          {textoDelModo(layout.modo, layout.enMapa.length, layout.enGrilla.length, Boolean(estilo.imagenFondo), sucursales.length)}
        </p>
        {layout.modo === "mapa" && (
          <p className="text-xs text-neutral-500">
            Arrastrá una tarjeta con el mouse para moverla (se guarda al soltar). Sin mouse, cargá los números en «Posición en el mapa del portal» de cada sucursal.
          </p>
        )}
        <p role="status" className="text-xs" data-aviso-posicion>
          {aviso}
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
  imagen: "URL https:// de la imagen (también sirve un link de markdown: [texto](https://…)).",
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
