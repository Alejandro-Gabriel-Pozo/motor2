import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { prisma } from "@/lib/db";
import { obtenerRecetaVigente, guardarReceta, agregarIngredienteAReceta, actualizarIngredienteDeReceta } from "@/server/actions/recetas";
import { listarUnidadesActivas } from "@/server/actions/unidades";
import { CampoNumero } from "@/components/campo-numero";

export default async function RecetasPage({ searchParams }: { searchParams: Promise<{ id?: string; editar?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "guardar_receta");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { id, editar } = await searchParams;

  const elegibles = await prisma.producto.findMany({
    where: { activo: true, OR: [{ tipo: "PV" }, { tipo: "MP", seProduce: true }] },
    orderBy: { nombre: "asc" },
  });

  const [productoSeleccionado, mpActivas, unidades] = await Promise.all([
    id ? prisma.producto.findUnique({ where: { id } }) : null,
    prisma.producto.findMany({ where: { tipo: "MP", activo: true }, orderBy: { nombre: "asc" } }),
    listarUnidadesActivas(),
  ]);

  const vigente = productoSeleccionado ? await obtenerRecetaVigente(productoSeleccionado.id) : null;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
      <div>
        <h1 className="mb-4 text-xl font-semibold">Recetas</h1>
        {elegibles.length === 0 ? (
          <div className="flex flex-col gap-2 text-sm text-neutral-500">
            <p>Todavía no hay ningún producto que pueda tener receta.</p>
            <p>
              Una receta es para un <strong>Producto de venta (PV)</strong> — lo que vendés — o una{" "}
              <strong>Materia prima marcada &quot;Se produce&quot;</strong> — algo que fabricás vos mismo por lote (ej. una salsa base).
            </p>
            <Link href="/catalogo/productos" className="underline">
              Ir a Productos para crear uno →
            </Link>
          </div>
        ) : (
          <ul className="text-sm">
            {elegibles.map((p) => (
              <li key={p.id} className="border-b py-2">
                <Link href={`/catalogo/recetas?id=${p.id}`} className={p.id === id ? "font-medium underline" : "underline"}>
                  {p.nombre} ({p.tipo})
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {productoSeleccionado && (
        <div className="space-y-6">
          <h2 className="text-lg font-medium">
            {productoSeleccionado.nombre} — versión vigente: {vigente?.version ?? "sin receta todavía"}
          </h2>

          {vigente && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-neutral-500">
                  <th className="py-2">Ingrediente</th>
                  <th>Cantidad</th>
                  <th>Unidad</th>
                  <th>Merma %</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vigente.ingredientes.map((ing) => {
                  const enEdicion = editar === ing.insumoProductoId;
                  return (
                    <tr key={ing.id} className="border-b">
                      {enEdicion ? (
                        <td colSpan={5} className="py-2">
                          <form
                            action={async (formData: FormData) => {
                              "use server";
                              const resultado = await actualizarIngredienteDeReceta(productoSeleccionado.id, ing.insumoProductoId, {
                                cantidad: Number(formData.get("cantidad")),
                                unidadId: String(formData.get("unidadId") ?? ""),
                                mermaPorcentaje: Number(formData.get("mermaPorcentaje") || 0),
                              });
                              // Sale del modo edición al guardar — si no, `editar=` queda pegado en la URL y la fila se muestra siempre editable.
                              if (resultado.ok) redirect(`/catalogo/recetas?id=${productoSeleccionado.id}`);
                            }}
                            className="flex flex-wrap items-end gap-2"
                          >
                            <span className="text-sm font-medium">{ing.insumoProducto.nombre}</span>
                            <CampoNumero name="cantidad" defaultValue={String(Number(ing.cantidad))} required className="w-28" />
                            <select name="unidadId" defaultValue={ing.unidadId} required className="rounded border px-2 py-1.5 text-sm">
                              {unidades.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.nombre}
                                </option>
                              ))}
                            </select>
                            <CampoNumero name="mermaPorcentaje" defaultValue={String(Number(ing.mermaPorcentaje))} placeholder="Merma %" className="w-24" />
                            <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
                              Guardar
                            </button>
                            <Link href={`/catalogo/recetas?id=${productoSeleccionado.id}`} className="text-sm underline">
                              Cancelar
                            </Link>
                          </form>
                        </td>
                      ) : (
                        <>
                          <td className="py-2">{ing.insumoProducto.nombre}</td>
                          <td>{Number(ing.cantidad)}</td>
                          <td>{ing.unidad.nombre}</td>
                          <td>{Number(ing.mermaPorcentaje)}</td>
                          <td className="flex gap-3">
                            <Link href={`/catalogo/recetas?id=${productoSeleccionado.id}&editar=${ing.insumoProductoId}`} className="text-sm underline">
                              Editar
                            </Link>
                            <form
                              action={async () => {
                                "use server";
                                const restantes = vigente.ingredientes
                                  .filter((otro) => otro.id !== ing.id)
                                  .map((otro) => ({
                                    insumoProductoId: otro.insumoProductoId,
                                    cantidad: Number(otro.cantidad),
                                    unidadId: otro.unidadId,
                                    mermaPorcentaje: Number(otro.mermaPorcentaje),
                                    observaciones: otro.observaciones ?? undefined,
                                  }));
                                await guardarReceta(productoSeleccionado.id, restantes);
                              }}
                            >
                              <button type="submit" className="text-sm underline">
                                Quitar
                              </button>
                            </form>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <form
            action={async (formData: FormData) => {
              "use server";
              await agregarIngredienteAReceta(productoSeleccionado.id, {
                insumoProductoId: String(formData.get("insumoProductoId") ?? ""),
                cantidad: Number(formData.get("cantidad")),
                unidadId: String(formData.get("unidadId") ?? ""),
                mermaPorcentaje: Number(formData.get("mermaPorcentaje") || 0),
              });
            }}
            className="flex max-w-lg flex-col gap-2"
          >
            <h3 className="font-medium">Agregar ingrediente (genera la próxima versión)</h3>
            <select name="insumoProductoId" required className="rounded border px-3 py-2">
              <option value="">Materia prima</option>
              {mpActivas.map((mp) => (
                <option key={mp.id} value={mp.id}>
                  {mp.nombre}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <CampoNumero name="cantidad" placeholder="Cantidad" required className="flex-1" />
              <select name="unidadId" required className="flex-1 rounded border px-3 py-2">
                <option value="">Unidad</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
              <CampoNumero name="mermaPorcentaje" placeholder="Merma %" className="w-28" />
            </div>
            <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
              Agregar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
