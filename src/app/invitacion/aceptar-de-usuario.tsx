"use client";

import { FormConResultado } from "@/components/form-con-resultado";
import { aceptarMiInvitacionDeUsuario } from "@/server/actions/auth/invitacion";

const BOTON = "w-full rounded-md bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-50";

/** El botón «Aceptar» de una invitación de usuario: el resultado (o el error) lo muestra `FormConResultado`; al salir bien la acción redirige. */
export function AceptarDeUsuario() {
  return (
    <FormConResultado accion={aceptarMiInvitacionDeUsuario} className="space-y-3 text-left">
      <button type="submit" className={BOTON}>
        Aceptar la invitación
      </button>
    </FormConResultado>
  );
}
