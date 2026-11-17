"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CartaVista } from "@/components/carta-publica/carta-vista";
import { clasesFuentesCarta } from "@/components/carta-publica/fuente-carta";
import { FormConResultado } from "@/components/form-con-resultado";
import {
  CLAVES_TEMA_SIMPLE,
  MENSAJE_FORMATO_DEL_COLOR,
  PALETAS_DE_MARCA,
  ROTULO_DE_OTRO_COLOR,
  conDefaultsDeLaMaqueta,
  eleccionDeLaMarca,
  esMarcaHex,
  marcaDeLaEleccion,
  mezclarTemaSimple,
  resolverEstiloCarta,
  validarValorTema,
} from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";
import { CARTA_EJEMPLO } from "./carta-ejemplo";

/**
 * La pantalla SIMPLE del tema de la carta (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`, §3; solo con el interruptor `TEMA_SIMPLE_VISIBLE` encendido): diez campos —color de marca,
 * logo, nombre, rubro, lugar, foto de portada y los cuatro del contacto— y un solo «Guardar». El color de marca se elige entre las seis paletas de Pedernal o se escribe en «Otro color» (`#rrggbb`); la vista previa es la carta real con ese color sobre el fondo oscuro del sistema: el texto va en colores fijos del sistema y la marca solo en acentos y bordes, así que cualquier color se guarda tal cual (sin ajustes ni avisos). Formulario NO controlado (`FormConResultado`), como el editor completo: un `onInput`
 * en el cuerpo vuelve a leer el `FormData` para la vista previa. El cuerpo se vuelve a montar con `key={version}` al guardar. El servidor revalida todo (guard) y cambia SOLO estas diez claves: lo demás que la empresa haya cargado sigue como estaba.
 */
