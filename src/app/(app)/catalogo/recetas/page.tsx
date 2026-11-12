import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { CajaDesplazable } from "@/components/catalogo/caja-desplazable";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { listarProductosConReceta } from "@/server/consultas/catalogo/recetas";
import { NuevaReceta } from "./nueva-receta";
import { AvisoSoloLecturaDeCatalogo } from "@/components/catalogo/aviso-solo-lectura";
import { FilaDeCatalogo } from "@/components/fila-de-catalogo";
import { PESTANAS_DE_PRODUCTOS } from "@/core/catalogo/public";

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
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "guardar_receta", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  // P2 (RLS por sucursal): la lista son los productos disponibles en ALGUNA sucursal con receta central: se lee con la base de VERIFICACIÓN (lectura en toda la empresa). Son filas de `Producto` (id, nombre, tipo, versión vigente), nada de otra sucursal.
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(ctx);
  // Ver ≠ escribir (DEC-33, Fase 7): «Nueva receta» abre el editor para guardar: se ofrece solo con el «Editar» de `guardar_receta`.
  const [conReceta, { editar: puedeEditar }] = await Promise.all([
    listarProductosConReceta(verificacion.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "guardar_receta", ctx.db),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Productos · Recetas</h1>
        {puedeEditar && conReceta.length > 0 && <NuevaReceta />}
      </div>
      <FilaDeCatalogo ctx={ctx} etiqueta="Qué mirar de los productos" pestanas={PESTANAS_DE_PRODUCTOS} ruta="/catalogo/recetas" />
      {!puedeEditar && <AvisoSoloLecturaDeCatalogo que="las recetas" />}

      {conReceta.length === 0 ? (
        <div className="flex flex-col gap-2 text-sm text-tinta-tenue">
          <p>Todavía no armaste ninguna receta.</p>
          <p>
            Una receta es para un <strong>producto de venta</strong> —lo que vendés— o para una <strong>materia prima que se produce</strong> —algo que fabricás vos mismo por
            lote, como una salsa base—.
          </p>
          {puedeEditar && <NuevaReceta triggerLabel="Crear la primera →" />}
        </div>
      ) : (
        <CajaDesplazable etiqueta="Tabla de recetas">
          <table className="w-full max-w-2xl text-sm">
            <thead>
              <tr className="border-b text-left text-tinta-tenue">
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
                    <td>{p.tipo === "PV" ? "De venta" : "Materia prima"}</td>
                    <td>v{vigente.version}</td>
                    <td>{vigente._count.ingredientes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CajaDesplazable>
      )}
    </div>
  );
}
