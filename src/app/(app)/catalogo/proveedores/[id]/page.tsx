import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa, accionesDelMenuQueElUsuarioPuedeVer, obtenerMiNivelPermisoDeEmpresa } from "@/server/acceso/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { listarProductosQueLeCompran, obtenerFichaProveedor } from "@/server/consultas/catalogo/proveedores";
import { formatearCuit } from "@/core/fiscal/public";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { Aviso } from "@/ui/primitivas/aviso";
import { claseDeBoton } from "@/ui/primitivas/boton";

const plata = (n: number) => `$${n.toLocaleString("es-AR")}`;

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-tinta-tenue">{etiqueta}</dt>
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
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedores", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { id } = await params;
  const { guardado } = unicosDeUrl(await searchParams);
  const p = await obtenerFichaProveedor(id, ctx.db);
  if (!p) notFound();

  const [productosQueLeCompran, puedeVerPrecios, { editar: puedeEditar }] = await Promise.all([
    listarProductosQueLeCompran(id, ctx.db),
    accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, ["comparar_precios"], ctx.db),
    // Ver ≠ escribir (DEC-33): «Editar» solo para quien puede editar proveedores (la página de edición y `actualizarProveedor` lo exigen igual).
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedores", ctx.db),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/catalogo/proveedores" className="mb-3 inline-block text-sm underline">
          ← Proveedores
        </Link>
        {guardado && (
          <Aviso variante="exito" className="mb-3">
            {guardado === "alta" ? "Proveedor creado." : "Cambios guardados."}
          </Aviso>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{p.nombre}</h1>
            <p className="text-sm text-tinta-tenue">
              {p.codigo} · {p.activo ? "Activo" : "Inactivo"}
            </p>
          </div>
          {puedeEditar && (
            <Link href={`/catalogo/proveedores/${p.id}/editar`} className={claseDeBoton()}>
              Editar
            </Link>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium">Datos</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded border p-4 sm:grid-cols-2">
          <Dato etiqueta="Contacto">{p.contacto ?? <span className="text-tinta-tenue">—</span>}</Dato>
          <Dato etiqueta="Teléfono">{p.telefono ?? <span className="text-tinta-tenue">—</span>}</Dato>
          <Dato etiqueta="Email">{p.email ?? <span className="text-tinta-tenue">—</span>}</Dato>
          <Dato etiqueta="CUIT">{p.cuit ? formatearCuit(p.cuit) : <span className="text-tinta-tenue">—</span>}</Dato>
          <Dato etiqueta="Condiciones de pago">{p.condicionesPago ?? <span className="text-tinta-tenue">—</span>}</Dato>
          {p.notas && (
            <div className="sm:col-span-2">
              <Dato etiqueta="Notas">{p.notas}</Dato>
            </div>
          )}
        </dl>
      </section>

      {/* Fase 7, M1 (diseño de Catálogo §9): «cómo lo llama» va PRIMERO y destacado: es lo que el operario lee en la factura; el producto del sistema, al lado. Lo que falta dice «Sin cargar» (se completa con la
          próxima compra), y sin compras la sección dice cómo se llena, en vez de no aparecer. */}
      <section aria-labelledby="titulo-lo-que-se-le-compra">
        <h2 id="titulo-lo-que-se-le-compra" className="mb-1 text-sm font-medium">
          Lo que se le compra
        </h2>
        {productosQueLeCompran.length === 0 ? (
          <p className="text-sm text-tinta-tenue">Todavía no se le compró nada. Lo que se le compra y cómo llama a cada producto en su factura se completan solos con la primera compra.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-tinta-tenue">Cómo llama este proveedor a cada producto en su factura, y a qué producto del sistema corresponde.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-tinta-tenue">
                    <th scope="col" className="py-1 pr-3">
                      Cómo lo llama (en su factura)
                    </th>
                    <th scope="col" className="pr-3">
                      Producto del sistema
                    </th>
                    <th scope="col" className="pr-3">
                      Unidad de compra
                    </th>
                    {puedeVerPrecios.has("comparar_precios") && (
                      <th scope="col" className="text-right">
                        Último precio
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {productosQueLeCompran.map((pp) => (
                    <tr key={`${pp.productoId}-${pp.unidadCompraId}`} className="border-b last:border-0 align-top">
                      <td className="py-1 pr-3 font-medium">
                        {pp.referenciaProveedor ?? <span className="font-normal text-tinta-tenue">Sin cargar (se completa en la próxima compra)</span>}
                      </td>
                      <td className="py-1 pr-3">
                        {pp.producto.nombre} <span className="text-tinta-tenue">({pp.producto.codigo})</span>
                      </td>
                      <td className="py-1 pr-3">{pp.unidadCompraNombre}</td>
                      {puedeVerPrecios.has("comparar_precios") && (
                        <td className="py-1 text-right tabular-nums">{Number(pp.precioPorUnidadStock) > 0 ? plata(Number(pp.precioPorUnidadStock)) : "—"}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

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
