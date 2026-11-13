"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import { CartaVista } from "@/components/carta-publica/carta-vista";
import { clasesFuentesCarta } from "@/components/carta-publica/fuente-carta";
import { resolverEstiloCarta, validarMarcaParaGuardar } from "@/core/carta/public";
import { Boton } from "@/ui/primitivas/boton";
import { CARTA_EJEMPLO } from "./carta-ejemplo";

/**
 * El color de marca de la carta (paso 9; `docs/diseno-marca-por-sucursal-y-empresa-2026-11-12.md`). Va DENTRO del formulario del tema (`EditorTema`): un selector de color, la vista previa de la carta real con ese
 * color, el aviso de que una carta oscura se ve clara, y dos botones (decisión del dueño, 2026-11-13: «Botón explícito (Recomendada)»):
 *  - «Pasar a color de marca» (o «Guardar color de marca» si la carta ya lo usa): manda el formulario con la intención «pasar».
 *  - «Volver a mis colores anteriores»: manda el formulario con la intención «volver» (quita solo el marcador; los colores sueltos nunca se borran).
 * Los botones son `type="button"` (no envían solos ni con Enter): ponen la intención en un campo escondido, envían y la vuelven a vaciar, así «Guardar tema» sigue guardando como siempre. El servidor revalida todo
 * (M1, M2 y M3 en `guardComandoGuardarTemaCarta`): acá el aviso en vivo es solo ayuda. La vista previa es solo para mirar (`inert`): no se navega y no repite los puntos de referencia (nav) de la vista previa del tema para los lectores de pantalla.
 */
const CLASE_COLOR = "h-11 w-14 shrink-0 cursor-pointer rounded border border-borde-control md:h-9";
const HEX_MINUSCULA = /^#[0-9a-f]{6}$/;

export function SeccionMarca({ modoMarca, marcaInicial, valores, soloLectura }: { modoMarca: boolean; marcaInicial: string; valores: Readonly<Record<string, string>>; soloLectura: boolean }) {
  const [marca, setMarca] = useState(() => (HEX_MINUSCULA.test(marcaInicial.trim().toLowerCase()) ? marcaInicial.trim().toLowerCase() : ""));
  const intencion = useRef<HTMLInputElement>(null);
  const evaluacion = marca ? validarMarcaParaGuardar(marca) : null;
  const estilo = useMemo(() => (marca ? resolverEstiloCarta({ ...valores, color_marca: marca, marca_derivada: "si" }) : null), [marca, valores]);

  function enviar(e: MouseEvent<HTMLButtonElement>, valor: "pasar" | "volver") {
    const formulario = e.currentTarget.form;
    if (!formulario || !intencion.current) return;
    intencion.current.value = valor;
    formulario.requestSubmit();
    // El envío ya tomó los datos (es síncrono): se vacía para que «Guardar tema» no lo arrastre si este envío se rechaza.
    intencion.current.value = "";
  }

  return (
    <section aria-labelledby="titulo-marca" className="flex flex-col gap-3 rounded border p-3" data-seccion-marca data-modo={modoMarca ? "marca" : "clasico"}>
      <input type="hidden" name="intencion" defaultValue="" ref={intencion} />
      <input type="hidden" name="marca_elegida" value={marca} readOnly />
      <div className="flex flex-col gap-1">
        <h2 id="titulo-marca" className="text-sm font-medium">
          Color de marca
        </h2>
        <p className="text-sm" data-estado-marca>
          {modoMarca ? "Esta carta usa el color de marca: el resto se calcula solo." : "Esta carta usa los colores sueltos de abajo, como siempre."}
        </p>
        <p className="text-xs text-tinta-tenue">
          Con el color de marca la carta usa el fondo claro y los textos del sistema (si hoy tu carta es oscura, se va a ver clara). Tus colores anteriores no se borran: podés volver cuando quieras.
          {modoMarca ? " Mientras la carta use el color de marca, los colores sueltos de abajo no se usan." : ""}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="color"
          aria-label="Color de marca: selector"
          value={marca || "#808080"}
          onChange={(e) => setMarca(e.target.value.toLowerCase())}
          disabled={soloLectura}
          className={CLASE_COLOR}
        />
        <span className="text-sm tabular-nums" data-color-elegido>
          {marca || "Sin elegir"}
        </span>
      </div>
      <p role="status" className={`text-sm ${evaluacion && !evaluacion.ok ? "text-error" : "text-tinta-tenue"}`} data-aviso-marca>
        {!evaluacion ? "Elegí un color para ver cómo queda." : evaluacion.ok ? "Este color se lee bien." : evaluacion.mensaje}
      </p>

      {estilo && (
        <div className="w-full max-w-[375px]" data-vista-previa-marca-caja inert aria-hidden="true">
          <div className={`carta-shell ${clasesFuentesCarta} overflow-hidden rounded border`} data-vista-previa-marca>
            <CartaVista carta={CARTA_EJEMPLO} estilo={estilo} embebida />
          </div>
        </div>
      )}

      {!soloLectura && (
        <div className="flex flex-wrap items-center gap-2">
          <Boton type="button" tamano="compacto" disabled={!evaluacion?.ok} onClick={(e) => enviar(e, "pasar")} data-accion-marca="pasar">
            {modoMarca ? "Guardar color de marca" : "Pasar a color de marca"}
          </Boton>
          {modoMarca && (
            <Boton type="button" variante="secundario" tamano="compacto" onClick={(e) => enviar(e, "volver")} data-accion-marca="volver">
              Volver a mis colores anteriores
            </Boton>
          )}
          <p className="w-full text-xs text-tinta-tenue">Se guarda junto con el resto del formulario.</p>
        </div>
      )}
    </section>
  );
}
