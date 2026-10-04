"use client";

import { FormConResultado } from "@/components/form-con-resultado";
import { aceptarMiInvitacion } from "@/server/actions/auth/invitacion";

/** El CUIT de la empresa y el botón para aceptar. El resultado (o el error) lo muestra `FormConResultado`; al salir bien la acción redirige. */
export function FormularioDeAceptacion() {
  return (
    <FormConResultado accion={aceptarMiInvitacion} className="space-y-3 text-left">
      <label className="block space-y-1">
        <span className="text-sm font-medium">CUIT de la empresa</span>
        <input
          name="cuit"
          inputMode="numeric"
          autoComplete="off"
          required
          placeholder="30-12345678-1"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </label>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">La plataforma lo verifica antes de activar la empresa.</p>
      <button type="submit" className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-800">
        Aceptar y ser gerente
      </button>
    </FormConResultado>
  );
}
