"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BotonActivarDesactivar } from "@/components/boton-activar-desactivar";
import { crearRol, renombrarRol, actualizarActivoRol } from "@/server/actions/permisos/roles";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";

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
          <tr className="border-b text-left text-tinta-tenue">
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
                    <div className="flex-1">
                      <Campo name="nombre" defaultValue={r.nombre} aria-label={`Nuevo nombre del rol ${r.nombre}`} tamano="compacto" required autoFocus />
                    </div>
                    <Boton type="submit" tamano="compacto" disabled={pending}>
                      {pending && pendingId === r.id ? "Guardando..." : "Guardar"}
                    </Boton>
                    <Boton variante="secundario" tamano="compacto" onClick={() => setRenombrandoId(null)}>
                      Cancelar
                    </Boton>
                  </form>
                ) : (
                  <>
                    {r.nombre}
                    {r.clave !== null && (
                      <span className="ml-2 text-xs text-tinta-tenue" title="Rol de sistema: puede cambiar de nombre, no de función.">
                        (rol de sistema · clave técnica «{r.clave}»)
                      </span>
                    )}
                  </>
                )}
              </td>
              <td>{r.activo ? "Sí" : "No"}</td>
              <td className="space-x-2">
                {puedeRenombrar && renombrandoId !== r.id && (
                  <Boton variante="secundario" tamano="compacto" onClick={() => setRenombrandoId(r.id)} aria-label={`Renombrar el rol ${r.nombre}`}>
                    Renombrar
                  </Boton>
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
        <div className="flex-1">
          <Campo name="nombre" placeholder="nombre del rol" aria-label="Nombre del rol nuevo" required />
        </div>
        <Boton type="submit" disabled={pending}>
          {pending && pendingId === null ? "Creando..." : "Crear"}
        </Boton>
      </form>

      {mensaje && (
        // Un rechazo (nombre reservado, sin permiso…) sigue anunciándose con `role="status"`, como antes: `Aviso` de error es `role="alert"`, y el spec de renombrar espera el estado.
        <Aviso variante={mensaje.ok ? "exito" : "advertencia"} forma="en-linea">
          {mensaje.texto}
        </Aviso>
      )}
    </div>
  );
}
