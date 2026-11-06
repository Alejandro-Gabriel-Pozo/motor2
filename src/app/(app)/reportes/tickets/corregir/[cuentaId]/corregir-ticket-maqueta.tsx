"use client";

import { useState } from "react";
import { Boton } from "@/ui/primitivas/boton";

interface LineaParaCorregir {
  producto: string;
  cantidad: number;
  subtotal: number;
  indentado: boolean;
  quitable: boolean;
}

const MOTIVOS = ["El cliente devolvió el producto", "Error al cargar el pedido", "Producto no entregado", "Otro"];
const plata = (n: number) => `$${n.toLocaleString("es-AR")}`;

/**
 * MAQUETA (rama temporal, no se mergea): el paso 2 de «Corregir un ticket». Una sola pantalla para lo que hoy son tres: marcar qué línea se quita (hoy «Anular venta» en Trazabilidad, una por una), ver cómo queda el
 * ticket corregido y emitirlo con motivo (hoy «Emitir ticket corregido» en la mesa). Se quita la LÍNEA ENTERA (la venta se registra por línea). NO guarda.
 */
export function CorregirTicketMaqueta({ numero, siguiente, estado, lineas }: { numero: string; siguiente: string; estado: string | null; lineas: LineaParaCorregir[] }) {
  const [quitadas, setQuitadas] = useState<ReadonlySet<number>>(new Set());
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const alternar = (i: number) => setQuitadas((actual) => { const n = new Set(actual); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const totalOriginal = lineas.reduce((s, l) => s + (l.indentado ? 0 : l.subtotal), 0);
  const totalCorregido = lineas.reduce((s, l, i) => s + (l.indentado || quitadas.has(i) ? 0 : l.subtotal), 0);
  const quitado = totalOriginal - totalCorregido;
  const sinLineas = lineas.filter((l, i) => !l.indentado && !quitadas.has(i)).length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-corregir-ticket>
      <section aria-label="Ticket original" className="rounded border bg-papel p-3">
        <h2 className="mb-2 text-sm font-semibold text-tinta-tenue">ORIGINAL · N.º {numero} · no se modifica</h2>
        <ul className="flex flex-col gap-1 text-sm text-tinta-tenue">
          {lineas.map((l, i) => (
            <li key={i} className={`flex justify-between gap-2 ${l.indentado ? "pl-4 text-xs" : ""}`}>
              <span>
                {l.cantidad} × {l.producto}
              </span>
              {!l.indentado && <span className="tabular-nums">{plata(l.subtotal)}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold text-tinta-tenue">
          <span>Total</span>
          <span className="tabular-nums">{plata(totalOriginal)}</span>
        </p>
      </section>

      <section aria-label="Ticket corregido" className="flex flex-col gap-3 rounded border p-3">
        <h2 className="text-sm font-semibold">COMO QUEDA · N.º {siguiente}</h2>
        {estado === "desactualizada" && <p className="rounded bg-papel p-2 text-xs">Ya se anuló parte de esta venta después de imprimirlo: solo falta emitir el corregido.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {lineas.map((l, i) => (
            <li key={i} className={`flex items-center justify-between gap-2 ${l.indentado ? "pl-4 text-xs text-tinta-tenue" : ""}`}>
              <span className={quitadas.has(i) ? "line-through text-tinta-tenue" : ""}>
                {l.cantidad} × {l.producto}
              </span>
              <span className="flex items-center gap-2">
                {!l.indentado && <span className={`tabular-nums ${quitadas.has(i) ? "line-through text-tinta-tenue" : ""}`}>{plata(l.subtotal)}</span>}
                {!l.indentado && (
                  <Boton
                    variante="secundario"
                    tamano="compacto"
                    disabled={!l.quitable}
                    title={l.quitable ? undefined : "Una promo se anula entera, no por componente"}
                    aria-label={`${quitadas.has(i) ? "Dejar" : "Quitar"} ${l.producto}`}
                    onClick={() => alternar(i)}
                  >
                    {quitadas.has(i) ? "Dejar" : "Quitar"}
                  </Boton>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-tinta-tenue">«Quitar» saca la línea entera (la venta se registra por línea) y devuelve su stock.</p>

        <div className="rounded bg-papel p-2 text-sm" data-que-cambia>
          <p className="flex justify-between">
            <span>Total corregido</span>
            <strong className="tabular-nums">{plata(totalCorregido)}</strong>
          </p>
          <p className="mt-1 text-xs text-tinta-tenue">
            {quitadas.size === 0 && estado !== "desactualizada"
              ? "Todavía no quitaste ninguna línea."
              : `Se quita ${plata(quitado)}. El ${numero} queda en el historial como «Reemplazado por ${siguiente}».`}
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Motivo (obligatorio)</span>
          <select className="min-h-11 rounded border bg-superficie px-2 text-base md:min-h-9 md:text-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {MOTIVOS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        {sinLineas && <p className="text-xs text-error">Si se quitan todas las líneas, la venta se anula entera: no hay ticket que corregir.</p>}
        <p className="text-xs text-aviso-tinta" data-maqueta>
          MAQUETA: muestra y calcula, pero no guarda. Hoy esto son tres pasos en tres pantallas (anular cada línea en Trazabilidad, volver a la mesa y emitir el corregido); acá sería uno.
        </p>
        <div className="flex items-center gap-3">
          <Boton disabled>Emitir ticket corregido N.º {siguiente}</Boton>
        </div>
      </section>
    </div>
  );
}
