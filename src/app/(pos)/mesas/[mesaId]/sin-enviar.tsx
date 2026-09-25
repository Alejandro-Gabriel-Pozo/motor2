"use client";

import { enviarACocina, quitarItemSinEnviar } from "@/server/actions/pos/cuenta";
import { BOTON_CHICO, BOTON_PRIMARIO } from "./estilos";
import { formatearCantidad, formatearMonto } from "./formato";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

export interface ItemSinEnviar {
  id: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
}

/**
 * Los ítems que todavía no salieron a cocina (borradores): «Quitar» los borra sin pedir motivo, y «Enviar a cocina» manda los que
 * están en pantalla (sus ids: uno que otro mozo agregó recién no sale sin que se vea). Sin `pos_tomar_pedido`, solo lectura.
 *
 * Al salir bien pide imprimir la comanda del envío que el SERVIDOR dice que creó ESTA llamada (`numeroEnvio` con `envioNuevo`). Si no
 * creó ninguno (pestaña vieja: otro ya los había enviado), no imprime: esa comanda ya salió desde donde se envió.
 */
export function SinEnviar({ cuentaId, items, puede }: { cuentaId: string; items: ItemSinEnviar[]; puede: boolean }) {
  const { ejecutar, pending, error } = useAccionMesa();
  const { pedir } = useImpresion();
  const sinPermiso = puede ? undefined : "Tu rol puede ver la mesa pero no tomar pedidos.";

  const enviar = () =>
    ejecutar(
      () => enviarACocina(cuentaId, items.map((i) => i.id)),
      (r) => {
        if (r.envioNuevo && r.numeroEnvio !== null) pedir({ tipo: "envio", numero: r.numeroEnvio });
      }
    );

  return (
    <section aria-labelledby="sin-enviar-titulo" className="rounded-[14px] border border-[var(--border)] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="sin-enviar-titulo" className="text-[15px] font-bold">
          Sin enviar · {items.length}
        </h2>
        {items.length > 0 && (
          <button type="button" className={BOTON_PRIMARIO} disabled={!puede || pending} title={sinPermiso} onClick={enviar}>
            {pending ? "Enviando…" : "Enviar a cocina"}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-[var(--ink-soft)]">No hay nada pendiente de enviar.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {items.map((i) => (
            <li key={i.id} data-item-sin-enviar={i.productoNombre} className="flex items-center justify-between gap-3 py-2 text-[14px]">
              <span>
                <span className="font-semibold tabular-nums">{formatearCantidad(i.cantidad)} ×</span> {i.productoNombre}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{formatearMonto(i.cantidad * i.precioUnitario)}</span>
                <button
                  type="button"
                  className={BOTON_CHICO}
                  disabled={!puede || pending}
                  title={sinPermiso}
                  aria-label={`Quitar ${i.productoNombre}`}
                  onClick={() => ejecutar(() => quitarItemSinEnviar(i.id))}
                >
                  Quitar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
