"use client";

import { useId } from "react";
import type { EntradaCarpetaSelectorCarta, EntradaSelectorCarta, ProductoPedible, SelectorCartaPos } from "@/core/pos/selector-carta";
import { SECCION_FUERA_DE_CARTA, type AccionSelectorCarta, type EstadoSelectorCarta } from "@/core/pos/selector-carta-estado";
import { estaEnListaPorAgregar, listaPorAgregarLlena, type EstadoListaPorAgregar } from "@/core/pos/agregar-lista-estado";
import { MAXIMO_ITEMS_POR_AGREGADO } from "@/core/pos/cantidad-pedido";
import { formatearMonto } from "@/core/pos/formato";

/**
 * «Agregar al pedido» por SECCIÓN DE CARTA (docs/plan-selector-carta-pos-2026-09-25.md, §2.2), por CARPETA DE GÉNERO
 * (docs/plan-genero-carta-2026-09-26.md) y hacia la lista «Por agregar» (docs/plan-pos-agregar-varios-2026-09-26.md): una barra con
 * las secciones de la carta (y «Fuera de carta» al final, si tiene algo) y, debajo, la grilla de la sección a la vista. Dentro de
 * una sección, una carpeta de género ("Cerveza") va primero (G2) y se despliega en el lugar (patrón disclosure) mostrando tanto
 * productos sueltos como ítems agrupados que comparten ese género. Un ítem agrupado («Gaseosa 500cc») SUELTO (sin género) se
 * despliega igual, mostrando sus opciones, cada una con SU precio; uno DENTRO de una carpeta se muestra siempre desplegado, sin su
 * propio botón (no tiene sentido propio: abrir/cerrar una carpeta ya es un nivel de disclosure, y así no hay contradicción con
 * "abrir un agrupado cierra la carpeta" — ver `selector-carta-estado.ts`).
 *
 * Tocar un producto (suelto, opción de un agrupado, o dentro de una carpeta) lo SUMA a la lista «Por agregar» (`sumar`, que
 * despacha a los DOS reductores de `AgregarItems`) — nunca envía nada al servidor por sí solo. `aria-pressed` refleja si YA está
 * en esa lista (para que sumar el mismo producto de nuevo, o desde otra sección, se vea): varios pueden estar marcados a la vez, a
 * propósito (mezclar productos de secciones distintas es el punto). Con la lista llena (`MAXIMO_ITEMS_POR_AGREGADO`), un producto
 * que TODAVÍA no está en la lista queda deshabilitado (uno que ya está sigue pudiendo sumar de nuevo: se acumula en su línea, no
 * abre otra).
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
// El último `aria-expanded:enabled:hover:` (mismo patrón que BOTON_SECCION/BOTON_PRODUCTO) es necesario, no cosmético: sin él,
// justo después del click que abre la carpeta el mouse queda posicionado ahí, `:hover` queda activo de verdad, y
// `enabled:hover:bg-[#F1EFEA]` (más específico que `aria-expanded:bg-[...]`, que es un solo selector de atributo) le gana al
// fondo abierto — texto blanco sobre #F1EFEA no pasa el contraste WCAG AA (hallazgo real de axe en
// test/e2e/pos-carta-secciones.spec.ts, «accesibilidad: con la carpeta de género abierta»).
const BOTON_CARPETA =
  "col-span-full flex min-h-[48px] w-full items-center justify-between gap-2 rounded-lg border border-[var(--brand)] bg-white px-3 py-2 text-left text-[13.5px] font-semibold enabled:hover:bg-[#F1EFEA] aria-expanded:bg-[var(--brand)] aria-expanded:text-white aria-expanded:enabled:hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50";
const PRECIO = "text-[12.5px] font-normal tabular-nums text-[var(--ink-soft)] group-aria-pressed:text-white";

/** «$ 5.000», o «$ 5.000 a $ 5.500» si las opciones de un agrupado no cuestan lo mismo. */
function precioDeAgrupado(minimo: number, maximo: number): string {
  return minimo === maximo ? formatearMonto(minimo) : `${formatearMonto(minimo)} a ${formatearMonto(maximo)}`;
}

