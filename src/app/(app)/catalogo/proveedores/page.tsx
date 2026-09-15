import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { altaProveedor, actualizarActivaProveedor, listarProveedores } from "@/server/actions/proveedores";

export default async function ProveedoresPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proveedores");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const proveedores = await listarProveedores();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Proveedores</h1>
        <Link href="/catalogo/proveedores/comparativa" className="text-sm underline">
          Comparativa de precios →
        </Link>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Código</th>
            <th>Nombre</th>
            <th>Contacto</th>
            <th>Activo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {proveedores.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="py-2">{p.codigo}</td>
              <td>{p.nombre}</td>
              <td>{p.contacto ?? "—"}</td>
              <td>{p.activo ? "Sí" : "No"}</td>
              <td>
                <form
                  action={async () => {
                    "use server";
                    await actualizarActivaProveedor(p.id, !p.activo);
                  }}
                >
                  <button type="submit" className="text-sm underline">
                    {p.activo ? "Desactivar" : "Activar"}
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
          await altaProveedor({
            nombre: String(formData.get("nombre") ?? ""),
            contacto: String(formData.get("contacto") ?? "") || undefined,
            telefono: String(formData.get("telefono") ?? "") || undefined,
            email: String(formData.get("email") ?? "") || undefined,
            cuit: String(formData.get("cuit") ?? "") || undefined,
          });
        }}
        className="flex max-w-md flex-col gap-2"
      >
        <h2 className="font-medium">Nuevo proveedor</h2>
        <input name="nombre" placeholder="Nombre" required className="rounded border px-3 py-2" />
        <input name="contacto" placeholder="Contacto" className="rounded border px-3 py-2" />
        <input name="telefono" placeholder="Teléfono" className="rounded border px-3 py-2" />
        <input name="email" type="email" placeholder="Email" className="rounded border px-3 py-2" />
        <input name="cuit" placeholder="CUIT" className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Crear
        </button>
      </form>
    </div>
  );
}
