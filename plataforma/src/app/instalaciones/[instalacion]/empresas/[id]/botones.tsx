"use client";

import { useActionState, useState } from "react";
import { normalizarCuit, formatearCuit } from "@/core/fiscal/cuit";
import { confirmar, corregirCuit, invitarOtraVez, quitarCuit, reactivar, reenviar, reenviarAviso, revocar, suspender, type EstadoDeFormulario } from "../acciones";
import { BotonConConfirmacion } from "./confirmacion";

function Mensaje({ estado }: { estado: EstadoDeFormulario }) {
  if (!estado) return null;
  return (
    <p className={estado.tipo === "error" ? "error" : "aviso"} role={estado.tipo === "error" ? "alert" : "status"}>
      {estado.mensaje}
    </p>
  );
}

/** Reenviar y revocar la invitación pendiente. Revocar pide confirmación: el enlace deja de servir y no hay vuelta atrás (se invita de nuevo). */
export function AccionesDeInvitacion({ instalacion, empresaId, hayPendiente }: { instalacion: string; empresaId: string; hayPendiente: boolean }) {
  const [estadoReenvio, accionReenvio, reenviando] = useActionState(reenviar.bind(null, instalacion, empresaId), null);
  const [estadoRevocar, accionRevocar, revocando] = useActionState(revocar.bind(null, instalacion, empresaId), null);
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
      <form action={accionRevocar}>
        <BotonConConfirmacion etiqueta="Revocar la invitación" aviso="¿Revocar la invitación? El enlace deja de servir." enCurso={revocando} secundario />
        <Mensaje estado={estadoRevocar} />
      </form>
    </div>
  );
}

/** Invitar a otro email (por ejemplo si el primero estaba mal escrito): revoca la pendiente y crea una nueva. */
export function InvitarDeNuevo({ instalacion, empresaId }: { instalacion: string; empresaId: string }) {
  const [estado, accion, pendiente] = useActionState(invitarOtraVez.bind(null, instalacion, empresaId), null);
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

/**
 * Confirmar el alta: el CUIT viene precargado con el que declaró el gerente. Hay que tildar que se revisó contra la constancia de ARCA; si se cambia el CUIT, además
 * hay que aceptar expresamente que se confirma uno distinto del declarado (queda auditado).
 */
export function ConfirmarAlta({ instalacion, empresaId, nombre, cuitDeclarado, repetidoCon }: { instalacion: string; empresaId: string; nombre: string; cuitDeclarado: string; repetidoCon: string[] }) {
  const [estado, accion, pendiente] = useActionState(confirmar.bind(null, instalacion, empresaId), null);
  const [cuit, setCuit] = useState(formatearCuit(cuitDeclarado));
  const [revisado, setRevisado] = useState(false);
  const [distinto, setDistinto] = useState(false);
  const difiere = normalizarCuit(cuit) !== cuitDeclarado;
  const listo = revisado && (!difiere || distinto);
  return (
    <form action={accion} className="acciones" noValidate>
      <h2>Confirmar el alta</h2>
      <p className="ayuda">El gerente aceptó la invitación y declaró el CUIT. Revisalo contra la constancia de ARCA; al confirmar la empresa pasa a activa y el gerente recibe un aviso.</p>
      {repetidoCon.length > 0 && (
        <p className="error" role="alert">
          Atención: {repetidoCon.map((n) => `«${n}»`).join(", ")} {repetidoCon.length === 1 ? "tiene o declaró" : "tienen o declararon"} el mismo CUIT. Solo una puede quedar con él.
        </p>
      )}
      <div>
        <label htmlFor="cuit-confirmar">CUIT de la empresa</label>
        <input id="cuit-confirmar" name="cuit" inputMode="numeric" autoComplete="off" value={cuit} onChange={(e) => setCuit(e.target.value)} />
      </div>
      <label className="casilla">
        <input type="checkbox" name="revisado" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} />
        <span>Revisé el CUIT contra la constancia de ARCA</span>
      </label>
      {difiere && (
        <label className="casilla">
          <input type="checkbox" name="aceptoCuitDistinto" checked={distinto} onChange={(e) => setDistinto(e.target.checked)} />
          <span>Confirmo un CUIT distinto del que declaró el gerente ({formatearCuit(cuitDeclarado)})</span>
        </label>
      )}
      <Mensaje estado={estado} />
      {listo ? (
        <BotonConConfirmacion etiqueta="Confirmar el alta" aviso={`¿Confirmar el alta de «${nombre}» con el CUIT ${formatearCuit(normalizarCuit(cuit) ?? cuit)}?`} enCurso={pendiente} />
      ) : (
        <button type="button" disabled>
          Confirmar el alta
        </button>
      )}
    </form>
  );
}

