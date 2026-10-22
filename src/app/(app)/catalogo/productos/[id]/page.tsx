import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, obtenerMiNivelPermisoEnAlgunaSucursal, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { ActivarDesactivarFila } from "@/components/activar-desactivar-fila";
import { actualizarDisponibilidadProducto, listarPresentaciones } from "@/server/actions/catalogo/productos";
import { disponibilidadPorSucursalDeProducto } from "@/server/consultas/catalogo/disponibilidad";
import { obtenerFichaProducto, obtenerSeccionHabitualEnSucursal } from "@/server/consultas/catalogo/productos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { cargarOpcionesDelProducto } from "@/server/consultas/catalogo/opciones-de-venta";
import type { ProductoDelEspacio } from "@/server/consultas/catalogo/espacio-del-producto";
import { ResumenDeOpciones } from "@/components/catalogo/resumen-de-opciones";
import { cargarMarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/datos-del-marco";
import { MarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/marco";
import { TablaDeDatos } from "@/ui/componentes/datos/tabla-de-datos";
import { Aviso } from "@/ui/primitivas/aviso";
import { claseDeBoton } from "@/ui/primitivas/boton";

const plata = (n: number) => `$${n.toLocaleString("es-AR")}`;

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-tinta-suave">{etiqueta}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

const SinValor = ({ children }: { children: React.ReactNode }) => <span className="text-tinta-suave">{children}</span>;

/**
 * La PORTADA del producto en el espacio del producto (Fase 6, 6.12; DEC-12): el resumen de un producto, de cualquier tipo, dentro del marco con su tira de pasos. Es de solo lectura: reúne sus datos y lleva a
 * los reportes que ya existen; los formularios están en cada paso (Qué se vende o Datos, Opciones y precio, Receta y En la carta), a los que se llega por las pestañas del marco. Al guardar un alta o una
 * edición se vuelve acá, con el aviso de que se guardó.
 *
 * Los pasos dependen del tipo (`pasosDelEspacio`): un producto de venta tiene los cuatro; una materia prima, Datos y —si se produce— Receta. El producto interno que respalda un adicional NO se maneja con el
 * espacio de venta: se muestra como siempre, sin marco, con su botón «Editar». Stock, precios por sucursal, proveedores y auditoría quedan para una fase siguiente (F3 de docs/grounding-lista-ver-editar-2026-09-18.md).
 */
export default async function FichaProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosDeUrl<"guardado">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <Aviso variante="error" forma="en-linea">{MENSAJE_DEMASIADAS_LECTURAS}</Aviso>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <Aviso variante="error" forma="en-linea">{gate.mensaje}</Aviso>;
  // Cortesía de la interfaz, no barrera: el servidor sigue exigiendo `producto_editar` en la ruta /datos y en la acción. Es un permiso de EDITAR, así que no
  // sirve el contexto de EnlaceInterno (solo lleva el nivel Ver de cada pantalla). Lo usa el botón «Editar» del producto de respaldo (sin marco); en el marco, el enlace es el paso 1.
  const { editar: puedeEditarProducto } = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_editar", ctx.db);
  const { editar: puedeCambiarDisponibilidad } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "producto_disponibilidad", ctx.db);
  // S-12 (D8 del dueño): el costo de consignación (lo que se le paga al proveedor por unidad vendida, y quién es) es de quien tiene `pagar_consignante` en alguna de sus sucursales de la empresa (P20, D23: «Ver incluye Editar», y la edición se evalúa igual) — la
  // pantalla donde ese precio se vuelve deuda. Acá no se esconde: la consulta ni lo devuelve sin esta bandera (deniega por defecto).
  const { ver: puedeVerCostoDeConsignacion } = await obtenerMiNivelPermisoEnAlgunaSucursal(ctx, "pagar_consignante");

  const { id } = await params;
  const { guardado } = unicosDeUrl(await searchParams);
  const p = await obtenerFichaProducto(id, ctx.db, { conCostoDeConsignacion: puedeVerCostoDeConsignacion });
  if (!p) notFound();

  // Primitivos para el closure "use server" de abajo: lo que captura viaja al cliente y `p` lleva Decimales de Prisma (ver precio-local).
  const productoId = p.id;

  const [presentaciones, disponibilidadPorSucursal, seccionHabitual, opcionesDeVenta, nivelOpciones] = await Promise.all([
    p.tipo === "MP" ? listarPresentaciones(p.id) : Promise.resolve([]),
    disponibilidadPorSucursalDeProducto(p.id, ctx.db),
    // Solo lectura (se configura en Stock › Sección habitual): la de ESTA sucursal, y solo si apunta a una sección activa de acá — la misma regla
    // con la que la usa el cierre de cuenta del salón (docs/plan-seccion-habitual-stock-2026-09-25.md).
    p.tipo === "PV" ? obtenerSeccionHabitualEnSucursal(ctx.sucursalId, p.id, ctx.db) : Promise.resolve(null),
    // GO-2d: las opciones de venta del producto, con los precios que calcula el servidor para la sucursal activa (solo leer). El enlace a editarlas, solo con «Editar» de
    // `producto_opciones_admitidas` (cortesía: esa pantalla exige el permiso por su cuenta).
    p.tipo === "PV" ? cargarOpcionesDelProducto(ctx.db, p.id, ctx.sucursalId) : Promise.resolve(null),
    p.tipo === "PV" ? obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_opciones_admitidas", ctx.db) : Promise.resolve({ ver: false, editar: false }),
  ]);
  const disponibleAca = disponibilidadPorSucursal.find((d) => d.sucursalId === ctx.sucursalId)?.disponible ?? false;
  const esDeRespaldo = opcionesDeVenta?.producto.esAnclaDeAdicional ?? false;

  const productoDelEspacio: ProductoDelEspacio = {
    id: p.id,
    nombre: p.nombre,
    codigo: p.codigo,
    tipo: p.tipo,
    modoDeVenta: p.modoDeVenta === "BASE_CONFIGURABLE" ? "BASE_CONFIGURABLE" : "DIRECTO",
    precioVenta: Number(p.precioVenta),
    seProduce: p.seProduce,
    esAnclaDeAdicional: esDeRespaldo,
  };
  // El marco (los pasos con su enlace y su estado) solo para lo que se maneja con el espacio; el producto de respaldo se muestra como siempre. Las opciones y la disponibilidad ya están leídas: no se vuelven a leer.
  const marco = esDeRespaldo ? null : await cargarMarcoDelEspacio(ctx, productoDelEspacio, { opciones: p.tipo === "PV" ? opcionesDeVenta : undefined, disponibleAca });
  const pendientes = marco?.pasos.filter((paso) => paso.estado.tipo === "pendiente") ?? [];

  const cuerpo = (
    <>
      {guardado && <Aviso variante="exito">{guardado === "alta" ? "Producto creado." : "Cambios guardados."}</Aviso>}

      {pendientes.length > 0 && (
        <section aria-labelledby="titulo-pendientes">
          <h2 id="titulo-pendientes" className="mb-2 text-sm font-medium">
            Qué falta
          </h2>
          <ul className="flex flex-col gap-1 rounded border border-aviso bg-aviso-tinte px-4 py-3 text-sm text-aviso-tinta">
            {pendientes.map((paso) => (
              <li key={paso.paso}>
                <span className="font-medium">{paso.titulo}:</span> {paso.estado.tipo === "pendiente" ? paso.estado.texto : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Datos</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded border border-borde p-4 sm:grid-cols-2">
          <Dato etiqueta="Categoría">{p.categoria?.nombre ?? <SinValor>Sin categoría</SinValor>}</Dato>
          {p.tipo === "MP" && (
            <Dato etiqueta="Insumo (grupo)">
              {p.insumo ? (
                <>
                  {p.insumo.nombre}
                  {p.insumo.grupo ? <SinValor> ({p.insumo.grupo.nombre})</SinValor> : <SinValor> (sin grupo)</SinValor>}
                </>
              ) : (
                <SinValor>Sin insumo asignado</SinValor>
              )}
            </Dato>
          )}
          <Dato etiqueta="Unidad de stock">{p.unidadStock.nombre}</Dato>
          <Dato etiqueta="Unidad de compra">{p.unidadCompra?.nombre ?? <SinValor>—</SinValor>}</Dato>
          <Dato etiqueta="Factor de conversión">
            {Number(p.factorConversion).toLocaleString("es-AR")} {p.unidadStock.nombre} por {p.unidadCompra?.nombre ?? "unidad de compra"}
          </Dato>
          {/* Fase 4 (ADR-035): de una base no se cobra el precio guardado: la ficha dice cómo se vende y lo muestra como guardado. */}
          {p.tipo === "PV" &&
            (p.modoDeVenta === "BASE_CONFIGURABLE" ? (
              <Dato etiqueta="Cómo se vende">
                <span data-se-vende-por-opcion="">Se vende por opción</span> · precio guardado {plata(Number(p.precioVenta))} (no se cobra: el precio final está en cada opción)
              </Dato>
            ) : (
              <Dato etiqueta="Precio de venta">{plata(Number(p.precioVenta))}</Dato>
            ))}
          {p.tipo === "PV" && (
            <Dato etiqueta="Venta fraccionada">
              {p.pasoVenta !== null ? `Se vende de a ${Number(p.pasoVenta).toLocaleString("es-AR")}` : <SinValor>No — se vende de a una unidad entera</SinValor>}
            </Dato>
          )}
          {p.tipo === "PV" && (
            <Dato etiqueta={`Sección habitual en «${ctx.sucursalNombre}»`}>
              {seccionHabitual ? seccionHabitual.seccion.nombre : <SinValor>Sin sección habitual (sale de donde haya stock)</SinValor>}
            </Dato>
          )}
          <Dato etiqueta="Se produce (tiene receta propia)">{p.seProduce ? "Sí" : "No"}</Dato>
          <Dato etiqueta="Consignación">
            {p.esConsignacion ? (
              <>
                Sí{p.proveedorConsignacion ? ` — ${p.proveedorConsignacion.nombre}` : ""}
                {p.precioConsignacion && Number(p.precioConsignacion) > 0 ? ` · ${plata(Number(p.precioConsignacion))} por unidad vendida` : ""}
              </>
            ) : (
              "No"
            )}
          </Dato>
          {p.observaciones && (
            <div className="sm:col-span-2">
              <Dato etiqueta="Observaciones">{p.observaciones}</Dato>
            </div>
          )}
        </dl>
      </section>

      {opcionesDeVenta && !esDeRespaldo && (
        <section aria-labelledby="titulo-opciones-de-venta">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="titulo-opciones-de-venta" className="text-sm font-medium">
              Opciones de venta
            </h2>
            {nivelOpciones.editar && (
              <Link href={`/catalogo/productos/${p.id}/opciones`} className="text-sm underline">
                Editar opciones
              </Link>
            )}
          </div>
          <div className="rounded border border-borde p-4">
            <ResumenDeOpciones resumen={opcionesDeVenta.vistaPrevia} sucursalNombre={ctx.sucursalNombre} />
          </div>
        </section>
      )}
      {esDeRespaldo && <p className="text-sm text-tinta-suave">Este es el producto interno que respalda el stock de un adicional: lo maneja el sistema y se vende solo como adicional.</p>}

      <section>
        <h2 className="mb-2 text-sm font-medium">Disponibilidad por sucursal</h2>
        <TablaDeDatos
          titulo="Disponibilidad por sucursal"
          presentacionCelular="tabla-con-scroll"
          filas={disponibilidadPorSucursal}
          claveDeFila={(d) => d.sucursalId}
          vacio="El producto no está disponible en ninguna sucursal."
          columnas={[
            { id: "sucursal", encabezado: "Sucursal", titulo: true, celda: (d) => d.sucursalNombre },
            { id: "disponible", encabezado: "Disponible", celda: (d) => (d.disponible ? "Sí" : "No") },
            {
              id: "acciones",
              encabezado: "Acciones",
              celda: (d) =>
                // Solo la sucursal ACTIVA tiene botón — actualizarDisponibilidadProducto evalúa el gate contra ctx.sucursalId, nunca contra un id que viaje del cliente.
                puedeCambiarDisponibilidad && d.sucursalId === ctx.sucursalId ? (
                  <ActivarDesactivarFila
                    activo={d.disponible}
                    aviso="Desactivar lo saca de los selectores, del stock consolidado y de la valuación de esta sucursal; en las demás no cambia nada. El historial se conserva. Si algo todavía depende de él acá (recetas vigentes, saldo), no se deja desactivar."
                    accion={async () => {
                      "use server";
                      return actualizarDisponibilidadProducto(productoId, !d.disponible);
                    }}
                  />
                ) : null,
            },
          ]}
        />
      </section>

      {presentaciones.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Presentaciones de compra</h2>
          <ul className="rounded border border-borde p-4 text-sm">
            {presentaciones.map((pr) => (
              <li key={pr.id} className={pr.activa ? "" : "text-tinta-suave"}>
                {pr.unidadCompraNombre} — {pr.factorConversion.toLocaleString("es-AR")} {p.unidadStock.nombre} cada una{pr.activa ? "" : " (inactiva)"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Ver en los reportes</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <EnlaceInterno href={`/reportes/historial?productoId=${p.id}`} className="underline">
              Historial de movimientos y saldo
            </EnlaceInterno>
          </li>
          {p.tipo === "PV" && (
            <li>
              <EnlaceInterno href="/reportes/costos" className="underline">
                Costo y margen (Costos y márgenes)
              </EnlaceInterno>
            </li>
          )}
          {/* La receta es un paso del espacio (una pestaña del marco). El producto de respaldo no tiene marco y conserva su enlace de siempre. */}
          {esDeRespaldo && (
            <li>
              <EnlaceInterno href={`/catalogo/recetas/${p.id}`} className="underline">
                Receta
              </EnlaceInterno>
            </li>
          )}
          {p.tipo === "MP" && (
            <li>
              <EnlaceInterno href="/catalogo/proveedores/comparativa" className="underline">
                Comparativa de precios por proveedor
              </EnlaceInterno>
            </li>
          )}
        </ul>
      </section>
    </>
  );

  if (marco) {
    return (
      <MarcoDelEspacio
        producto={{ id: p.id, nombre: p.nombre, codigo: p.codigo, tipo: p.tipo, modoDeVenta: productoDelEspacio.modoDeVenta, disponibleAca, sucursalNombre: ctx.sucursalNombre }}
        pasos={marco.pasos}
        actual="portada"
      >
        {cuerpo}
      </MarcoDelEspacio>
    );
  }

  // El producto de respaldo de un adicional: sin marco ni pasos de venta, como siempre.
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/catalogo/productos" className="mb-3 inline-block text-sm underline">
          ← Productos
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{p.nombre}</h1>
            <p className="text-sm text-tinta-suave">
              {p.codigo} · Producto de venta (PV) · {disponibleAca ? `Disponible en «${ctx.sucursalNombre}»` : `No disponible en «${ctx.sucursalNombre}»`}
            </p>
          </div>
          {puedeEditarProducto && (
            <div className="flex items-start gap-4">
              <Link href={`/catalogo/productos/${p.id}/datos`} className={claseDeBoton()}>
                Editar
              </Link>
            </div>
          )}
        </div>
      </div>
      {cuerpo}
    </div>
  );
}
