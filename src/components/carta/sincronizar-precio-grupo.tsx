"use client";

import { useState, useTransition } from "react";
import type { ResultadoAccion, SincronizablePrecioGrupo } from "@/server/actions/tipos";

const pesos = (n: number) => `$${n.toLocaleString("es-AR")}`;

/**
 * Después de guardar un precio (Catálogo o Precio Local) de un producto que está en un ítem agrupado de la carta, ofrece aplicar el
 * mismo precio a sus hermanos que quedaron a otro precio (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8). Es un bloque
 * aparte, no un modal ni un `confirm()`: el precio ya quedó guardado, y si nadie aprieta el botón la carta muestra el mayor con aviso
 * (la red de seguridad de D5). Solo aparece si la acción devolvió `sincronizable`.
 */
export function SincronizarPrecioGrupo({
  sincronizable: s,
  aplicar,
  alTerminar,
}: {
  sincronizable: SincronizablePrecioGrupo;
  /** Llama a la acción de sincronizar (sincronizarPrecioGrupoCarta / sincronizarPrecioLocalGrupoCarta) con los hermanos y el precio. */
  aplicar: (productoIds: string[], precio: number) => Promise<ResultadoAccion>;
  /** Cuando se aplicó bien o se eligió dejarlo como está. */
  alTerminar: (aplicado: boolean) => void;
}) {
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pending, startTransition] = useTransition();
  const cantidad = s.hermanos.length;

  return (
    <div className="flex flex-col gap-2 rounded border border-amber-300 p-3 text-sm dark:border-amber-700" data-sincronizar-precio-grupo={s.nombreItem}>
      <p className="text-amber-700 dark:text-amber-600">
        «{s.nombreItem}» tiene {cantidad} {cantidad === 1 ? "opción más" : "opciones más"} a otro precio:{" "}
        {s.hermanos.map((h) => `${h.nombre} (${pesos(h.precioActual)})`).join(", ")}. ¿Aplicar {pesos(s.precioNuevo)} también?
      </p>
      <p className="text-neutral-500 dark:text-neutral-400">Si no, la carta muestra el mayor de los precios hasta que se igualen.</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50"
          onClick={() =>
            startTransition(async () => {
              const r = await aplicar(
                s.hermanos.map((h) => h.productoId),
                s.precioNuevo
              );
              setResultado(r);
              if (r.ok) alTerminar(true);
            })
          }
        >
          {pending ? "Aplicando..." : `Aplicar ${pesos(s.precioNuevo)} también`}
        </button>
        <button type="button" disabled={pending} className="underline disabled:opacity-50" onClick={() => alTerminar(false)}>
          Dejar como está
        </button>
      </div>
      {resultado && (
        <p role={resultado.ok ? "status" : "alert"} className={resultado.ok ? "text-green-700" : "text-red-600"}>
          {resultado.mensaje}
        </p>
      )}
    </div>
  );
}
