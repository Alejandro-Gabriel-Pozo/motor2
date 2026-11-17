"use client";

import { useMemo, useState, type FormEvent } from "react";
import { PortalVista } from "@/components/carta-publica/portal-vista";
import { clasesFuentesCarta } from "@/components/carta-publica/fuente-carta";
import { FormConResultado } from "@/components/form-con-resultado";
import { eleccionDeFondo, estiloDelPortalSimple, fondoDeLaEleccion, leerDireccionDeImagen, type EntradaVistaPreviaPortal, type EstiloPortal } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { GrupoDeColor, type ClaveDeFondo } from "./editor-colores-fichas";

/**
 * El editor del portal como la maqueta de Pedernal (`portal-de-la-empresa.html`, pestañas Portal y Colores; solo con el interruptor `portalSimpleVisible` encendido): tres pestañas (Portal: logo, línea sobre el título y título; Colores: los tres fondos en acordeones con fichas en grilla; Vista previa: el portal
 * real) y un «Guardar» de ancho completo fijo al pie. Los textos NO se eligen: se derivan (blanco o negro) y el fondo llega a 7:1 AL MOSTRAR; si un color no llega, el veredicto avisa cuál se usa (lo que se guarda es siempre el elegido). La vista previa es el MISMO portal público (`PortalVista` con
 * `estiloDelPortalSimple`, la misma función que usa el servidor). Formulario NO controlado (`FormConResultado`): un `onInput` vuelve a leer el `FormData` para la vista previa; el cuerpo se vuelve a montar con `key={version}` al guardar. El servidor revalida todo (guard) y cambia SOLO estos campos.
 * Las tres pestañas están siempre en el formulario (la que no se ve va con `hidden`): guardar manda todo. La dirección de la imagen (variante B de la maqueta) solo se pide con la variante B; con la A viaja escondida para no perderla.
 */
export interface ValoresInicialesDelPortal {
  colorEncabezado: string | null;
  colorPagina: string | null;
  colorDetras: string | null;
  lineaSuperior: string;
  titulo: string;
  logoVisible: boolean;
  /** Dirección de la imagen del portal (vacía = sin imagen). */
  imagen: string;
}

export function EditorColoresDelPortal(props: {
  iniciales: ValoresInicialesDelPortal;
  /** Lo que la empresa ya tenía cargado en el Json (la vista previa lo usa donde la fila no cargó nada, igual que el portal público). */
  json: Readonly<Record<string, string>>;
  variante: "A" | "B";
  sucursales: readonly EntradaVistaPreviaPortal[];
  empresaNombre: string;
  version: string;
  accion: (formData: FormData) => Promise<ResultadoAccion>;
  soloLectura?: boolean;
}) {
  const { accion, version, soloLectura = false } = props;
  return (
    <FormConResultado accion={accion} ofrecerRecargar className="flex flex-col gap-4">
      <Cuerpo key={version} {...props} soloLectura={soloLectura} />
      {!soloLectura && (
        <div className="sticky bottom-0 -mx-4 border-t border-borde bg-superficie px-4 py-3">
          <Boton type="submit" tamano="tactil" className="w-full">
            Guardar
          </Boton>
        </div>
      )}
    </FormConResultado>
  );
}

const GRUPOS = [
  { clave: "encabezado", rotulo: "Encabezado", inicial: "colorEncabezado" },
  { clave: "pagina", rotulo: "Página", inicial: "colorPagina" },
  { clave: "detras", rotulo: "Detrás de la imagen", inicial: "colorDetras" },
] as const;

const PESTANAS = [
  { id: "portal", rotulo: "Portal" },
  { id: "colores", rotulo: "Colores" },
  { id: "vista", rotulo: "Vista previa" },
] as const;
type IdDePestana = (typeof PESTANAS)[number]["id"];

interface Lectura {
  fondos: Record<ClaveDeFondo, string>;
  lineaSuperior: string;
  titulo: string;
  imagen: string;
}

const COLOR_PEDIDO = /^#[0-9a-fA-F]{6}$/;

function leer(form: HTMLFormElement): Lectura {
  const fd = new FormData(form);
  const fondo = (c: ClaveDeFondo) => fondoDeLaEleccion(fd.get(`paleta_${c}`), fd.get(`otro_${c}`));
  return {
    fondos: { encabezado: fondo("encabezado"), pagina: fondo("pagina"), detras: fondo("detras") },
    lineaSuperior: String(fd.get("lineaSuperior") ?? ""),
    titulo: String(fd.get("titulo") ?? ""),
    imagen: String(fd.get("imagen") ?? ""),
  };
}

/** La miniatura de la maqueta (`miniHtml`): encabezado y tarjeta contenedora con los colores que se están eligiendo; solo adorno (sin texto). */
function Miniatura({ estilo }: { estilo: EstiloPortal }) {
  const v = estilo.variablesCss;
  const fondo = (variable: string) => (v[variable] === undefined ? undefined : { background: v[variable] });
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-lg border-2 border-borde-control bg-superficie" style={fondo("--portal-fondo-color")}>
      <div className="flex flex-col items-center gap-2 p-4" style={fondo("--portal-header-bg")}>
        <span className="h-2 w-24 rounded-full bg-tinta-suave opacity-40" />
        <span className="h-3 w-40 rounded-full bg-tinta-suave opacity-40" />
      </div>
      <div className="m-4 flex flex-col gap-2 rounded-2xl p-3" style={fondo("--portal-detras-bg")}>
        <span className="h-9 rounded-lg border-2 border-borde-control bg-superficie" />
        <span className="h-9 rounded-lg border-2 border-borde-control bg-superficie" />
      </div>
    </div>
  );
}