export function EditorTemaSimple({
  valoresIniciales,
  accion,
  version,
  soloLectura = false,
}: {
  valoresIniciales: Readonly<Record<string, string>>;
  accion: (formData: FormData) => Promise<ResultadoAccion>;
  /** La versión del tema que se está viendo: cambia al guardar y vuelve a montar el cuerpo con lo guardado. */
  version: string;
  /** Quien solo VE el tema recibe los campos deshabilitados, sin «Guardar» (el servidor igual rechaza, `conPermiso("carta_tema")`). */
  soloLectura?: boolean;
}) {
  return (
    <FormConResultado accion={accion} ofrecerRecargar className="flex flex-col gap-4">
      <CuerpoSimple key={version} valoresIniciales={valoresIniciales} soloLectura={soloLectura} />
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

interface Lectura {
  eleccion: string;
  otro: string;
  valores: Record<string, string>;
}

const CLAVES_DE_TEXTO = CLAVES_TEMA_SIMPLE.filter((c) => c !== "color_marca");

function leer(form: HTMLFormElement): Lectura {
  const fd = new FormData(form);
  return {
    eleccion: String(fd.get("paleta") ?? "ninguna"),
    otro: String(fd.get("color_marca_otro") ?? ""),
    valores: Object.fromEntries(CLAVES_DE_TEXTO.map((c) => [c, String(fd.get(c) ?? "")])),
  };
}

const AYUDA: Record<string, string> = {
  restaurante_logo_url: "Dirección https:// de la imagen. Si la dejás vacía, se usa la inicial del nombre.",
  restaurante_nombre: "Si lo dejás vacío, se usa el nombre de la sucursal.",
  hero_etiqueta_superior: "La línea sobre el nombre, por ejemplo: Restaurante.",
  restaurante_subtitulo: "La línea debajo del nombre, por ejemplo: Villa La Angostura.",
  hero_imagen_fondo_url: "Opcional. Dirección https:// de la foto. Con foto, la portada oscurece el fondo detrás del texto para que se lea con cualquier imagen.",
  restaurante_instagram: "El usuario (@usuario) o la URL https:// del perfil.",
  restaurante_facebook: "El usuario o la URL https:// del perfil.",
  restaurante_whatsapp: "Con código de país: +54 9 294 123-4567.",
  restaurante_footer_maps_url: "El link de Google Maps de tu local.",
};

const ETIQUETA: Record<string, string> = {
  restaurante_logo_url: "Logo",
  restaurante_nombre: "Nombre",
  hero_etiqueta_superior: "Rubro",
  restaurante_subtitulo: "Lugar",
  hero_imagen_fondo_url: "Foto de portada",
  restaurante_instagram: "Instagram",
  restaurante_facebook: "Facebook",
  restaurante_whatsapp: "WhatsApp",
  restaurante_footer_maps_url: "Google Maps",
};

const TIPO_DE_TECLADO: Record<string, "text" | "tel"> = { restaurante_whatsapp: "tel" };

function CuerpoSimple({ valoresIniciales, soloLectura }: { valoresIniciales: Readonly<Record<string, string>>; soloLectura: boolean }) {
  const inicial = useMemo(() => eleccionDeLaMarca(valoresIniciales.color_marca ?? ""), [valoresIniciales]);
  const [lectura, setLectura] = useState<Lectura>(() => ({
    eleccion: inicial.eleccion,
    otro: inicial.otro,
    valores: Object.fromEntries(CLAVES_DE_TEXTO.map((c) => [c, valoresIniciales[c] ?? ""])),
  }));

  // Se relee un instante después, como en el editor completo: el valor de un radio o de un campo ya está en el `FormData` recién cuando el navegador terminó el evento.
  const releer = (e: FormEvent<HTMLDivElement>) => {
    const form = e.currentTarget.closest("form");
    if (form) setTimeout(() => setLectura(leer(form)), 0);
  };

  const marca = marcaDeLaEleccion(lectura.eleccion, lectura.otro);
  const marcaValida = marca === "" || esMarcaHex(marca);
  const errorDeOtro = lectura.eleccion === "otro" && !marcaValida ? MENSAJE_FORMATO_DEL_COLOR : undefined;

  // La vista previa es la carta que va a ver quien entre: lo ya cargado por la empresa (con los por defecto de la maqueta en lo que no cargó), con los diez campos de la pantalla encima y la marca oscura.
  const estilo = useMemo(() => {
    // Exactamente la mezcla que hace el servidor al guardar (`mezclarTemaSimple`) y, encima, los por defecto de la maqueta en lo que no se cargó, como la carta pública. Un color escrito a medias no cambia la vista previa.
    const mezcla = mezclarTemaSimple(valoresIniciales, { ...lectura.valores, color_marca: marcaValida ? marca : (valoresIniciales.color_marca ?? "") });
    return resolverEstiloCarta(conDefaultsDeLaMaqueta(mezcla));
  }, [valoresIniciales, lectura.valores, marca, marcaValida]);


  return (
    <div onInput={releer} onChange={releer} className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <fieldset disabled={soloLectura} className="flex min-w-0 flex-col gap-4" data-solo-lectura={soloLectura ? "" : undefined} data-tema-simple>
        <section aria-labelledby="titulo-color-de-marca" className="flex flex-col gap-3 rounded border p-3" data-seccion-color-de-marca>
          <h2 id="titulo-color-de-marca" className="text-sm font-medium">
            Color de marca
          </h2>
          <OpcionesExcluyentes
            leyenda="Colores"
            nombre="paleta"
            presentacion="fila"
            valorInicial={inicial.eleccion}
            opciones={[
              ...PALETAS_DE_MARCA.map((p) => ({
                valor: p.id,
                etiqueta: (
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full border border-borde-control" style={{ backgroundColor: p.hex }} />
                    {p.nombre}
                  </span>
                ),
              })),
              { valor: "otro", etiqueta: "Otro color" },
              { valor: "ninguna", etiqueta: "Sin color de marca" },
            ]}
          />
          {lectura.eleccion === "otro" && (
            <Campo etiqueta={ROTULO_DE_OTRO_COLOR} name="color_marca_otro" type="text" maxLength={7} inputMode="text" autoComplete="off" defaultValue={inicial.otro} error={errorDeOtro} />
          )}
          <div data-estado-marca-simple>
            {!marca && (
              <Aviso variante="informacion" forma="en-linea">
                Elegí un color para ver cómo queda la carta.
              </Aviso>
            )}
          </div>
        </section>

        <section aria-labelledby="titulo-marca-simple" className="flex flex-col gap-3 rounded border p-3">
          <h2 id="titulo-marca-simple" className="text-sm font-medium">
            Marca
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(["restaurante_logo_url", "restaurante_nombre"] as const).map((clave) => (
              <CampoSimple key={clave} clave={clave} inicial={valoresIniciales[clave] ?? ""} actual={lectura.valores[clave] ?? ""} />
            ))}
          </div>
        </section>

        <section aria-labelledby="titulo-portada-simple" className="flex flex-col gap-3 rounded border p-3">
          <h2 id="titulo-portada-simple" className="text-sm font-medium">
            Portada
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(["hero_etiqueta_superior", "restaurante_subtitulo", "hero_imagen_fondo_url"] as const).map((clave) => (
              <CampoSimple key={clave} clave={clave} inicial={valoresIniciales[clave] ?? ""} actual={lectura.valores[clave] ?? ""} />
            ))}
          </div>
        </section>

        <section aria-labelledby="titulo-contacto-simple" className="flex flex-col gap-3 rounded border p-3">
          <h2 id="titulo-contacto-simple" className="text-sm font-medium">
            Contacto
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(["restaurante_instagram", "restaurante_facebook", "restaurante_whatsapp", "restaurante_footer_maps_url"] as const).map((clave) => (
              <CampoSimple key={clave} clave={clave} inicial={valoresIniciales[clave] ?? ""} actual={lectura.valores[clave] ?? ""} />
            ))}
          </div>
        </section>
      </fieldset>

      <section aria-labelledby="titulo-vista-previa-simple" className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
        <h2 id="titulo-vista-previa-simple" className="text-sm font-medium">
          Vista previa
        </h2>
        {/* Solo para mirar (`inert`): no se navega y no repite los puntos de referencia de la carta para los lectores de pantalla. */}
        <div className="w-full max-w-[375px]" inert aria-hidden="true" data-vista-previa-caja>
          <div className={`carta-shell ${clasesFuentesCarta} overflow-hidden rounded border`} data-vista-previa-tema-simple>
            <CartaVista carta={CARTA_EJEMPLO} estilo={estilo} embebida />
          </div>
        </div>
        <p className="text-xs text-tinta-suave">Es la carta real con datos de ejemplo. El color de marca va en los detalles; el fondo y el texto son del sistema.</p>
      </section>
    </div>
  );
}

function CampoSimple({ clave, inicial, actual }: { clave: (typeof CLAVES_DE_TEXTO)[number]; inicial: string; actual: string }) {
  const r = actual.trim() ? validarValorTema(clave, actual) : null;
  const error = r && !r.ok ? `No es válido: ${r.mensaje}.` : undefined;
  return (
    <div data-campo-tema={clave}>
      <Campo etiqueta={ETIQUETA[clave]} ayuda={AYUDA[clave]} name={clave} type={TIPO_DE_TECLADO[clave] ?? "text"} inputMode={clave === "restaurante_logo_url" || clave === "hero_imagen_fondo_url" || clave === "restaurante_footer_maps_url" ? "url" : undefined} defaultValue={inicial} error={error} />
    </div>
  );
}
