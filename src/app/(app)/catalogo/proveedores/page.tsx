import Link from "next/link";
import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { altaProveedor, actualizarActivaProveedor, actualizarProveedor, listarProveedores } from "@/server/actions/catalogo/proveedores";
import { FormConResultado } from "@/components/form-con-resultado";

export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proveedores");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { editar } = await searchParams;
  const proveedores = await listarProveedores();
  const enEdicion = editar ? proveedores.find((p) => p.id === editar) : undefined;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Proveedores</h1>
        <EnlaceInterno href="/catalogo/proveedores/comparativa" className="text-sm underline">
          Comparativa de precios →
        </EnlaceInterno>
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
              <td className="flex gap-3 py-2">
                <Link href={`/catalogo/proveedores?editar=${p.id}`} className="text-sm underline">
                  Editar
                </Link>
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return actualizarActivaProveedor(p.id, !p.activo);
                  }}
                >
                  <button type="submit" className="text-sm underline">
                    {p.activo ? "Desactivar" : "Activar"}
                  </button>
                </FormConResultado>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* `key`: los dos ramos son el mismo componente en la misma posición, y sus campos usan `defaultValue`;
          sin `key` React reutiliza el formulario al pasar de un proveedor a otro (o al alta) y arrastra lo tipeado
          sin guardar. Mismo patrón que `stock/minimo` y `catalogo/productos`. */}
      {enEdicion ? (
        <FormConResultado
          key={enEdicion.id}
          accion={async (formData: FormData) => {
            "use server";
            return actualizarProveedor(enEdicion.id, {
              contacto: String(formData.get("contacto") ?? "") || undefined,
              telefono: String(formData.get("telefono") ?? "") || undefined,
              email: String(formData.get("email") ?? "") || undefined,
              cuit: String(formData.get("cuit") ?? "") || undefined,
              condicionesPago: String(formData.get("condicionesPago") ?? "") || undefined,
              notas: String(formData.get("notas") ?? "") || undefined,
            });
          }}
          className="flex max-w-md flex-col gap-2"
        >
          <h2 className="font-medium">Editar &quot;{enEdicion.nombre}&quot;</h2>
          <input name="contacto" placeholder="Contacto" defaultValue={enEdicion.contacto ?? ""} className="rounded border px-3 py-2" />
          <input name="telefono" placeholder="Teléfono" defaultValue={enEdicion.telefono ?? ""} className="rounded border px-3 py-2" />
          <input name="email" type="email" placeholder="Email" defaultValue={enEdicion.email ?? ""} className="rounded border px-3 py-2" />
          <input name="cuit" placeholder="CUIT" defaultValue={enEdicion.cuit ?? ""} className="rounded border px-3 py-2" />
          <input
            name="condicionesPago"
            placeholder="Condiciones de pago"
            defaultValue={enEdicion.condicionesPago ?? ""}
            className="rounded border px-3 py-2"
          />
          <textarea name="notas" placeholder="Notas" defaultValue={enEdicion.notas ?? ""} className="rounded border px-3 py-2" />
          <div className="flex gap-3">
            <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
              Guardar
            </button>
            <Link href="/catalogo/proveedores" className="self-center text-sm underline">
              Cancelar
            </Link>
          </div>
        </FormConResultado>
      ) : (
        <FormConResultado
          key="nuevo"
          accion={async (formData: FormData) => {
            "use server";
            return altaProveedor({
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
        </FormConResultado>
      )}
    </div>
  );
}
