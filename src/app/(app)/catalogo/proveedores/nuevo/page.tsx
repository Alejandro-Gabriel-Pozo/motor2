import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/core/permisos/gate";
import { ProveedorForm } from "../proveedor-form";

/** Alta de un proveedor nuevo. Al guardar, lleva a la ficha del proveedor creado. */
export default async function NuevoProveedorPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedores", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  // Además de Ver, EDITAR: `altaProveedor` exige `proveedor_alta`. Quien solo ve proveedores no recibe el formulario para descubrir recién al guardar que no puede.
  const gateAlta = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedor_alta", ctx.db);
  if (!gateAlta.ok) return <p className="text-red-600">{gateAlta.mensaje}</p>;

  return (
    <div className="max-w-md">
      <Link href="/catalogo/proveedores" className="mb-3 inline-block text-sm underline">
        ← Proveedores
      </Link>
      <ProveedorForm />
    </div>
  );
}
