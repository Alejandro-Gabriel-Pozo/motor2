"use client";

import { useState } from "react";
import { type TicketDeCuenta, formatearNumeroTicket, formatearMonto } from "@/core/pos/public";
import { corregirLineaDeTicket, quitarUnidadesDeLinea } from "@/server/actions/pos/cuenta-cierre";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Boton } from "@/ui/primitivas/boton";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

/**
 * «Corregir una línea» en una fila de «Cuentas cerradas» (E0 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md): UN diálogo con la
 * línea a corregir, el motivo (obligatorio) y un botón. Al confirmar, en una sola operación del servidor, se anula la línea ENTERA, se guarda el motivo en la
 * venta y se emite el ticket corregido (mismo número, ejemplar siguiente), que se manda a imprimir. Reemplaza el recorrido de tres pantallas (anular en
 * Trazabilidad y después «Emitir ticket corregido»). Una promo se corrige entera y un adicional va con su producto.
 *
 * La clave de reintento (I3) nace al ABRIR el diálogo y se reenvía tal cual en cada intento: un doble clic o un corte de red no corrigen dos veces. Se manda
 * también el ejemplar y el total que la persona está viendo: si otra persona corrigió en el medio, el servidor lo rechaza y la fila se refresca.
 *
 * E1 (quitar unidades): si la línea elegida vende 2 o más unidades, el diálogo ofrece «Quitar solo algunas unidades» («cobré 2 cervezas y la mesa tomó 1»): con un
 * − / + se elige cuántas, y una vista previa muestra lo que queda de la línea y el total nuevo del ticket. La unidad quitada vuelve al stock. Una promo se corrige
 * entera; una línea con adicionales también, y lo dice como «pendiente de completar».
 *
 * Habilitado solo con ticket numerado, no anulado entero, con las dos permisos (`anular_venta` y `pos_emitir_ticket_corregido`) y con más de una línea vigente
 * (la última no se anula entera: queda «Anular venta» en Trazabilidad; sí se le pueden quitar unidades si vende 2 o más); si no, deshabilitado con un `title` que dice por qué.
 */
