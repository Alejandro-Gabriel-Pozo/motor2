import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVerDeEmpresa } from "@/core/permisos/gate";
import { obtenerProveedorPorId } from "@/server/consultas/catalogo/proveedores";
import { ProveedorForm, type ProveedorExistente } from "../../proveedor-form";

/** Edición de un proveedor. Al guardar, vuelve a su ficha, que muestra el aviso de que se guardó. */
export default async function EditarProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedores", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { id } = await params;
  const p = await obtenerProveedorPorId(id, ctx.db);
  if (!p) notFound();

  const proveedorExistente: ProveedorExistente = {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    contacto: p.contacto ?? undefined,
    telefono: p.telefono ?? undefined,
    email: p.email ?? undefined,
    cuit: p.cuit ?? undefined,
    condicionesPago: p.condicionesPago ?? undefined,
    notas: p.notas ?? undefined,
  };

  return (
    <div className="max-w-md">
      <Link href={`/catalogo/proveedores/${p.id}`} className="mb-3 inline-block text-sm underline">
        ← Volver a la ficha
      </Link>
      <ProveedorForm key={p.id} proveedorExistente={proveedorExistente} />
    </div>
  );
}
