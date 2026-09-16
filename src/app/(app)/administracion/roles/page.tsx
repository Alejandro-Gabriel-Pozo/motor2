import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { crearRol, actualizarActivoRol, listarRoles } from "@/server/actions/roles";
import { FormConResultado } from "@/components/form-con-resultado";

export default async function RolesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "gestion_permisos");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const roles = await listarRoles();

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Roles (catálogo único para todo el negocio)</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Activo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{r.nombre}</td>
              <td>{r.activo ? "Sí" : "No"}</td>
              <td>
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return actualizarActivoRol(r.id, !r.activo);
                  }}
                >
                  <button type="submit" className="text-sm underline">
                    {r.activo ? "Desactivar" : "Activar"}
                  </button>
                </FormConResultado>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="max-w-md space-y-2">
        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            return crearRol(String(formData.get("nombre") ?? ""));
          }}
          className="flex gap-2"
        >
          <input name="nombre" placeholder="nombre del rol" required className="flex-1 rounded border px-3 py-2" />
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Crear
          </button>
        </FormConResultado>
        <p className="text-xs text-neutral-500">
          Un rol recién creado no puede hacer nada todavía (deny-by-default) — anda a{" "}
          <Link href="/administracion/permisos" className="underline">
            Permisos
          </Link>{" "}
          para elegir qué puede ver y editar, antes de asignárselo a alguien.
        </p>
      </div>
    </div>
  );
}
