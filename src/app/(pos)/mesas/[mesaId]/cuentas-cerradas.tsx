"use client";

import type { BoletaDeCuenta } from "@/core/pos/boleta";
import { formatearNumeroBoleta } from "@/core/pos/numeracion-boleta";
import { BOTON_CHICO } from "./estilos";
import { formatearMonto } from "@/core/pos/formato";
import { formatearHora } from "@/core/tiempo/zona-horaria";
import { useImpresion } from "./imprimir";
import { EmitirBoletaCorregida } from "./emitir-boleta-corregida";

/**
 * «Cuentas cerradas» (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B8): al pie de la pantalla de la mesa, libre o con cuenta
 * abierta, las últimas cuentas cerradas CON VENTA de la mesa, de la más nueva a la más vieja, con «Reimprimir boleta» (la copia sale
 * marcada REIMPRESIÓN). Sin `pos_cerrar_cuenta` Editar el botón queda deshabilitado; si la venta se anuló entera, también, y lo dice: no
 * se imprime el comprobante de una venta revertida. Sin ninguna cuenta cerrada con venta, la sección no aparece. Cada fila empieza por el
 * número de su boleta («N.º 566-A · …», docs/plan-numeracion-boleta-2026-09-25.md), salvo las cerradas antes de la numeración.
 *
 * Según el estado de la boleta (`BoletaDeCuenta.estado`): «vigente» se reimprime (aunque sea un ejemplar de corrección, 566-B);
 * «desactualizada» (se anuló una línea después de imprimirla) no se reimprime y habilita «Emitir boleta corregida»; «anulada», todo
 * deshabilitado.
 */
export function CuentasCerradas({ boletas, puede, puedeCorregir, zonaHoraria }: { boletas: BoletaDeCuenta[]; puede: boolean; puedeCorregir: boolean; zonaHoraria: string }) {
  const { reimprimirBoleta } = useImpresion();
  if (!boletas.length) return null;

  return (
    <section aria-labelledby="cuentas-cerradas-titulo" className="mt-6 rounded-[14px] border border-[var(--border)] bg-white p-4">
      <h2 id="cuentas-cerradas-titulo" className="mb-3 text-[15px] font-bold">
        Cuentas cerradas
      </h2>
      <ul className="divide-y divide-[var(--border)]">
        {boletas.map((b) => {
          const hora = formatearHora(b.cerradaEn, zonaHoraria);
          const motivo =
            b.estado === "anulada"
              ? "La venta de esta cuenta se anuló: su boleta ya no vale."
              : b.estado === "desactualizada"
                ? "Se anuló parte de la venta después de imprimir esta boleta: emití la boleta corregida."
                : puede
                  ? undefined
                  : "Reimprimir la boleta requiere el permiso de cerrar cuentas, que tu rol no tiene.";
          return (
            <li key={b.cuentaId} data-cuenta-cerrada={hora} className="flex flex-wrap items-center justify-between gap-3 py-2 text-[14px]">
              <span>
                {b.numero && `N.º ${formatearNumeroBoleta(b.numero)} · `}Cerrada {hora} · Atendió {b.mesero} · <span className="tabular-nums">{formatearMonto(b.total)}</span>
              </span>
              <span className="flex items-center gap-3">
                {b.estado === "anulada" && <span className="text-[12.5px] font-semibold text-[var(--mesa-ocupada)]">Venta anulada</span>}
                <EmitirBoletaCorregida boleta={b} hora={hora} puede={puedeCorregir} />
                <button
                  type="button"
                  className={BOTON_CHICO}
                  disabled={!puede || b.estado !== "vigente"}
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
