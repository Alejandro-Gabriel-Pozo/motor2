import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { listarPresentaciones } from "@/server/actions/catalogo/productos";
import { leerProductoDelEspacio } from "@/server/consultas/catalogo/espacio-del-producto";
import { obtenerFichaProducto } from "@/server/consultas/catalogo/productos";
import { PRESENTACIONES_VISIBLES } from "@/core/catalogo/public";
import { formatearCantidad } from "@/core/formato-de-numero";
import { cargarMarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/datos-del-marco";
import { MarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/marco";
import { Aviso } from "@/ui/primitivas/aviso";
import { Enlace } from "@/ui/primitivas/enlace";

/**
 * La pestaña «Cómo se compra» de la ficha de una materia prima (docs/diseno-productos-igual-a-pedernal-2026-11-13.md; dueño, 2026-11-13: «Volver a mostrarlas como Pedernal»): las presentaciones de compra del producto,
 * solo para leer. Antes se listaban al pie de Datos. Gestionarlas (agregar, activar, desactivar) sigue donde estaba, en el formulario de Datos, con sus permisos. Quien ve el catálogo (`producto_ver_catalogo`) la ve; solo
 * una materia prima y mientras las presentaciones estén visibles (`PRESENTACIONES_VISIBLES`) tiene esta pestaña.
 */
export default async function CompraDelProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <Aviso variante="error" forma="en-linea">{MENSAJE_DEMASIADAS_LECTURAS}</Aviso>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <Aviso variante="error" forma="en-linea">{gate.mensaje}</Aviso>;

  const { id } = await params;
  const producto = await leerProductoDelEspacio(ctx.db, id);
  if (!producto) notFound();
  if (producto.tipo !== "MP" || producto.esAnclaDeAdicional || !PRESENTACIONES_VISIBLES) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          <Enlace href={`/catalogo/productos/${producto.id}`}>← {producto.nombre}</Enlace>
        </p>
        <Aviso variante="error" forma="en-linea">«{producto.nombre}» no se compra con presentaciones.</Aviso>
      </div>
    );
  }
  const [marco, presentaciones, ficha] = await Promise.all([cargarMarcoDelEspacio(ctx, producto), listarPresentaciones(producto.id), obtenerFichaProducto(producto.id, ctx.db)]);
  if (!ficha) notFound();

  return (
    <MarcoDelEspacio
      producto={{ id: producto.id, nombre: producto.nombre, codigo: producto.codigo, tipo: "MP", modoDeVenta: producto.modoDeVenta, disponibleAca: marco.disponibleAca, sucursalNombre: ctx.sucursalNombre }}
      pasos={marco.pasos}
      actual="compra"
    >
      {presentaciones.length === 0 ? (
        <p className="text-sm text-tinta-suave">Sin presentaciones</p>
      ) : (
        <ul aria-label="Presentaciones de compra" className="rounded border border-borde p-4 text-sm">
          {presentaciones.map((pr) => (
            <li key={pr.id} className={pr.activa ? "" : "text-tinta-suave"}>
              {pr.unidadCompraNombre} — {formatearCantidad(pr.factorConversion)} {ficha.unidadStock.nombre} cada una{pr.activa ? "" : " (inactiva)"}
            </li>
          ))}
        </ul>
      )}
    </MarcoDelEspacio>
  );
}
