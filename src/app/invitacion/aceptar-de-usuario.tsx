"use client";

import { FormConResultado } from "@/components/form-con-resultado";
import { aceptarMiInvitacionDeUsuario } from "@/server/actions/auth/invitacion";
import { Boton } from "@/ui/primitivas/boton";

/** El botón «Aceptar» de una invitación de usuario: el resultado (o el error) lo muestra `FormConResultado`; al salir bien la acción redirige. */
export function AceptarDeUsuario() {
  return (
    <FormConResultado accion={aceptarMiInvitacionDeUsuario} className="space-y-3 text-left">
      <Boton type="submit" className="w-full">
        Aceptar la invitación
      </Boton>
    </FormConResultado>
  );
}
