"use client";

import Link from "next/link";
import { useMemo, useReducer, useRef } from "react";
import { textoDeLimites } from "@/core/opciones/public";
import {
  elegidasParaPedir,
  esDeUnaSolaEleccion,
  estadoInicialElegirOpciones,
  formatearMonto,
  grupoCompleto,
  gruposQueFaltan,
  opcionDisponible,
  reducirElegirOpciones,
  resumenDePrecios,
  vistaPreviaDeConfiguracion,
  type ConfiguracionDelSelector,
} from "@/core/pos/public";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { BOTON_CHICO, BOTON_PRIMARIO } from "./estilos";

/** Una elección precargada: lo más pedido de la sucursal u «Otro igual» de una línea. */
export interface EleccionPrecargada {
  etiqueta: string;
  elegidas: { opcionId: string; cantidad: number }[];
}

const OPCION_RADIO =
  "flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[14px] font-semibold has-[:checked]:border-[var(--brand)] has-[:checked]:bg-[#F1EFEA] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--brand)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

/**
 * «Elegir opciones» de un producto en el POS (GO-2d; ADR-030): el diálogo que se abre al tocar un producto que admite opciones (uno sin opciones se sigue agregando con un toque). Es
 * el `Dialogo` del sistema de diseño (hoja inferior en el celular, centrado desde `sm:`, Escape cierra, el foco queda adentro), siempre claro como el resto del salón.
 *
 * - Cada grupo es un `fieldset` con su `legend` («Tamaño · Elegí 1»), en el orden del producto con los obligatorios primero.
 * - Un grupo de una sola elección (un tamaño, una variante, la guarnición) son radios nativos con forma de botón grande: las flechas los recorren. Uno de varias (adicionales) usa
 *   −/+ con «+ $ 600 c/u» y el tope. Una opción agotada en la sucursal se ve deshabilitada con «Agotada hoy». Si el sistema registra stock 0 de un insumo de una opción, se marca
 *   discretamente: se puede vender igual (el stock teórico avisa, nunca bloquea).
 * - Al completar un grupo, la vista baja al siguiente sin mover el foco (y sin animar, si la persona pidió reducir movimiento).
 * - Pie fijo: la cantidad, el total con su desglose (en `aria-live`), «Falta elegir: Tamaño» y «Agregar · $ 3.300», deshabilitado hasta que se cumplan los mínimos.
 * Los precios que se ven salen de la configuración que armó el servidor y de la MISMA regla que la venta (`vistaPreviaDeConfiguracion`); al pedir, el servidor vuelve a armar la
 * línea con lo vigente (si algo cambió, responde que se vuelva a elegir y no cobra otra cosa).
 */
