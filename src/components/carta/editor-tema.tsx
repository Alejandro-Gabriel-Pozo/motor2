"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { CartaVista } from "@/components/carta-publica/carta-vista";
import { fuenteCartaSerif } from "@/components/carta-publica/fuente-carta";
import { FormConResultado } from "@/components/form-con-resultado";
import { resolverEstiloCarta } from "@/core/carta/public";
import { CLAVES_TEMA_V1, parsearConfigPegada, validarValorTema, ZONAS_TEMA, type ConfigPegada, type DefinicionClaveTema } from "@/core/carta/tema";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { CampoColor } from "./campo-color";
import { CARTA_EJEMPLO } from "./carta-ejemplo";

/**
 * Editor del tema de la carta (docs/plan-tema-carta-2026-09-24.md, M9, D11/D12). Formulario NO controlado (`FormConResultado`),
 * un campo por clave del catálogo `CLAVES_TEMA_V1`, agrupados por zona en `<details>` (solo la primera abierta), con el widget
 * según el tipo y el default de la carta como placeholder (vacío = default de la carta). Al lado, la vista previa en vivo: un
 * `onInput` en el cuerpo vuelve a leer el `FormData`.
 *
 * `FormConResultado` hace `form.reset()` cuando la acción sale bien, y la página se refresca con los valores nuevos: por eso el
 * CUERPO se vuelve a montar con `key={version}` (el `actualizadoEn` del tema), así los campos y la vista previa arrancan de lo
 * guardado; el formulario (y su mensaje de resultado) no se desmonta.
 *
 * "Pegar desde la sheet" (D12) rellena el formulario desde el cliente, SIN guardar, con `parsearConfigPegada`, y muestra lo que no
 * entra en cinco listas.
 */
export function EditorTema({ valoresIniciales, version, accion }: { valoresIniciales: Readonly<Record<string, string>>; version: string; accion: (formData: FormData) => Promise<ResultadoAccion> }) {
  return (
    <FormConResultado accion={accion} className="flex flex-col gap-4">
      <CuerpoEditor key={version} valoresIniciales={valoresIniciales} />
      <div>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
          Guardar tema
        </button>
      </div>
    </FormConResultado>
  );
}

const CLASE_INPUT = "rounded border px-2 py-1";

function leerValores(form: HTMLFormElement): Record<string, string> {
  const fd = new FormData(form);
  return Object.fromEntries(CLAVES_TEMA_V1.map((d) => [d.clave, String(fd.get(d.clave) ?? "")]));
}

function CuerpoEditor({ valoresIniciales }: { valoresIniciales: Readonly<Record<string, string>> }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(CLAVES_TEMA_V1.map((d) => [d.clave, valoresIniciales[d.clave] ?? ""])));
  const [pegado, setPegado] = useState<ConfigPegada | null>(null);
  const estilo = useMemo(() => resolverEstiloCarta(valores), [valores]);

  const releer = (e: FormEvent<HTMLDivElement>) => {
    const form = e.currentTarget.closest("form");
    if (form) setValores(leerValores(form));
  };

  const rellenarDesdeLaSheet = () => {
    const div = raiz.current;
    const form = div?.closest("form");
    const texto = div?.querySelector<HTMLTextAreaElement>("#tema-pegar-sheet")?.value ?? "";
    if (!form) return;
    const r = parsearConfigPegada(texto);
    // Reemplaza TODO el formulario, como la tab Config: lo que no está en lo pegado queda vacío (= default de la carta).
    for (const d of CLAVES_TEMA_V1) {
      const campo = form.elements.namedItem(d.clave);
      if (!(campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement)) continue;
      campo.value = (r.valores as Record<string, string>)[d.clave] ?? "";
      // Que se enteren el selector de color de ese campo y la vista previa (onInput).
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setValores(leerValores(form));
    setPegado(r);
  };

  return (
    <div ref={raiz} onInput={releer} onChange={releer} className="flex flex-col gap-4">
      <section aria-labelledby="titulo-pegar-sheet" className="flex flex-col gap-2 rounded border border-dashed p-3">
        <h2 id="titulo-pegar-sheet" className="text-sm font-medium">
          Pegar desde la sheet
        </h2>
        <label htmlFor="tema-pegar-sheet" className="text-sm text-neutral-500">
          Copiá las columnas A y B de la tab Config de la sheet de esta sucursal y pegalas acá. Reemplaza todo el formulario (lo que no esté queda vacío,
          con el default de la carta) y NO guarda: revisá la vista previa y tocá «Guardar tema».
        </label>
        <textarea id="tema-pegar-sheet" rows={4} className={`${CLASE_INPUT} font-mono text-xs`} placeholder={"restaurante_nombre\tLa Parrilla\ncolor_marca\t#8b4513"} />
        <div>
          <button type="button" onClick={rellenarDesdeLaSheet} className="rounded border px-3 py-1.5 text-sm">
            Rellenar el formulario
          </button>
        </div>
        {pegado && <ResultadoPegado r={pegado} />}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-2">
          {ZONAS_TEMA.map((zona, i) => {
            const campos = CLAVES_TEMA_V1.filter((d) => d.zona === zona);
            const cargados = campos.filter((d) => valores[d.clave]?.trim()).length;
            return (
              <details key={zona} open={i === 0} className="rounded border p-3" data-zona-tema={zona}>
                <summary className="cursor-pointer text-sm font-medium">
                  {zona} <span className="font-normal text-neutral-500">({cargados} de {campos.length} cargados)</span>
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {campos.map((d) => (
                    <Campo key={d.clave} d={d as DefinicionClaveTema} inicial={valoresIniciales[d.clave] ?? ""} actual={valores[d.clave] ?? ""} />
                  ))}
                </div>
              </details>
            );
          })}
        </div>

        <section aria-labelledby="titulo-vista-previa" className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
          <h2 id="titulo-vista-previa" className="text-sm font-medium">
            Vista previa
          </h2>
          <div className={`carta-shell ${fuenteCartaSerif.variable} overflow-hidden rounded border`} data-vista-previa-tema>
            <CartaVista carta={CARTA_EJEMPLO} estilo={estilo} embebida />
          </div>
          <p className="text-xs text-neutral-500">
            Es la carta real con datos de ejemplo (portada, índice y dos secciones): se recorre con las flechas o tocando el índice. La altura de la banda de cada sección
            (medida en <code>vh</code>) se calcula con la ventana del navegador, no con el alto de este recuadro.
          </p>
        </section>
      </div>
    </div>
  );
}

