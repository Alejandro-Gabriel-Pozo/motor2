import Link from "next/link";
import { redirect } from "next/navigation";
import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { actualizarActivaProveedor, listarProveedores } from "@/server/actions/catalogo/proveedores";
import { FormConResultado } from "@/components/form-con-resultado";
import { IconoDeAccion } from "@/components/iconos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

/**
 * Lista de proveedores. Ya no comparte pantalla con el formulario: el alta
 * está en `/nuevo`, la ficha (solo lectura) en `/[id]` y la edición en
 * `/[id]/editar` — mismo patrón F1/F2 de Productos
 * (docs/grounding-lista-ver-editar-2026-09-18.md, F4).
 */
export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"editar">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedores", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { editar } = unicosDeUrl(await searchParams);
  // Los enlaces y favoritos viejos apuntaban a `/catalogo/proveedores?editar=…` (la edición estaba en esta misma pantalla).
  if (editar) redirect(`/catalogo/proveedores/${encodeURIComponent(editar)}/editar`);

  // `/nuevo` exige `proveedor_alta`: quien solo ve proveedores no recibe el botón para descubrirlo recién al entrar.
  const { editar: puedeDarDeAlta } = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedor_alta", ctx.db);
  const proveedores = await listarProveedores();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Proveedores</h1>
        <div className="flex items-center gap-4">
          <EnlaceInterno href="/catalogo/proveedores/comparativa" className="text-sm underline">
            Comparativa de precios →
          </EnlaceInterno>
          {puedeDarDeAlta && (
            <Link href="/catalogo/proveedores/nuevo" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
              + Nuevo proveedor
            </Link>
          )}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Código</th>
            <th>Nombre</th>
            <th>Contacto</th>
            <th>Activo</th>
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {proveedores.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="py-2">{p.codigo}</td>
              <td>
                <Link href={`/catalogo/proveedores/${p.id}`} className="underline">
                  {p.nombre}
                </Link>
              </td>
              <td>{p.contacto ?? "—"}</td>
              <td>{p.activo ? "Sí" : "No"}</td>
              <td className="py-2">
                <div className="flex gap-3">
                  <Link href={`/catalogo/proveedores/${p.id}/editar`} className="text-sm underline inline-flex items-center gap-1">
                    <IconoDeAccion id="editar" />
                    Editar
                  </Link>
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return actualizarActivaProveedor(p.id, !p.activo);
                    }}
                  >
                    <button type="submit" className="text-sm underline inline-flex items-center gap-1">
                      <IconoDeAccion id="activar" />
                      {p.activo ? "Desactivar" : "Activar"}
                    </button>
                  </FormConResultado>
                </div>
              </td>
            </tr>
          ))}
          {!proveedores.length && (
            <tr>
              <td className="py-2 text-neutral-500" colSpan={5}>
                Sin proveedores.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
