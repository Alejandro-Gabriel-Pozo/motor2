"use client";

import { useMemo, useState } from "react";
import { useAvisoConDeshacer } from "@/components/aviso-con-deshacer";
import { CRITERIOS_DE_LIMPIEZA, candidatosALimpiar, nombreDelTipoDeGrupo, productosAfectados, type CriterioDeLimpieza, type GrupoParaLimpiar, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { ResultadoAccion } from "@/server/actions/tipos";

export interface GrupoDeLimpieza extends GrupoParaLimpiar {
  tipo: TipoDeGrupoDeOpciones;
}

const ETIQUETA: Record<CriterioDeLimpieza, string> = {
  SIN_PRODUCTOS: "Sin productos",
  SIN_VENTAS_30: "Sin ventas 30 días",
  SIN_VENTAS_90: "Sin ventas 90 días",
  SIN_VENTAS_180: "Sin ventas 180 días",
};

const MOTIVO: Record<CriterioDeLimpieza, string> = {
  SIN_PRODUCTOS: "ningún producto lo usa",
  SIN_VENTAS_30: "sin ventas en 30 días",
  SIN_VENTAS_90: "sin ventas en 90 días",
  SIN_VENTAS_180: "sin ventas en 180 días",
};

const productos = (n: number) => (n === 1 ? "1 producto" : `${n} productos`);
/** «ningún producto lo usa», «lo usa 1 producto», «lo usan 3 productos» (y lo mismo con «la admite»). */
const quienes = (n: number, objeto: "lo" | "la", verbo: "usa" | "admite") => (n === 0 ? `ningún producto ${objeto} ${verbo}` : `${objeto} ${verbo}${n === 1 ? "" : "n"} ${productos(n)}`);

/**
 * «Limpiar» las opciones de venta (OPCIONES-LIMPIEZA, G2; para achicar la carta desde el celular). Muestra, según el criterio elegido, los grupos y las opciones en uso que no se usan
 * (sin productos, o sin ventas en 30, 90 o 180 días: la regla pura es `candidatosALimpiar`), deja elegir varios y los ARCHIVA DE UNA VEZ (el servidor: todo o nada, una auditoría por
 * elemento) con la vista previa de cuántos productos dejan de ofrecer algo. El aviso de abajo trae «Deshacer», que restaura el lote entero. Nada se borra.
 */
export function LimpiarOpciones({
  grupos,
  nombresDeProductos,
  accion,
}: {
  grupos: GrupoDeLimpieza[];
  nombresDeProductos: Record<string, string>;
  accion: (grupoIds: string[], opcionIds: string[], archivar: boolean) => Promise<ResultadoAccion>;
}) {
  const { ejecutar, ocupado } = useAvisoConDeshacer();
  const [criterio, setCriterio] = useState<CriterioDeLimpieza>("SIN_PRODUCTOS");
  const [grupoIds, setGrupoIds] = useState<ReadonlySet<string>>(new Set());
  const [opcionIds, setOpcionIds] = useState<ReadonlySet<string>>(new Set());
  const candidatos = useMemo(() => candidatosALimpiar(grupos, criterio), [grupos, criterio]);

  // Solo cuenta lo elegido que sigue siendo candidato (al cambiar el criterio o después de archivar, lo que ya no está en la lista no viaja).
  const gruposElegidos = candidatos.grupos.filter((g) => grupoIds.has(g.id)).map((g) => g.id);
  const opcionesElegidas = candidatos.opciones.filter((c) => opcionIds.has(c.opcion.id)).map((c) => c.opcion.id);
  const total = gruposElegidos.length + opcionesElegidas.length;
  const totalCandidatos = candidatos.grupos.length + candidatos.opciones.length;
  const afectados = productosAfectados(grupos, { grupoIds: new Set(gruposElegidos), opcionIds: new Set(opcionesElegidas) });
  const nombres = afectados.map((id) => nombresDeProductos[id] ?? "un producto");

  const alternar = (conjunto: ReadonlySet<string>, id: string) => {
    const nuevo = new Set(conjunto);
    if (nuevo.has(id)) nuevo.delete(id);
    else nuevo.add(id);
    return nuevo;
  };
  const elegirTodo = (si: boolean) => {
    setGrupoIds(si ? new Set(candidatos.grupos.map((g) => g.id)) : new Set());
    setOpcionIds(si ? new Set(candidatos.opciones.map((c) => c.opcion.id)) : new Set());
  };
  const archivar = () => {
    if (total === 0) return;
    const g = [...gruposElegidos];
    const o = [...opcionesElegidas];
    ejecutar(
      () => accion(g, o, true),
      () => accion(g, o, false)
    );
    // La elección se vacía al mandar: lo archivado sale de la lista con el refresco y, si se deshace, vuelve sin elegir (la barra de abajo no tapa el aviso con «Deshacer»).
    setGrupoIds(new Set());
    setOpcionIds(new Set());
  };

  const casilla = "size-5 shrink-0 accent-[#1b2735] dark:accent-neutral-200";
  const tarjeta = "flex min-h-[56px] cursor-pointer items-center gap-3 border border-[#cdd5dd] bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="min-w-0">
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-400">Qué mostrar</legend>
        <div className="flex flex-wrap gap-2">
          {CRITERIOS_DE_LIMPIEZA.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={criterio === c}
              onClick={() => setCriterio(c)}
              className="min-h-[44px] border border-[#cdd5dd] bg-white px-3.5 py-2 text-sm font-medium aria-pressed:border-[#1b2735] aria-pressed:bg-[#1b2735] aria-pressed:font-semibold aria-pressed:text-white dark:border-neutral-600 dark:bg-neutral-900 dark:aria-pressed:border-neutral-200 dark:aria-pressed:bg-neutral-200 dark:aria-pressed:text-neutral-900"
            >
              {ETIQUETA[c]}
            </button>
          ))}
        </div>
      </fieldset>

      {totalCandidatos === 0 ? (
        <p role="status" className="border-l-4 border-[#1f6b49] bg-[#e4f2ea] px-3 py-2.5 text-sm text-neutral-900 dark:border-emerald-500 dark:bg-emerald-950 dark:text-neutral-100">
          No hay nada {MOTIVO[criterio]}: no hay nada que limpiar con este criterio.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {totalCandidatos === 1 ? "1 elemento" : `${totalCandidatos} elementos`} {MOTIVO[criterio]}.
            </p>
            <button type="button" onClick={() => elegirTodo(total < totalCandidatos)} className="min-h-[44px] px-1 text-sm font-medium underline">
              {total < totalCandidatos ? "Elegir todos" : "No elegir ninguno"}
            </button>
          </div>

          {candidatos.grupos.length > 0 && (
            <section aria-labelledby="titulo-grupos-candidatos" className="flex flex-col gap-2">
              <h2 id="titulo-grupos-candidatos" className="font-medium">
                Grupos enteros ({candidatos.grupos.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {candidatos.grupos.map((g) => (
                  <li key={g.id}>
                    <label className={tarjeta} data-candidato-grupo={g.nombre}>
                      <input type="checkbox" className={casilla} checked={grupoIds.has(g.id)} onChange={() => setGrupoIds((s) => alternar(s, g.id))} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium [overflow-wrap:anywhere]">{g.nombre}</span>
                        <span className="block text-xs text-neutral-600 dark:text-neutral-400">
                          {nombreDelTipoDeGrupo(g.tipo)} · {g.opciones.length === 1 ? "1 opción" : `${g.opciones.length} opciones`} · {quienes(g.productoIds.length, "lo", "usa")}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {candidatos.opciones.length > 0 && (
            <section aria-labelledby="titulo-opciones-candidatas" className="flex flex-col gap-2">
              <h2 id="titulo-opciones-candidatas" className="font-medium">
                Opciones sueltas ({candidatos.opciones.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {candidatos.opciones.map(({ grupo, opcion }) => (
                  <li key={opcion.id}>
                    <label className={tarjeta} data-candidata-opcion={opcion.nombre}>
                      <input type="checkbox" className={casilla} checked={opcionIds.has(opcion.id)} onChange={() => setOpcionIds((s) => alternar(s, opcion.id))} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium [overflow-wrap:anywhere]">{opcion.nombre}</span>
                        <span className="block text-xs text-neutral-600 dark:text-neutral-400">
                          De «{grupo.nombre}» · {quienes(opcion.productoIds.length, "la", "admite")}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {total > 0 && (
        <div data-barra-limpiar="" className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 border-t border-[#cdd5dd] bg-white px-1 pb-3 pt-2 dark:border-neutral-700 dark:bg-neutral-950">
          <p className="text-sm" data-vista-previa="">
            <b>{total === 1 ? "1 elegido" : `${total} elegidos`}</b> ·{" "}
            {afectados.length === 0
              ? "no afecta a ningún producto."
              : `afecta a ${productos(afectados.length)}: ${nombres.slice(0, 3).join(", ")}${nombres.length > 3 ? ` y ${nombres.length - 3} más` : ""} (deja de ofrecerse ahí).`}
          </p>
          <button
            type="button"
            onClick={archivar}
            aria-disabled={ocupado || undefined}
            className="min-h-[48px] w-full border border-[#1b2735] bg-[#1b2735] px-4 py-2 font-semibold text-white aria-disabled:cursor-progress aria-disabled:opacity-60 sm:w-auto sm:self-start dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900"
          >
            Archivar {total === 1 ? "1 elemento" : `${total} elementos`}
          </button>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">Se archivan todos juntos o ninguno. «Deshacer» los restaura; lo ya vendido queda como se vendió.</p>
        </div>
      )}
    </div>
  );
}
