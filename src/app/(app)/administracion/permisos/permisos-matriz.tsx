"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { actualizarPermiso } from "@/server/actions/permisos/permisos";
import type { AccionClave } from "@/core/permisos/acciones";

interface Accion {
  clave: string;
  descripcion: string;
}
interface Rol {
  id: string;
  nombre: string;
}
interface Permiso {
  rolId: string;
  accionClave: string;
  puedeVer: boolean;
  puedeEditar: boolean;
}

export function PermisosMatriz({ acciones, roles, permisosIniciales }: { acciones: Accion[]; roles: Rol[]; permisosIniciales: Permiso[] }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const permisoDe = (rolId: string, accionClave: string) => permisosIniciales.find((p) => p.rolId === rolId && p.accionClave === accionClave);

  function actualizar(rolId: string, accionClave: string, puedeEditar: boolean, puedeVer: boolean) {
    const key = `${rolId}:${accionClave}`;
    setPendingKey(key);
    startTransition(async () => {
      const resultado = await actualizarPermiso(rolId, accionClave as AccionClave, puedeEditar, puedeVer);
      setMensaje(resultado.mensaje);
      setPendingKey(null);
      if (resultado.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2 pr-4">Acción</th>
              {roles.map((r) => (
                <th key={r.id} colSpan={2} className="pr-4 text-center">
                  {r.nombre}
                </th>
              ))}
            </tr>
            <tr className="border-b text-left text-neutral-400 text-xs">
              <th />
              {roles.map((r) => (
                <Fragment key={r.id}>
                  <th>Ver</th>
                  <th>Editar</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {acciones.map((a) => (
              <tr key={a.clave} className="border-b">
                <td className="py-2 pr-4">
                  <div className="font-medium">{a.clave}</div>
                  <div className="text-xs text-neutral-500">{a.descripcion}</div>
                </td>
                {roles.map((r) => {
                  const permiso = permisoDe(r.id, a.clave);
                  const keyVer = `${r.id}:${a.clave}`;
                  const ocupado = pending && pendingKey === keyVer;
                  return (
                    <Fragment key={r.id}>
                      <td>
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => actualizar(r.id, a.clave, permiso?.puedeEditar ?? false, !(permiso?.puedeVer ?? false))}
                          className="disabled:opacity-50"
                        >
                          {ocupado ? "…" : permiso?.puedeVer ? "✅" : "⬜"}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => actualizar(r.id, a.clave, !(permiso?.puedeEditar ?? false), permiso?.puedeVer ?? false)}
                          className="disabled:opacity-50"
                        >
                          {ocupado ? "…" : permiso?.puedeEditar ? "✅" : "⬜"}
                        </button>
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mensaje && <p className={mensaje.includes("actualizados") ? "text-sm text-green-700" : "text-sm text-red-600"}>{mensaje}</p>}
      <p className="text-xs text-neutral-500">
        Tocar &quot;Editar&quot; también prende &quot;Ver&quot; (Ver ⊇ Editar). &quot;gestion_permisos&quot;/&quot;gestion_usuarios&quot; siempre conservan Editar=✅ para admin.
      </p>
    </div>
  );
}
