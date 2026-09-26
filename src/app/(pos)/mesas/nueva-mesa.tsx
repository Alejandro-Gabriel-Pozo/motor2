"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { crearMesa } from "@/server/actions/pos/mesas";
import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";

/**
 * «Nueva mesa»: la única pieza de cliente del mapa. Abre un diálogo propio (con `role="dialog"`, título y cierre con Escape) con el
 * número sugerido precargado (el mayor + 1) y llama a `crearMesa`; si sale bien, cierra el diálogo, avisa y pide `router.refresh()`
 * (la acción no refresca sola: ver su docstring). Sin permiso de Editar en `pos_mesas` el botón queda deshabilitado; igual la acción
 * vuelve a verificarlo en el servidor.
 *
 * El número usa `CampoNumero` (nunca `Number(...)` a secas): antes un `<input>` crudo aceptaba notación científica en silencio
 * ("1e3" → 1000). `CampoNumero` interpreta con `interpretarNumero`/`numeroDelCampo` (src/core/datos/numero-tecleado.ts) y deja el
 * campo `aria-invalid` con el mensaje nativo del navegador ante un formato que no es un número — `crearMesa` sigue siendo quien
 * valida que sea un entero dentro del rango permitido.
 */
export function NuevaMesa({ siguienteNumero, puedeCrear }: { siguienteNumero: number; puedeCrear: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [numero, setNumero] = useState(String(siguienteNumero));
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const abrir = () => {
    setNumero(String(siguienteNumero)); // el sugerido cambia después de cada alta (llega de nuevo con el refresco)
    setError(null);
    setAviso(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      // numeroDelCampo: vacío → undefined, texto inválido (ej. notación científica) → NaN — el servidor lo rechaza, nunca un 0 encubierto.
      const r = await crearMesa(numeroDelCampo(numero) ?? Number.NaN);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setAbierto(false);
      setAviso(r.mensaje);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-start gap-1.5 md:items-end">
      <button
        type="button"
        onClick={abrir}
        disabled={!puedeCrear}
        title={puedeCrear ? undefined : "Tu rol puede ver el mapa pero no dar de alta mesas."}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] px-4 py-[9px] text-[13px] font-semibold text-white transition-colors enabled:hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Nueva mesa
      </button>
      {aviso && (
        <p role="status" className="text-[12.5px] text-[var(--mesa-libre-ink)]">
          {aviso}
        </p>
      )}

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={cerrar}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nueva-mesa-titulo"
            className="w-full max-w-sm rounded-[14px] bg-white p-5 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") cerrar();
            }}
          >
            <h2 id="nueva-mesa-titulo" className="mb-4 text-lg font-extrabold tracking-tight">
              Nueva mesa
            </h2>
            <form onSubmit={enviar} className="flex flex-col gap-3">
              <label htmlFor="nueva-mesa-numero" className="text-[13px] font-semibold">
                Número de mesa
              </label>
              <CampoNumero id="nueva-mesa-numero" value={numero} onChange={setNumero} required autoFocus />
              {error && (
                <p id="nueva-mesa-error" role="alert" className="text-[13px] text-red-700">
                  {error}
                </p>
              )}
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" onClick={cerrar} className="rounded-lg border border-[var(--border)] px-4 py-[9px] text-[13px] font-semibold hover:bg-[#F1EFEA]">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-[var(--brand)] px-4 py-[9px] text-[13px] font-semibold text-white enabled:hover:bg-[var(--brand-hover)] disabled:opacity-50"
                >
                  {pending ? "Creando…" : "Crear mesa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
