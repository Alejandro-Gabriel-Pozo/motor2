"use client";

import { useId } from "react";
import type { EntradaSelectorCarta, ProductoPedible, SelectorCartaPos } from "@/core/pos/selector-carta";
import { SECCION_FUERA_DE_CARTA, type AccionSelectorCarta, type EstadoSelectorCarta } from "@/core/pos/selector-carta-estado";
import { formatearMonto } from "./formato";

/**
 * «Agregar al pedido» por SECCIÓN DE CARTA (docs/plan-selector-carta-pos-2026-09-25.md, §2.2): una barra con las secciones de la
 * carta (y «Fuera de carta» al final, si tiene algo) y, debajo, la grilla de la sección a la vista. Un ítem agrupado («Gaseosa
 * 500cc») se despliega en el lugar (patrón disclosure) y muestra sus opciones, cada una con SU precio; elegir una opción elige ese
 * producto, nunca el grupo. El estado vive en `AgregarItems` (reductor puro de `selector-carta-estado.ts`); acá solo se dibuja.
 *
 * Todos los botones son `type="button"`: viven dentro del `<form>` de agregar, y un toque no tiene que enviarlo. Ninguno se llama
 * «Agregar». Colores del salón (siempre claro, sin `dark:`).
 */

const BOTON_SECCION =
  "rounded-full border border-[var(--border)] bg-white px-3.5 py-1.5 text-[13px] font-semibold enabled:hover:bg-[#F1EFEA] aria-pressed:border-[var(--brand)] aria-pressed:bg-[var(--brand)] aria-pressed:text-white aria-pressed:enabled:hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50";
const BOTON_PRODUCTO =
  "group flex min-h-[48px] w-full flex-col items-start justify-center gap-0.5 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-left text-[13.5px] font-semibold enabled:hover:bg-[#F1EFEA] aria-pressed:border-[var(--brand)] aria-pressed:bg-[var(--brand)] aria-pressed:text-white aria-pressed:enabled:hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50";
const BOTON_AGRUPADO =
  "flex min-h-[48px] w-full items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--ink-soft)] bg-white px-3 py-2 text-left text-[13.5px] font-semibold enabled:hover:bg-[#F1EFEA] aria-expanded:border-solid aria-expanded:bg-[#F1EFEA] disabled:cursor-not-allowed disabled:opacity-50";
const PRECIO = "text-[12.5px] font-normal tabular-nums text-[var(--ink-soft)] group-aria-pressed:text-white";

/** «$ 5.000», o «$ 5.000 a $ 5.500» si las opciones de un agrupado no cuestan lo mismo. */
function precioDeAgrupado(minimo: number, maximo: number): string {
  return minimo === maximo ? formatearMonto(minimo) : `${formatearMonto(minimo)} a ${formatearMonto(maximo)}`;
}

export function SelectorCarta({ selector, estado, despachar }: { selector: SelectorCartaPos; estado: EstadoSelectorCarta; despachar: (accion: AccionSelectorCarta) => void }) {
  const idBase = useId();
  const pestanas = [
    ...selector.seccionesCarta.map((s) => ({ id: s.seccionCartaId, nombre: s.nombre })),
    ...(selector.fueraDeCarta.length > 0 ? [{ id: SECCION_FUERA_DE_CARTA, nombre: "Fuera de carta" }] : []),
  ];
  // Tras un `router.refresh()` la sección elegida pudo desaparecer (se apagó, quedó vacía): se cae a la primera.
  const activa = pestanas.some((p) => p.id === estado.seccionActiva) ? estado.seccionActiva : (pestanas[0]?.id ?? null);
  if (activa === null) return null;
  const idPestana = (id: string) => `${idBase}-seccion-${id}`;
  const entradas: EntradaSelectorCarta[] =
    activa === SECCION_FUERA_DE_CARTA
      ? selector.fueraDeCarta.map((producto) => ({ tipo: "producto", producto }))
      : (selector.seccionesCarta.find((s) => s.seccionCartaId === activa)?.entradas ?? []);

  const botonProducto = (p: ProductoPedible) => (
    <button
      type="button"
      aria-pressed={estado.productoId === p.productoId}
      data-producto-carta={p.productoId}
      onClick={() => despachar({ tipo: "elegirProducto", productoId: p.productoId, origen: "carta" })}
      className={BOTON_PRODUCTO}
    >
      <span>{p.nombre}</span>
      <span className={PRECIO}>{formatearMonto(p.precio)}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Secciones de la carta" className="flex flex-wrap gap-2">
        {pestanas.map((p) => (
          <button key={p.id} id={idPestana(p.id)} type="button" aria-pressed={p.id === activa} onClick={() => despachar({ tipo: "elegirSeccion", seccionId: p.id })} className={BOTON_SECCION}>
            {p.nombre}
          </button>
        ))}
      </div>
      <div role="region" aria-labelledby={idPestana(activa)}>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {entradas.flatMap((e) => {
            if (e.tipo === "producto") return [<li key={e.producto.productoId}>{botonProducto(e.producto)}</li>];
            const abierto = estado.agrupadoAbierto === e.itemAgrupadoCartaId;
            const idOpciones = `${idBase}-opciones-${e.itemAgrupadoCartaId}`;
            const boton = (
              <li key={e.itemAgrupadoCartaId}>
                <button
                  type="button"
                  aria-expanded={abierto}
                  aria-controls={abierto ? idOpciones : undefined}
                  data-agrupado-carta={e.itemAgrupadoCartaId}
                  onClick={() => despachar({ tipo: "alternarAgrupado", itemAgrupadoCartaId: e.itemAgrupadoCartaId })}
                  className={BOTON_AGRUPADO}
                >
                  <span className="flex flex-col gap-0.5">
                    <span>{e.nombre}</span>
                    <span className={PRECIO}>
                      {e.opciones.length === 1 ? "1 opción" : `${e.opciones.length} opciones`} · {precioDeAgrupado(e.precioMinimo, e.precioMaximo)}
                    </span>
                  </span>
                  <span aria-hidden className="text-[var(--ink-soft)]">
                    {abierto ? "▴" : "▾"}
                  </span>
                </button>
              </li>
            );
            if (!abierto) return [boton];
            return [
              boton,
              <li key={`${e.itemAgrupadoCartaId}-opciones`} className="col-span-full">
                <ul id={idOpciones} aria-label={`Opciones de ${e.nombre}`} className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[#F1EFEA] p-2 sm:grid-cols-3 lg:grid-cols-4">
                  {e.opciones.map((o) => (
                    <li key={o.productoId}>{botonProducto(o)}</li>
                  ))}
                </ul>
              </li>,
            ];
          })}
        </ul>
      </div>
    </div>
  );
}
