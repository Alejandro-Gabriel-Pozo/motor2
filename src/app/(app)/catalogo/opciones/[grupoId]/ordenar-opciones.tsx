"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { ResultadoAccion } from "@/server/actions/tipos";

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
    <p role={resultado.ok ? "status" : "alert"} className={`text-sm ${resultado.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
      {resultado.mensaje}
      {!resultado.ok && /Recargá la pantalla/.test(resultado.mensaje) && (
        <button type="button" onClick={() => window.location.reload()} className="ml-2 inline-flex min-h-[44px] items-center rounded border border-current px-3 py-1 font-medium">
          Recargar
        </button>
      )}
    </p>
  );

  if (!ordenando) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" onClick={empezar} className="min-h-[44px] self-start rounded border px-3 py-2 text-sm">
          Ordenar opciones
        </button>
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
        <button type="button" onClick={() => poner(destino)} className="min-h-[44px] w-full rounded border border-dashed border-neutral-500 px-3 py-2 text-sm">
          {destino === lista.length ? "Poner al final" : "Poner acá"}
        </button>
      </li>
    );
  };

  return (
    <section aria-label="Ordenar las opciones" className="flex flex-col gap-2 rounded border p-3">
      <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
        {elegida === null ? "Tocá la opción que querés mover." : "Ahora tocá dónde va."}
      </p>
      <ol className="flex flex-col gap-1">
        {lista.flatMap((o, i) => [
          lugar(i),
          <li key={o.id}>
            <button
              type="button"
              aria-pressed={elegida === o.id}
              onClick={() => setElegida(elegida === o.id ? null : o.id)}
              className="flex min-h-[44px] w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm aria-pressed:border-neutral-900 aria-pressed:font-semibold dark:aria-pressed:border-neutral-100"
            >
              <span className="tabular-nums text-neutral-600 dark:text-neutral-400">{i + 1}.</span>
              <span>{o.nombre}</span>
              {o.esNinguna && <span className="text-xs text-neutral-600 dark:text-neutral-400">(ninguna)</span>}
              {!o.activa && <span className="text-xs text-neutral-600 dark:text-neutral-400">(archivada)</span>}
              {elegida === o.id && <span className="ml-auto text-xs">Elegida</span>}
            </button>
          </li>,
        ])}
        {lugar(lista.length)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={guardar} disabled={pendiente} className="min-h-[44px] rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60">
          {pendiente ? "Guardando…" : "Guardar orden"}
        </button>
        <button type="button" onClick={() => setOrdenando(false)} className="min-h-[44px] rounded border px-4 py-2 text-sm">
          Cancelar
        </button>
      </div>
      {mensaje}
    </section>
  );
}
