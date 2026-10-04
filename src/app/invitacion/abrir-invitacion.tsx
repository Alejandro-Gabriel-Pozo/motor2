"use client";

import { useEffect, useState } from "react";
import { tokenDelFragmento } from "@/core/features/empresa/invitacion";
import { abrirInvitacion } from "@/server/actions/auth/invitacion";

/**
 * Lee el token del fragmento del enlace (`#t=...`), que el navegador no manda al servidor, y se lo pasa a `abrirInvitacion`, que lo guarda en una cookie y
 * recarga la página. Sin token válido en el fragmento no hay nada que abrir.
 */
export function AbrirInvitacion() {
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    const token = tokenDelFragmento(window.location.hash);
    // Sale del fragmento antes de pedir: así el token no queda en el historial ni a la vista. Sin token válido la acción responde con el mismo mensaje de «enlace no válido».
    window.history.replaceState(null, "", window.location.pathname);
    void abrirInvitacion(token ?? "").then((r) => {
      if (r && !r.ok) setMensaje(r.mensaje);
    });
  }, []);

  return (
    <p role="status" className="text-sm text-neutral-500 dark:text-neutral-400">
      {mensaje ?? "Abriendo tu invitación…"}
    </p>
  );
}
