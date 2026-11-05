"use client";

import { textoDeLimites } from "@/core/opciones/public";
import { esDeUnaSolaEleccion, gruposQueFaltanDeUnidad, type GrupoParaVender, type UnidadAElegir } from "@/core/pos/public";
import { Boton } from "@/ui/primitivas/boton";

/**
 * Las opciones de UNA unidad de una entrada «a elegir» de una promo (diseño 2026-11-04 §7 y §11 nivel 8): un grupo por `fieldset`, solo con las opciones PERMITIDAS efectivas de hoy (las que ya filtró la
 * lectura, la misma que valida el servidor), con los límites del grupo. Un grupo de una sola elección se resuelve con botones de selección (`aria-pressed`; tocar la elegida en un grupo opcional la
 * saca); uno de varias, con −/+ y el tope de la opción. Sin precios ni adicionales: el precio de la promo es fijo. Es comodidad: no decide nada; el servidor vuelve a armar todo contra lo permitido.
 */
export function OpcionesDeUnidad({
  nombre,
  numero,
  grupos,
  unidad,
  onOpcion,
}: {
  /** El plato elegido («Bife»). */
  nombre: string;
  /** Cuál de las unidades de ese plato es («Bife 2»): solo se muestra si hay más de una. */
  numero: number | null;
  grupos: readonly GrupoParaVender[];
  unidad: UnidadAElegir;
  onOpcion: (accion: "elegir" | "sumar" | "restar", grupoId: string, opcionId: string) => void;
}) {
  const faltan = gruposQueFaltanDeUnidad(grupos, unidad);
  const titulo = numero === null ? nombre : `${nombre} ${numero}`;
  return (
    <div data-unidad-a-elegir={titulo} role="group" aria-label={`Opciones de ${titulo}`} className="flex flex-col gap-3 rounded-lg bg-superficie-suave p-3">
      {numero !== null && <p className="text-sm font-semibold">{titulo}</p>}
      {grupos.map((g) => {
        const unaSola = esDeUnaSolaEleccion(g);
        return (
          <fieldset key={g.grupoId} data-grupo-opciones={g.nombre} className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 text-sm font-bold">
              {g.nombre} · {g.cantidadMinima > 0 ? textoDeLimites(g.cantidadMinima, g.cantidadMaxima).replace(/^E/, "e") : textoDeLimites(g.cantidadMinima, g.cantidadMaxima).toLowerCase()}
            </legend>
            {g.opciones.map((o) => {
              const cuantas = unidad.elegidas[o.opcionId] ?? 0;
              if (unaSola) {
                const elegida = cuantas > 0;
                return (
                  <Boton
                    key={o.opcionId}
                    variante="seleccion"
                    tamano="tactil"
                    className="w-full"
                    aria-pressed={elegida}
                    // Un grupo obligatorio no se puede dejar vacío tocando la elegida (se cambia eligiendo otra); uno opcional sí.
                    onClick={() => onOpcion(elegida ? "restar" : "elegir", g.grupoId, o.opcionId)}
                    disabled={elegida && g.cantidadMinima > 0}
                  >
                    <span className="w-full text-left">{o.nombre}</span>
                  </Boton>
                );
              }
              return (
                <div key={o.opcionId} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-borde bg-superficie px-3 py-1.5">
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    {o.nombre}
                    <span className="block text-sm font-normal text-tinta-suave">hasta {o.cantidadMaxima}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Boton variante="secundario" tamano="tactil" className="min-w-11" aria-label={`Restar uno de ${o.nombre} en ${titulo}`} disabled={cuantas === 0} onClick={() => onOpcion("restar", g.grupoId, o.opcionId)}>
                      −
                    </Boton>
                    <span className="w-6 text-center tabular-nums" data-cuantas={o.nombre}>
                      {cuantas}
                    </span>
                    <Boton variante="secundario" tamano="tactil" className="min-w-11" aria-label={`Sumar uno de ${o.nombre} en ${titulo}`} onClick={() => onOpcion("sumar", g.grupoId, o.opcionId)}>
                      +
                    </Boton>
                  </span>
                </div>
              );
            })}
          </fieldset>
        );
      })}
      <p aria-live="polite" data-falta-elegir={faltan.length > 0 ? "si" : "no"} className="text-sm text-tinta-suave">
        {faltan.length > 0 ? `Falta elegir: ${faltan.map((g) => g.nombre).join(", ")}` : "Listo."}
      </p>
    </div>
  );
}
