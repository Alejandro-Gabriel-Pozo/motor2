import Link from "next/link";
import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { lecturaEnSucursalesVisibles } from "@/server/acceso/alcance";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import { cargarAdminCarta, origenesDeCopiaVisibles } from "@/server/consultas/carta/admin";
import { cargarCartaParaMantener } from "@/server/consultas/carta/mantenimiento";
import { saldosDeLosIngredientesDeLosPlatos } from "@/server/consultas/carta/avisos-de-stock";
import { agregarProductoALaCarta, fijarDisponibilidadDeHoy, quitarProductoDeLaCarta } from "@/server/actions/carta/mantenimiento";
import { ajustarPreciosDeLaCarta, ajustarPreciosDeLaEmpresa } from "@/server/actions/carta/precios";
import { avisoDePrecioDeEmpresa } from "@/server/actions/carta/precios-en-sucursales";
import { puedeEditarCamposSensiblesDelProducto } from "@/server/acceso/campos-sensibles-de-producto";
import { actualizarVisibleEnCarta } from "@/server/actions/carta/contenido-producto";
import { actualizarActivaSeccionCarta } from "@/server/actions/carta/secciones";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { formatearCantidad } from "@/core/pos/public";
import { AvisoSoloLectura } from "@/components/carta/datos-solo-lectura";
import { CopiarCartaDeSucursal } from "@/components/carta/copiar-carta-de-sucursal";
import { EncabezadoDeCarta } from "./encabezado-de-carta";
import { MantenimientoDeCarta, type PestanaDeMantenimiento } from "./mantenimiento-de-carta";
import s from "./carta-mant.module.css";

/**
 * La carta de la sucursal, puerta «Mantenimiento» (CARTA-MANT, ADR-034; prototipo APROBADO «Mantenimiento / Parametrización»): lo de todos los días, en tres niveles —«Hoy» (lo que se acabó),
 * «Precios» y «Visibilidad» (qué se muestra de forma estable, y al final «Fuera de carta (POS y menú del día)»)—. Lo que se cambia pocas veces (secciones, géneros, agrupados, promociones, apariencia)
 * vive en la otra puerta, `/carta/parametrizacion`, con los mismos formularios de siempre.
 *
 * Decisión del dueño (2026-10-14): un PV sin contenido de carta NO es un faltante —es el menú del día o algo que se vende solo en el POS, que nunca sale en la carta pública—: va a «Fuera de carta», un
 * contador informativo plegado con buscador, «Agregar a la carta» de un toque y su «Deshacer». El ancla de un adicional no figura en ninguna lista (`organizarCartaParaMantener`).
 *
 * Ver ≠ editar: entrar pide «Ver» de `carta_ver`; cada control se habilita solo con «Editar» de la clave que gobierna lo que toca —«Hoy», `producto_disponibilidad` (la disponibilidad por producto y
 * sucursal de siempre); el Sí/No de un producto y «Agregar/Quitar», `carta_contenido_producto`; el de una sección, `carta_secciones` (de la empresa)—. Es cortesía de la interfaz: cada acción vuelve a
 * exigirlo. Los closures "use server" capturan solo ids (texto) y le pasan a la acción el ECO de la sucursal que vio la pantalla.
 */
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

const PESTANAS: readonly PestanaDeMantenimiento[] = ["hoy", "precios", "visibilidad"];
/**
 * F4 «Precios» (ADR-034): el interruptor para apagarlo sin tocar nada más. En `false` la pestaña queda de solo lectura («próximamente») y la pantalla no ofrece ajustar; las acciones
 * (`src/server/actions/carta/precios.ts`) siguen exigiendo sus permisos de siempre.
 */
const PRECIOS_EDITABLES = true;
const pesos = (n: number) => `$ ${n.toLocaleString("es-AR")}`;

