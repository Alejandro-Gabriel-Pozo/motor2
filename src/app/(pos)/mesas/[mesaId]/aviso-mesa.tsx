"use client";

import { createContext, useContext, useState } from "react";

/**
 * Aviso de la última acción que salió bien en la pantalla de la mesa. Vive ARRIBA de todo y no dentro de cada botón: después de
 * `router.refresh()` el botón que disparó la acción puede desaparecer (cerrar la cuenta, enviar el último ítem, quitar uno) y su
 * mensaje se perdería con él. Los errores, en cambio, se muestran junto al control que los provocó (`role="alert"`).
 */
const AvisoContexto = createContext<(mensaje: string) => void>(() => {});

export function useAvisar() {
  return useContext(AvisoContexto);
}

export function AvisoMesaProvider({ children }: { children: React.ReactNode }) {
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <AvisoContexto.Provider value={setAviso}>
      {/* Un aviso con «⚠» (el cierre dejó stock negativo) va en ámbar: es un éxito, pero con algo que alguien tiene que corregir. */}
      <div
        role="status"
        aria-live="polite"
        className={
          !aviso
            ? "sr-only"
            : aviso.includes("⚠")
              ? "mb-5 rounded-[10px] border border-[var(--mesa-draft)] bg-[var(--mesa-draft-tint)] px-4 py-3 text-[13.5px] font-medium text-[var(--mesa-draft-ink)]"
              : "mb-5 rounded-[10px] border border-[var(--border)] bg-white px-4 py-3 text-[13.5px]"
        }
      >
        {aviso}
      </div>
      {children}
    </AvisoContexto.Provider>
  );
}
