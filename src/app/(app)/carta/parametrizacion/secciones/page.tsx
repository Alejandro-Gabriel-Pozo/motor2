import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import type { ProductoParaMantener } from "@/core/carta/public";
import { cargarAdminCarta } from "@/server/consultas/carta/admin";
import { cargarCartaParaMantener } from "@/server/consultas/carta/mantenimiento";
import { actualizarActivaSeccionCarta, guardarSeccionCarta, ordenarSeccionesCarta } from "@/server/actions/carta/secciones";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { AvisoSoloLectura } from "@/components/carta/datos-solo-lectura";
import { FilaDeCarta } from "@/components/fila-de-carta";
import { EnlaceInterno } from "@/components/enlace-interno";
import { PESTANAS_DE_CARTA } from "@/core/carta/public";
import { EncabezadoDeCarta } from "../../encabezado-de-carta";
import estilos from "../../carta-mant.module.css";
import { CamposSeccion, GrupoDeLaCarta } from "../formularios";
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
 * CARTA-MANT: Parametrización › Secciones, LISTA SIMPLE como Pedernal (Frente 6; pedido del dueño 2026-11-16, «Lista simple como Pedernal (Recomendada)»): «Secciones de la carta» con «Ordenar» y «⋯» (F3, `OrdenarSecciones`)
 * y «Nueva sección de carta». Tocar una sección abre su pantalla (`./[id]`) con sus datos (nombre, título, descripción, imagen, orden) y sus productos; la ficha de carta de cada producto vive en la ficha del producto
 * (`/catalogo/productos/[id]/en-la-carta`). No se perdió ningún dato ni función: son las mismas acciones y los mismos permisos de antes (entrar pide «Ver» de `carta_ver`; los formularios se dibujan solo con «Editar» de
 * `carta_secciones`). Abajo quedan, plegados, los productos que no están en ninguna sección (ocultos, o dentro de un ítem agrupado), cada uno con su enlace a su ficha.
 */
export default async function SeccionesDeCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  const nivelSecciones = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_secciones", ctx.db);
  const puedeEditarSecciones = nivelSecciones.editar;
  // La hora se fija acá, en el borde (O.22-c).
  const [datos, carta] = await Promise.all([cargarAdminCarta(ctx.sucursalId, ctx.db, new Date()), cargarCartaParaMantener(ctx.db, ctx.sucursalId)]);
  /** Un producto fuera de las secciones: su nombre, con el enlace a su ficha de carta. */
  const filaDeProducto = (p: ProductoParaMantener) => (
    <li key={p.id} className="text-sm max-md:min-h-11" data-contenido-carta={p.nombre}>
      <EnlaceInterno href={`/catalogo/productos/${p.id}/en-la-carta`} className="font-medium underline [overflow-wrap:anywhere]">
        {p.nombre}
      </EnlaceInterno>
    </li>
  );

  return (
    <div className={estilos.raiz}>
      <EncabezadoDeCarta entrada="Carta" pestana="Secciones" sucursal={ctx.sucursalNombre}>
        <FilaDeCarta ctx={ctx} etiqueta="Carta" pestanas={PESTANAS_DE_CARTA} ruta="/carta/parametrizacion/secciones" />
      </EncabezadoDeCarta>
      <div className={estilos.contenido}>
        <div className={estilos.pad}>
          {/* DEC-24: la pestaña «Secciones y géneros» reúne dos pantallas; esta lleva a la otra. */}
          <EnlaceInterno href="/carta/parametrizacion/generos" className={`${estilos.boton} ${estilos.botonSuave} ${estilos.volver}`}>
            Géneros (carpetas del selector del POS) ›
          </EnlaceInterno>
          {!puedeEditarSecciones && <AvisoSoloLectura />}
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
          <p className={estilos.ayuda}>Las secciones son de toda la empresa; los productos de cada una, de esta sucursal. Tocá una sección para ver sus datos y sus productos.</p>
          <div className={`${estilos.formulario} flex flex-col gap-10`}>
      <div className="flex flex-col gap-3">
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
              <BotonDeServidor type="submit" tamano="compacto">
                Crear sección
              </BotonDeServidor>
            </div>
          </FormConResultado>
        )}
      </div>

            {(carta.sinSeccion.length > 0 || carta.enAgrupados.length > 0) && (
              <section aria-labelledby="titulo-sin-seccion" className="flex flex-col gap-3">
                <h2 id="titulo-sin-seccion" className="text-lg font-medium">
                  Productos fuera de las secciones
                </h2>
                {carta.sinSeccion.length > 0 && <GrupoDeLaCarta nombre="Ocultos, sin sección" detalle={null} productos={carta.sinSeccion} vacio="" fila={filaDeProducto} />}
                {carta.enAgrupados.length > 0 && <GrupoDeLaCarta nombre="Dentro de un ítem agrupado" detalle="salen en la carta dentro de su agrupado" productos={carta.enAgrupados} vacio="" fila={filaDeProducto} />}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
