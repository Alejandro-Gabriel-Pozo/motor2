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
  gruposEnOrdenParaElegir,
  gruposQueFaltan,
  opcionDisponible,
  reducirElegirOpciones,
  resumenDePrecios,
  vistaPreviaDeConfiguracion,
  type ConfiguracionDelSelector,
} from "@/core/pos/public";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Boton } from "@/ui/primitivas/boton";

/** Una elección precargada: lo más pedido de la sucursal u «Otro igual» de una línea. */
export interface EleccionPrecargada {
  etiqueta: string;
  elegidas: { opcionId: string; cantidad: number }[];
}

/** «Agregar» del pie: 48 px de alto (más que los 44 mínimos) y el color de marca. Va a mano a propósito: `Boton` no tiene un tamaño de 48 y migrarlo lo achicaría. */
const BOTON_AGREGAR =
  "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg bg-marca px-4 py-2 text-sm font-semibold text-superficie transition-colors enabled:hover:bg-marca-hover disabled:cursor-not-allowed disabled:opacity-50";

const OPCION_RADIO =
  "flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-borde bg-superficie px-3 py-2 text-sm font-semibold has-[:checked]:border-marca has-[:checked]:bg-superficie-suave has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-marca has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

/**
 * «Elegir opciones» de un producto en el POS (GO-2d; ADR-030): el diálogo que se abre al tocar un producto que admite opciones (uno sin opciones se sigue agregando con un toque). Es
 * el `Dialogo` del sistema de diseño (hoja inferior en el celular, centrado desde `sm:`, Escape cierra, el foco queda adentro), siempre claro como el resto del salón.
 *
 * - Cada grupo es un `fieldset` con su `legend` («Tamaño · Elegí 1»), primero el que define el precio (el mismo orden que la carta, `ordenarPorRol`) y, dentro de cada papel, los obligatorios primero.
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
  const { precioBase, descuentoDeProducto, esBase, sinStock } = configuracion;
  // Solo los grupos que hoy cuentan.
  const vigentes = useMemo(
    () => configuracion.grupos.filter((g) => g.admitido && g.activo).map((g) => ({ ...g, opciones: g.opciones.filter((o) => o.activa && o.admitida) })),
    [configuracion]
  );
  const precios = useMemo(() => resumenDePrecios({ grupos: vigentes, precioBase, descuentoDeProducto, esBase }), [vigentes, precioBase, descuentoDeProducto, esBase]);
  // Fase 5 («carta pareja»): el mismo orden que la carta, primero el grupo que define el precio (`gruposEnOrdenParaElegir`).
  const grupos = useMemo(() => gruposEnOrdenParaElegir(vigentes, precios), [vigentes, precios]);
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
    <Dialogo abierto titulo={nombre} onCerrar={onCerrar}>
      <div className="flex flex-col gap-4" data-elegir-opciones={nombre}>
        {precargas.length > 0 && (
          <div role="group" aria-label="Lo más pedido acá" className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-tinta-suave">Lo más pedido acá</p>
            <div className="flex flex-wrap gap-2">
              {precargas.map((p) => (
                <Boton key={p.etiqueta} variante="secundario" tamano="compacto" className="min-w-11" onClick={() => despachar({ tipo: "precargar", grupos, elegidas: p.elegidas })}>
                  {p.etiqueta}
                </Boton>
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
              className="flex min-w-0 flex-col gap-2"
              data-grupo-opciones={g.nombre}
            >
              <legend className="mb-1 text-sm font-bold">
                {g.nombre} · {g.cantidadMinima > 0 ? textoDeLimites(g.cantidadMinima, g.cantidadMaxima).replace(/^E/, "e") : textoDeLimites(g.cantidadMinima, g.cantidadMaxima).toLowerCase()}
              </legend>
              {g.opciones.map((o) => {
                const disponible = opcionDisponible(o);
                const noDisponible = "Agotada hoy";
                const precio = textoDePrecio(g.tipo, g.grupoId, o.opcionId);
                const enCero = sinStock[o.opcionId];
                const marca = enCero?.length ? <span className="block text-xs font-normal text-tinta-suave">Sistema: stock 0 de {enCero.join(", ")}</span> : null;
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
                      <span className="text-sm font-normal tabular-nums">{disponible ? precio : noDisponible}</span>
                    </label>
                  );
                }
                const cuantas = estado.elegidas[o.opcionId] ?? 0;
                return (
                  <div key={o.opcionId} className="flex min-h-[48px] items-center justify-between gap-2 rounded-lg border border-borde bg-superficie px-3 py-2">
                    <span className="text-sm font-semibold">
                      {o.nombre}
                      <span className="block text-sm font-normal text-tinta-suave">
                        {disponible ? `${precio ? `${precio} · ` : ""}hasta ${o.cantidadMaxima}` : noDisponible}
                      </span>
                      {marca}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Boton variante="secundario" tamano="tactil" className="min-w-11" aria-label={`Restar uno de ${o.nombre}`} disabled={cuantas === 0} onClick={() => despachar({ tipo: "restar", opcionId: o.opcionId })}>
                        −
                      </Boton>
                      <span className="w-6 text-center tabular-nums" data-cuantas={o.nombre}>
                        {cuantas}
                      </span>
                      <Boton
                        variante="secundario" tamano="tactil" className="min-w-11"
                        aria-label={`Sumar uno de ${o.nombre}`}
                        disabled={!disponible}
                        onClick={() => {
                          const despues = reducirElegirOpciones(estado, { tipo: "sumar", grupo: g, opcionId: o.opcionId });
                          despachar({ tipo: "sumar", grupo: g, opcionId: o.opcionId });
                          avanzarDesde(indice, despues);
                        }}
                      >
                        +
                      </Boton>
                    </span>
                  </div>
                );
              })}
            </fieldset>
          );
        })}

        {puedeAgotar && (
          <Link href="/movimientos/opciones-agotadas" className="self-start text-sm underline">
            ¿Se acabó algo? Marcarlo agotado
          </Link>
        )}

        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t border-borde bg-superficie p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Cantidad</span>
            <span className="flex items-center gap-1.5">
              <Boton variante="secundario" tamano="tactil" className="min-w-11" aria-label="Restar una unidad" disabled={estado.cantidad <= 1} onClick={() => despachar({ tipo: "cantidad", delta: -1 })}>
                −
              </Boton>
              <span className="w-8 text-center tabular-nums" data-cantidad-producto>
                {estado.cantidad}
              </span>
              <Boton variante="secundario" tamano="tactil" className="min-w-11" aria-label="Sumar una unidad" onClick={() => despachar({ tipo: "cantidad", delta: 1 })}>
                +
              </Boton>
            </span>
          </div>
          <p aria-live="polite" className="text-sm text-tinta-suave" data-total-opciones>
            {faltan.length > 0 ? `Falta elegir: ${faltan.map((g) => g.nombre).join(", ")}` : vista.ok ? desglose : vista.mensaje}
          </p>
          <button
            type="button"
            className={BOTON_AGREGAR}
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
