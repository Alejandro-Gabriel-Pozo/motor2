"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BotonActivarDesactivar } from "@/components/boton-activar-desactivar";
import { crearRol, actualizarActivoRol } from "@/server/actions/permisos/roles";

interface Rol {
  id: string;
  nombre: string;
  activo: boolean;
}

export function RolesTabla({ rolesIniciales }: { rolesIniciales: Rol[] }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleActivo(r: Rol) {
    setPendingId(r.id);
    startTransition(async () => {
      const resultado = await actualizarActivoRol(r.id, !r.activo);
      setMensaje(resultado.mensaje);
      setPendingId(null);
      if (resultado.ok) router.refresh();
    });
  }

  function crear(formData: FormData) {
    startTransition(async () => {
      const resultado = await crearRol(String(formData.get("nombre") ?? ""));
      setMensaje(resultado.mensaje);
      if (resultado.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Activo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rolesIniciales.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{r.nombre}</td>
              <td>{r.activo ? "Sí" : "No"}</td>
              <td>
                <BotonActivarDesactivar
                  activo={r.activo}
                  ocupado={pending && pendingId === r.id}
                  aviso={`¿Desactivar el rol "${r.nombre}"? Deja de poder asignarse a usuarios nuevos.`}
                  onCambiar={() => toggleActivo(r)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={crear} className="flex max-w-md gap-2">
        <input name="nombre" placeholder="nombre del rol" required className="flex-1 rounded border px-3 py-2" />
        <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
          {pending ? "Creando..." : "Crear"}
        </button>
      </form>

      {mensaje && <p className={mensaje.includes("creado") || mensaje.includes("activado") ? "text-sm text-green-700" : "text-sm text-red-600"}>{mensaje}</p>}
    </div>
  );
}
