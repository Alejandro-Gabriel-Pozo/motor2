"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { agregarOActualizarUsuario, actualizarActivoMembresia } from "@/server/actions/auth/usuarios";

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
}

export function UsuariosTabla({
  membresiasIniciales,
  roles,
  sucursales,
  sucursalActualId,
}: {
  membresiasIniciales: Membresia[];
  roles: Rol[];
  sucursales: Sucursal[];
  sucursalActualId: string;
}) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleActivo(m: Membresia) {
    setPendingId(m.id);
    startTransition(async () => {
      const resultado = await actualizarActivoMembresia(m.id, !m.activo);
      setMensaje(resultado.mensaje);
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
      setMensaje(resultado.mensaje);
      if (resultado.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Email</th>
            <th>Rol</th>
            <th>Activo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {membresiasIniciales.map((m) => (
            <tr key={m.id} className="border-b">
              <td className="py-2">{m.usuario.email}</td>
              <td>{m.rol.nombre}</td>
              <td>{m.activo ? "Sí" : "No"}</td>
              <td>
                <button
                  type="button"
                  disabled={pending && pendingId === m.id}
                  onClick={() => toggleActivo(m)}
                  className="text-sm underline disabled:opacity-50"
                >
                  {pending && pendingId === m.id ? "..." : m.activo ? "Desactivar" : "Activar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        action={guardarUsuario}
        className="flex max-w-md flex-col gap-2"
      >
        <h2 className="font-medium">Agregar / actualizar usuario</h2>
        <input name="email" type="email" placeholder="email@negocio.com" required className="rounded border px-3 py-2" />
        <label className="flex flex-col gap-1 text-sm text-neutral-500">
          Sucursal
          <select name="sucursalId" defaultValue={sucursalActualId} required className="rounded border px-3 py-2 text-neutral-900 dark:text-neutral-100">
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
                {s.id === sucursalActualId ? " (donde estás ahora)" : ""}
              </option>
            ))}
          </select>
        </label>
        <select name="rolId" required className="rounded border px-3 py-2">
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
        {mensaje && <p className={mensaje.endsWith("guardado en la sucursal.") || mensaje.startsWith("Usuario ") ? "text-sm text-green-700" : "text-sm text-red-600"}>{mensaje}</p>}
        <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
          {pending ? "Guardando..." : "Guardar"}
        </button>
      </form>
      <p className="max-w-md text-xs text-neutral-500">
        Para que alguien vea varias sucursales (ej. un súper admin de las 5), agregalo acá una vez por cada sucursal — con la membresía elegirá
        cuál ver desde el selector arriba a la derecha.
      </p>
    </div>
  );
}
