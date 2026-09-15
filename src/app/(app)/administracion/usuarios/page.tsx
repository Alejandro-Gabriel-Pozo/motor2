import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { prisma } from "@/lib/db";
import { agregarOActualizarUsuario, actualizarActivoMembresia, listarUsuariosDeSucursal } from "@/server/actions/usuarios";
import { listarSucursales } from "@/server/actions/sucursales";

export default async function UsuariosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null; // el layout ya redirige

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "gestion_usuarios");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [membresias, roles, sucursales] = await Promise.all([
    listarUsuariosDeSucursal(ctx.sucursalId),
    prisma.rol.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
    listarSucursales(),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Usuarios — {ctx.sucursalNombre}</h1>

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
          {membresias.map((m) => (
            <tr key={m.id} className="border-b">
              <td className="py-2">{m.usuario.email}</td>
              <td>{m.rol.nombre}</td>
              <td>{m.activo ? "Sí" : "No"}</td>
              <td>
                <form
                  action={async () => {
                    "use server";
                    await actualizarActivoMembresia(m.id, !m.activo);
                  }}
                >
                  <button type="submit" className="text-sm underline">
                    {m.activo ? "Desactivar" : "Activar"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        action={async (formData: FormData) => {
          "use server";
          await agregarOActualizarUsuario({
            email: String(formData.get("email") ?? ""),
            rolId: String(formData.get("rolId") ?? ""),
            sucursalId: String(formData.get("sucursalId") ?? ctx.sucursalId),
          });
        }}
        className="flex max-w-md flex-col gap-2"
      >
        <h2 className="font-medium">Agregar / actualizar usuario</h2>
        <input name="email" type="email" placeholder="email@negocio.com" required className="rounded border px-3 py-2" />
        <label className="flex flex-col gap-1 text-sm text-neutral-500">
          Sucursal
          <select name="sucursalId" defaultValue={ctx.sucursalId} required className="rounded border px-3 py-2 text-neutral-900 dark:text-neutral-100">
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
                {s.id === ctx.sucursalId ? " (donde estás ahora)" : ""}
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
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Guardar
        </button>
      </form>
      <p className="max-w-md text-xs text-neutral-500">
        Para que alguien vea varias sucursales (ej. un súper admin de las 5), agregalo acá una vez por cada sucursal — con la membresía elegirá
        cuál ver desde el selector arriba a la derecha.
      </p>
    </div>
  );
}
