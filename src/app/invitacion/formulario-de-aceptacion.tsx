"use client";

import { useRef, useState } from "react";
import { FormConResultado } from "@/components/form-con-resultado";
import { formatearCuit, validarCuit } from "@/core/fiscal/public";
import { aceptarMiInvitacion } from "@/server/actions/auth/invitacion";

const CAMPO = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";
const BOTON = "w-full rounded-md bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-50";
const BOTON_SECUNDARIO = "w-full rounded-md border border-neutral-300 px-4 py-2 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800";

/**
 * El CUIT de la empresa, en dos pasos para evitar errores de tipeo: primero se escribe y se revisa (se valida acá mismo, el servidor lo vuelve a validar), después
 * se muestra formateado junto al nombre de la empresa y hay que tildar que los datos son correctos antes de aceptar. Es un paso en la misma pantalla y no una
 * ventana flotante: así el foco y el lector de pantalla no quedan atrapados. El resultado (o el error) lo muestra `FormConResultado`; al salir bien la acción redirige.
 */
export function FormularioDeAceptacion({ nombreEmpresa }: { nombreEmpresa: string }) {
  const [cuit, setCuit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aRevisar, setARevisar] = useState<string | null>(null);
  const [verificado, setVerificado] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);

  function revisar() {
    const r = validarCuit(cuit);
    if (!r.ok) return setError(r.mensaje);
    if (r.valor === null) return setError("Cargá el CUIT de la empresa.");
    setError(null);
    setVerificado(false);
    setARevisar(r.valor);
    // El foco pasa al título del paso nuevo para que el cambio se anuncie.
    setTimeout(() => titulo.current?.focus(), 0);
  }

  if (aRevisar !== null) {
    return (
      <FormConResultado accion={aceptarMiInvitacion} className="space-y-3 text-left">
        <input type="hidden" name="cuit" value={aRevisar} />
        <h2 ref={titulo} tabIndex={-1} className="text-base font-semibold">
          ¿Es este el CUIT de la empresa?
        </h2>
        <p className="rounded-md border border-neutral-300 p-3 text-center text-lg font-semibold dark:border-neutral-600">{formatearCuit(aRevisar)}</p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Empresa: <strong>{nombreEmpresa}</strong>. Después de aceptar solo la plataforma puede corregirlo.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={verificado} onChange={(e) => setVerificado(e.target.checked)} className="mt-1" />
          <span>Verifiqué que el CUIT y los datos de la empresa son correctos.</span>
        </label>
        <button type="submit" className={BOTON} disabled={!verificado}>
          Confirmar y aceptar
        </button>
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => setARevisar(null)}>
          Corregir el CUIT
        </button>
      </FormConResultado>
    );
  }

  return (
    <div className="space-y-3 text-left">
      <label className="block space-y-1">
        <span className="text-sm font-medium">CUIT de la empresa</span>
        <input
          name="cuit-a-revisar"
          inputMode="numeric"
          autoComplete="off"
          value={cuit}
          onChange={(e) => setCuit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              revisar();
            }
          }}
          placeholder="30-12345678-1"
          aria-describedby={error ? "error-cuit" : undefined}
          aria-invalid={error ? true : undefined}
          className={CAMPO}
        />
      </label>
      {error && (
        <p id="error-cuit" role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <p className="text-xs text-neutral-500 dark:text-neutral-400">Lo vas a poder revisar antes de aceptar. La plataforma lo verifica antes de activar la empresa.</p>
      <button type="button" className={BOTON} onClick={revisar}>
        Revisar el CUIT
      </button>
    </div>
  );
}