/** Corregir (o cargar) el CUIT de una empresa activa o suspendida; con motivo. Quitarlo solo si está suspendida. */
export function CorregirCuit({ instalacion, empresaId, cuitActual, puedeQuitar }: { instalacion: string; empresaId: string; cuitActual: string | null; puedeQuitar: boolean }) {
  const [estado, accion, pendiente] = useActionState(corregirCuit.bind(null, instalacion, empresaId), null);
  const [estadoQuitar, accionQuitar, quitando] = useActionState(quitarCuit.bind(null, instalacion, empresaId), null);
  return (
    <div className="acciones">
      <form action={accion} noValidate>
        <h2>{cuitActual ? "Corregir el CUIT" : "Cargar el CUIT"}</h2>
        <p className="ayuda">Se puede corregir hasta la primera factura autorizada por ARCA en producción. Queda en la auditoría con el valor anterior y el motivo.</p>
        <label htmlFor="cuit-corregir">CUIT nuevo</label>
        <input id="cuit-corregir" name="cuit" inputMode="numeric" autoComplete="off" defaultValue={cuitActual ? formatearCuit(cuitActual) : ""} />
        <label htmlFor="motivo-cuit">Motivo</label>
        <input id="motivo-cuit" name="motivo" maxLength={200} autoComplete="off" />
        <Mensaje estado={estado} />
        <BotonConConfirmacion etiqueta="Guardar el CUIT" aviso="¿Guardar el CUIT nuevo? Queda registrado con el valor anterior y el motivo." enCurso={pendiente} secundario />
      </form>
      {puedeQuitar && (
        <form action={accionQuitar} noValidate>
          <label htmlFor="motivo-quitar">Motivo para quitar el CUIT</label>
          <input id="motivo-quitar" name="motivo" maxLength={200} autoComplete="off" />
          <Mensaje estado={estadoQuitar} />
          <BotonConConfirmacion etiqueta="Quitar el CUIT" aviso="¿Quitar el CUIT de esta empresa suspendida?" enCurso={quitando} secundario />
        </form>
      )}
    </div>
  );
}

export function Suspender({ instalacion, empresaId, nombre }: { instalacion: string; empresaId: string; nombre: string }) {
  const [estado, accion, pendiente] = useActionState(suspender.bind(null, instalacion, empresaId), null);
  return (
    <form action={accion} className="acciones" noValidate>
      <h2>Suspender</h2>
      <p className="ayuda">Sus usuarios dejan de entrar en su próximo pedido y ven que la empresa está suspendida. Los datos quedan intactos.</p>
      <label htmlFor="motivo-suspender">Motivo</label>
      <input id="motivo-suspender" name="motivo" maxLength={200} autoComplete="off" />
      <Mensaje estado={estado} />
      <BotonConConfirmacion etiqueta="Suspender la empresa" aviso={`¿Suspender «${nombre}»? Sus usuarios no van a poder entrar.`} enCurso={pendiente} secundario />
    </form>
  );
}

export function Reactivar({ instalacion, empresaId, nombre }: { instalacion: string; empresaId: string; nombre: string }) {
  const [estado, accion, pendiente] = useActionState(reactivar.bind(null, instalacion, empresaId), null);
  return (
    <form action={accion} className="acciones" noValidate>
      <h2>Reactivar</h2>
      <label htmlFor="motivo-reactivar">Motivo (opcional)</label>
      <input id="motivo-reactivar" name="motivo" maxLength={200} autoComplete="off" />
      <Mensaje estado={estado} />
      <BotonConConfirmacion etiqueta="Reactivar la empresa" aviso={`¿Reactivar «${nombre}»? Sus usuarios vuelven a entrar.`} enCurso={pendiente} />
    </form>
  );
}

export function ReenviarAviso({ instalacion, empresaId }: { instalacion: string; empresaId: string }) {
  const [estado, accion, pendiente] = useActionState(reenviarAviso.bind(null, instalacion, empresaId), null);
  return (
    <form action={accion} className="acciones">
      <button type="submit" className="secundario" disabled={pendiente}>
        {pendiente ? "Reenviando…" : "Reenviar el aviso de activación"}
      </button>
      <Mensaje estado={estado} />
    </form>
  );
}
