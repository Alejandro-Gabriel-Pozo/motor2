import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { leerProductoDelEspacio } from "@/server/consultas/catalogo/espacio-del-producto";
import { cargarOpcionesDelProducto } from "@/server/consultas/catalogo/opciones-de-venta";
import { formatearMonto } from "@/core/pos/public";
import { EnlaceInterno } from "@/components/enlace-interno";
import { ResumenDeOpciones } from "@/components/catalogo/resumen-de-opciones";
import { cargarMarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/datos-del-marco";
import { MarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/marco";
import { PrecioDeLaSucursal } from "@/components/catalogo/espacio-del-producto/precio-de-la-sucursal";
import { Aviso } from "@/ui/primitivas/aviso";
import { Enlace } from "@/ui/primitivas/enlace";

/**
 * La pestaña «Precios» de la ficha del producto (docs/diseno-productos-igual-a-pedernal-2026-11-13.md, D8; dueño, 2026-11-13: ficha de tres pestañas, «Sí, así provisorio»): el precio del producto en la sucursal
 * activa y «Así se cobra». Antes estaba arriba del paso «Opciones y precio»; es el MISMO componente y el MISMO comando (`PrecioDeLaSucursal` → `setPrecioLocalProducto`, clave `precio_local`, valor visto como control
 * de concurrencia): acá no hay lógica de dinero nueva, solo otra pantalla.
 *
 * Quien ve el catálogo (`producto_ver_catalogo`) ve el precio y «Así se cobra»; el campo para cambiarlo se dibuja solo con «Editar» de `precio_local` en la sucursal activa y para un producto que se cobra al precio propio
 * (uno que se vende por opción tiene el precio en cada opción y no lleva campo); la acción vuelve a exigir el permiso. Un producto que no es de venta (o el interno de un adicional) no tiene precios.
 */
export default async function PreciosDelProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <Aviso variante="error" forma="en-linea">{MENSAJE_DEMASIADAS_LECTURAS}</Aviso>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <Aviso variante="error" forma="en-linea">{gate.mensaje}</Aviso>;

  const { id } = await params;
  const [datos, productoDelEspacio] = await Promise.all([cargarOpcionesDelProducto(ctx.db, id, ctx.sucursalId), leerProductoDelEspacio(ctx.db, id)]);
  if (!datos || !productoDelEspacio) notFound();
  const { producto } = datos;
  const productoId = producto.id;
  if (producto.tipo !== "PV" || producto.esAnclaDeAdicional) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          <Enlace href={`/catalogo/productos/${productoId}`}>← {producto.nombre}</Enlace>
        </p>
        <Aviso variante="error" forma="en-linea">
          {producto.esAnclaDeAdicional ? `«${producto.nombre}» es el producto interno de un adicional: no tiene precios propios.` : `«${producto.nombre}» no es un producto de venta: solo un producto de venta tiene precios.`}
        </Aviso>
      </div>
    );
  }
  const [marco, puedeEditarElPrecio] = await Promise.all([
    cargarMarcoDelEspacio(ctx, productoDelEspacio, { opciones: datos }),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "precio_local", ctx.db).then((nivel) => nivel.editar),
  ]);

  return (
    <MarcoDelEspacio
      producto={{ id: productoId, nombre: producto.nombre, codigo: productoDelEspacio.codigo, tipo: "PV", modoDeVenta: productoDelEspacio.modoDeVenta, disponibleAca: marco.disponibleAca, sucursalNombre: ctx.sucursalNombre }}
      pasos={marco.pasos}
      actual="precios"
      ancho="ancho"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-tinta-suave" data-precio-de-la-sucursal="">
          {producto.esBase
            ? `Se vende por opción: el precio guardado (${formatearMonto(datos.precioBase)}) no se cobra, rige el precio final de cada opción.`
            : `Precio de lista en «${ctx.sucursalNombre}»: ${formatearMonto(datos.precioBase)}.`}{" "}
          {puedeEditarElPrecio && !producto.esBase ? "Las otras sucursales se comparan y se cambian en " : "El precio de cada sucursal se cambia en "}
          <EnlaceInterno href="/movimientos/precio-local" className="underline">
            Precio local
          </EnlaceInterno>
          .
        </p>

        {puedeEditarElPrecio && !producto.esBase ? (
          <PrecioDeLaSucursal
            productoId={productoId}
            sucursalId={ctx.sucursalId}
            sucursalNombre={ctx.sucursalNombre}
            precioVigente={datos.precioBase}
            precioGlobal={datos.precioGlobal}
            guardado={datos.precioLocal.guardado}
            capacidadActiva={datos.precioLocal.capacidadActiva}
          />
        ) : null}

        <section aria-labelledby="titulo-asi-se-cobra" className="flex flex-col gap-2 rounded border border-borde p-4">
          <h2 id="titulo-asi-se-cobra" className="text-sm font-medium">
            Así se cobra
          </h2>
          <ResumenDeOpciones resumen={datos.vistaPrevia} sucursalNombre={ctx.sucursalNombre} />
        </section>
      </div>
    </MarcoDelEspacio>
  );
}
