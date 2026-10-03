"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BotonActivarDesactivar } from "@/components/boton-activar-desactivar";
import { crearRol, renombrarRol, actualizarActivoRol } from "@/server/actions/permisos/roles";

interface Rol {
  id: string;
  nombre: string;
  /** Clave técnica de un rol de sistema (no cambia al renombrar); `null` en los roles creados a mano. */
  clave: string | null;
  activo: boolean;
}

export function RolesTabla({ rolesIniciales, puedeRenombrar }: { rolesIniciales: Rol[]; puedeRenombrar: boolean }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<{ texto: string; ok: boolean } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [renombrandoId, setRenombrandoId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleActivo(r: Rol) {
    setPendingId(r.id);
    startTransition(async () => {
      const resultado = await actualizarActivoRol(r.id, !r.activo);
      setMensaje({ texto: resultado.mensaje, ok: resultado.ok });
      setPendingId(null);
      if (resultado.ok) router.refresh();
    });
  }

  function crear(formData: FormData) {
    startTransition(async () => {
      const resultado = await crearRol(String(formData.get("nombre") ?? ""));
      setMensaje({ texto: resultado.mensaje, ok: resultado.ok });
      if (resultado.ok) router.refresh();
    });
  }

  function renombrar(r: Rol, formData: FormData) {
    setPendingId(r.id);
    startTransition(async () => {
      const resultado = await renombrarRol(r.id, String(formData.get("nombre") ?? ""));
      setMensaje({ texto: resultado.mensaje, ok: resultado.ok });
      setPendingId(null);
      if (resultado.ok) {
        setRenombrandoId(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Activo</th>
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {rolesIniciales.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">
                {renombrandoId === r.id ? (
                  <form action={(formData) => renombrar(r, formData)} className="flex max-w-md gap-2">
                    <input
                      name="nombre"
                      defaultValue={r.nombre}
                      aria-label={`Nuevo nombre del rol ${r.nombre}`}
                      required
                      autoFocus
                      className="flex-1 rounded border px-3 py-1"
                    />
                    <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50">
                      {pending && pendingId === r.id ? "Guardando..." : "Guardar"}
                    </button>
                    <button type="button" onClick={() => setRenombrandoId(null)} className="rounded border px-3 py-1">
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <>
                    {r.nombre}
                    {r.clave !== null && (
                      <span className="ml-2 text-xs text-neutral-500" title="Rol de sistema: puede cambiar de nombre, no de función.">
                        (rol de sistema · clave técnica «{r.clave}»)
                      </span>
                    )}
                  </>
                )}
              </td>
              <td>{r.activo ? "Sí" : "No"}</td>
              <td className="space-x-2">
                {puedeRenombrar && renombrandoId !== r.id && (
                  <button type="button" onClick={() => setRenombrandoId(r.id)} className="rounded border px-2 py-1" aria-label={`Renombrar el rol ${r.nombre}`}>
                    Renombrar
                  </button>
                )}
                {r.clave === null && (
                  <BotonActivarDesactivar
                    activo={r.activo}
                    ocupado={pending && pendingId === r.id}
                    aviso={`¿Desactivar el rol "${r.nombre}"? Deja de poder asignarse a usuarios nuevos.`}
                    onCambiar={() => toggleActivo(r)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={crear} className="flex max-w-md gap-2">
        <input name="nombre" placeholder="nombre del rol" aria-label="Nombre del rol nuevo" required className="flex-1 rounded border px-3 py-2" />
        <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
          {pending && pendingId === null ? "Creando..." : "Crear"}
        </button>
      </form>

      {mensaje && (
        <p role="status" className={mensaje.ok ? "text-sm text-green-700" : "text-sm text-red-600"}>
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}