export function CorregirLinea({ ticket, hora, puede }: { ticket: TicketDeCuenta; hora: string; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const { pedir } = useImpresion();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [operacionId, setOperacionId] = useState<string | null>(null);
  const [modo, setModo] = useState<"entera" | "unidades">("entera");
  const [quitar, setQuitar] = useState(1);
  const [clave, setClave] = useState("");

  const numero = ticket.numero ? formatearNumeroTicket(ticket.numero) : null;
  const bloqueo =
    ticket.estado === "anulada"
      ? "La venta se anuló entera: no hay ticket que corregir."
      : ticket.numero === null
        ? "Esta cuenta se cerró antes de la numeración de tickets: no tiene ticket que corregir."
        : !puede
          ? "Corregir una línea requiere los permisos de anular ventas y de emitir el ticket corregido, que tu rol no tiene."
          : ticket.corregibles.length < 2 && !ticket.corregibles.some((l) => l.unidades !== undefined)
            ? "Es la única línea que sigue vendida: para anular toda la venta usá «Anular venta» en Trazabilidad."
            : null;

  const linea = ticket.corregibles.find((l) => l.operacionId === operacionId) ?? null;
  const unidades = linea?.unidades;
  // La línea entera solo se anula si queda otra vigente (si no, se usa «Anular venta» en Trazabilidad); por unidades se puede aunque sea la única.
  const puedeEntera = ticket.corregibles.length >= 2;
  const porUnidades = linea !== null && unidades !== undefined && modo === "unidades";
  const nombreDeLinea = linea ? linea.texto.replace(/^\d+ × /, "") : "";
  const importeQuitado = linea && unidades !== undefined ? Math.round(((linea.subtotal / unidades) * quitar) * 100) / 100 : 0;

  const elegirLinea = (id: string) => {
    const elegida = ticket.corregibles.find((l) => l.operacionId === id);
    setOperacionId(id);
    setQuitar(1);
    // Con unidades de sobra, lo habitual es «la mesa tomó una menos»; si la línea es la única, solo se puede por unidades.
    setModo(elegida?.unidades !== undefined ? "unidades" : "entera");
  };

  const abrir = () => {
    setMotivo("");
    setOperacionId(null);
    setModo("entera");
    setQuitar(1);
    setClave(crypto.randomUUID());
    setError(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };

  return (
    <>
      <Boton variante="secundario" tamano="compacto" disabled={bloqueo !== null} title={bloqueo ?? undefined} aria-label={`Corregir una línea de la cuenta cerrada a las ${hora}`} onClick={abrir}>
        Corregir una línea
      </Boton>

      <Dialogo abierto={abierto} titulo={`Corregir una línea · N.º ${numero}`} onCerrar={cerrar} cerrable={!pending}>
        <p className="mb-4 text-sm text-tinta-suave">
          Elegí la línea. Sale un ticket corregido con el mismo número y la letra siguiente; lo que ya se imprimió no se toca. Una unidad que se quita vuelve al stock.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!operacionId || !ticket.numero) return;
            ejecutar(
              () =>
                porUnidades && unidades !== undefined
                  ? quitarUnidadesDeLinea(ticket.cuentaId, operacionId, quitar, unidades, motivo, ticket.numero!.ejemplar, ticket.total, clave)
                  : corregirLineaDeTicket(ticket.cuentaId, operacionId, motivo, ticket.numero!.ejemplar, ticket.total, clave),
              (r) => {
                setAbierto(false);
                pedir({ tipo: "ticket-correccion", cuentaId: ticket.cuentaId, ejemplar: r.ejemplar });
              }
            );
          }}
          className="flex flex-col gap-3"
        >
          <OpcionesExcluyentes
            leyenda="Línea a corregir"
            nombre={`linea-a-corregir-${ticket.cuentaId}`}
            presentacion="tarjetas"
            alCambiar={elegirLinea}
            opciones={ticket.corregibles.map((l) => ({
              valor: l.operacionId,
              etiqueta: (
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span>{l.texto}</span>
                  <span className="tabular-nums">{formatearMonto(l.subtotal)}</span>
                </span>
              ),
            }))}
          />
          {linea && unidades !== undefined && (
            <>
              <OpcionesExcluyentes
                key={linea.operacionId}
                leyenda="¿Qué corregís de esa línea?"
                nombre={`modo-de-correccion-${ticket.cuentaId}`}
                presentacion="tarjetas"
                valorInicial={modo}
                alCambiar={(v) => setModo(v === "unidades" ? "unidades" : "entera")}
                opciones={[
                  { valor: "unidades", etiqueta: "Quitar solo algunas unidades", ayuda: "Por ejemplo, cobraste 2 y la mesa tomó 1." },
                  puedeEntera
                    ? { valor: "entera", etiqueta: "Quitar toda la línea" }
                    : { valor: "entera", etiqueta: "Quitar toda la línea", deshabilitada: true, motivo: "Es la única línea que sigue vendida: para anular toda la venta usá «Anular venta» en Trazabilidad." },
                ]}
              />
              {modo === "unidades" && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-borde px-3 py-2">
                  <span id={`unidades-a-quitar-${ticket.cuentaId}`} className="text-sm font-semibold">
                    Unidades a quitar (de {unidades})
                  </span>
                  <div className="flex items-center gap-2">
                    <Boton variante="secundario" tamano="compacto" className="min-w-11" aria-label="Quitar una unidad menos" disabled={quitar <= 1} onClick={() => setQuitar((q) => Math.max(1, q - 1))}>
                      −
                    </Boton>
                    <output aria-labelledby={`unidades-a-quitar-${ticket.cuentaId}`} className="w-8 text-center text-lg font-extrabold tabular-nums">
                      {quitar}
                    </output>
                    <Boton variante="secundario" tamano="compacto" className="min-w-11" aria-label="Quitar una unidad más" disabled={quitar >= unidades - 1} onClick={() => setQuitar((q) => Math.min(unidades - 1, q + 1))}>
                      +
                    </Boton>
                  </div>
                </div>
              )}
            </>
          )}
          {linea?.sinCorreccionPorUnidades && (
            <p className="rounded-lg bg-papel px-3 py-2 text-sm text-tinta-suave">
              {linea.sinCorreccionPorUnidades === "PROMO"
                ? "Una promo se corrige entera."
                : "Corregir unidades de líneas con adicionales: pendiente de completar. Por ahora se corrige la línea entera."}
            </p>
          )}
          {porUnidades && unidades !== undefined && (
            <p className="text-sm" aria-live="polite">
              Queda <strong>{unidades - quitar} × {nombreDeLinea}</strong> ({formatearMonto((linea?.subtotal ?? 0) - importeQuitado)}) y vuelve al stock {quitar === 1 ? "1 unidad" : `${quitar} unidades`}.
            </p>
          )}
          <div className="flex items-baseline justify-between rounded-lg bg-papel px-3 py-2">
            <span className="text-sm font-semibold">Total del ticket hoy</span>
            <span className="text-xl font-extrabold tabular-nums">{formatearMonto(ticket.total)}</span>
          </div>
          {linea && (
            <div className="flex items-baseline justify-between rounded-lg bg-papel px-3 py-2">
              <span className="text-sm font-semibold">Total del ticket corregido</span>
              <span className="text-xl font-extrabold tabular-nums" aria-live="polite">
                {formatearMonto(porUnidades ? ticket.total - importeQuitado : ticket.total - linea.subtotal)}
              </span>
            </div>
          )}
          <AreaDeTexto etiqueta="Motivo (obligatorio)" maxLength={200} aria-required="true" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={error} />
          <div className="mt-1 flex justify-end gap-2">
            <Boton variante="secundario" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="acento" disabled={pending || !operacionId || !motivo.trim()}>
              {pending ? "Corrigiendo…" : "Corregir e imprimir"}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </>
  );
}
