import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { lecturaEnSucursalesVisibles } from "@/server/acceso/alcance";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import type { ProductoCartaAdmin, ProductoParaMantener } from "@/core/carta/public";
import { cargarAdminCarta, origenesDeCopiaVisibles } from "@/server/consultas/carta/admin";
import { cargarCartaParaMantener } from "@/server/consultas/carta/mantenimiento";
import { agregarProductoALaCarta } from "@/server/actions/carta/mantenimiento";
import { actualizarActivaSeccionCarta, guardarSeccionCarta } from "@/server/actions/carta/secciones";
import { actualizarActivoGeneroCarta, guardarGeneroCarta } from "@/server/actions/carta/generos";
import { guardarContenidoCartaProducto } from "@/server/actions/carta/contenido-producto";
import { guardarDescuentoProducto } from "@/server/actions/carta/descuento-producto";
import {
  actualizarActivaPromoCarta,
  actualizarActivaPromoCartaEnSucursal,
  guardarCuposPromoCarta,
  guardarPrecioLocalPromoCarta,
  guardarPromoCarta,
} from "@/server/actions/carta/promos";
import { precioMinimoPromo } from "@/core/pos/public";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { FormConResultado } from "@/components/form-con-resultado";
import { SeccionYOrden } from "@/components/carta/seccion-y-orden";
import { AvisoSoloLectura, Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import { CopiarCartaDeSucursal } from "@/components/carta/copiar-carta-de-sucursal";
import { saldosDeLosIngredientesDeLosPlatos } from "@/server/consultas/carta/avisos-de-stock";
import { formatearCantidad } from "@/core/pos/public";
import type { LugarDeCombo, VigenciaDePromoAdmin } from "@/core/carta/public";
import { cargarCombosDeLaCarta } from "@/server/consultas/carta/combos";
import { actualizarActivaEntradaDeCupo, agregarEntradaDeCupo, guardarVigenciaPromoCarta } from "@/server/actions/carta/combos";
import { AgregarEntradaDeLugar } from "./agregar-entrada-de-lugar";
import { lugaresDelFormulario } from "./lugares-del-formulario";
import { FueraDeCarta } from "./fuera-de-carta";

/**
 * Admin de la carta pública (docs/plan-carta-catalogo-2026-09-24.md, M10): lo que muestra la carta pública interna
 * (ADR-006). Bloques: secciones de carta, géneros, los PRODUCTOS EN LA CARTA de esta sucursal agrupados por sección (cada uno con su contenido, su sección
 * elegida DIRECTO — docs/plan-carta-seccion-directa-2026-09-25.md —) y, plegado, «Fuera de carta (POS y menú del día)», y las promos (de la empresa, prendidas o no en la
 * sucursal activa). CARTA-MANT (decisión del dueño, 2026-10-14): un PV sin contenido de carta NO es un faltante —es el menú del día o algo que se vende solo en el POS, que nunca
 * sale en la carta pública—, así que ya no se avisa en ámbar: es un contador informativo con buscador y «Agregar a la carta» de un toque. El ancla de un adicional no figura en
 * ninguna lista (`organizarCartaParaMantener`). El nombre, el precio y la disponibilidad de cada producto se siguen editando en Catálogo; la Categoría de producto no ubica nada en la carta.
 *
 * Todas las mutaciones pasan por las Server Actions de src/server/actions/carta (una clave por bloque: carta_secciones, carta_generos,
 * carta_contenido_producto y, para las promos, carta_promo_definir / carta_promo_activar / carta_promo_precio_local); el refresco lo piden los
 * closures de acá (ver refrescar.ts). Los closures capturan solo ids (texto): lo que captura un closure "use server" viaja al
 * cliente.
 *
 * Ver ≠ editar (docs/grounding-lista-ver-editar-2026-09-18.md, §7.4: catálogo chico, queda inline): entrar pide «Ver» de "carta_ver";
 * los formularios, las altas y los botones de apagar/prender de cada bloque se dibujan solo con «Editar» de la clave de ESE bloque. Sin «Editar», el bloque muestra los
 * mismos datos como texto (DatosSoloLectura). Es cortesía de la interfaz, no barrera: la acción sigue exigiendo el permiso.
 */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

// MOVIL (O.461): en celular (< 768 px) los campos y botones miden 44 px de alto como mínimo (se tocan con el dedo) y el texto de los campos 16 px (iOS hace zoom con menos); en escritorio, igual que siempre.
const CLASE_INPUT = "rounded border px-2 py-1 max-md:min-h-11 max-md:text-base";
const CLASE_BOTON = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white max-md:min-h-11";
/** Un número corto (mín./máx., orden…): a todo el ancho de su columna en celular, de 4 rem desde `sm`. */
const CLASE_NUMERO = `${CLASE_INPUT} w-full sm:w-16`;
/** Un botón con aspecto de enlace («Apagar «X» en esta sucursal»): en celular, una fila de 44 px de alto. */
const CLASE_ENLACE_DE_ACCION = "text-sm underline max-md:inline-flex max-md:min-h-11 max-md:items-center";
/** Una casilla con su texto: en celular, la fila entera (la etiqueta es el objetivo táctil) mide 44 px de alto. */
const CLASE_CASILLA = "max-md:min-h-11";
/**
 * Una fila del bloque «Cupos» (una sección o un lugar de entradas). En celular es una tarjetita: el nombre con su casilla arriba, a todo el ancho, y «mín.» y «máx.» abajo, lado a lado
 * (antes los cinco campos se rompían de a uno por renglón y no se sabía de quién era cada uno); desde `sm`, la fila de siempre.
 */
const CLASE_FILA_DE_CUPO = "grid grid-cols-2 gap-2 rounded border p-2 text-sm sm:flex sm:flex-wrap sm:items-center sm:rounded-none sm:border-0 sm:p-0";
const CLASE_NOMBRE_DE_CUPO = `col-span-2 flex items-center gap-2 sm:min-w-[10rem] ${CLASE_CASILLA} [overflow-wrap:anywhere]`;
const CLASE_CANTIDAD_DE_CUPO = "flex flex-col gap-1 sm:flex-row sm:items-center";

type OpcionSeccion = { id: string; nombre: string; activa: boolean };
type OpcionGenero = { id: string; nombre: string; activo: boolean };
/** Para el select de sección + orden sugerido (DA6): las secciones, y cuántos ítems ya tiene cada una. */
type UbicacionEnCarta = { secciones: OpcionSeccion[]; cantidadPorSeccion: Record<string, number>; generos: OpcionGenero[] };

export default async function CartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const [nivelSecciones, nivelGeneros, nivelContenido, nivelPromoDefinir, nivelPromoActivar, nivelPromoPrecio, nivelDescuento, nivelCopiar] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_secciones", ctx.db),
    // S-10/D1 (O.59): géneros y contenido son de contexto SUCURSAL (se escriben en la carta de la sucursal activa): el «Editar» que cuenta es el de esta sucursal.
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_generos", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_contenido_producto", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_promo_definir", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_promo_activar", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_promo_precio_local", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_producto_descuento", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_copiar_de_sucursal", ctx.db),
  ]);
  const puedeEditarSecciones = nivelSecciones.editar;
  const puedeEditarGeneros = nivelGeneros.editar;
  const puedeEditarContenido = nivelContenido.editar;
  const puedeDefinirPromos = nivelPromoDefinir.editar;
  const puedeActivarPromos = nivelPromoActivar.editar;
  const puedePrecioLocalPromos = nivelPromoPrecio.editar;
  const puedeDescuento = nivelDescuento.editar;
  const puedeCopiarCarta = nivelCopiar.editar;
  const puedeEditarAlgo = puedeEditarSecciones || puedeEditarGeneros || puedeEditarContenido || puedeDefinirPromos || puedeActivarPromos || puedePrecioLocalPromos || puedeDescuento;

  // La hora se fija acá, en el borde (O.22-c).
  // M.3-A5: de dónde se puede copiar se lee de las OTRAS sucursales (`cargarAdminCarta` cuenta la carta propia de cada una): solo quien puede copiar la carta ensancha la LECTURA a las sucursales donde el
  // rol ve `carta_ver` (el mismo «Ver» que exige `leerOrigenDeCopia` al copiar). Todo lo demás que lee esa consulta está atado a `ctx.sucursalId`, así que la base ampliada no cambia lo que muestra.
  const origenes = puedeCopiarCarta ? await lecturaEnSucursalesVisibles(ctx, "carta_ver") : ctx;
  const datos = await cargarAdminCarta(ctx.sucursalId, origenes.db, new Date());
  // GO-3b (U1): los combos de cada promo (lugares de entradas, sus entradas y la vigencia), aparte de `cargarAdminCarta` (que no cambia).
  const combos = await cargarCombosDeLaCarta(ctx.db, ctx.sucursalId);
  // S-07 (O.56): solo se ofrecen de origen las sucursales donde el usuario tiene membresía y el «Ver» de la carta (las demás ni se nombran).
  const origenesDeCopia = datos.cartaVacia && puedeCopiarCarta ? await origenesDeCopiaVisibles(ctx.usuarioId, datos.sucursalesConCarta, ctx.db) : [];
  const seccionesActivas = datos.secciones.filter((s) => s.activa);
  // GO-2d (el stock teórico AVISA, NUNCA BLOQUEA): de los productos que se muestran en la carta, los ingredientes que el sistema registra en 0 o menos acá. No saca nada de la carta.
  const saldos = await saldosDeLosIngredientesDeLosPlatos(
    ctx.db,
    ctx.sucursalId,
    datos.productos.filter((p) => p.contenido?.visibleEnCarta).map((p) => p.id)
  );
  const sinStock = new Map([...saldos].flatMap(([id, ingredientes]) => {
    const enCero = ingredientes.filter((i) => i.saldo <= 0);
    return enCero.length ? [[id, enCero] as const] : [];
  }));
  // CARTA-MANT: en qué lista va cada producto (por sección, ocultos sin sección, dentro de un agrupado, «Fuera de carta»; el ancla de un adicional en ninguna).
  const carta = await cargarCartaParaMantener(ctx.db, ctx.sucursalId);
  const sucursalId = ctx.sucursalId;
  const adminPorId = new Map(datos.productos.map((p) => [p.id, p]));
  const ubicacion: UbicacionEnCarta = {
    secciones: datos.secciones.map((s) => ({ id: s.id, nombre: s.nombre, activa: s.activa })),
    cantidadPorSeccion: Object.fromEntries(datos.secciones.map((s) => [s.id, s.cantidadItems])),
    generos: datos.generos.map((g) => ({ id: g.id, nombre: g.nombre, activo: g.activo })),
  };

  /** El renglón de un producto: con su ficha de contenido si está disponible acá (lo que lee `cargarAdminCarta`); si no, solo su nombre. */
  const filaDeProducto = (p: ProductoParaMantener) => {
    const admin = adminPorId.get(p.id);
    if (admin) return <ContenidoProducto key={p.id} producto={admin} ubicacion={ubicacion} puedeEditar={puedeEditarContenido} puedeDescuento={puedeDescuento} precioLocalActivo={datos.precioLocalActivo} />;
    return (
      <li key={p.id} className="rounded border p-3 text-sm" data-contenido-carta={p.nombre}>
        <span className="font-medium">{p.nombre}</span> · no disponible en esta sucursal
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Carta pública</h1>
        <p className="text-sm text-neutral-500">
          Lo que la carta pública de la sucursal muestra: secciones, contenido de cada producto de venta y promos. El nombre, el precio y la disponibilidad
          se editan en Catálogo.
        </p>
        {!puedeEditarAlgo && <AvisoSoloLectura />}
      </div>

      {/* Carta PROPIA de cada sucursal (ADR-009, C3/C4): una sucursal sin carta propia no muestra nada hasta que la arma o la copia de otra. */}
      {datos.cartaVacia && (
        <section aria-labelledby="titulo-carta-vacia" className="flex max-w-2xl flex-col gap-3 rounded border border-dashed p-4" data-carta-vacia>
          <h2 id="titulo-carta-vacia" className="text-lg font-medium">
            Tu sucursal no tiene carta propia todavía
          </h2>
          <p role="status" className="text-sm text-neutral-600">
            Mientras no armes la carta, la carta pública y el selector del POS de esta sucursal salen vacíos (las secciones son de la empresa y ya están).
            Podés armarla producto por producto{puedeCopiarCarta ? " o copiar la de otra sucursal" : ""}.
          </p>
          {puedeEditarContenido && (
            <a href="#titulo-contenido" className="self-start rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
              Armar carta
            </a>
          )}
          {puedeCopiarCarta && <CopiarCartaDeSucursal origenes={origenesDeCopia} />}
        </section>
      )}

      {/* 1. Secciones de carta */}
      <section aria-labelledby="titulo-secciones" className="flex flex-col gap-3">
        <h2 id="titulo-secciones" className="text-lg font-medium">
          Secciones de carta
        </h2>
        <ul className="flex flex-col gap-2">
          {datos.secciones.map((s) => {
            const id = s.id;
            const activa = s.activa;
            return (
              <li key={s.id} className="rounded border p-3" data-seccion-carta={s.nombre}>
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

      {/* 2. Géneros de carta (docs/plan-genero-carta-2026-09-26.md): carpetas VISUALES del POS, globales como las secciones. */}
      <section aria-labelledby="titulo-generos" className="flex flex-col gap-3">
        <h2 id="titulo-generos" className="text-lg font-medium">
          Géneros de carta
        </h2>
        <p className="text-sm text-neutral-500">
          Carpetas del selector del POS (ej. «Cerveza»): agrupan, dentro de una sección, tanto productos sueltos como ítems agrupados que comparten género. No
          implican mismo precio ni sustituibilidad (eso lo maneja «Ítems agrupados de la carta»); no cambian la carta pública que ve el cliente. Un producto sin
          género (o con uno apagado) sigue apareciendo suelto.
        </p>
        <ul className="flex flex-col gap-2">
          {datos.generos.map((g) => {
            const id = g.id;
            const activo = g.activo;
            return (
              <li key={g.id} className="rounded border p-3" data-genero-carta={g.nombre}>
                <details>
                  <summary className="cursor-pointer text-sm max-md:min-h-11 max-md:py-2">
                    <span className="font-medium">{g.nombre}</span> · orden {g.orden} · {g.activo ? "activo" : "apagado"}
                  </summary>
                  {puedeEditarGeneros ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        return refrescarSiOk(await guardarGeneroCarta({ id, nombre: campo(fd, "nombre"), orden: campo(fd, "orden") }));
                      }}
                      className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                    >
                      <CamposGenero valores={g} />
                      <div className="sm:col-span-2">
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar género
                        </button>
                      </div>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Nombre">{g.nombre}</Dato>
                      <Dato etiqueta="Orden">{g.orden}</Dato>
                    </DatosSoloLectura>
                  )}
                </details>
                {puedeEditarGeneros && (
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return refrescarSiOk(await actualizarActivoGeneroCarta(id, !activo));
                    }}
                    className="mt-2"
                  >
                    <button type="submit" className={CLASE_ENLACE_DE_ACCION}>
                      {g.activo ? `Apagar «${g.nombre}»` : `Prender «${g.nombre}»`}
                    </button>
                  </FormConResultado>
                )}
              </li>
            );
          })}
          {!datos.generos.length && <li className="text-sm text-neutral-500">Todavía no hay géneros.</li>}
        </ul>

        {puedeEditarGeneros && (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(await guardarGeneroCarta({ nombre: campo(fd, "nombre"), orden: campo(fd, "orden") }));
            }}
            className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
          >
            <h3 className="text-sm font-medium sm:col-span-2">Nuevo género</h3>
            <CamposGenero ordenSugerido={datos.generos.length} />
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Crear género
              </button>
            </div>
          </FormConResultado>
        )}
      </section>

      {/* 3. Productos en la carta (CARTA-MANT F1): lo que ve el cliente, por sección; abajo, plegado, lo que está «Fuera de carta» (el POS y el menú del día), que NO es un faltante. */}
      <section aria-labelledby="titulo-contenido" className="flex flex-col gap-3">
        <h2 id="titulo-contenido" className="text-lg font-medium">
          Productos en la carta
        </h2>
        <p className="text-sm text-neutral-500">
          Lo que ve el cliente en la carta pública de esta sucursal, por sección. Tocá una sección para ver sus productos y uno para editar su contenido. El nombre, el precio y la
          disponibilidad se editan en Catálogo.
        </p>

        {datos.visiblesSinSeccion.length > 0 && (
          <div className="rounded border border-amber-300 p-3 dark:border-amber-700">
            <h3 className="text-sm font-medium text-amber-700 dark:text-amber-600">Visibles pero sin sección de carta activa (no salen en la carta)</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {datos.visiblesSinSeccion.map((p) => (
                <li key={p.productoId}>{p.nombre}</li>
              ))}
            </ul>
          </div>
        )}

        {sinStock.size > 0 && (
          <div className="rounded border border-amber-300 p-3 dark:border-amber-700" data-avisos-de-stock>
            <h3 className="text-sm font-medium text-amber-700 dark:text-amber-600">El sistema registra stock 0 de un ingrediente (siguen en la carta)</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
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

        {carta.secciones.map((s) => (
          <GrupoDeLaCarta
            key={s.id}
            nombre={s.nombre}
            detalle={s.activa ? null : "sección apagada: no sale en la carta"}
            productos={s.productos}
            vacio="Todavía no tiene productos en esta sucursal."
            fila={(p) => filaDeProducto(p)}
          />
        ))}
        {carta.sinSeccion.length > 0 && <GrupoDeLaCarta nombre="Ocultos, sin sección" detalle={null} productos={carta.sinSeccion} vacio="" fila={(p) => filaDeProducto(p)} />}
        {carta.enAgrupados.length > 0 && (
          <GrupoDeLaCarta nombre="Dentro de un ítem agrupado" detalle="salen en la carta dentro de su agrupado" productos={carta.enAgrupados} vacio="" fila={(p) => filaDeProducto(p)} />
        )}

        <FueraDeCarta
          productos={carta.fueraDeCarta.map((p) => ({ id: p.id, nombre: p.nombre, precio: `$${p.precioAca.toLocaleString("es-AR")}` }))}
          secciones={seccionesActivas.map((s) => ({ id: s.id, nombre: s.nombre }))}
          puedeAgregar={puedeEditarContenido}
          agregar={async (productoId: string, seccionCartaId: string) => {
            "use server";
            return refrescarSiOk(await agregarProductoALaCarta({ sucursalId, productoId, seccionCartaId }));
          }}
        />
      </section>

      {/* 4. Promos (de la empresa; cada sucursal las prende y, si quiere, les pone su precio) */}
      <section aria-labelledby="titulo-promos" className="flex flex-col gap-3">
        <h2 id="titulo-promos" className="text-lg font-medium">
          Promos
        </h2>
        <p className="text-sm text-neutral-500">
          Una promo se define una sola vez para toda la empresa. Cada sucursal decide si la prende (apagada no sale en la carta ni en el POS) y, si quiere, le pone su propio precio.
        </p>
        <ul className="flex flex-col gap-2">
          {datos.promos.map((pr) => {
            const id = pr.id;
            const activa = pr.activa;
            const prendidaAca = pr.prendidaAca;
            const combo = combos.porPromo[pr.id] ?? { lugares: [], vigencia: { version: 1, vigenteDesde: null, vigenteHasta: null, diasDeSemana: null } };
            const lugares = combo.lugares;
            const versionDeLaPromo = combo.vigencia.version;
            return (
              <li key={pr.id} className="rounded border p-3" data-promo-carta={pr.titulo}>
                <details>
                  <summary className="cursor-pointer text-sm max-md:min-h-11 max-md:py-2">
                    <span className="font-medium">{pr.titulo}</span> · ${pr.precioAca.toLocaleString("es-AR")}
                    {pr.precioLocal !== null ? (datos.precioLocalActivo ? " (precio de esta sucursal)" : " (no rige: precio local apagado)") : ""} · {pr.seccionCarta} ·{" "}
                    {!pr.activa ? "apagada en toda la empresa" : pr.prendidaAca ? "prendida acá" : "apagada acá"} ·{" "}
                    {pr.cupos.length + lugares.length ? (
                      <>
                        Armable — {pr.cupos.length + lugares.length} cupo{pr.cupos.length + lugares.length === 1 ? "" : "s"}
                      </>
                    ) : (
                      "Informativa (sin cupos)"
                    )}
                  </summary>
                  {puedeDefinirPromos ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        return refrescarSiOk(
                          await guardarPromoCarta({ id, seccionCartaId: campo(fd, "seccionCartaId"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), precio: campo(fd, "precio"), orden: campo(fd, "orden") })
                        );
                      }}
                      className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                    >
                      <CamposPromo secciones={datos.secciones} valores={pr} />
                      <div className="sm:col-span-2">
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar promo
                        </button>
                      </div>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Título">{pr.titulo}</Dato>
                      <Dato etiqueta="Sección de carta">{pr.seccionCarta}</Dato>
                      <Dato etiqueta="Descripción" ancho>
                        {pr.descripcion}
                      </Dato>
                      <Dato etiqueta="Precio de la empresa">${pr.precio.toLocaleString("es-AR")}</Dato>
                      <Dato etiqueta="Orden">{pr.orden}</Dato>
                    </DatosSoloLectura>
                  )}

                  {/* Precio propio de esta sucursal (opcional): vacío = usa el de la empresa. */}
                  {puedePrecioLocalPromos ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        const texto = campo(fd, "precioLocal").trim();
                        return refrescarSiOk(await guardarPrecioLocalPromoCarta(id, texto === "" ? null : texto));
                      }}
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      <label className="flex flex-col gap-1 text-sm">
                        Precio en esta sucursal (vacío = el de la empresa)
                        <input name="precioLocal" type="number" min={0} step="0.01" defaultValue={pr.precioLocal ?? ""} className={CLASE_INPUT} />
                      </label>
                      <button type="submit" className={CLASE_BOTON}>
                        Guardar precio de esta sucursal
                      </button>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Precio en esta sucursal">
                        {pr.precioLocal !== null ? `$${pr.precioLocal.toLocaleString("es-AR")}${datos.precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : "El de la empresa"}
                      </Dato>
                    </DatosSoloLectura>
                  )}

                  {/* Cupos (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): con uno o más, la promo pasa a ser ARMABLE en el POS. */}
                  <h3 className="mt-3 text-sm font-medium">Cupos</h3>
                  {puedeDefinirPromos ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        const cupos = datos.secciones.flatMap((s) => {
                          if (!fd.get(`incluir_${s.id}`)) return [];
                          return [{ seccionCartaId: s.id, cantidadMinima: campo(fd, `min_${s.id}`), cantidadMaxima: campo(fd, `max_${s.id}`) }];
                        });
                        // GO-3b (D3): la lista que se guarda es la FINAL, de todos los tipos: los lugares de entradas que siguen tildados van también (si no, se darían de baja).
                        const deEntradas = lugaresDelFormulario(fd);
                        return refrescarSiOk(await guardarCuposPromoCarta(id, [...cupos, ...deEntradas]));
                      }}
                      className="mt-1 flex flex-col gap-2"
                    >
                      <p className="text-sm text-neutral-500">Tildá de qué secciones se arma esta promo, con cuántas unidades mínimas y máximas de cada una (D1).</p>
                      {/* Paso 13 (opcional, no bloqueante): con los cupos YA guardados, cuánta holgura hay hoy antes de tocar el piso de
                          $0,01 por unidad en el peor caso (D3) — guardarCuposPromoCarta rechaza de una si un cambio lo cruza; esto avisa
                          ANTES de intentarlo, con lo que hay guardado ahora mismo (no recalcula en vivo lo que se está tipeando). */}
                      {pr.cupos.length > 0 &&
                        (() => {
                          const unidadesEnElPeorCaso = pr.cupos.reduce((suma, c) => suma + c.cantidadMaxima, 0);
                          const minimo = precioMinimoPromo([{ cantidad: unidadesEnElPeorCaso }]);
                          const holgura = pr.precio - minimo;
                          return (
                            <p className="text-xs text-neutral-500" data-aviso-peor-caso={pr.titulo}>
                              Con los cupos de hoy, el peor caso son {unidadesEnElPeorCaso} unidad{unidadesEnElPeorCaso === 1 ? "" : "es"} y el precio mínimo permitido es $
                              {minimo.toLocaleString("es-AR")}
                              {holgura > 0 ? ` — hay $${holgura.toLocaleString("es-AR")} de margen antes de ese piso si subís algún máximo.` : "."}
                            </p>
                          );
                        })()}
                      <CamposCupos secciones={datos.secciones} guardados={pr.cupos} />
                      <CamposLugares lugares={lugares} />
                      <div>
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar cupos
                        </button>
                      </div>
                    </FormConResultado>
                  ) : pr.cupos.length + lugares.length ? (
                    <DatosSoloLectura className="mt-1">
                      {pr.cupos.map((c) => (
                        <Dato key={c.id} etiqueta={c.seccionCarta}>
                          {c.cantidadMinima} a {c.cantidadMaxima}
                        </Dato>
                      ))}
                      {lugares.map((l) => (
                        <Dato key={l.id} etiqueta={`${l.nombre} (${l.tipo === "DEL_DIA" ? "del día" : "lista"})`}>
                          {l.cantidadMinima} a {l.cantidadMaxima}
                        </Dato>
                      ))}
                    </DatosSoloLectura>
                  ) : (
                    <p className="mt-1 text-sm text-neutral-500">Sin cupos: esta promo es solo informativa, el POS la ignora.</p>
                  )}

                  {/* GO-3b (U1): las entradas de cada lugar LISTA (con una sola y mínimo = máximo, viene FIJO). Los platos de un lugar «del día» se cargan en Movimientos → Menú del día. */}
                  {lugares.map((l) => {
                    // Los closures "use server" capturan solo el id del lugar (texto): lo que capturan viaja al cliente.
                    const cupoId = l.id;
                    return (
                    <div key={l.id} className="mt-3 flex flex-col gap-1" data-lugar-de-combo={l.nombre}>
                      <h4 className="text-sm font-medium">
                        {l.nombre} · {l.tipo === "DEL_DIA" ? "del día" : esFijo(l) ? "viene fijo" : `se elige ${l.cantidadMinima === l.cantidadMaxima ? l.cantidadMaxima : `de ${l.cantidadMinima} a ${l.cantidadMaxima}`}`}
                      </h4>
                      {l.tipo === "DEL_DIA" ? (
                        <p className="text-sm text-neutral-500">
                          El plato lo carga cada sucursal por día en{" "}
                          <EnlaceInterno href="/movimientos/menu-del-dia" className="underline">
                            Menú del día
                          </EnlaceInterno>
                          .
                        </p>
                      ) : (
                        <>
                          {l.entradas.length === 0 ? (
                            <p className="text-sm text-neutral-500">Sin entradas todavía: sumá los productos que se pueden elegir acá.</p>
                          ) : (
                            <ul className="flex flex-col divide-y text-sm">
                              {l.entradas.map((e) => {
                                const entradaId = e.id;
                                const activaAhora = e.activa;
                                return (
                                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1" data-entrada-de-lugar={e.nombre}>
                                    <span className={e.activa ? "" : "text-neutral-500 line-through"}>{e.nombre}</span>
                                    {puedeDefinirPromos && (
                                      <FormConResultado
                                        accion={async () => {
                                          "use server";
                                          return refrescarSiOk(await actualizarActivaEntradaDeCupo({ entradaId, activa: !activaAhora }));
                                        }}
                                      >
                                        <button type="submit" className={CLASE_ENLACE_DE_ACCION}>
                                          {e.activa ? `Sacar «${e.nombre}»` : `Volver a ofrecer «${e.nombre}»`}
                                        </button>
                                      </FormConResultado>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {puedeDefinirPromos && (
                            <AgregarEntradaDeLugar
                              lugar={l.nombre}
                              productos={combos.productos}
                              agregar={async (productoId: string, opciones: { opcionId: string; cantidad: number }[]) => {
                                "use server";
                                return refrescarSiOk(await agregarEntradaDeCupo({ cupoId, productoId, opciones }));
                              }}
                            />
                          )}
                        </>
                      )}
                    </div>
                    );
                  })}

                  {/* GO-3b (D-7): la vigencia de la promo (fechas y días de la semana); sin nada = vale siempre. Se evalúa al agregarla a una mesa. */}
                  <h3 className="mt-3 text-sm font-medium">Vigencia</h3>
                  {puedeDefinirPromos ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        const dias = [0, 1, 2, 3, 4, 5, 6].filter((d) => fd.get(`dia_${d}`));
                        const desde = campo(fd, "vigenteDesde").trim();
                        const hasta = campo(fd, "vigenteHasta").trim();
                        return refrescarSiOk(
                          await guardarVigenciaPromoCarta({ promoCartaId: id, versionEsperada: versionDeLaPromo, vigenteDesde: desde || null, vigenteHasta: hasta || null, diasDeSemana: dias })
                        );
                      }}
                      className="mt-1 flex flex-col gap-2"
                    >
                      <CamposVigencia vigencia={combo.vigencia} />
                      <div>
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar vigencia
                        </button>
                      </div>
                    </FormConResultado>
                  ) : (
                    <p className="mt-1 text-sm">{textoDeVigencia(combo.vigencia)}</p>
                  )}
                </details>
                {puedeActivarPromos && (
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return refrescarSiOk(await actualizarActivaPromoCartaEnSucursal(id, !prendidaAca));
                    }}
                    className="mt-2"
                  >
                    <button type="submit" className={CLASE_ENLACE_DE_ACCION}>
                      {pr.prendidaAca ? `Apagar «${pr.titulo}» en esta sucursal` : `Prender «${pr.titulo}» en esta sucursal`}
                    </button>
                  </FormConResultado>
                )}
                {puedeDefinirPromos && (
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return refrescarSiOk(await actualizarActivaPromoCarta(id, !activa));
                    }}
                    className="mt-2"
                  >
                    <button type="submit" className={CLASE_ENLACE_DE_ACCION}>
                      {pr.activa ? `Apagar «${pr.titulo}» en toda la empresa` : `Prender «${pr.titulo}» en toda la empresa`}
                    </button>
                  </FormConResultado>
                )}
              </li>
            );
          })}
          {!datos.promos.length && <li className="text-sm text-neutral-500">La empresa no tiene promos cargadas.</li>}
        </ul>

        {!puedeDefinirPromos ? null : seccionesActivas.length > 0 ? (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarPromoCarta({ seccionCartaId: campo(fd, "seccionCartaId"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), precio: campo(fd, "precio"), orden: campo(fd, "orden") })
              );
            }}
            className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
          >
            <h3 className="text-sm font-medium sm:col-span-2">Nueva promo (queda prendida en esta sucursal)</h3>
            <CamposPromo secciones={seccionesActivas} />
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Crear promo
              </button>
            </div>
          </FormConResultado>
        ) : (
          <p className="text-sm text-neutral-500">Para cargar una promo hace falta al menos una sección de carta activa.</p>
        )}
      </section>
    </div>
  );
}

/**
 * CARTA-MANT: un grupo plegado de la carta (una sección, los ocultos sin sección o los que están dentro de un agrupado): el nombre con cuántos productos tiene (y cuántos ocultos) en el resumen,
 * y adentro el renglón de cada uno. Plegado por defecto, como en el prototipo («tocá una sección para ver sus productos»).
 */
function GrupoDeLaCarta({
  nombre,
  detalle,
  productos,
  vacio,
  fila,
}: {
  nombre: string;
  detalle: string | null;
  productos: ProductoParaMantener[];
  vacio: string;
  fila: (p: ProductoParaMantener) => React.ReactNode;
}) {
  const ocultos = productos.filter((p) => p.contenido && !p.contenido.visibleEnCarta).length;
  return (
    <details className="rounded border" data-grupo-de-la-carta={nombre}>
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-baseline gap-x-2 px-3 py-2">
        <span className="font-medium [overflow-wrap:anywhere]">{nombre}</span>
        <span className="text-sm text-neutral-600 dark:text-neutral-400">
          {productos.length} producto{productos.length === 1 ? "" : "s"}
          {ocultos ? ` · ${ocultos} oculto${ocultos === 1 ? "" : "s"}` : ""}
          {detalle ? ` · ${detalle}` : ""}
        </span>
      </summary>
      <ul className="flex flex-col gap-2 border-t p-3">
        {productos.map(fila)}
        {!productos.length && vacio && <li className="text-sm text-neutral-500">{vacio}</li>}
      </ul>
    </details>
  );
}

function CamposSeccion({
  valores,
  ordenSugerido = 0,
}: {
  valores?: { nombre: string; titulo: string | null; descripcion: string | null; imagenUrl: string | null; orden: number };
  /** Alta (DA5): el orden inicial; al editar se muestra el guardado. */
  ordenSugerido?: number;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Nombre
        <input name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Platos Principales" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Título (opcional, si no se usa el nombre)
        <input name="titulo" defaultValue={valores?.titulo ?? ""} placeholder="Del fuego" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Descripción (opcional)
        <textarea name="descripcion" rows={2} defaultValue={valores?.descripcion ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Imagen (URL https, opcional)
        <input name="imagenUrl" type="url" defaultValue={valores?.imagenUrl ?? ""} placeholder="https://…" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? ordenSugerido} className={CLASE_INPUT} />
      </label>
    </>
  );
}

function CamposGenero({
  valores,
  ordenSugerido = 0,
}: {
  valores?: { nombre: string; orden: number };
  /** Alta: el orden inicial; al editar se muestra el guardado. */
  ordenSugerido?: number;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Nombre
        <input name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Cerveza" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? ordenSugerido} className={CLASE_INPUT} />
      </label>
    </>
  );
}

/** El select "Género (opcional)" del contenido de un PV o de un ítem agrupado (docs/plan-genero-carta-2026-09-26.md). */
function SelectGenero({ generos, guardado }: { generos: OpcionGenero[]; guardado: string | null }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      Género (opcional)
      <select name="generoCartaId" defaultValue={guardado ?? ""} className={CLASE_INPUT}>
        <option value="">— sin género (sale suelto) —</option>
        {generos.map((g) => (
          <option key={g.id} value={g.id} disabled={!g.activo}>
            {g.nombre}
            {g.activo ? "" : " (apagado)"}
          </option>
        ))}
      </select>
    </label>
  );
}

function CamposPromo({
  secciones,
  valores,
}: {
  secciones: { id: string; nombre: string; activa: boolean }[];
  valores?: { seccionCartaId: string; titulo: string; descripcion: string | null; precio: number; orden: number };
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Título
        <input name="titulo" required defaultValue={valores?.titulo ?? ""} placeholder="1 pizza + coca 1,5 L" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Sección de carta
        <select name="seccionCartaId" required defaultValue={valores?.seccionCartaId ?? ""} className={CLASE_INPUT}>
          {!valores && <option value="">— elegí una —</option>}
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
              {s.activa ? "" : " (apagada)"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Descripción (opcional)
        <textarea name="descripcion" rows={2} defaultValue={valores?.descripcion ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Precio
        <input name="precio" type="number" min={0} step="0.01" required defaultValue={valores?.precio ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? 0} className={CLASE_INPUT} />
      </label>
    </>
  );
}

/**
 * Cupos de una promo ARMABLE (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): una fila por CADA sección de carta, con un
 * checkbox "incluir" + mínimo/máximo — full-replace al guardar (`guardarCuposPromoCarta`): la sección tildada con sus
 * cantidades entra, la que no queda tildada se borra si ya era un cupo. Sin cliente propio: los checkboxes e inputs son HTML
 * nativo, `FormConResultado` ya resetea el form entero cuando la acción sale bien (vuelve a los `defaultValue`/`defaultChecked`
 * de lo recién guardado, en el próximo render del servidor).
 */
/** GO-3b: ¿un lugar LISTA viene FIJO? (una sola entrada activa y mínimo = máximo, de 1 o más: lo completa el servidor). */
function esFijo(l: LugarDeCombo): boolean {
  return l.tipo === "LISTA" && l.entradas.filter((e) => e.activa).length === 1 && l.cantidadMinima >= 1 && l.cantidadMinima === l.cantidadMaxima;
}

const NOMBRES_DE_DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** GO-3b: «Vale siempre», «Del 2026-10-01 al 2026-10-31, lunes a viernes»… */
function textoDeVigencia(v: VigenciaDePromoAdmin): string {
  const partes: string[] = [];
  if (v.vigenteDesde) partes.push(`desde el ${v.vigenteDesde}`);
  if (v.vigenteHasta) partes.push(`hasta el ${v.vigenteHasta}`);
  if (v.diasDeSemana !== null) partes.push(`los ${NOMBRES_DE_DIAS.filter((_d, i) => (v.diasDeSemana! & (1 << i)) !== 0).map((d) => d.toLowerCase()).join(", ")}`);
  return partes.length ? `Vale ${partes.join(", ")}.` : "Vale siempre.";
}

/** GO-3b: los campos de la vigencia (las fechas son opcionales; los días, tildados todos = todos los días). */
function CamposVigencia({ vigencia }: { vigencia: VigenciaDePromoAdmin }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <label className="flex flex-col gap-1">
          Desde (opcional)
          <input type="date" name="vigenteDesde" defaultValue={vigencia.vigenteDesde ?? ""} className={CLASE_INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          Hasta (opcional)
          <input type="date" name="vigenteHasta" defaultValue={vigencia.vigenteHasta ?? ""} className={CLASE_INPUT} />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1">Días en que vale</legend>
        {NOMBRES_DE_DIAS.map((d, i) => (
          <label key={d} className={`flex items-center gap-1 ${CLASE_CASILLA}`}>
            <input type="checkbox" name={`dia_${i}`} defaultChecked={vigencia.diasDeSemana === null || (vigencia.diasDeSemana & (1 << i)) !== 0} />
            {d}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-neutral-500">{textoDeVigencia(vigencia)} Se mira al agregar la promo a una mesa: lo que ya está en una mesa no cambia.</p>
    </div>
  );
}

/**
 * GO-3b (U1): los lugares de ENTRADAS de la promo en el formulario de cupos: cada uno con «incluir» (destildado, se da de baja: sus entradas quedan guardadas por si vuelve) y su mínimo y máximo;
 * el nombre es su identidad (cambiarlo es otro lugar). Abajo, una fila para sumar un lugar nuevo: una LISTA («Bebida») o uno DEL DÍA («Plato del día»).
 */
function CamposLugares({ lugares }: { lugares: LugarDeCombo[] }) {
  return (
    <div className="flex flex-col gap-1">
      {lugares.map((l) => (
        <div key={l.id} data-cupo-lugar={l.nombre} className={CLASE_FILA_DE_CUPO}>
          <input type="hidden" name="lugar_id" value={l.id} />
          <input type="hidden" name={`lugar_tipo_${l.id}`} value={l.tipo} />
          <input type="hidden" name={`lugar_nombre_${l.id}`} value={l.nombre} />
          <label className={CLASE_NOMBRE_DE_CUPO}>
            <input type="checkbox" name={`lugar_incluir_${l.id}`} defaultChecked />
            {l.nombre} ({l.tipo === "DEL_DIA" ? "del día" : "lista"})
          </label>
          <label className={CLASE_CANTIDAD_DE_CUPO}>
            mín.
            <input type="number" name={`lugar_min_${l.id}`} min={0} step={1} defaultValue={l.cantidadMinima} className={CLASE_NUMERO} />
          </label>
          <label className={CLASE_CANTIDAD_DE_CUPO}>
            máx.
            <input type="number" name={`lugar_max_${l.id}`} min={1} step={1} defaultValue={l.cantidadMaxima} className={CLASE_NUMERO} />
          </label>
        </div>
      ))}
      <fieldset className="mt-1 grid min-w-0 grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap sm:items-end">
        <legend className="mb-1 text-sm">Sumar un lugar (opcional)</legend>
        <label className="col-span-2 flex flex-col gap-1">
          Tipo
          <select name="nuevo_lugar_tipo" defaultValue="LISTA" className={CLASE_INPUT}>
            <option value="LISTA">Lista de productos</option>
            <option value="DEL_DIA">Plato del día</option>
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          Nombre
          <input name="nuevo_lugar_nombre" maxLength={80} placeholder="Ej.: Bebida" className={CLASE_INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          mín.
          <input type="number" name="nuevo_lugar_min" min={0} step={1} defaultValue={1} className={CLASE_NUMERO} />
        </label>
        <label className="flex flex-col gap-1">
          máx.
          <input type="number" name="nuevo_lugar_max" min={1} step={1} defaultValue={1} className={CLASE_NUMERO} />
        </label>
      </fieldset>
    </div>
  );
}

function CamposCupos({
  secciones,
  guardados,
}: {
  secciones: { id: string; nombre: string; activa: boolean }[];
  guardados: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[];
}) {
  const porSeccion = new Map(guardados.map((c) => [c.seccionCartaId, c]));
  return (
    <div className="flex flex-col gap-1">
      {secciones.map((s) => {
        const g = porSeccion.get(s.id);
        return (
          <div key={s.id} data-cupo-seccion={s.nombre} className={CLASE_FILA_DE_CUPO}>
            <label className={CLASE_NOMBRE_DE_CUPO}>
              <input type="checkbox" name={`incluir_${s.id}`} defaultChecked={!!g} />
              {s.nombre}
              {s.activa ? "" : " (apagada)"}
            </label>
            <label className={CLASE_CANTIDAD_DE_CUPO}>
              mín.
              <input type="number" name={`min_${s.id}`} min={0} step={1} defaultValue={g?.cantidadMinima ?? 0} className={CLASE_NUMERO} />
            </label>
            <label className={CLASE_CANTIDAD_DE_CUPO}>
              máx.
              <input type="number" name={`max_${s.id}`} min={1} step={1} defaultValue={g?.cantidadMaxima ?? 1} className={CLASE_NUMERO} />
            </label>
          </div>
        );
      })}
    </div>
  );
}

function ContenidoProducto({
  producto: p,
  ubicacion,
  puedeEditar,
  puedeDescuento,
  precioLocalActivo,
}: {
  producto: ProductoCartaAdmin;
  ubicacion: UbicacionEnCarta;
  puedeEditar: boolean;
  puedeDescuento: boolean;
  precioLocalActivo: boolean;
}) {
  const productoId = p.id;
  // Un PV agrupado sale solo dentro de su ítem agrupado (docs/plan-agrupacion-items-carta-2026-09-24.md, D3/M6): su contenido propio se ignora mientras tanto.
  const estado = p.agrupadoEn
    ? `en «${p.agrupadoEn}»`
    : !p.contenido
      ? "sin contenido"
      : p.contenido.visibleEnCarta
        ? (p.seccionCarta ? "se muestra" : "visible, sin sección")
        : "oculto";
  return (
    <li className="rounded border p-3" data-contenido-carta={p.nombre}>
      <details>
        <summary className="cursor-pointer text-sm max-md:min-h-11 max-md:py-2">
          <span className="font-medium">{p.nombre}</span> · {p.seccionCarta ?? "sin sección de carta"} · ${p.precio.toLocaleString("es-AR")} ·{" "}
          {estado}
          {p.contenido?.especial ? " · ★" : ""}
          {p.generoCarta ? ` · ${p.generoCarta}` : ""}
          {p.descuento !== null ? ` · −${p.descuento} %${precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : ""}
        </summary>
        {p.agrupadoEn && (
          <p className="mt-2 text-sm text-neutral-500">
            Sale en la carta dentro de «{p.agrupadoEn}» (
            <EnlaceInterno href="/carta/agrupados" className="underline">
              Ítems agrupados de la carta
            </EnlaceInterno>
            ): mientras esté agrupado, el contenido de acá no se usa.
          </p>
        )}
        {!puedeEditar ? (
          <ContenidoSoloLectura producto={p} ubicacion={ubicacion} />
        ) : (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarContenidoCartaProducto(productoId, {
                  visibleEnCarta: fd.get("visibleEnCarta") === "on",
                  seccionCartaId: campo(fd, "seccionCartaId") || null,
                  descripcion: campo(fd, "descripcion"),
                  tags: campo(fd, "tags"),
                  especial: fd.get("especial") === "on",
                  orden: campo(fd, "orden"),
                  generoCartaId: campo(fd, "generoCartaId") || null,
                })
              );
            }}
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <label className={`flex items-center gap-2 text-sm ${CLASE_CASILLA}`}>
              <input name="visibleEnCarta" type="checkbox" defaultChecked={p.contenido?.visibleEnCarta ?? true} /> Se muestra en la carta
            </label>
            <label className={`flex items-center gap-2 text-sm ${CLASE_CASILLA}`}>
              <input name="especial" type="checkbox" defaultChecked={p.contenido?.especial ?? false} /> Especial (★)
            </label>
            <SeccionYOrden
              secciones={ubicacion.secciones}
              cantidadPorSeccion={ubicacion.cantidadPorSeccion}
              guardado={p.contenido && { seccionCartaId: p.contenido.seccionCartaId, orden: p.contenido.orden }}
              etiquetaSeccion="Sección de carta (obligatoria si se muestra)"
            />
            <SelectGenero generos={ubicacion.generos} guardado={p.contenido?.generoCartaId ?? null} />
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Descripción (opcional)
              <textarea name="descripcion" rows={2} defaultValue={p.contenido?.descripcion ?? ""} className={CLASE_INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Tags (separados por coma)
              <input name="tags" defaultValue={p.contenido?.tags.join(", ") ?? ""} placeholder="Regional, Sin TACC" className={CLASE_INPUT} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Guardar contenido de «{p.nombre}»
              </button>
            </div>
          </FormConResultado>
        )}

        {/* Producto con descuento (% por sucursal; no es una promo). Un producto agrupado no lo admite: el renglón agrupado muestra un solo precio. */}
        {!p.agrupadoEn &&
          (puedeDescuento ? (
            <FormConResultado
              accion={async (fd: FormData) => {
                "use server";
                const texto = campo(fd, "descuento").trim();
                return refrescarSiOk(await guardarDescuentoProducto(productoId, texto === "" ? null : texto));
              }}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1 text-sm">
                Descuento en esta sucursal, % (vacío = sin descuento)
                <input name="descuento" type="number" min={0} max={99.99} step="0.01" defaultValue={p.descuento ?? ""} className={CLASE_INPUT} />
              </label>
              <button type="submit" className={CLASE_BOTON}>
                Guardar descuento de «{p.nombre}»
              </button>
              {!precioLocalActivo && p.descuento !== null && <p className="w-full text-sm text-neutral-500">No rige: el precio local está apagado en esta sucursal (se cobra el precio de lista).</p>}
            </FormConResultado>
          ) : (
            <DatosSoloLectura className="mt-3">
              <Dato etiqueta="Descuento en esta sucursal">{p.descuento !== null ? `${p.descuento} %${precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : "Sin descuento"}</Dato>
            </DatosSoloLectura>
          ))}
      </details>
    </li>
  );
}

/** El contenido de carta de un PV como texto, para quien puede ver la carta pero no editarla. */
function ContenidoSoloLectura({ producto: p, ubicacion }: { producto: ProductoCartaAdmin; ubicacion: UbicacionEnCarta }) {
  const c = p.contenido;
  if (!c) return <p className="mt-3 text-sm text-neutral-500">Todavía no tiene contenido de carta.</p>;
  const seccion = ubicacion.secciones.find((s) => s.id === c.seccionCartaId);
  const genero = ubicacion.generos.find((g) => g.id === c.generoCartaId);
  return (
    <DatosSoloLectura className="mt-3">
      <Dato etiqueta="Se muestra en la carta">{c.visibleEnCarta ? "Sí" : "No"}</Dato>
      <Dato etiqueta="Especial (★)">{c.especial ? "Sí" : "No"}</Dato>
      <Dato etiqueta="Sección de carta">{seccion && `${seccion.nombre}${seccion.activa ? "" : " (apagada)"}`}</Dato>
      <Dato etiqueta="Género">{genero && `${genero.nombre}${genero.activo ? "" : " (apagado)"}`}</Dato>
      <Dato etiqueta="Orden">{c.orden}</Dato>
      <Dato etiqueta="Descripción" ancho>
        {c.descripcion}
      </Dato>
      <Dato etiqueta="Tags" ancho>
        {c.tags.join(", ")}
      </Dato>
    </DatosSoloLectura>
  );
}