function ResultadoPegado({ r }: { r: ConfigPegada }) {
  const cargados = Object.keys(r.valores);
  const listas: { id: keyof ConfigPegada; titulo: string; items: string[] }[] = [
    { id: "valores", titulo: `Cargadas en el formulario (${cargados.length})`, items: cargados },
    { id: "fijasDelSistema", titulo: "Fijas del sistema (precios: es-AR, $ a la izquierda; no se importan)", items: r.fijasDelSistema },
    { id: "noPorTenant", titulo: "No son por sucursal (config de la raíz del portal o del modo single; no se importan)", items: r.noPorTenant },
    { id: "desconocidas", titulo: "Desconocidas (no son claves de la tab Config)", items: r.desconocidas },
    { id: "invalidas", titulo: "Inválidas (quedan con el default de la carta)", items: r.invalidas.map((i) => `${i.clave}: ${i.motivo}`) },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2" role="status">
      {listas.map((l) => (
        <div key={l.id} data-pegado={l.id}>
          <p className="font-medium">{l.titulo}</p>
          {l.items.length ? (
            <ul className="list-disc pl-5 text-xs">
              {l.items.map((item) => (
                <li key={item} className="break-all">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-neutral-500">Ninguna.</p>
          )}
        </div>
      ))}
    </div>
  );
}

const ETIQUETAS_OPCION: Record<string, string> = { left: "izquierda", center: "centro", right: "derecha", top: "arriba", bottom: "abajo", si: "sí", no: "no" };

const AYUDA: Partial<Record<DefinicionClaveTema["tipo"], string>> = {
  tamanoFuente: "Número = px, o una medida: 0.9rem, 12px, clamp(…).",
  altoBandaMobile: "Número = px (20 a 600), o una medida: 12vh, clamp(…).",
  altoBandaDesktop: "Número = px (20 a 600), o una medida: 18vh, clamp(80px, 18vh, 140px).",
  anchoImagenMobile: "Número = % del alto de la banda (1 a 400), o una medida: 80px.",
  tamanoFondo: "contain, cover, auto o dos medidas (ej. auto 100%).",
  colorHeroInk: "claro, oscuro o un color.",
  colorHex: "Solo hex #rrggbb: la carta le suma transparencia cuando hay imagen de fondo.",
  redSocial: "El usuario (@usuario) o la URL https:// del perfil.",
  telefono: "Con código de país: +54 9 294 123-4567.",
};

function Campo({ d, inicial, actual }: { d: DefinicionClaveTema; inicial: string; actual: string }) {
  const id = `tema-${d.clave}`;
  const r = actual.trim() ? validarValorTema(d.clave, actual) : null;
  const error = r && !r.ok ? r.mensaje : null;
  const ayuda = AYUDA[d.tipo];
  const describedBy = [ayuda ? `${id}-ayuda` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const placeholder = d.defaultCarta || "default de la carta";
  const comun = { id, name: d.clave, defaultValue: inicial, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy } as const;

  let control: React.ReactNode;
  switch (d.tipo) {
    case "color":
    case "colorHeroInk":
    case "colorHex":
      control = <CampoColor comun={comun} etiqueta={d.etiqueta} inicial={inicial} placeholder={placeholder} />;
      break;
    case "enum":
      control = (
        <select {...comun} className={CLASE_INPUT}>
          <option value="">(default de la carta: {ETIQUETAS_OPCION[d.defaultCarta] ?? d.defaultCarta})</option>
          {d.opciones.map((o) => (
            <option key={o} value={o}>
              {ETIQUETAS_OPCION[o] ?? o}
            </option>
          ))}
        </select>
      );
      break;
    case "porcentaje":
      control = <input {...comun} type="number" min={0} max={100} step="0.01" placeholder={placeholder} className={CLASE_INPUT} />;
      break;
    case "opacidad":
      control = <input {...comun} type="number" min={1} max={100} step={1} placeholder={placeholder} className={CLASE_INPUT} />;
      break;
    case "texto":
      control = <input {...comun} type="text" maxLength={d.maximo} placeholder={placeholder} className={CLASE_INPUT} />;
      break;
    case "urlHttps":
    case "imagen":
      // Texto con teclado de URL (y no type="url"): la validación nativa trabaría el envío por un campo escondido en un <details> cerrado.
      control = <input {...comun} type="text" inputMode="url" placeholder="https://…" className={CLASE_INPUT} />;
      break;
    case "telefono":
      control = <input {...comun} type="tel" placeholder={placeholder} className={CLASE_INPUT} />;
      break;
    default:
      control = <input {...comun} type="text" placeholder={placeholder} className={`${CLASE_INPUT} font-mono text-sm`} />;
  }

  return (
    <div className="flex flex-col gap-1 text-sm" data-campo-tema={d.clave}>
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
