import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { prisma } from "@/lib/db";
import { whereDisponibleEnAlguna } from "@/core/catalogo/public-servidor";
import { NuevaReceta } from "./nueva-receta";

/**
 * Lista de recetas YA armadas — antes esta pantalla mezclaba "elegir un
 * producto" con "editarlo" en una sola vista de dos columnas. Grounded
 * contra Dolibarr (`bom_list.php`, lista de BOMs existentes + botón
 * "New") y ERPNext (List View de cualquier doctype): la lista muestra lo
 * que ya existe, "+ Nueva receta" abre un selector para empezar una, y
 * cada fila manda al editor dedicado en `/catalogo/recetas/[productoId]`.
 */
export default async function RecetasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "guardar_receta");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const conReceta = await prisma.producto.findMany({
    where: { ...whereDisponibleEnAlguna(), recetaVersiones: { some: {} } },
    orderBy: { nombre: "asc" },
    include: {
      recetaVersiones: {
        orderBy: { version: "desc" },
        take: 1,
        include: { _count: { select: { ingredientes: true } } },
      },
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Recetas</h1>
        {conReceta.length > 0 && <NuevaReceta />}
      </div>

      {conReceta.length === 0 ? (
        <div className="flex flex-col gap-2 text-sm text-neutral-500">
          <p>Todavía no armaste ninguna receta.</p>
          <p>
            Una receta es para un <strong>Producto de venta (PV)</strong> — lo que vendés — o una{" "}
            <strong>Materia prima marcada &quot;Se produce&quot;</strong> — algo que fabricás vos mismo por lote (ej. una salsa base).
          </p>
          <NuevaReceta triggerLabel="Crear la primera →" />
        </div>
      ) : (
        <table className="w-full max-w-2xl text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Producto</th>
              <th>Tipo</th>
              <th>Versión vigente</th>
              <th>Ingredientes</th>
            </tr>
          </thead>
          <tbody>
            {conReceta.map((p) => {
              const vigente = p.recetaVersiones[0];
              return (
                <tr key={p.id} className="border-b">
                  <td className="py-2">
                    <Link href={`/catalogo/recetas/${p.id}`} className="underline">
                      {p.nombre}
                    </Link>
                  </td>
                  <td>{p.tipo}</td>
                  <td>v{vigente.version}</td>
                  <td>{vigente._count.ingredientes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
