"use client";

import { useActionState } from "react";
import { invitarOtraVez, reenviar, revocar, type EstadoDeFormulario } from "../acciones";

function Mensaje({ estado }: { estado: EstadoDeFormulario }) {
  if (!estado) return null;
  return (
    <p className={estado.tipo === "error" ? "error" : "aviso"} role={estado.tipo === "error" ? "alert" : "status"}>
      {estado.mensaje}
    </p>
  );
}

/** Reenviar y revocar la invitación pendiente. Revocar pide confirmación: el enlace deja de servir y no hay vuelta atrás (se invita de nuevo). */
export function AccionesDeInvitacion({ empresaId, hayPendiente }: { empresaId: string; hayPendiente: boolean }) {
  const [estadoReenvio, accionReenvio, reenviando] = useActionState(reenviar.bind(null, empresaId), null);
  const [estadoRevocar, accionRevocar, revocando] = useActionState(revocar.bind(null, empresaId), null);
  if (!hayPendiente) return null;
  return (
    <div className="acciones">
      <form action={accionReenvio}>
        <button type="submit" disabled={reenviando}>
          {reenviando ? "Reenviando…" : "Reenviar la invitación"}
        </button>
        <p className="ayuda">Genera un enlace nuevo y renueva el vencimiento; el enlace anterior deja de servir.</p>
        <Mensaje estado={estadoReenvio} />
      </form>
      <form
        action={accionRevocar}
        onSubmit={(e) => {
          if (!window.confirm("¿Revocar la invitación? El enlace deja de servir.")) e.preventDefault();
        }}
      >
        <button type="submit" className="secundario" disabled={revocando}>
          {revocando ? "Revocando…" : "Revocar la invitación"}
        </button>
        <Mensaje estado={estadoRevocar} />
      </form>
    </div>
  );
}

/** Invitar a otro email (por ejemplo si el primero estaba mal escrito): revoca la pendiente y crea una nueva. */
export function InvitarDeNuevo({ empresaId }: { empresaId: string }) {
  const [estado, accion, pendiente] = useActionState(invitarOtraVez.bind(null, empresaId), null);
  return (
    <form action={accion} className="acciones" noValidate>
      <div>
        <label htmlFor="email">Invitar a otro email</label>
        <input id="email" name="email" type="email" required autoComplete="off" />
      </div>
      <Mensaje estado={estado} />
      <button type="submit" className="secundario" disabled={pendiente}>
        {pendiente ? "Invitando…" : "Invitar de nuevo"}
      </button>
    </form>
  );
}
