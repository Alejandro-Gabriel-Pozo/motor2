"use client";

import { liberarMesa } from "@/server/actions/pos/cuenta-apertura";
import { BOTON_SECUNDARIO } from "./estilos";
import { useAccionMesa } from "./usar-accion";

/**
 * «Liberar mesa»: solo se dibuja con la cuenta abierta y SIN ningún ítem (se sentaron y se fueron, o se abrió por error): la cierra
 * sin venta. Con ítems, la cuenta se cierra con «Cerrar cuenta».
 */
export function LiberarMesa({ cuentaId, puede }: { cuentaId: string; puede: boolean }) {
  const { ejecutar, pending, error } = useAccionMesa();
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className={BOTON_SECUNDARIO}
        disabled={!puede || pending}
        title={puede ? undefined : "Tu rol puede ver la mesa pero no liberarla."}
        onClick={() => ejecutar(() => liberarMesa(cuentaId))}
      >
        {pending ? "Liberando…" : "Liberar mesa"}
      </button>
      {error && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
