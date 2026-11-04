"use client";

import { useRef, useState, useTransition } from "react";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { EnlaceInterno } from "@/components/enlace-interno";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

/**
 * «Platos de la carta sin nombre de carta» (confirmado por el dueño, 2026-11-04): los platos visibles cuyo «Nombre en la carta» sigue sin decidir. Siguen saliendo con el nombre del producto; acá se ven como
 * «pendiente de completar». Cada uno se completa en su ficha («En la carta») o, si el nombre del producto SIRVE para la carta, con «Está bien así»: lo copia al campo a propósito (queda auditado) y, si ya lo
 * usa otro plato, un ítem agrupado o una promo, el servidor responde con el motivo y no copia. Un doble toque no manda dos veces; el servidor vuelve a validar todo.
 */
export function NombresDeCartaPendientes({
  platos,
  puedeEditar,
  confirmar,
}: {
  platos: { productoId: string; nombre: string }[];
  puedeEditar: boolean;
  confirmar: (productoId: string) => Promise<ResultadoAccion>;
}) {
  const [resultados, setResultados] = useState<Record<string, ResultadoAccion>>({});
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);
  if (platos.length === 0) return null;

  const alConfirmar = (productoId: string) => {
    if (enviando.current) return;
    enviando.current = true;
    startTransition(async () => {
      try {
        const r = await confirmar(productoId);
        setResultados((previos) => ({ ...previos, [productoId]: r }));
      } finally {
        enviando.current = false;
      }
    });
  };

  return (
    <section aria-labelledby="titulo-nombres-pendientes" className="mb-3 rounded-lg border border-borde bg-superficie-suave p-3 text-sm" data-nombres-de-carta-pendientes>
      <h2 id="titulo-nombres-pendientes" className="text-base font-medium">
        Platos de la carta sin nombre de carta ({platos.length})
      </h2>
      <p className="mt-1 text-tinta-suave">Salen con el nombre del producto. Completá el nombre de carta en su ficha, o confirmá que el del producto está bien.</p>
      <ul className="mt-2 flex flex-col gap-2">
        {platos.map((p) => {
          const r = resultados[p.productoId];
          return (
            <li key={p.productoId} data-plato-pendiente={p.nombre} className="flex flex-col gap-1 border-t border-borde pt-2 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  <EnlaceInterno href={`/catalogo/productos/${p.productoId}/en-la-carta`} className="underline">
                    {p.nombre}
                  </EnlaceInterno>{" "}
                  <span className="text-tinta-suave">· Nombre de carta: pendiente de completar</span>
                </span>
                {puedeEditar && (
                  <Boton type="button" variante="secundario" disabled={pendiente} onClick={() => alConfirmar(p.productoId)} aria-label={`Está bien así: ${p.nombre}`}>
                    Está bien así
                  </Boton>
                )}
              </div>
              {r && (
                <Aviso variante={r.ok ? "exito" : "error"} forma="en-linea">
                  {r.mensaje}
                </Aviso>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
