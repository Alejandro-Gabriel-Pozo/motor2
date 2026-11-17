"use client";

import { useState } from "react";
import { MENSAJE_FORMATO_DEL_COLOR_DEL_PORTAL, PALETAS_DEL_PORTAL, colorDelPortal, eleccionDeFondo, textoDelContraste } from "@/core/carta/public";
import { Aviso } from "@/ui/primitivas/aviso";
import { Campo } from "@/ui/primitivas/campo";

/**
 * Un grupo de color del editor del portal como la maqueta de Pedernal (`portal-de-la-empresa.html:258-263,629-636`): acordeón con el nombre del grupo, fichas en grilla de tres (muestra + nombre, la elegida con tilde), «Otro color» y el veredicto de contraste con los textos aprobados de la maqueta.
 * Las fichas son radios (`paleta_<grupo>`) para que el formulario las lea como siempre; el radio ocupa toda la ficha (transparente) para que el toque y el teclado funcionen sobre ella.
 */
export type ClaveDeFondo = "encabezado" | "pagina" | "detras";

const COLOR_PEDIDO = /^#[0-9a-fA-F]{6}$/;

function Ficha({ nombre, valor, marcada, muestra, rotulo, alCambiar }: { nombre: string; valor: string; marcada: boolean; muestra: string | null; rotulo: string; alCambiar: (v: string) => void }) {
  return (
    <label className="relative block">
      <input type="radio" name={nombre} value={valor} checked={marcada} onChange={() => alCambiar(valor)} className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0" />
      <span className="flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 border-borde-control bg-superficie px-1 text-sm font-semibold text-tinta peer-checked:border-tinta peer-checked:bg-superficie-suave peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foco peer-disabled:opacity-50">
        <span aria-hidden="true" className="h-7 w-7 shrink-0 rounded-full border-2 border-borde-control bg-superficie" style={muestra === null ? undefined : { backgroundColor: muestra }} />
        {rotulo}
        {marcada && <span aria-hidden="true">✓</span>}
      </span>
    </label>
  );
}

export function GrupoDeColor({ clave, rotulo, inicial, actual, abierto }: { clave: ClaveDeFondo; rotulo: string; inicial: ReturnType<typeof eleccionDeFondo>; actual: string; abierto: boolean }) {
  const [eleccion, setEleccion] = useState<string>(inicial.eleccion);
  const valido = COLOR_PEDIDO.test(actual);
  const errorDeOtro = eleccion === "otro" && actual !== "" && !valido ? MENSAJE_FORMATO_DEL_COLOR_DEL_PORTAL : undefined;
  const usado = valido ? colorDelPortal(actual) : null;
  const nombre = `paleta_${clave}`;
  return (
    <details open={abierto || undefined} className="rounded-lg border border-borde bg-superficie" data-fondo-portal={clave}>
      <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-3 font-semibold text-tinta">
        {rotulo}
        <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-full border-2 border-borde-control bg-superficie" style={valido ? { backgroundColor: actual } : undefined} />
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3">
        <div role="group" aria-label={rotulo} className="grid grid-cols-3 gap-2">
          {PALETAS_DEL_PORTAL.map((p) => (
            <Ficha key={p.hex} nombre={nombre} valor={p.hex} marcada={eleccion === p.hex} muestra={p.hex} rotulo={p.nombre} alCambiar={setEleccion} />
          ))}
          <Ficha nombre={nombre} valor="otro" marcada={eleccion === "otro"} muestra={valido ? actual : null} rotulo="Otro color" alCambiar={setEleccion} />
          <Ficha nombre={nombre} valor="ninguna" marcada={eleccion === "ninguna"} muestra={null} rotulo="Sin color" alCambiar={setEleccion} />
        </div>
        {eleccion === "otro" && <Campo etiqueta="Otro color" name={`otro_${clave}`} type="text" maxLength={7} inputMode="text" autoComplete="off" spellCheck={false} defaultValue={inicial.otro} error={errorDeOtro} />}
        {usado !== null && (
          <div data-contraste-fondo={clave}>
            {usado.ajustado ? (
              <Aviso variante="advertencia" forma="en-linea" data-aviso-fondo-ajustado={clave}>
                El texto no se lee bien sobre este color. Se usa {usado.hex}, del mismo tono, más oscuro. Contraste {textoDelContraste(usado.razon)} a 1.
              </Aviso>
            ) : (
              <Aviso variante="exito" forma="en-linea" data-aviso-fondo-ok={clave}>
                Contraste {textoDelContraste(usado.razon)} a 1
              </Aviso>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
