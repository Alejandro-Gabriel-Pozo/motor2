"use client";

import { abrirCuenta } from "@/server/actions/pos/cuenta";
import { BOTON_PRIMARIO } from "./estilos";
import { useAccionMesa } from "./usar-accion";

/** «Abrir cuenta» de una mesa libre. Sin `pos_tomar_pedido` el botón queda deshabilitado (el servidor lo vuelve a verificar igual). */
export function AbrirCuenta({ mesaId, puede }: { mesaId: string; puede: boolean }) {
  const { ejecutar, pending, error } = useAccionMesa();
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className={BOTON_PRIMARIO}
        disabled={!puede || pending}
        title={puede ? undefined : "Tu rol puede ver la mesa pero no tomar pedidos."}
        onClick={() => ejecutar(() => abrirCuenta(mesaId))}
      >
        {pending ? "Abriendo…" : "Abrir cuenta"}
      </button>
      {error && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
