import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { crearSucursalConAdmin, listarSucursales } from "@/server/actions/sucursales";

export default async function SucursalesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "alta_sucursal");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sucursales = await listarSucursales();

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Sucursales</h1>

      <ul className="text-sm">
        {sucursales.map((s) => (
          <li key={s.id} className="border-b py-2">
            {s.nombre} {s.activo ? "" : "(inactiva)"}
          </li>
        ))}
      </ul>

      <form
        action={async (formData: FormData) => {
          "use server";
          await crearSucursalConAdmin({
            nombre: String(formData.get("nombre") ?? ""),
            emailPrimerAdmin: String(formData.get("emailPrimerAdmin") ?? ""),
          });
        }}
        className="flex max-w-md flex-col gap-2"
      >
        <h2 className="font-medium">Nueva sucursal</h2>
        <input name="nombre" placeholder="Nombre de la sucursal" required className="rounded border px-3 py-2" />
        <input
          name="emailPrimerAdmin"
          type="email"
          placeholder="Email del primer admin"
          required
          className="rounded border px-3 py-2"
        />
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Crear
        </button>
      </form>
    </div>
  );
}
