"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

export interface OpcionParaOrdenar {
  id: string;
  nombre: string;
  version: number;
  esNinguna: boolean;
  activa: boolean;
}

/**
 * «Ordenar» las opciones de un grupo (GO-2d) con «mover tocando», como en el prototipo aprobado: se toca la opción que se quiere mover y después «Poner acá» donde va. Sin
 * arrastrar (en el celular falla) y sin flechas fila por fila. El orden se arma en la pantalla y se guarda de UNA vez con «Guardar orden» (`reordenarOpcionesDeGrupo`, atómica, con
 * la versión de cada opción que vio la pantalla): si otra persona cambió algo, el servidor lo rechaza y aparece «Recargar». La opción «ninguna» nunca va primera (no se ofrece ese
 * lugar), así el selector del POS empieza siempre por una opción de verdad.
 */
export function OrdenarOpciones({ opciones, accion }: { opciones: OpcionParaOrdenar[]; accion: (orden: { opcionId: string; versionEsperada: number }[]) => Promise<ResultadoAccion> }) {
  const router = useRouter();
  const [ordenando, setOrdenando] = useState(false);
  const [lista, setLista] = useState(opciones);
  const [elegida, setElegida] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);

  const empezar = () => {
    setLista(opciones);
    setElegida(null);
    setResultado(null);
    setOrdenando(true);
  };

  const poner = (destino: number) => {
    if (elegida === null) return;
    const desde = lista.findIndex((o) => o.id === elegida);
    const sin = lista.filter((o) => o.id !== elegida);
    const antesDelDestino = destino > desde ? destino - 1 : destino;
    setLista([...sin.slice(0, antesDelDestino), lista[desde]!, ...sin.slice(antesDelDestino)]);
    setElegida(null);
  };

  const guardar = () => {
    if (enviando.current) return;
    enviando.current = true;
    setResultado(null);
    startTransition(async () => {
      try {
        const r = await accion(lista.map((o) => ({ opcionId: o.id, versionEsperada: o.version })));
        setResultado(r);
        if (r.ok) {
          setOrdenando(false);
          router.refresh();
        }
      } finally {
        enviando.current = false;
      }
    });
  };

  const mensaje = resultado && (
    <Aviso variante={resultado.ok ? "exito" : "error"} forma="en-linea">
      {resultado.mensaje}
      {!resultado.ok && /Recargá la pantalla/.test(resultado.mensaje) && (
        <Boton variante="secundario" tamano="tactil" onClick={() => window.location.reload()} className="ml-2">
          Recargar
        </Boton>
      )}
    </Aviso>
  );

  if (!ordenando) {
    return (
      <div className="flex flex-col gap-1">
        <Boton variante="secundario" tamano="tactil" onClick={empezar} className="self-start">
          Ordenar opciones
        </Boton>
        {mensaje}
      </div>
    );
  }

  const elegidaEsNinguna = lista.find((o) => o.id === elegida)?.esNinguna ?? false;
  const lugar = (destino: number) => {
    const desde = elegida === null ? -1 : lista.findIndex((o) => o.id === elegida);
    // Ofrecer solo los lugares que mueven algo; el primero, nunca para «ninguna».
    if (elegida === null || destino === desde || destino === desde + 1 || (destino === 0 && elegidaEsNinguna)) return null;
    return (
      <li key={`lugar-${destino}`}>
        <Boton variante="secundario" tamano="tactil" onClick={() => poner(destino)} className="w-full">
          {destino === lista.length ? "Poner al final" : "Poner acá"}
        </Boton>
      </li>
    );
  };

  return (
    <section aria-label="Ordenar las opciones" className="flex flex-col gap-2 rounded border p-3">
      <Aviso variante="informacion" forma="en-linea">
        {elegida === null ? "Tocá la opción que querés mover." : "Ahora tocá dónde va."}
      </Aviso>
      <ol className="flex flex-col gap-1">
        {lista.flatMap((o, i) => [
          lugar(i),
          <li key={o.id}>
            <Boton variante="seleccion" tamano="tactil" aria-pressed={elegida === o.id} onClick={() => setElegida(elegida === o.id ? null : o.id)} className="w-full">
              <span className="flex w-full items-center gap-2 text-left">
                <span className="tabular-nums opacity-70">{i + 1}.</span>
                <span>{o.nombre}</span>
                {o.esNinguna && <span className="text-xs opacity-70">(ninguna)</span>}
                {!o.activa && <span className="text-xs opacity-70">(archivada)</span>}
                {elegida === o.id && <span className="ml-auto text-xs">Elegida</span>}
              </span>
            </Boton>
          </li>,
        ])}
        {lugar(lista.length)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Boton tamano="tactil" onClick={guardar} disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar orden"}
        </Boton>
        <Boton variante="secundario" tamano="tactil" onClick={() => setOrdenando(false)}>
          Cancelar
        </Boton>
      </div>
      {mensaje}
    </section>
  );
}
