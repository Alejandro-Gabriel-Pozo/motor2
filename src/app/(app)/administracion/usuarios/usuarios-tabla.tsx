"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BotonActivarDesactivar } from "@/components/boton-activar-desactivar";
import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import {
  agregarOActualizarUsuario,
  actualizarActivoMembresia,
  invitarAVincular,
  reenviarInvitacionPendiente,
  revocarInvitacion,
  type EstadoDeCuentaGoogle,
} from "@/server/actions/auth/usuarios";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";

interface Rol {
  id: string;
  nombre: string;
}
interface Sucursal {
  id: string;
  nombre: string;
}
interface Membresia {
  id: string;
  activo: boolean;
  usuario: { email: string };
  rol: { nombre: string };
  google: EstadoDeCuentaGoogle;
  invitacionId: string | null;
}
interface InvitacionPendiente {
  id: string;
  email: string;
  invitadoPor: string | null;
  venceEn: string;
  vencida: boolean;
  enviada: boolean;
  accesos: { sucursal: string; rol: string }[];
  /** Accesos de la invitación en sucursales que quien mira no administra (S-16): solo la cuenta, sin nombres. */
  enOtrasSucursales: number;
}

const TEXTO_GOOGLE: Record<EstadoDeCuentaGoogle, string> = {
  vinculada: "Vinculada",
  "sin-invitacion": "Sin vincular",
  pendiente: "Sin vincular — invitación enviada",
  vencida: "Sin vincular — invitación vencida",
  "sin-enviar": "Sin vincular — invitación sin enviar",
};

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function UsuariosTabla({
  membresiasIniciales,
  invitaciones,
  roles,
  sucursales,
  sucursalActualId,
  puedeActivar,
}: {
  membresiasIniciales: Membresia[];
  invitaciones: InvitacionPendiente[];
  roles: Rol[];
  sucursales: Sucursal[];
  sucursalActualId: string;
  puedeActivar: boolean;
}) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleActivo(m: Membresia) {
    setPendingId(m.id);
    startTransition(async () => {
      const resultado = await actualizarActivoMembresia(m.id, !m.activo);
      setMensaje({ ok: resultado.ok, texto: resultado.mensaje });
      setPendingId(null);
      if (resultado.ok) router.refresh();
    });
  }

  function vincular(m: Membresia) {
    setPendingId(m.id);
    startTransition(async () => {
      const resultado = await invitarAVincular(m.id);
      setMensaje({ ok: resultado.ok, texto: resultado.mensaje });
      setPendingId(null);
      if (resultado.ok) router.refresh();
    });
  }

  function guardarUsuario(formData: FormData) {
    startTransition(async () => {
      const resultado = await agregarOActualizarUsuario({
        email: String(formData.get("email") ?? ""),
        rolId: String(formData.get("rolId") ?? ""),
        sucursalId: String(formData.get("sucursalId") ?? sucursalActualId),
      });
      setMensaje({ ok: resultado.ok, texto: resultado.mensaje });
      if (resultado.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {mensaje && (
        <Aviso variante={mensaje.ok ? "exito" : "error"} forma="en-linea">
          {mensaje.texto}
        </Aviso>
      )}

      <table className="w-full text-sm">
        <caption className="sr-only">Usuarios de la sucursal</caption>
        <thead>
          <tr className="border-b text-left text-tinta-tenue">
            <th scope="col" className="py-2">Email</th>
            <th scope="col">Rol</th>
            <th scope="col">Activo</th>
            <th scope="col">Cuenta de Google</th>
            <th scope="col"><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {membresiasIniciales.map((m) => (
            <tr key={m.id} className="border-b">
              <td className="py-2">{m.usuario.email}</td>
              <td>{m.rol.nombre}</td>
              <td>{m.activo ? "Sí" : "No"}</td>
              <td>{TEXTO_GOOGLE[m.google]}</td>
              <td className="space-x-3">
                {puedeActivar && (
                  <BotonActivarDesactivar
                    activo={m.activo}
                    ocupado={pending && pendingId === m.id}
                    aviso={`¿Desactivar a ${m.usuario.email}? Pierde el acceso a esta sucursal.`}
                    onCambiar={() => toggleActivo(m)}
                  />
                )}
                {m.google !== "vinculada" && (
                  <Boton
                    variante="enlace"
                    tamano="en-fila"
                    disabled={pending && pendingId === m.id}
                    onClick={() => vincular(m)}
                    aria-label={`${m.google === "sin-invitacion" ? "Invitar a vincular" : "Reenviar la invitación a"} ${m.usuario.email}`}
                  >
                    {m.google === "sin-invitacion" ? "Invitar a vincular" : "Reenviar invitación"}
                  </Boton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-labelledby="titulo-invitaciones" className="space-y-2">
        <h2 id="titulo-invitaciones" className="font-medium">Invitaciones pendientes</h2>
        {invitaciones.length === 0 ? (
          <p className="text-sm text-tinta-tenue">No hay invitaciones pendientes. Las personas nuevas aparecen acá hasta que aceptan.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Invitaciones pendientes de esta sucursal</caption>
            <thead>
              <tr className="border-b text-left text-tinta-tenue">
                <th scope="col" className="py-2">Email</th>
                <th scope="col">Acceso que da</th>
                <th scope="col">Invitó</th>
                <th scope="col">Estado</th>
                <th scope="col"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {invitaciones.map((i) => (
                <tr key={i.id} className="border-b align-top">
                  <td className="py-2">{i.email}</td>
                  <td>
                    <ul>
                      {i.accesos.map((a) => (
                        <li key={a.sucursal}>
                          {a.sucursal} — {a.rol}
                        </li>
                      ))}
                      {i.enOtrasSucursales > 0 && <li className="text-tinta-tenue">y {i.enOtrasSucursales === 1 ? "1 acceso más" : `${i.enOtrasSucursales} accesos más`} en otras sucursales</li>}
                    </ul>
                  </td>
                  <td>{i.invitadoPor ?? "—"}</td>
                  <td>{i.vencida ? `Vencida el ${fecha(i.venceEn)}` : i.enviada ? `Vence el ${fecha(i.venceEn)}` : "Sin enviar (el mail no salió)"}</td>
                  <td className="space-y-1">
                    <BotonConConfirmacion
                      etiqueta="Reenviar"
                      etiquetaAccesible={`Reenviar la invitación a ${i.email}`}
                      aviso={`¿Reenviar la invitación a ${i.email}? El enlace anterior deja de servir.`}
                      etiquetaConfirmar="Sí, reenviar"
                      etiquetaEnCurso="Reenviando…"
                      accion={() => reenviarInvitacionPendiente(i.id)}
                      claseDisparador="text-sm underline"
                    />
                    <BotonConConfirmacion
                      etiqueta="Revocar"
                      etiquetaAccesible={`Revocar la invitación a ${i.email}`}
                      aviso={`¿Revocar la invitación a ${i.email}? El enlace deja de servir y la persona no tendrá acceso.`}
                      etiquetaConfirmar="Sí, revocar"
                      etiquetaEnCurso="Revocando…"
                      accion={() => revocarInvitacion(i.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <form action={guardarUsuario} className="flex max-w-md flex-col gap-2">
        <h2 className="font-medium">Agregar / actualizar usuario</h2>
        <Campo etiqueta="Email" name="email" type="email" placeholder="email@negocio.com" required />
        <Selector etiqueta="Sucursal" name="sucursalId" defaultValue={sucursalActualId} required>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
              {s.id === sucursalActualId ? " (donde estás ahora)" : ""}
            </option>
          ))}
        </Selector>
        <Selector etiqueta="Rol" name="rolId" required>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </Selector>
        <Boton type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar"}
        </Boton>
      </form>
      <p className="max-w-md text-xs text-tinta-tenue">
        Si la persona todavía no es parte de la empresa, se le manda una invitación por mail: tiene acceso recién cuando la acepta con su cuenta de Google. Si ya es parte, se le suma la
        sucursal o se le cambia el rol al instante. Para que alguien vea varias sucursales (ej. un súper admin de las 5), agregalo acá una vez por cada sucursal.
      </p>
    </div>
  );
}
