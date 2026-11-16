import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import { cargarAdminCarta } from "@/server/consultas/carta/admin";
import { cargarCartaParaMantener } from "@/server/consultas/carta/mantenimiento";
import { actualizarActivaSeccionCarta, guardarSeccionCarta } from "@/server/actions/carta/secciones";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { AvisoSoloLectura, Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import { FilaDeCarta } from "@/components/fila-de-carta";
import { EnlaceInterno } from "@/components/enlace-interno";
import Link from "next/link";
import { PESTANAS_DE_CARTA, RUTA_SECCIONES } from "@/core/carta/public";
import { EncabezadoDeCarta } from "../../../encabezado-de-carta";
import estilos from "../../../carta-mant.module.css";
import { CamposSeccion } from "../../formularios";
import { RejillaDeSecciones, SeccionDeRejilla } from "@/ui/componentes/estructura/rejilla-de-secciones";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";

/** Ayudantes puros de los closures "use server" de esta página (locales a propósito: `use-server-solo-donde-corresponde` solo los acepta definidos en el mismo archivo). */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

/**
 * Una sección de la carta (Frente 6, etapa «Secciones: lista simple como Pedernal»; pedido del dueño 2026-11-16, «Lista simple como Pedernal (Recomendada)»): sus DATOS de siempre (nombre, título, descripción,
 * imagen, orden) con las mismas acciones (`guardarSeccionCarta`, `actualizarActivaSeccionCarta`) y el mismo permiso (`carta_secciones`, de la empresa), y la lista de SUS productos en esta sucursal, cada uno
 * con su enlace a la ficha de carta del producto (`/catalogo/productos/[id]/en-la-carta`, donde viven la descripción, los tags, ★, género, sección, orden y descuento). No se pierde ningún dato ni función:
 * antes estaban todas las secciones apiladas en `/carta/parametrizacion/secciones`.
 *
 * Entrar pide «Ver» de `carta_ver` (la misma acción que la lista; la ruta cuelga de ella); cada formulario se dibuja solo con «Editar» de `carta_secciones`, y el servidor lo vuelve a decidir al guardar. El id de la
 * URL es lo único que viene del navegador: una sección que no es de esta empresa (la base filtra por empresa) o que no existe da «no encontrada».
 */
export default async function UnaSeccionDeCartaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { id } = await params;
  const nivelSecciones = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_secciones", ctx.db);
  const puedeEditar = nivelSecciones.editar;
  // La hora se fija acá, en el borde (O.22-c).
  const [datos, carta] = await Promise.all([cargarAdminCarta(ctx.sucursalId, ctx.db, new Date()), cargarCartaParaMantener(ctx.db, ctx.sucursalId)]);
  const seccion = datos.secciones.find((x) => x.id === id);
  if (!seccion) notFound();
  const productos = carta.secciones.find((x) => x.id === id)?.productos ?? [];
  const activa = seccion.activa;

  return (
    <div className={estilos.raiz}>
      <EncabezadoDeCarta entrada="Carta" pestana="Secciones" sucursal={ctx.sucursalNombre}>
        <FilaDeCarta ctx={ctx} etiqueta="Carta" pestanas={PESTANAS_DE_CARTA} ruta={RUTA_SECCIONES} />
      </EncabezadoDeCarta>
      <div className={estilos.contenido}>
        <div className={estilos.pad}>
          <Link href="/carta/parametrizacion/secciones" className={`${estilos.boton} ${estilos.botonSuave} ${estilos.volver}`}>
            ‹ Secciones de la carta
          </Link>
          {!puedeEditar && <AvisoSoloLectura />}
          <RejillaDeSecciones separacion="amplia">
          <SeccionDeRejilla>
          <section aria-labelledby="titulo-seccion" className="flex flex-col gap-3" data-seccion-carta={seccion.nombre}>
            <h2 id="titulo-seccion" className="text-lg font-medium">
              {seccion.nombre}
              {activa ? "" : " · apagada"}
            </h2>
            {puedeEditar ? (
              <FormConResultado
                accion={async (fd: FormData) => {
                  "use server";
                  return refrescarSiOk(
                    await guardarSeccionCarta({ id, nombre: campo(fd, "nombre"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), imagenUrl: campo(fd, "imagenUrl"), orden: campo(fd, "orden") })
                  );
                }}
                className="grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <CamposSeccion valores={seccion} />
                <div className="sm:col-span-2">
                  <BotonDeServidor type="submit" tamano="compacto">
                    Guardar sección
                  </BotonDeServidor>
                </div>
              </FormConResultado>
            ) : (
              <DatosSoloLectura>
                <Dato etiqueta="Nombre">{seccion.nombre}</Dato>
                <Dato etiqueta="Título">{seccion.titulo}</Dato>
                <Dato etiqueta="Descripción" ancho>
                  {seccion.descripcion}
                </Dato>
                <Dato etiqueta="Imagen">{seccion.imagenUrl}</Dato>
                <Dato etiqueta="Orden">{seccion.orden}</Dato>
              </DatosSoloLectura>
            )}
            {puedeEditar && (
              <FormConResultado
                accion={async () => {
                  "use server";
                  return refrescarSiOk(await actualizarActivaSeccionCarta(id, !activa));
                }}
              >
                <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                  {activa ? `Apagar «${seccion.nombre}»` : `Prender «${seccion.nombre}»`}
                </BotonDeServidor>
              </FormConResultado>
            )}
          </section>
          </SeccionDeRejilla>

          <SeccionDeRejilla>
          <section aria-labelledby="titulo-productos-de-la-seccion" className="flex flex-col gap-2" data-productos-de-la-seccion>
            <h2 id="titulo-productos-de-la-seccion" className="text-lg font-medium">
              Productos de esta sección
            </h2>
            {!activa && <p className="text-sm text-tinta-tenue">Sección apagada: no sale en la carta.</p>}
            <ul className="flex flex-col gap-1">
              {productos.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 rounded border px-3 py-2 text-sm max-md:min-h-11" data-producto-de-la-seccion={p.nombre}>
                  <EnlaceInterno href={`/catalogo/productos/${p.id}/en-la-carta`} className="font-medium underline [overflow-wrap:anywhere]">
                    {p.nombre}
                  </EnlaceInterno>
                  {p.contenido && !p.contenido.visibleEnCarta && <span className="text-tinta-suave">oculto</span>}
                </li>
              ))}
              {!productos.length && <li className="text-sm text-tinta-tenue">Todavía no tiene productos en esta sucursal.</li>}
            </ul>
          </section>
          </SeccionDeRejilla>
          </RejillaDeSecciones>
        </div>
      </div>
    </div>
  );
}
