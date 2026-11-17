"use client";

import { useMemo, useState, type FormEvent } from "react";
import { PortalVista } from "@/components/carta-publica/portal-vista";
import { clasesFuentesCarta } from "@/components/carta-publica/fuente-carta";
import { FormConResultado } from "@/components/form-con-resultado";
import {
  MENSAJE_FORMATO_DEL_COLOR_DEL_PORTAL,
  PALETAS_DEL_PORTAL,
  ROTULO_DE_OTRO_COLOR_DEL_PORTAL,
  eleccionDeFondo,
  estiloDelPortalSimple,
  fondoDeLaEleccion,
  leerDireccionDeImagen,
  type EntradaVistaPreviaPortal,
} from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";

/**
 * La pantalla SIMPLE de «Colores del portal» (pestaña Portal de «Apariencia y publicación», como Pedernal; solo con el interruptor `portalSimpleVisible` encendido): los TRES COLORES (encabezado, página y detrás de la imagen), la línea sobre el título, el título, el logo y la imagen, con un
 * solo «Guardar». Cada fondo se elige entre las seis paletas de Pedernal o se escribe en «Otro color» (`#rrggbb`); los textos NO se eligen: se derivan (blanco o negro) y el fondo llega a 7:1 AL MOSTRAR. Si un color no llega, la pantalla avisa cuál se usa en su lugar (lo que se guarda es
 * siempre el elegido). La vista previa es el MISMO portal público (`PortalVista` con `estiloDelPortalSimple`, la misma función que usa el servidor). Formulario NO controlado (`FormConResultado`): un `onInput` vuelve a leer el `FormData` para la vista previa; el cuerpo se vuelve a montar
 * con `key={version}` al guardar. El servidor revalida todo (guard) y cambia SOLO estos campos.
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
        <div>
          <Boton type="submit" tamano="compacto">
            Guardar
          </Boton>
        </div>
      )}
    </FormConResultado>
  );
}

const FONDOS = [
  { clave: "encabezado", rotulo: "Encabezado", ayuda: "El filo de abajo del encabezado." },
  { clave: "pagina", rotulo: "Página", ayuda: "El filo de arriba de la página." },
  { clave: "detras", rotulo: "Detrás de la imagen", ayuda: "El borde de las tarjetas." },
] as const;
type ClaveDeFondo = (typeof FONDOS)[number]["clave"];

interface Lectura {
  fondos: Record<ClaveDeFondo, string>;
  lineaSuperior: string;
  titulo: string;
  logoVisible: boolean;
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
    logoVisible: fd.get("logoVisible") === "on",
    imagen: String(fd.get("imagen") ?? ""),
  };
}

function Cuerpo({ iniciales, json, variante, sucursales, empresaNombre, soloLectura }: Parameters<typeof EditorColoresDelPortal>[0] & { soloLectura: boolean }) {
  const [lectura, setLectura] = useState<Lectura>(() => ({
    fondos: { encabezado: iniciales.colorEncabezado ?? "", pagina: iniciales.colorPagina ?? "", detras: iniciales.colorDetras ?? "" },
    lineaSuperior: iniciales.lineaSuperior,
    titulo: iniciales.titulo,
    logoVisible: iniciales.logoVisible,
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
      logoVisible: lectura.logoVisible,
    });
  }, [json, variante, lectura]);

  return (
    <div onInput={releer} onChange={releer} className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <fieldset disabled={soloLectura} className="flex min-w-0 flex-col gap-4" data-solo-lectura={soloLectura ? "" : undefined} data-portal-simple>
        {FONDOS.map((f) => (
          <SeccionDeFondo key={f.clave} fondo={f} inicial={eleccionDeFondo(iniciales[f.clave === "encabezado" ? "colorEncabezado" : f.clave === "pagina" ? "colorPagina" : "colorDetras"])} actual={lectura.fondos[f.clave]} />
        ))}
        <section aria-labelledby="titulo-textos-portal" className="flex flex-col gap-3 rounded border p-3">
          <h2 id="titulo-textos-portal" className="text-sm font-medium">
            Textos, logo e imagen
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Línea sobre el título" name="lineaSuperior" defaultValue={iniciales.lineaSuperior} maxLength={40} />
            <Campo etiqueta="Título" name="titulo" defaultValue={iniciales.titulo} maxLength={60} />
          </div>
          <Casilla etiqueta="Mostrar el logo" name="logoVisible" defaultChecked={iniciales.logoVisible} />
          <Campo etiqueta="Imagen del portal" ayuda="Dirección de la imagen (Cloudinary). Vacía = sin imagen. Se usa cuando el portal se ve como mapa." name="imagen" type="text" inputMode="url" defaultValue={iniciales.imagen} />
        </section>
      </fieldset>

      <section aria-labelledby="titulo-vista-previa-colores" className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
        <h2 id="titulo-vista-previa-colores" className="text-sm font-medium">
          Vista previa
        </h2>
        {/* Solo para mirar (`inert`): no se navega y no repite los puntos de referencia del portal para los lectores de pantalla. */}
        <div className="w-full max-w-[375px]" inert aria-hidden="true">
          <div className={`carta-shell ${clasesFuentesCarta} overflow-hidden rounded border`} data-vista-previa-colores-portal>
            <PortalVista sucursales={sucursales} empresaNombre={empresaNombre} estilo={estilo} hrefDe={() => "#"} modo="vista-previa" />
          </div>
        </div>
        <p className="text-xs text-tinta-suave">Es el portal real con las sucursales de la empresa. El color elegido pinta solo los acentos (filos y bordes); los textos son los del sistema.</p>
      </section>
    </div>
  );
}

function SeccionDeFondo({ fondo, inicial, actual }: { fondo: (typeof FONDOS)[number]; inicial: ReturnType<typeof eleccionDeFondo>; actual: string }) {
  const [eleccion, setEleccion] = useState<string>(inicial.eleccion);
  const rotuloId = `titulo-fondo-${fondo.clave}`;
  const valido = COLOR_PEDIDO.test(actual);
  const errorDeOtro = eleccion === "otro" && actual !== "" && !valido ? MENSAJE_FORMATO_DEL_COLOR_DEL_PORTAL : undefined;
  return (
    <section aria-labelledby={rotuloId} className="flex flex-col gap-3 rounded border p-3" data-fondo-portal={fondo.clave}>
      <div>
        <h2 id={rotuloId} className="text-sm font-medium">
          {fondo.rotulo}
        </h2>
        <p className="text-xs text-tinta-suave">{fondo.ayuda}</p>
      </div>
      <OpcionesExcluyentes
        leyenda="Colores"
        nombre={`paleta_${fondo.clave}`}
        presentacion="fila"
        valorInicial={inicial.eleccion}
        alCambiar={setEleccion}
        opciones={[
          ...PALETAS_DEL_PORTAL.map((p) => ({
            valor: p.hex,
            etiqueta: (
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full border border-borde-control" style={{ backgroundColor: p.hex }} />
                {p.nombre}
              </span>
            ),
          })),
          { valor: "otro", etiqueta: "Otro color" },
          { valor: "ninguna", etiqueta: "Sin color (el de siempre)" },
        ]}
      />
      {eleccion === "otro" && <Campo etiqueta={ROTULO_DE_OTRO_COLOR_DEL_PORTAL} name={`otro_${fondo.clave}`} type="text" maxLength={7} inputMode="text" autoComplete="off" defaultValue={inicial.otro} error={errorDeOtro} />}
    </section>
  );
}
