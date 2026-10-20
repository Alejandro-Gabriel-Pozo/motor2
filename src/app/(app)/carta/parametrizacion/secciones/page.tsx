import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import type { ProductoParaMantener } from "@/core/carta/public";
import { basesDeUnEjeEnLaCarta, cargarAdminCarta } from "@/server/consultas/carta/admin";
import { cargarCartaParaMantener } from "@/server/consultas/carta/mantenimiento";
import { actualizarActivaSeccionCarta, guardarSeccionCarta, ordenarSeccionesCarta } from "@/server/actions/carta/secciones";
import { FormConResultado } from "@/components/form-con-resultado";
import { AvisoSoloLectura, Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import { EncabezadoDeCarta } from "../../encabezado-de-carta";
import estilos from "../../carta-mant.module.css";
import { CLASE_BOTON, CLASE_ENLACE_DE_ACCION, CamposSeccion, ContenidoProducto, GrupoDeLaCarta, type UbicacionEnCarta } from "../formularios";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { OrdenarSecciones } from "./ordenar-secciones";

/** Ayudantes puros de los closures "use server" de esta página (locales a propósito: `use-server-solo-donde-corresponde` solo los acepta definidos en el mismo archivo). */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

/**
 * CARTA-MANT: Parametrización › Secciones (prototipo aprobado). Arriba, «Secciones de la carta» con «Ordenar» y «⋯» (F3, `OrdenarSecciones`). Después, los datos de cada sección (de la EMPRESA:
 * nombre, título, descripción, imagen, orden, prendida o apagada) y, debajo, la FICHA de cada
 * producto de la carta de esta sucursal, agrupada por sección (descripción, tags, ★, género, sección y orden, descuento y «Quitar de la carta»). Son los mismos formularios que antes estaban apilados en
 * `/carta`, con las mismas acciones y permisos: entrar pide «Ver» de `carta_ver`; cada formulario se dibuja solo con «Editar» de su clave (`carta_secciones`, `carta_contenido_producto`,
 * `carta_producto_descuento`).
 */
export default async function SeccionesDeCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const [nivelSecciones, nivelContenido, nivelDescuento] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_secciones", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_contenido_producto", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_producto_descuento", ctx.db),
  ]);
  const puedeEditarSecciones = nivelSecciones.editar;
  const puedeEditarContenido = nivelContenido.editar;
  const puedeDescuento = nivelDescuento.editar;
  // La hora se fija acá, en el borde (O.22-c).
  const [datos, carta, basesDeUnEje] = await Promise.all([cargarAdminCarta(ctx.sucursalId, ctx.db, new Date()), cargarCartaParaMantener(ctx.db, ctx.sucursalId), basesDeUnEjeEnLaCarta(ctx.sucursalId, ctx.db)]);
  const sucursalId = ctx.sucursalId;
  const adminPorId = new Map(datos.productos.map((p) => [p.id, p]));
  const ubicacion: UbicacionEnCarta = {
    secciones: datos.secciones.map((x) => ({ id: x.id, nombre: x.nombre, activa: x.activa })),
    cantidadPorSeccion: Object.fromEntries(datos.secciones.map((x) => [x.id, x.cantidadItems])),
    generos: datos.generos.map((g) => ({ id: g.id, nombre: g.nombre, activo: g.activo })),
  };
  /** La ficha de un producto: con su formulario si está disponible acá (lo que lee `cargarAdminCarta`); si no, solo su nombre. */
  const filaDeProducto = (p: ProductoParaMantener) => {
    const admin = adminPorId.get(p.id);
    if (admin)
      return (
        <ContenidoProducto
          key={p.id}
          producto={admin}
          ubicacion={ubicacion}
          puedeEditar={puedeEditarContenido}
          puedeDescuento={puedeDescuento}
          precioLocalActivo={datos.precioLocalActivo}
          sucursalId={sucursalId}
          mostrarNombreArriba={basesDeUnEje.get(p.id)}
        />
      );
    return (
      <li key={p.id} className="rounded border p-3 text-sm" data-contenido-carta={p.nombre}>
        <span className="font-medium">{p.nombre}</span> · no disponible en esta sucursal
      </li>
    );
  };

  return (
    <div className={estilos.raiz}>
      <EncabezadoDeCarta puerta="parametrizacion" subtitulo="Parametrización · Secciones" sucursal={ctx.sucursalNombre} />
      <div className={estilos.contenido}>
        <div className={estilos.pad}>
          <Link href="/carta/parametrizacion" className={`${estilos.boton} ${estilos.botonSuave} ${estilos.volver}`}>
            ← Volver
          </Link>
          {!(puedeEditarSecciones || puedeEditarContenido || puedeDescuento) && <AvisoSoloLectura />}
          <OrdenarSecciones
            secciones={datos.secciones.map((x) => ({ id: x.id, nombre: x.nombre, activa: x.activa, orden: x.orden }))}
            puede={puedeEditarSecciones}
            acciones={{
              ordenar: async (secciones: { seccionCartaId: string; ordenVisto: number }[]) => {
                "use server";
                return refrescarSiOk(await ordenarSeccionesCarta({ secciones }));
              },
              activa: async (seccionCartaId: string, activa: boolean) => {
                "use server";
                return refrescarSiOk(await actualizarActivaSeccionCarta(seccionCartaId, activa));
              },
            }}
          />
          <p className={estilos.ayuda}>Las secciones son de toda la empresa; los productos de cada una, de esta sucursal.</p>
          <div className={`${estilos.formulario} flex flex-col gap-10`}>
      {/* 1. Secciones de carta */}
      <section aria-labelledby="titulo-secciones" className="flex flex-col gap-3">
        <h2 id="titulo-secciones" className="text-lg font-medium">
          Datos de cada sección
        </h2>
        <ul className="flex flex-col gap-2">
          {datos.secciones.map((s) => {
            const id = s.id;
            const activa = s.activa;
            return (
              <li key={s.id} id={`datos-seccion-${s.id}`} className="rounded border p-3" data-seccion-carta={s.nombre}>
                <details>
                  <summary className="cursor-pointer text-sm max-md:min-h-11 max-md:py-2">
                    <span className="font-medium">{s.nombre}</span>
                    {s.titulo ? ` — «${s.titulo}»` : ""} · orden {s.orden} · {s.cantidadItems} ítem(s) · {s.activa ? "activa" : "apagada"}
                  </summary>
                  {puedeEditarSecciones ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        return refrescarSiOk(
                          await guardarSeccionCarta({ id, nombre: campo(fd, "nombre"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), imagenUrl: campo(fd, "imagenUrl"), orden: campo(fd, "orden") })
                        );
                      }}
                      className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                    >
                      <CamposSeccion valores={s} />
                      <div className="sm:col-span-2">
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar sección
                        </button>
                      </div>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Nombre">{s.nombre}</Dato>
                      <Dato etiqueta="Título">{s.titulo}</Dato>
                      <Dato etiqueta="Descripción" ancho>
                        {s.descripcion}
                      </Dato>
                      <Dato etiqueta="Imagen">{s.imagenUrl}</Dato>
                      <Dato etiqueta="Orden">{s.orden}</Dato>
                    </DatosSoloLectura>
                  )}
                </details>
                {puedeEditarSecciones && (
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return refrescarSiOk(await actualizarActivaSeccionCarta(id, !activa));
                    }}
                    className="mt-2"
                  >
                    <button type="submit" className={CLASE_ENLACE_DE_ACCION}>
                      {s.activa ? `Apagar «${s.nombre}»` : `Prender «${s.nombre}»`}
                    </button>
                  </FormConResultado>
                )}
              </li>
            );
          })}
          {!datos.secciones.length && <li className="text-sm text-neutral-500">Todavía no hay secciones de carta.</li>}
        </ul>

        {puedeEditarSecciones && (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarSeccionCarta({ nombre: campo(fd, "nombre"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), imagenUrl: campo(fd, "imagenUrl"), orden: campo(fd, "orden") })
              );
            }}
            className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
          >
            <h3 className="text-sm font-medium sm:col-span-2">Nueva sección de carta</h3>
            {/* DA5: una sección nueva cae al final por defecto (orden = cuántas hay). */}
            <CamposSeccion ordenSugerido={datos.secciones.length} />
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Crear sección
              </button>
            </div>
          </FormConResultado>
        )}
      </section>


            {/* La ficha de cada producto de la carta de esta sucursal, por sección (antes «Contenido de carta de cada producto de venta», en /carta). */}
            <section aria-labelledby="titulo-contenido" className="flex flex-col gap-3">
              <h2 id="titulo-contenido" className="text-lg font-medium">
                Productos de cada sección
              </h2>
              <p className="text-sm text-neutral-500">
                La ficha de cada producto que sale en la carta de esta sucursal: descripción, tags, ★, género, sección y orden. Lo que no sale en la carta (el POS y el menú del día) está en
                Mantenimiento › Visibilidad › «Fuera de carta».
              </p>
              {carta.secciones.map((x) => (
                <GrupoDeLaCarta key={x.id} nombre={x.nombre} detalle={x.activa ? null : "sección apagada: no sale en la carta"} productos={x.productos} vacio="Todavía no tiene productos en esta sucursal." fila={filaDeProducto} />
              ))}
              {carta.sinSeccion.length > 0 && <GrupoDeLaCarta nombre="Ocultos, sin sección" detalle={null} productos={carta.sinSeccion} vacio="" fila={filaDeProducto} />}
              {carta.enAgrupados.length > 0 && <GrupoDeLaCarta nombre="Dentro de un ítem agrupado" detalle="salen en la carta dentro de su agrupado" productos={carta.enAgrupados} vacio="" fila={filaDeProducto} />}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