function Cuerpo({ iniciales, json, variante, sucursales, empresaNombre, soloLectura }: Parameters<typeof EditorColoresDelPortal>[0] & { soloLectura: boolean }) {
  const [pestana, setPestana] = useState<IdDePestana>("portal");
  const [logoVisible, setLogoVisible] = useState(iniciales.logoVisible);
  const [lectura, setLectura] = useState<Lectura>(() => ({
    fondos: { encabezado: iniciales.colorEncabezado ?? "", pagina: iniciales.colorPagina ?? "", detras: iniciales.colorDetras ?? "" },
    lineaSuperior: iniciales.lineaSuperior,
    titulo: iniciales.titulo,
    imagen: iniciales.imagen,
  }));
  // Se relee un instante después: el valor de un radio o de un campo ya está en el `FormData` recién cuando el navegador terminó el evento.
  const releer = (e: FormEvent<HTMLDivElement>) => {
    const form = e.currentTarget.closest("form");
    if (form) setTimeout(() => setLectura(leer(form)), 0);
  };

  // Un color escrito a medias no cambia la vista previa (solo cuenta el que tiene la forma `#rrggbb`).
  const valido = (c: string): string | null => (COLOR_PEDIDO.test(c) ? c : null);
  const estilo = useMemo(() => {
    const imagen = lectura.imagen.trim() === "" ? null : leerDireccionDeImagen(lectura.imagen);
    return estiloDelPortalSimple(json, {
      variante,
      lineaSuperior: lectura.lineaSuperior.trim() || null,
      titulo: lectura.titulo.trim() || null,
      colorEncabezado: valido(lectura.fondos.encabezado),
      colorPagina: valido(lectura.fondos.pagina),
      colorDetras: valido(lectura.fondos.detras),
      imagen: imagen !== null && imagen.ok ? imagen.valor : null,
      logoVisible,
    });
  }, [json, variante, lectura, logoVisible]);
  const logo = json.empresa_logo_url?.startsWith("https://") ? json.empresa_logo_url : null;

  return (
    <div onInput={releer} onChange={releer} className="flex flex-col gap-4">
      <div role="group" aria-label="Solapas" className="flex flex-wrap gap-2">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={pestana === p.id}
            onClick={() => setPestana(p.id)}
            className="min-h-11 rounded-full border-2 border-borde-control bg-superficie px-4 text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco aria-pressed:border-tinta aria-pressed:bg-tinta aria-pressed:font-semibold aria-pressed:text-superficie"
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      <fieldset disabled={soloLectura} className="flex min-w-0 flex-col gap-4" data-solo-lectura={soloLectura ? "" : undefined} data-portal-simple>
        <div hidden={pestana !== "portal"} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Aspecto</h2>
          <Miniatura estilo={estilo} />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Logo</span>
            <div className="flex items-center gap-3">
              {logo !== null && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" aria-hidden="true" className={`h-14 w-14 object-contain ${logoVisible ? "" : "opacity-30"}`} />
              )}
              <Boton type="button" variante="secundario" tamano="tactil" onClick={() => setLogoVisible((v) => !v)}>
                {logoVisible ? "Quitar" : "Volver a mostrar"}
              </Boton>
            </div>
            {logoVisible && <input type="hidden" name="logoVisible" value="on" />}
          </div>
          <Campo etiqueta="Línea sobre el título" name="lineaSuperior" defaultValue={iniciales.lineaSuperior} maxLength={40} />
          <Campo etiqueta="Título" name="titulo" defaultValue={iniciales.titulo} maxLength={60} />
          {variante === "B" ? <Campo etiqueta="Dirección de la imagen" name="imagen" type="text" inputMode="url" defaultValue={iniciales.imagen} /> : <input type="hidden" name="imagen" defaultValue={iniciales.imagen} />}
        </div>

        <div hidden={pestana !== "colores"} className="flex flex-col gap-3">
          <Miniatura estilo={estilo} />
          {GRUPOS.map((g, i) => (
            <GrupoDeColor key={g.clave} clave={g.clave} rotulo={g.rotulo} inicial={eleccionDeFondo(iniciales[g.inicial])} actual={lectura.fondos[g.clave]} abierto={i === 0} />
          ))}
        </div>
      </fieldset>

      <div hidden={pestana !== "vista"}>
        {/* Solo para mirar (`inert`): no se navega y no repite los puntos de referencia del portal para los lectores de pantalla. */}
        <div className="mx-auto w-full max-w-[375px]" inert aria-hidden="true">
          <div className={`carta-shell ${clasesFuentesCarta} overflow-hidden rounded-lg border-2 border-borde-control`} data-vista-previa-colores-portal>
            <PortalVista sucursales={sucursales} empresaNombre={empresaNombre} estilo={estilo} hrefDe={() => "#"} modo="vista-previa" />
          </div>
        </div>
      </div>
    </div>
  );
}
