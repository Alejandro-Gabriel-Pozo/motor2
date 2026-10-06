import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVerDeEmpresa, accionesDelMenuQueElUsuarioPuedeVer } from "@/core/permisos/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { listarProductosQueLeCompran, obtenerFichaProveedor } from "@/server/consultas/catalogo/proveedores";
import { formatearCuit } from "@/core/fiscal/cuit";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

const plata = (n: number) => `$${n.toLocaleString("es-AR")}`;

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-neutral-500">{etiqueta}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Ficha de un proveedor: solo lectura, mismo patrón que la de Productos
 * (F1/F2, docs/grounding-lista-ver-editar-2026-09-18.md). "Desactivar" y su
 * confirmación quedan en la lista por ahora — moverlos acá es un
 * seguimiento, no parte de F4.
 */
export default async function FichaProveedorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosDeUrl<"guardado">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedores", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { id } = await params;
  const { guardado } = unicosDeUrl(await searchParams);
  const p = await obtenerFichaProveedor(id, ctx.db);
  if (!p) notFound();

  const [productosQueLeCompran, puedeVerPrecios] = await Promise.all([
    listarProductosQueLeCompran(id, ctx.db),
    accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, ["comparar_precios"], ctx.db),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/catalogo/proveedores" className="mb-3 inline-block text-sm underline">
          ← Proveedores
        </Link>
        {guardado && (
          <p role="status" className="mb-3 rounded border border-green-700 px-3 py-2 text-sm text-green-700">
            {guardado === "alta" ? "Proveedor creado." : "Cambios guardados."}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{p.nombre}</h1>
            <p className="text-sm text-neutral-500">
              {p.codigo} · {p.activo ? "Activo" : "Inactivo"}
            </p>
          </div>
          <Link href={`/catalogo/proveedores/${p.id}/editar`} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
            Editar
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium">Datos</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded border p-4 sm:grid-cols-2">
          <Dato etiqueta="Contacto">{p.contacto ?? <span className="text-neutral-500 dark:text-neutral-400">—</span>}</Dato>
          <Dato etiqueta="Teléfono">{p.telefono ?? <span className="text-neutral-500 dark:text-neutral-400">—</span>}</Dato>
          <Dato etiqueta="Email">{p.email ?? <span className="text-neutral-500 dark:text-neutral-400">—</span>}</Dato>
          <Dato etiqueta="CUIT">{p.cuit ? formatearCuit(p.cuit) : <span className="text-neutral-500 dark:text-neutral-400">—</span>}</Dato>
          <Dato etiqueta="Condiciones de pago">{p.condicionesPago ?? <span className="text-neutral-500 dark:text-neutral-400">—</span>}</Dato>
          {p.notas && (
            <div className="sm:col-span-2">
              <Dato etiqueta="Notas">{p.notas}</Dato>
            </div>
          )}
        </dl>
      </section>

      {productosQueLeCompran.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Lo que se le compra</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-1">Producto</th>
                <th>Unidad de compra</th>
                <th>Cómo lo llama</th>
                {puedeVerPrecios.has("comparar_precios") && <th className="text-right">Último precio</th>}
              </tr>
            </thead>
            <tbody>
              {productosQueLeCompran.map((pp) => (
                <tr key={pp.id} className="border-b last:border-0">
                  <td className="py-1">
                    {pp.producto.codigo} — {pp.producto.nombre}
                  </td>
                  <td>{pp.unidadCompra.nombre}</td>
                  <td>{pp.referenciaProveedor ?? <span className="text-neutral-500 dark:text-neutral-400">—</span>}</td>
                  {puedeVerPrecios.has("comparar_precios") && (
                    <td className="text-right tabular-nums">{Number(pp.precioPorUnidadStock) > 0 ? plata(Number(pp.precioPorUnidadStock)) : "—"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {p.productosConsignados.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Productos en consignación</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {p.productosConsignados.map((prod) => (
              <li key={prod.id}>
                <EnlaceInterno href={`/catalogo/productos/${prod.id}`} className="underline">
                  {prod.nombre}
                </EnlaceInterno>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Ver en los reportes</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <EnlaceInterno href="/catalogo/proveedores/comparativa" className="underline">
              Comparativa de precios por proveedor
            </EnlaceInterno>
          </li>
          <li>
            <EnlaceInterno href={`/reportes/compras?proveedorId=${p.id}`} className="underline">
              Compras registradas de este proveedor
            </EnlaceInterno>
          </li>
          {p.productosConsignados.length > 0 && (
            <li>
              <EnlaceInterno href="/reportes/consignacion" className="underline">
                Consignación
              </EnlaceInterno>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