interface Props {
  selector: SelectorCartaPos;
  estado: EstadoSelectorCarta;
  lista: EstadoListaPorAgregar;
  despachar: (accion: AccionSelectorCarta) => void;
  /** Suma un producto a la lista «Por agregar» (y avisa acá para vaciar el buscador y cerrar el agrupado suelto, G3). */
  sumar: (productoId: string) => void;
}

export function SelectorCarta({ selector, estado, lista, despachar, sumar }: Props) {
  const idBase = useId();
  const llena = listaPorAgregarLlena(lista, MAXIMO_ITEMS_POR_AGREGADO);
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

  const botonProducto = (p: ProductoPedible) => {
    const enLista = estaEnListaPorAgregar(lista, p.productoId);
    return (
      <button
        type="button"
        aria-pressed={enLista}
        disabled={llena && !enLista}
        title={llena && !enLista ? `Llegaste al máximo de ${MAXIMO_ITEMS_POR_AGREGADO} productos distintos: sacá alguno de la lista antes de sumar otro.` : undefined}
        data-producto-carta={p.productoId}
        onClick={() => sumar(p.productoId)}
        className={BOTON_PRODUCTO}
      >
        <span>{p.nombre}</span>
        <span className={PRECIO}>{formatearMonto(p.precio)}</span>
      </button>
    );
  };

  /** Un ítem agrupado SUELTO (fuera de una carpeta): disclosure propio, igual que siempre. */
  const entradaAgrupadoSuelto = (e: Extract<EntradaSelectorCarta, { tipo: "agrupado" }>) => {
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
  };

  /** Lo de DENTRO de una carpeta ya abierta: un producto suelto, o un agrupado siempre desplegado (sin su propio botón). */
  const entradaDeCarpeta = (e: EntradaCarpetaSelectorCarta) => {
    if (e.tipo === "producto") return [<li key={e.producto.productoId}>{botonProducto(e.producto)}</li>];
    return [
      <li key={e.itemAgrupadoCartaId} className="col-span-full flex flex-col gap-2">
        <p className="text-[13px] font-semibold">
          {e.nombre} <span className={PRECIO}>· {e.opciones.length === 1 ? "1 opción" : `${e.opciones.length} opciones`} · {precioDeAgrupado(e.precioMinimo, e.precioMaximo)}</span>
        </p>
        <ul aria-label={`Opciones de ${e.nombre}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {e.opciones.map((o) => (
            <li key={o.productoId}>{botonProducto(o)}</li>
          ))}
        </ul>
      </li>,
    ];
  };

  return (
    <div data-selector-carta className="flex flex-col gap-3">
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
            if (e.tipo === "agrupado") return entradaAgrupadoSuelto(e);

            // Carpeta de género (docs/plan-genero-carta-2026-09-26.md): mismo patrón disclosure que un agrupado.
            const abierta = estado.carpetaAbierta === e.generoCartaId;
            const idContenido = `${idBase}-carpeta-${e.generoCartaId}`;
            const boton = (
              <li key={e.generoCartaId} className="col-span-full">
                <button
                  type="button"
                  aria-expanded={abierta}
                  aria-controls={abierta ? idContenido : undefined}
                  data-carpeta-genero={e.generoCartaId}
                  onClick={() => despachar({ tipo: "alternarCarpeta", generoCartaId: e.generoCartaId })}
                  className={BOTON_CARPETA}
                >
                  <span>{e.nombre}</span>
                  <span aria-hidden>{abierta ? "▴" : "▾"}</span>
                </button>
              </li>
            );
            if (!abierta) return [boton];
            return [
              boton,
              <li key={`${e.generoCartaId}-contenido`} className="col-span-full">
                <ul
                  id={idContenido}
                  aria-label={`Productos de ${e.nombre}`}
                  className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[#F1EFEA] p-2 sm:grid-cols-3 lg:grid-cols-4"
                >
                  {e.entradas.flatMap(entradaDeCarpeta)}
                </ul>
              </li>,
            ];
          })}
        </ul>
      </div>
    </div>
  );
}
