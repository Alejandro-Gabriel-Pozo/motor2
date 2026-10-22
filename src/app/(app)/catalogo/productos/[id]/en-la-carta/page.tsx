import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import { leerProductoDelEspacio } from "@/server/consultas/catalogo/espacio-del-producto";
import { basesDeUnEjeEnLaCarta, cargarAdminCarta } from "@/server/consultas/carta/admin";
import { cargarMarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/datos-del-marco";
import { MarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/marco";
import { ContenidoDelProducto, type UbicacionEnCarta } from "@/components/carta/contenido-del-producto";
import { AvisoSoloLectura } from "@/components/carta/datos-solo-lectura";
import { EnlaceInterno } from "@/components/enlace-interno";
import { Aviso } from "@/ui/primitivas/aviso";

/**
 * Paso 4 del espacio del producto, «En la carta» (Fase 6, 6.17c; DEC-12): publicar el producto en la carta de la sucursal SIN salir del espacio. Es la ficha de carta del producto de siempre (`ContenidoDelProducto`,
 * la misma de Parametrización › Secciones, con las mismas Server Actions y los mismos permisos): «Se muestra en la carta», sección y orden, ★, género, descripción, tags, el descuento de la sucursal y «Quitar de la carta».
 *
 * Es una página de VER, no de editar: entrar pide «Ver» de `carta_ver` (la sucursal activa; `accionDeRuta` la declara como ruta hija con acción propia, así `EnlaceInterno` no miente) y cada formulario se dibuja solo con
 * el «Editar» de su clave (`carta_contenido_producto`, `carta_producto_descuento`), igual que en Secciones; quien solo ve, ve el contenido como texto. NO pide `producto_ver_catalogo`: quien administra la carta sin ver el
 * catálogo entra igual, y el marco no le da lo que es del catálogo (`fichaVisible`). Todo lo que se escribe lo decide la acción con `ctx.sucursalId`, nunca un parámetro de la ruta. Sin el módulo Carta no hay paso:
 * el gate lo rechaza y el marco no lo ofrece.
 *
 * Un producto que no es de venta, el interno de un adicional o uno que no está disponible en esta sucursal no tienen ficha de carta: la pantalla lo dice (la carta solo lista lo que se vende acá).
 */
export default async function EnLaCartaDelProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <Aviso variante="error" forma="en-linea">{MENSAJE_DEMASIADAS_LECTURAS}</Aviso>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <Aviso variante="error" forma="en-linea">{gate.mensaje}</Aviso>;

  const { id } = await params;
  const producto = await leerProductoDelEspacio(ctx.db, id);
  if (!producto) notFound();

  const [nivelContenido, nivelDescuento, nivelFicha, marco] = await Promise.all([
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_contenido_producto", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_producto_descuento", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db),
    cargarMarcoDelEspacio(ctx, producto),
  ]);
  const puedeEditarContenido = nivelContenido.editar;
  const puedeDescuento = nivelDescuento.editar;
  const esDeVenta = producto.tipo === "PV" && !producto.esAnclaDeAdicional;

  // La hora se fija acá, en el borde (O.22-c). Se lee UN producto (6.17b): la misma fila que trae el lote completo.
  const [datos, basesDeUnEje] = esDeVenta
    ? await Promise.all([cargarAdminCarta(ctx.sucursalId, ctx.db, new Date(), { soloProductoId: producto.id }), basesDeUnEjeEnLaCarta(ctx.sucursalId, ctx.db)])
    : [null, null];
  const admin = datos?.productos[0] ?? null;
  const ubicacion: UbicacionEnCarta | null = datos && {
    secciones: datos.secciones.map((x) => ({ id: x.id, nombre: x.nombre, activa: x.activa })),
    cantidadPorSeccion: Object.fromEntries(datos.secciones.map((x) => [x.id, x.cantidadItems])),
    generos: datos.generos.map((g) => ({ id: g.id, nombre: g.nombre, activo: g.activo })),
  };

  return (
    <MarcoDelEspacio
      producto={{
        id: producto.id,
        nombre: producto.nombre,
        codigo: producto.codigo,
        tipo: producto.tipo,
        modoDeVenta: producto.modoDeVenta,
        disponibleAca: marco.disponibleAca,
        sucursalNombre: ctx.sucursalNombre,
        fichaVisible: nivelFicha.ver,
      }}
      pasos={marco.pasos}
      actual="en-la-carta"
    >
      <section aria-labelledby="titulo-en-la-carta" className="flex flex-col gap-3">
        <h2 id="titulo-en-la-carta" className="text-lg font-medium">
          En la carta de «{ctx.sucursalNombre}»
        </h2>
        {!esDeVenta ? (
          <Aviso variante="informacion" forma="en-linea">
            {producto.esAnclaDeAdicional ? `«${producto.nombre}» es el producto interno de un adicional: no sale en la carta por su cuenta.` : `«${producto.nombre}» no es un producto de venta: solo un producto de venta sale en la carta.`}
          </Aviso>
        ) : !admin || !ubicacion ? (
          <Aviso variante="informacion" forma="en-linea">
            «{producto.nombre}» no está disponible en «{ctx.sucursalNombre}»: la carta de cada sucursal lista solo lo que se vende ahí.
          </Aviso>
        ) : (
          <>
            {!(puedeEditarContenido || puedeDescuento) && <AvisoSoloLectura />}
            <p className="text-sm text-tinta-suave">
              La ficha de «{producto.nombre}» en la carta de esta sucursal: si se muestra, en qué sección y en qué orden, ★, género, descripción y tags. Lo que no sale en la carta (el POS y el menú del día) se ve en{" "}
              <EnlaceInterno href="/carta?nivel=visibilidad" className="underline">
                Mantenimiento › Visibilidad
              </EnlaceInterno>
              .
            </p>
            <ul className="flex flex-col gap-2">
              <ContenidoDelProducto
                producto={admin}
                ubicacion={ubicacion}
                puedeEditar={puedeEditarContenido}
                puedeDescuento={puedeDescuento}
                precioLocalActivo={datos?.precioLocalActivo ?? false}
                sucursalId={ctx.sucursalId}
                mostrarNombreArriba={basesDeUnEje?.get(producto.id)}
                abierto
              />
            </ul>
          </>
        )}
      </section>
    </MarcoDelEspacio>
  );
}
