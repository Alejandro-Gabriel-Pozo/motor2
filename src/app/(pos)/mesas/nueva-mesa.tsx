"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { crearMesa } from "@/server/actions/pos/mesas";
import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

/**
 * «Nueva mesa»: la única pieza de cliente del mapa. Abre el `Dialogo` del sistema (modal nativo: rol, título, foco atrapado y devuelto al botón, cierre con Escape; mientras se crea no se cierra) con el
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
      <Boton variante="acento" onClick={abrir} disabled={!puedeCrear} title={puedeCrear ? undefined : "Tu rol puede ver el mapa pero no dar de alta mesas."}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Nueva mesa
      </Boton>
      {aviso && (
        <Aviso variante="exito" forma="en-linea">
          {aviso}
        </Aviso>
      )}

      <Dialogo abierto={abierto} titulo="Nueva mesa" onCerrar={cerrar} cerrable={!pending}>
        <form onSubmit={enviar} className="flex flex-col gap-3">
          <label htmlFor="nueva-mesa-numero" className="text-sm font-medium">
            Número de mesa
          </label>
          {/* El foco inicial va al número (lo marca `data-foco-inicial`; un autoFocus de React no enfoca dentro de un <dialog> todavía cerrado). */}
          <div data-foco-inicial="">
            <CampoNumero id="nueva-mesa-numero" value={numero} onChange={setNumero} required />
          </div>
          {error && (
            <Aviso id="nueva-mesa-error" variante="error" forma="en-linea">
              {error}
            </Aviso>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Boton variante="secundario" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="acento" disabled={pending}>
              {pending ? "Creando…" : "Crear mesa"}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </div>
  );
}
