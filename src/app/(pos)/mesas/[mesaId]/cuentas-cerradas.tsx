"use client";

import type { BoletaDeCuenta } from "@/core/pos/boleta";
import { BOTON_CHICO } from "./estilos";
import { formatearHora, formatearMonto } from "./formato";
import { useImpresion } from "./imprimir";

/**
 * «Cuentas cerradas» (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B8): al pie de la pantalla de la mesa, libre o con cuenta
 * abierta, las últimas cuentas cerradas CON VENTA de la mesa, de la más nueva a la más vieja, con «Reimprimir boleta» (la copia sale
 * marcada REIMPRESIÓN). Sin `pos_cerrar_cuenta` Editar el botón queda deshabilitado; si la venta se anuló, también, y lo dice: no se
 * imprime el comprobante de una venta revertida. Sin ninguna cuenta cerrada con venta, la sección no aparece.
 */
export function CuentasCerradas({ boletas, puede }: { boletas: BoletaDeCuenta[]; puede: boolean }) {
  const { reimprimirBoleta } = useImpresion();
  if (!boletas.length) return null;

  return (
    <section aria-labelledby="cuentas-cerradas-titulo" className="mt-6 rounded-[14px] border border-[var(--border)] bg-white p-4">
      <h2 id="cuentas-cerradas-titulo" className="mb-3 text-[15px] font-bold">
        Cuentas cerradas
      </h2>
      <ul className="divide-y divide-[var(--border)]">
        {boletas.map((b) => {
          const hora = formatearHora(b.cerradaEn);
          const motivo = b.ventaAnulada
            ? "La venta de esta cuenta se anuló: su boleta ya no vale."
            : puede
              ? undefined
              : "Reimprimir la boleta requiere el permiso de cerrar cuentas, que tu rol no tiene.";
          return (
            <li key={b.cuentaId} data-cuenta-cerrada={hora} className="flex flex-wrap items-center justify-between gap-3 py-2 text-[14px]">
              <span>
                Cerrada {hora} · Atendió {b.mesero} · <span className="tabular-nums">{formatearMonto(b.total)}</span>
              </span>
              <span className="flex items-center gap-3">
                {b.ventaAnulada && <span className="text-[12.5px] font-semibold text-[var(--mesa-ocupada)]">Venta anulada</span>}
                <button
                  type="button"
                  className={BOTON_CHICO}
                  disabled={!puede || b.ventaAnulada}
                  title={motivo}
                  aria-label={`Reimprimir la boleta de la cuenta cerrada a las ${hora}`}
                  onClick={() => reimprimirBoleta(b.cuentaId)}
                >
                  Reimprimir boleta
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
