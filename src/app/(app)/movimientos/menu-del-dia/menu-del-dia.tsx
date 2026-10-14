"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { MenuDelDiaDeLaSucursal } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";

const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
/** «hoy», «mañana» o «jueves 16/10». */
function nombreDelDia(dia: string, hoy: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const fecha = new Date(Date.UTC(a!, m! - 1, d!));
  const etiqueta = `${DIAS[(fecha.getUTCDay() + 6) % 7]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  return dia === hoy ? `hoy (${etiqueta})` : etiqueta;
}

/**
 * «Menú del día» (GO-3b, U2): el día elegido (de hoy a hoy + 13), y por cada lugar del día de las promos, sus platos con «Quitar» y un selector para agregar uno de los productos disponibles en la
 * sucursal (los que no pueden ser plato se ven con su motivo y no se pueden elegir). «Copiar el día anterior» carga, todo o nada, lo del día anterior. Cada cambio lo decide y lo escribe el servidor
 * (con el eco de la sucursal que vio la pantalla) y la pantalla se refresca; un doble toque no manda dos veces.
 */
export function MenuDelDia({
  datos,
  puedeCambiar,
  agregar,
  quitar,
  copiar,
}: {
  datos: MenuDelDiaDeLaSucursal;
  puedeCambiar: boolean;
  agregar: (cupoId: string, productoId: string, dia: string) => Promise<ResultadoAccion>;
  quitar: (platoId: string) => Promise<ResultadoAccion>;
  copiar: (dia: string) => Promise<ResultadoAccion>;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);
  const sinPermiso = puedeCambiar ? undefined : "Tu rol puede ver el menú del día pero no cambiarlo.";

  const ejecutar = (accion: () => Promise<ResultadoAccion>) => {
    if (enviando.current) return;
    enviando.current = true;
    startTransition(async () => {
      try {
        const r = await accion();
        setResultado(r);
        if (r.ok) router.refresh();
      } finally {
        enviando.current = false;
      }
    });
  };

  const disponibles = datos.candidatos.filter((c) => c.aviso === null);
  const conAviso = datos.candidatos.filter((c) => c.aviso !== null);

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Día del menú" className="flex flex-wrap gap-2">
        {datos.dias.map((d) => (
          <Link
            key={d}
            href={`/movimientos/menu-del-dia?fecha=${d}`}
            aria-current={d === datos.fecha ? "date" : undefined}
            className="min-h-[44px] rounded-full border px-3 py-2 text-sm aria-[current=date]:border-[var(--brand,#1f2937)] aria-[current=date]:font-semibold"
          >
            {nombreDelDia(d, datos.hoy)}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-medium">Platos de {nombreDelDia(datos.fecha, datos.hoy)}</h2>
        <button
          type="button"
          disabled={!puedeCambiar || pendiente || !datos.hayDiaAnterior}
          title={sinPermiso ?? (datos.hayDiaAnterior ? undefined : "El día anterior no tiene platos cargados.")}
          onClick={() => ejecutar(() => copiar(datos.fecha))}
          className="min-h-[44px] rounded border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          Copiar el día anterior
        </button>
      </div>

      {resultado && (
        <p role={resultado.ok ? "status" : "alert"} className={`text-sm ${resultado.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {resultado.mensaje}
        </p>
      )}

      {datos.lugares.map((l) => {
        const idSelect = `plato-${l.cupoId}`;
        return (
          <section key={l.cupoId} aria-labelledby={`lugar-${l.cupoId}`} className="flex flex-col gap-3 rounded border p-3" data-lugar-del-dia={l.nombre}>
            <h3 id={`lugar-${l.cupoId}`} className="font-medium">
              {l.nombre} <span className="text-sm font-normal text-neutral-600 dark:text-neutral-400">· {l.promoTitulo}</span>
            </h3>
            {!l.ofrecidaAca && <p className="text-xs text-amber-700 dark:text-amber-600">Esta promo no está prendida en esta sucursal: el plato queda cargado, pero el salón no la ofrece hasta que la prendan.</p>}
            {l.platos.length === 0 ? (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">Sin plato cargado: ese día no se puede vender este menú.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {l.platos.map((p) => (
                  <li key={p.platoId} className="flex items-center justify-between gap-2 py-2" data-plato-del-dia={p.nombre}>
                    <span className="text-sm">{p.nombre}</span>
                    <button
                      type="button"
                      disabled={!puedeCambiar || pendiente}
                      title={sinPermiso}
                      onClick={() => ejecutar(() => quitar(p.platoId))}
                      aria-label={`Quitar ${p.nombre} de ${l.nombre}`}
                      className="min-h-[44px] rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={idSelect} className="text-sm font-medium">
                  Agregar un plato
                </label>
                <select
                  id={idSelect}
                  value={elegidos[l.cupoId] ?? ""}
                  onChange={(e) => setElegidos((antes) => ({ ...antes, [l.cupoId]: e.target.value }))}
                  disabled={!puedeCambiar}
                  className="min-h-[44px] max-w-xs rounded border px-3 py-2"
                >
                  <option value="">Elegí un producto…</option>
                  {disponibles.map((c) => (
                    <option key={c.productoId} value={c.productoId}>
                      {c.nombre}
                    </option>
                  ))}
                  {conAviso.length > 0 && (
                    <optgroup label="No pueden ser plato del día">
                      {conAviso.map((c) => (
                        <option key={c.productoId} value={c.productoId} disabled>
                          {c.nombre} — {c.aviso}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <button
                type="button"
                disabled={!puedeCambiar || pendiente || !elegidos[l.cupoId]}
                title={sinPermiso}
                onClick={() => ejecutar(() => agregar(l.cupoId, elegidos[l.cupoId]!, datos.fecha))}
                className="min-h-[44px] rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
              >
                Agregar
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
