import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { ProveedorForm } from "../proveedor-form";

/** Alta de un proveedor nuevo. Al guardar, lleva a la ficha del proveedor creado. */
export default async function NuevoProveedorPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proveedores", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  return (
    <div className="max-w-md">
      <Link href="/catalogo/proveedores" className="mb-3 inline-block text-sm underline">
        ← Proveedores
      </Link>
      <ProveedorForm />
    </div>
  );
}