export function ElegirOpciones({
  nombre,
  configuracion,
  precargas,
  inicial,
  puedeAgotar,
  onCerrar,
  onConfirmar,
}: {
  nombre: string;
  configuracion: ConfiguracionDelSelector;
  /** Lo más pedido de la sucursal (modelo 3): botones que precargan la elección; igual se confirma viendo el precio. */
  precargas: EleccionPrecargada[];
  /** «Otro igual»: arranca con esta elección. */
  inicial?: { opcionId: string; cantidad: number }[];
  /** Quien tiene `opcion_apagar_en_sucursal` ve el enlace a «Opciones agotadas». */
  puedeAgotar: boolean;
  onCerrar: () => void;
  onConfirmar: (elegidas: { opcionId: string; cantidad: number; versionDeOpcionId: string }[], cantidad: number) => void;
}) {
  const { precioBase, descuentoDeProducto, sinStock } = configuracion;
  // Solo los grupos que hoy cuentan, con los obligatorios primero (orden estable del producto).
  const grupos = useMemo(() => {
    const vigentes = configuracion.grupos.filter((g) => g.admitido && g.activo).map((g) => ({ ...g, opciones: g.opciones.filter((o) => o.activa && o.admitida) }));
    return [...vigentes.filter((g) => g.cantidadMinima > 0), ...vigentes.filter((g) => g.cantidadMinima === 0)];
  }, [configuracion]);
  const precios = useMemo(() => resumenDePrecios({ grupos, precioBase, descuentoDeProducto }), [grupos, precioBase, descuentoDeProducto]);
  const [estado, despachar] = useReducer(reducirElegirOpciones, undefined, () => {
    const vacio = estadoInicialElegirOpciones();
    return inicial ? reducirElegirOpciones(vacio, { tipo: "precargar", grupos, elegidas: inicial }) : vacio;
  });
  const refs = useRef(new Map<string, HTMLFieldSetElement>());

  const elegidas = elegidasParaPedir(estado, grupos);
  const faltan = gruposQueFaltan(estado, grupos);
  const vista = vistaPreviaDeConfiguracion({ grupos, elegidas, precioBase, descuentoDeProducto, cantidad: estado.cantidad });
  const puedeConfirmar = faltan.length === 0 && vista.ok;

  const precioDe = (grupoId: string, opcionId: string) => precios.grupos.find((g) => g.grupoId === grupoId)?.opciones.find((o) => o.opcionId === opcionId);
  const textoDePrecio = (tipo: string, grupoId: string, opcionId: string) => {
    const p = precioDe(grupoId, opcionId);
    if (!p) return "";
    if (p.precioFinal !== null) return formatearMonto(p.precioFinal);
    if (p.diferencia === 0) return tipo === "ADICIONAL" ? "" : "sin recargo";
    return `${p.diferencia > 0 ? "+" : "−"} ${formatearMonto(Math.abs(p.diferencia))}${tipo === "ADICIONAL" ? " c/u" : ""}`;
  };

  /** Lleva la vista al grupo siguiente cuando este se completa; nunca mueve el foco y respeta «reducir movimiento». */
  const avanzarDesde = (indice: number, despues: typeof estado) => {
    const grupo = grupos[indice];
    const siguiente = grupos[indice + 1];
    if (!grupo || !siguiente || !grupoCompleto(despues, grupo)) return;
    const reducir = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    refs.current.get(siguiente.grupoId)?.scrollIntoView({ block: "nearest", behavior: reducir ? "auto" : "smooth" });
  };

  const total = vista.ok ? vista.total : null;
  const desglose = vista.ok
    ? [
        `${estado.cantidad} × ${formatearMonto(vista.precioUnitario)}${vista.precioLista !== null ? ` (lista ${formatearMonto(vista.precioLista)})` : ""}`,
        ...vista.adicionales.map((a) => `${a.nombre} ${a.cantidad} × ${formatearMonto(a.precioUnitario)}`),
      ].join(" + ")
    : null;

  return (
    <Dialogo abierto titulo={nombre} onCerrar={onCerrar} siempreClaro>
      <div className="flex flex-col gap-4" data-elegir-opciones={nombre}>
        {precargas.length > 0 && (
          <div role="group" aria-label="Lo más pedido acá" className="flex flex-col gap-1.5">
            <p className="text-[12.5px] font-semibold text-[var(--ink-soft)]">Lo más pedido acá</p>
            <div className="flex flex-wrap gap-2">
              {precargas.map((p) => (
                <button key={p.etiqueta} type="button" className={BOTON_CHICO} onClick={() => despachar({ tipo: "precargar", grupos, elegidas: p.elegidas })}>
                  {p.etiqueta}
                </button>
              ))}
            </div>
          </div>
        )}

        {grupos.map((g, indice) => {
          const unaSola = esDeUnaSolaEleccion(g);
          return (
            <fieldset
              key={g.grupoId}
              ref={(el) => {
                if (el) refs.current.set(g.grupoId, el);
                else refs.current.delete(g.grupoId);
              }}
              className="flex flex-col gap-2"
              data-grupo-opciones={g.nombre}
            >
              <legend className="mb-1 text-[14px] font-bold">
                {g.nombre} · {g.cantidadMinima > 0 ? textoDeLimites(g.cantidadMinima, g.cantidadMaxima).replace(/^E/, "e") : textoDeLimites(g.cantidadMinima, g.cantidadMaxima).toLowerCase()}
              </legend>
              {g.opciones.map((o) => {
                const disponible = opcionDisponible(o);
                const precio = textoDePrecio(g.tipo, g.grupoId, o.opcionId);
                const enCero = sinStock[o.opcionId];
                const marca = enCero?.length ? <span className="block text-[11.5px] font-normal text-[var(--ink-soft)]">Sistema: stock 0 de {enCero.join(", ")}</span> : null;
                if (unaSola) {
                  return (
                    <label key={o.opcionId} className={OPCION_RADIO}>
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`grupo-${g.grupoId}`}
                          checked={(estado.elegidas[o.opcionId] ?? 0) > 0}
                          disabled={!disponible}
                          onChange={() => {
                            const despues = reducirElegirOpciones(estado, { tipo: "elegir", grupo: g, opcionId: o.opcionId });
                            despachar({ tipo: "elegir", grupo: g, opcionId: o.opcionId });
                            avanzarDesde(indice, despues);
                          }}
                          className="h-4 w-4"
                        />
                        <span>
                          {o.nombre}
                          {marca}
                        </span>
                      </span>
                      <span className="text-[13px] font-normal tabular-nums">{disponible ? precio : "Agotada hoy"}</span>
                    </label>
                  );
                }
                const cuantas = estado.elegidas[o.opcionId] ?? 0;
                return (
                  <div key={o.opcionId} className="flex min-h-[48px] items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2">
                    <span className="text-[14px] font-semibold">
                      {o.nombre}
                      <span className="block text-[12.5px] font-normal text-[var(--ink-soft)]">
                        {disponible ? `${precio ? `${precio} · ` : ""}hasta ${o.cantidadMaxima}` : "Agotada hoy"}
                      </span>
                      {marca}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <button type="button" className={`${BOTON_CHICO} min-h-[44px] min-w-[44px]`} aria-label={`Restar uno de ${o.nombre}`} disabled={cuantas === 0} onClick={() => despachar({ tipo: "restar", opcionId: o.opcionId })}>
                        −
                      </button>
                      <span className="w-6 text-center tabular-nums" data-cuantas={o.nombre}>
                        {cuantas}
                      </span>
                      <button
                        type="button"
                        className={`${BOTON_CHICO} min-h-[44px] min-w-[44px]`}
                        aria-label={`Sumar uno de ${o.nombre}`}
                        disabled={!disponible}
                        onClick={() => {
                          const despues = reducirElegirOpciones(estado, { tipo: "sumar", grupo: g, opcionId: o.opcionId });
                          despachar({ tipo: "sumar", grupo: g, opcionId: o.opcionId });
                          avanzarDesde(indice, despues);
                        }}
                      >
                        +
                      </button>
                    </span>
                  </div>
                );
              })}
            </fieldset>
          );
        })}

        {puedeAgotar && (
          <Link href="/movimientos/opciones-agotadas" className="self-start text-[12.5px] underline">
            ¿Se acabó algo? Marcarlo agotado
          </Link>
        )}

        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t border-[var(--border)] bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">Cantidad</span>
            <span className="flex items-center gap-1.5">
              <button type="button" className={`${BOTON_CHICO} min-h-[44px] min-w-[44px]`} aria-label="Restar una unidad" disabled={estado.cantidad <= 1} onClick={() => despachar({ tipo: "cantidad", delta: -1 })}>
                −
              </button>
              <span className="w-8 text-center tabular-nums" data-cantidad-producto>
                {estado.cantidad}
              </span>
              <button type="button" className={`${BOTON_CHICO} min-h-[44px] min-w-[44px]`} aria-label="Sumar una unidad" onClick={() => despachar({ tipo: "cantidad", delta: 1 })}>
                +
              </button>
            </span>
          </div>
          <p aria-live="polite" className="text-[13px] text-[var(--ink-soft)]" data-total-opciones>
            {faltan.length > 0 ? `Falta elegir: ${faltan.map((g) => g.nombre).join(", ")}` : vista.ok ? desglose : vista.mensaje}
          </p>
          <button
            type="button"
            className={`${BOTON_PRIMARIO} min-h-[48px]`}
            disabled={!puedeConfirmar}
            onClick={() => {
              if (!puedeConfirmar) return;
              onConfirmar(elegidas, estado.cantidad);
            }}
          >
            {total !== null && faltan.length === 0 ? `Agregar · ${formatearMonto(total)}` : "Agregar"}
          </button>
        </div>
      </div>
    </Dialogo>
  );
}