export default async function CartaPage({ searchParams }: { searchParams: Promise<{ [clave: string]: string | string[] | undefined }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const [nivelHoy, nivelContenido, nivelSecciones, nivelCopiar, nivelPrecioLocal, nivelProductoEditar, camposSensibles] = await Promise.all([
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "producto_disponibilidad", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_contenido_producto", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_secciones", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_copiar_de_sucursal", ctx.db),
    PRECIOS_EDITABLES ? obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "precio_local", ctx.db) : null,
    PRECIOS_EDITABLES ? obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_editar", ctx.db) : null,
    PRECIOS_EDITABLES ? puedeEditarCamposSensiblesDelProducto(ctx) : false,
  ]);
  const puedeBase = { hoy: nivelHoy.editar, contenido: nivelContenido.editar, secciones: nivelSecciones.editar };
  const puedeCopiarCarta = nivelCopiar.editar;

  const pedido = (await searchParams).nivel;
  const pestanaInicial: PestanaDeMantenimiento = PESTANAS.find((n) => n === pedido) ?? "hoy";

  // La hora se fija acá, en el borde (O.22-c).
  // M.3-A5: de dónde se puede copiar se lee de las OTRAS sucursales (`cargarAdminCarta` cuenta la carta propia de cada una): solo quien puede copiar la carta ensancha la LECTURA a las sucursales donde el
  // rol ve `carta_ver` (el mismo «Ver» que exige `leerOrigenDeCopia` al copiar). Todo lo demás que lee esa consulta está atado a `ctx.sucursalId`, así que la base ampliada no cambia lo que muestra.
  const origenes = puedeCopiarCarta ? await lecturaEnSucursalesVisibles(ctx, "carta_ver") : ctx;
  const [datos, carta] = await Promise.all([cargarAdminCarta(ctx.sucursalId, origenes.db, new Date()), cargarCartaParaMantener(ctx.db, ctx.sucursalId)]);
  // S-07 (O.56): solo se ofrecen de origen las sucursales donde el usuario tiene membresía y el «Ver» de la carta (las demás ni se nombran).
  const origenesDeCopia = datos.cartaVacia && puedeCopiarCarta ? await origenesDeCopiaVisibles(ctx.usuarioId, datos.sucursalesConCarta, ctx.db) : [];
  // GO-2d (el stock teórico AVISA, NUNCA BLOQUEA): de los productos que se muestran en la carta, los ingredientes que el sistema registra en 0 o menos acá. No saca nada de la carta.
  const saldos = await saldosDeLosIngredientesDeLosPlatos(
    ctx.db,
    ctx.sucursalId,
    datos.productos.filter((p) => p.contenido?.visibleEnCarta).map((p) => p.id)
  );
  const sinStock = new Map(
    [...saldos].flatMap(([id, ingredientes]) => {
      const enCero = ingredientes.filter((i) => i.saldo <= 0);
      return enCero.length ? [[id, enCero] as const] : [];
    })
  );
  const sucursalId = ctx.sucursalId;
  // F4 «Precios»: en esta sucursal, su precio local (`precio_local` y la capacidad prendida, la misma lectura de la carta); en toda la empresa, el precio de lista (las dos claves de Catálogo).
  const puede = {
    ...puedeBase,
    preciosLocal: nivelPrecioLocal?.editar === true && datos.precioLocalActivo,
    preciosEmpresa: nivelProductoEditar?.editar === true && camposSensibles,
  };
  type AjusteDeLaPantalla = { direccion: "subir" | "bajar"; modo: "porcentaje" | "monto" | "precio"; valor: string; redondeo: number };
  type Vistos = { productoId: string; precioVisto: string }[];

  return (
    <div className={s.raiz}>
      <EncabezadoDeCarta puerta="mantenimiento" subtitulo="Mantenimiento" sucursal={ctx.sucursalNombre} />
      <div className={s.contenido}>
        <div className={s.pad}>
          {!(puede.hoy || puede.contenido || puede.secciones || puede.preciosLocal || puede.preciosEmpresa) && <AvisoSoloLectura />}

          {/* Carta PROPIA de cada sucursal (ADR-009, C3/C4): una sucursal sin carta propia no muestra nada hasta que la arma o la copia de otra. */}
          {datos.cartaVacia && (
            <section aria-labelledby="titulo-carta-vacia" className={`${s.tarjeta} ${s.irAParte}`} data-carta-vacia>
              <h2 id="titulo-carta-vacia" className={s.h2}>
                Tu sucursal no tiene carta propia todavía
              </h2>
              <p role="status" className={s.ayuda}>
                Mientras no armes la carta, la carta pública y el selector del POS de esta sucursal salen vacíos (las secciones son de la empresa y ya están). Podés armarla producto por producto
                {puedeCopiarCarta ? " o copiar la de otra sucursal" : ""}.
              </p>
              {puede.contenido && (
                <Link href="/carta?nivel=visibilidad" className={`${s.boton} ${s.botonPrincipal} ${s.volver}`}>
                  Armar carta
                </Link>
              )}
              {puedeCopiarCarta && <CopiarCartaDeSucursal origenes={origenesDeCopia} />}
            </section>
          )}

          {datos.visiblesSinSeccion.length > 0 && (
            <div className={s.nota}>
              <b>Visibles pero sin sección de carta activa (no salen en la carta):</b> {datos.visiblesSinSeccion.map((p) => p.nombre).join(", ")}.
            </div>
          )}
          {sinStock.size > 0 && (
            <div className={s.nota} data-avisos-de-stock>
              <b>El sistema registra stock 0 de un ingrediente (siguen en la carta):</b>
              <ul className="mt-1 list-disc pl-5">
                {datos.productos
                  .filter((p) => sinStock.has(p.id))
                  .map((p) => (
                    <li key={p.id}>
                      «{p.nombre}»:{" "}
                      {sinStock
                        .get(p.id)!
                        .map((i) => `${i.nombre}: el sistema dice ${formatearCantidad(i.saldo)} ${i.unidadNombre}`)
                        .join("; ")}
                      . Si hay en el depósito,{" "}
                      <EnlaceInterno href="/movimientos/conteo-fisico" className="underline">
                        hacé un conteo físico
                      </EnlaceInterno>
                      .
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <MantenimientoDeCarta
            pestanaInicial={pestanaInicial}
            secciones={carta.secciones.map((x) => ({
              id: x.id,
              nombre: x.nombre,
              activa: x.activa,
              productos: x.productos.map((p) => ({
                id: p.id,
                nombre: p.nombre,
                precio: pesos(p.precioAca),
                disponible: p.disponibleAca,
                visible: p.contenido?.visibleEnCarta === true,
                precioVisto: p.precioAca.toFixed(2),
                precioDeListaVisto: p.precioDeLista.toFixed(2),
                conPrecioLocal: p.conPrecioLocal,
              })),
            }))}
            ocultosSinSeccion={carta.sinSeccion.map((p) => ({ id: p.id, nombre: p.nombre }))}
            fueraDeCarta={carta.fueraDeCarta.map((p) => ({ id: p.id, nombre: p.nombre, precio: pesos(p.precioAca), vistaPrevia: p.vistaPrevia ?? "Sin opciones." }))}
            puede={puede}
            acciones={{
              fijarHoy: async (cambios: { productoId: string; disponible: boolean }[]) => {
                "use server";
                return refrescarSiOk(await fijarDisponibilidadDeHoy({ sucursalId, cambios }));
              },
              visibleProducto: async (productoId: string, visible: boolean) => {
                "use server";
                return refrescarSiOk(await actualizarVisibleEnCarta(productoId, visible));
              },
              activaSeccion: async (seccionId: string, activa: boolean) => {
                "use server";
                return refrescarSiOk(await actualizarActivaSeccionCarta(seccionId, activa));
              },
              agregar: async (productoId: string, seccionCartaId: string) => {
                "use server";
                return refrescarSiOk(await agregarProductoALaCarta({ sucursalId, productoId, seccionCartaId }));
              },
              quitar: async (productoId: string) => {
                "use server";
                return refrescarSiOk(await quitarProductoDeLaCarta({ sucursalId, productoId, confirmado: false }));
              },
              ajustarLocal: async (ajuste: AjusteDeLaPantalla, items: Vistos) => {
                "use server";
                return refrescarSiOk(await ajustarPreciosDeLaCarta({ sucursalId, ajuste, items }));
              },
              ajustarEmpresa: async (ajuste: AjusteDeLaPantalla, items: Vistos, confirmado: boolean) => {
                "use server";
                return refrescarSiOk(await ajustarPreciosDeLaEmpresa({ ajuste, items, confirmado }));
              },
              leerAvisoDeEmpresa: async (productoIds: string[]) => {
                "use server";
                return avisoDePrecioDeEmpresa(productoIds);
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
