"use client";

import { useRef, useState } from "react";
import { CampoCodigo } from "@/components/campo-codigo";
import { FormConResultado } from "@/components/form-con-resultado";
import { formatearCuit, validarCuit } from "@/core/fiscal/public";
import { aceptarMiInvitacion } from "@/server/actions/auth/invitacion";
import { Boton } from "@/ui/primitivas/boton";
import { Casilla } from "@/ui/primitivas/casilla";

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
        <p className="rounded-md border border-borde-control p-3 text-center text-lg font-semibold">{formatearCuit(aRevisar)}</p>
        <p className="text-sm text-tinta-tenue">
          Empresa: <strong>{nombreEmpresa}</strong>. Después de aceptar solo la plataforma puede corregirlo.
        </p>
        <Casilla etiqueta="Verifiqué que el CUIT y los datos de la empresa son correctos." checked={verificado} onChange={(e) => setVerificado(e.target.checked)} />
        <Boton type="submit" className="w-full" disabled={!verificado}>
          Confirmar y aceptar
        </Boton>
        <Boton variante="secundario" className="w-full" onClick={() => setARevisar(null)}>
          Corregir el CUIT
        </Boton>
      </FormConResultado>
    );
  }

  return (
    <div className="space-y-3 text-left">
      <CampoCodigo
        etiqueta="CUIT de la empresa"
        name="cuit-a-revisar"
        autoComplete="off"
        longitudMaxima={13}
        patron="[0-9\-]*"
        value={cuit}
        onChange={(e) => setCuit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            revisar();
          }
        }}
        placeholder="30-12345678-1"
        error={error}
      />
      <p className="text-xs text-tinta-tenue">Lo vas a poder revisar antes de aceptar. La plataforma lo verifica antes de activar la empresa.</p>
      <Boton className="w-full" onClick={revisar}>
        Revisar el CUIT
      </Boton>
    </div>
  );
}
