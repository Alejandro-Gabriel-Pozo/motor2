"use client";

import { useState, useTransition } from "react";
import type { ResultadoAccion, SincronizablePrecioGrupo } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

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
  /**
   * Llama a la acción de sincronizar (sincronizarPrecioGrupoCarta / sincronizarPrecioLocalGrupoCarta) con los hermanos y el precio. Cada hermano va con el
   * `precioActual` que esta pantalla le mostró (el valor visto): la acción lo vuelve a comparar con la base antes de escribir.
   */
  aplicar: (hermanos: { productoId: string; precioActual: number }[], precio: number) => Promise<ResultadoAccion>;
  /** Cuando se aplicó bien o se eligió dejarlo como está. */
  alTerminar: (aplicado: boolean) => void;
}) {
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pending, startTransition] = useTransition();
  const cantidad = s.hermanos.length;

  return (
    <div className="flex flex-col gap-2 rounded border border-aviso p-3 text-sm" data-sincronizar-precio-grupo={s.nombreItem}>
      <p className="text-aviso-tinta">
        «{s.nombreItem}» tiene {cantidad} {cantidad === 1 ? "opción más" : "opciones más"} a otro precio:{" "}
        {s.hermanos.map((h) => `${h.nombre} (${pesos(h.precioActual)})`).join(", ")}. ¿Aplicar {pesos(s.precioNuevo)} también?
      </p>
      <p className="text-tinta-tenue">Si no, la carta muestra el mayor de los precios hasta que se igualen.</p>
      <div className="flex flex-wrap gap-3">
        <Boton
          tamano="compacto"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await aplicar(
                s.hermanos.map((h) => ({ productoId: h.productoId, precioActual: h.precioActual })),
                s.precioNuevo
              );
              setResultado(r);
              if (r.ok) alTerminar(true);
            })
          }
        >
          {pending ? "Aplicando..." : `Aplicar ${pesos(s.precioNuevo)} también`}
        </Boton>
        <Boton variante="enlace" tamano="en-fila" disabled={pending} onClick={() => alTerminar(false)}>
          Dejar como está
        </Boton>
      </div>
      {resultado && (
        <Aviso variante={resultado.ok ? "exito" : "error"} forma="en-linea">
          {resultado.mensaje}
        </Aviso>
      )}
    </div>
  );
}
