"use server";

import type { PrismaClient, TipoProducto } from "@prisma/client";
import { azarDelProceso } from "@/lib/azar";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa } from "@/server/acceso/gate";
import { puedeEditarCamposSensiblesDelProducto } from "@/server/acceso/campos-sensibles-de-producto";
import { escaparComodinesLike, textoDeBusqueda } from "@/core/texto";
import { disponibilidadDeProductos } from "@/server/lecturas/catalogo/disponibilidad";
import { whereDisponibleEn, whereDisponibleEnAlguna, type FiltroSelectorProducto } from "@/core/catalogo/public";
import type { CampoSensibleDelProducto } from "@/core/features/catalogo/productos.schema";
import { guardComandoAgregarPresentacionAlternativa, guardComandoDarDeAltaProductoRapido, guardComandoDatosDeProducto, guardComandoSincronizarPrecioGrupoCarta } from "@/core/features/catalogo/productos.guard";
import { ofrecerSincronizarPrecio } from "@/core/carta/public";
import { aResultadoAccion } from "@/core/resultado-caso";
import { resolverGrupoDeProducto } from "@/server/lecturas/carta/grupo-de-producto";
import { conPermiso, conPermisoDeEmpresa } from "../con-permiso";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { error, okConId, type ResultadoAccion, type ResultadoConId, type ResultadoConSincronizable } from "../tipos";
import { requerirVer, requerirVerAlguna, requerirVerDeEmpresa } from "../con-sesion";
import { actualizarActivaPresentacionCasoDeUso } from "./casos-de-uso/actualizar-activa-presentacion";
import { actualizarDisponibilidadProductoCasoDeUso } from "./casos-de-uso/actualizar-disponibilidad-producto";
import { actualizarProductoCasoDeUso } from "./casos-de-uso/actualizar-producto";
import { agregarPresentacionAlternativaCasoDeUso } from "./casos-de-uso/agregar-presentacion-alternativa";
import { asignarInsumoAProductoCasoDeUso } from "./casos-de-uso/asignar-insumo-a-producto";
import { darDeAltaProductoCasoDeUso } from "./casos-de-uso/dar-de-alta-producto";
import { darDeAltaProductoRapidoCasoDeUso } from "./casos-de-uso/dar-de-alta-producto-rapido";
import { sincronizarPrecioGrupoCartaCasoDeUso } from "./casos-de-uso/sincronizar-precio-grupo-carta";

/**
 * Desde el Hito 4 de la pureza (bloque 4.3, pasos H4C-11 a H4C-13) las ocho mutaciones de este archivo son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{asignar-insumo-a-producto,dar-de-alta-producto-rapido,dar-de-alta-producto,actualizar-producto,sincronizar-precio-grupo-carta,
 * actualizar-disponibilidad-producto,agregar-presentacion-alternativa,actualizar-activa-presentacion}.ts`; escrituras en server/persistencia/catalogo/productos.ts):
 * el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Las lecturas (H8: `buscarProductosSelector`, `obtener*`, `listar*`) siguen acá con sus guardas. La acción
 * conserva los efectos de Next (revalidar la carta pública) y el `sincronizable` de la edición, después de revalidar; las altas, la fuente de azar del proceso.
 */

/**
 * S-12 (D8 del dueño): ¿puede quien llama gestionar el COSTO DE CONSIGNACIÓN de un producto (si es de consignación, su proveedor y su precio)? Es `pagar_consignante` EDITAR en la
 * sucursal activa (piso administrador): la pantalla donde ese precio se vuelve deuda. La alta y la edición lo calculan acá, con el gate, y los casos de uso —que no chequean
 * permisos— lo reciben como dato. No se exporta: este archivo es `"use server"` y toda función exportada es un endpoint.
 */
async function puedeGestionarConsignacion(ctx: { usuarioId: string; sucursalId: string; db: PrismaClient }): Promise<boolean> {
  return (await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pagar_consignante", ctx.db)).editar;
}

export interface ProductoOpcion {
  id: string;
  codigo: string;
  nombre: string;
}

const LIMITE_SELECTOR = 20;

/**
 * Fuente de datos del combobox de producto (`<SelectorProducto>`), en todo
 * lugar donde antes había un `<select>` poblado con el catálogo entero
 * (`listarProductos()` sin límite — hallazgo de la diligencia de motor2:
 * "catálogo sin límite"). Sin término de búsqueda devuelve las primeras
 * `LIMITE_SELECTOR` en orden alfabético (para que el combobox no arranque
 * vacío); con término, filtra por nombre o código.
 */
export async function buscarProductosSelector(termino: string, filtro?: FiltroSelectorProducto): Promise<ProductoOpcion[]> {
  // H8 (D-2): el «O» de las claves de las 24 pantallas que muestran el selector (test/arquitectura/consumidores-de-lecturas-declarados.test.ts).
  const ctx = await requerirVerAlguna([
    "proceso_compra",
    "proceso_produccion",
    "proceso_consumo",
    "proceso_ajuste",
    "proceso_transferencia",
    "proceso_merma",
    "proceso_devolucion_consignacion",
    "proceso_devolucion_cliente",
    "proceso_devolucion_proveedor",
    "proceso_venta",
    "proceso_control",
    "precio_local",
    "traspaso_solicitar",
    "traspaso_enviar_directo",
    "stock_minimo",
    "stock_seccion_habitual",
    "stock_reclasificar",
    "conteo_frecuencia",
    "reporte_conteos",
    "reporte_historial",
    "guardar_receta",
    "pos_mesas",
    "alta_producto",
    "producto_ver_catalogo",
  ]);
  const t = textoDeBusqueda(termino);
  const condiciones = [
    ...(filtro?.tipo ? [{ tipo: filtro.tipo }] : []),
    ...(filtro?.soloDisponibles ? [whereDisponibleEn(ctx.sucursalId)] : []),
    ...(filtro?.soloDisponiblesEnAlguna ? [whereDisponibleEnAlguna()] : []),
    ...(filtro?.soloConStockReal ? [{ OR: [{ tipo: "MP" as const }, { tipo: "PV" as const, seProduce: true }] }] : []),
    ...(filtro?.soloSeProduce ? [{ seProduce: true }] : []),
    ...(filtro?.elegibleParaReceta ? [{ OR: [{ tipo: "PV" as const }, { tipo: "MP" as const, seProduce: true }] }] : []),
    ...(filtro?.esConsignacion !== undefined ? [{ esConsignacion: filtro.esConsignacion }] : []),
    ...(t ? [{ OR: [{ nombre: { contains: escaparComodinesLike(t), mode: "insensitive" as const } }, { codigo: { contains: escaparComodinesLike(t), mode: "insensitive" as const } }] }] : []),
  ];
  return ctx.db.producto.findMany({
    where: condiciones.length ? { AND: condiciones } : {},
    select: { id: true, codigo: true, nombre: true },
    orderBy: { nombre: "asc" },
    take: LIMITE_SELECTOR,
  });
}

/**
 * Un producto puntual por id, en la misma forma que el combobox — para mostrar su etiqueta después de elegirlo (ej. Conteo Físico, al agregar una fila manual).
 * Exige el «Ver» de alguna de sus dos pantallas: conteo físico o el reporte de conteos (H8, D-5).
 */
export async function obtenerProductoOpcion(productoId: string): Promise<ProductoOpcion | null> {
  const ctx = await requerirVerAlguna(["proceso_control", "reporte_conteos"]);
  return ctx.db.producto.findUnique({ where: { id: productoId }, select: { id: true, codigo: true, nombre: true } });
}

export interface InsumoDeProducto {
  productoCodigo: string;
  productoNombre: string;
  insumoId: string | null;
  insumoNombre: string | null;
  unidadStockId: string;
  unidadStockNombre: string;
}

/**
 * Info de agrupación de una MP existente — usada por el asistente de
 * "hermanar" del Alta/Editar Producto (`AsistenteHermanar`): al elegir "ya
 * compro esto con otro nombre/código", esto le dice al asistente si esa MP
 * ya tiene Insumo (se reusa con un solo click) o hace falta crear uno
 * nuevo y asignárselo retroactivamente.
 */
export async function obtenerInsumoDeProducto(productoId: string): Promise<InsumoDeProducto | null> {
  // H8: el formulario de producto, en alta o en edición.
  const ctx = await requerirVerAlguna(["alta_producto", "producto_ver_catalogo"]);
  const p = await ctx.db.producto.findUnique({
    where: { id: productoId },
    // S-15: solo lo que arma el resultado (la fila entera de `Producto` no sale de acá, pero se pide por `select` como toda lectura exportada: GT-3a).
    select: { codigo: true, nombre: true, insumoId: true, unidadStockId: true, insumo: { select: { nombre: true } }, unidadStock: { select: { nombre: true } } },
  });
  if (!p) return null;
  return {
    productoCodigo: p.codigo,
    productoNombre: p.nombre,
    insumoId: p.insumoId,
    insumoNombre: p.insumo?.nombre ?? null,
    unidadStockId: p.unidadStockId,
    unidadStockNombre: p.unidadStock.nombre,
  };
}

/**
 * Asigna el Insumo a una MP ya existente — la mitad "retroactiva" del
 * asistente de hermanar: cuando la MP elegida como "ya la compro" todavía
 * no tenía Insumo, se crea uno nuevo (`crearInsumo`) y este función se lo
 * asigna a ELLA, además de a la MP que se está dando de alta/editando
 * ahora — así el grupo queda armado de los dos lados, no solo del nuevo.
 * Misma validación de unidad que el alta/edición normal
 * (`validarUnidadInsumo`): no se puede agrupar si ya hay un producto
 * activo del mismo Insumo con otra unidad de stock.
 */
export async function asignarInsumoAProducto(productoId: string, insumoId: string): Promise<ResultadoAccion> {
  // Desde el Hito 4 (H4C-11): permiso → caso de uso (`casos-de-uso/asignar-insumo-a-producto.ts`) → `aResultadoAccion`. Sin guard (`SIN_GUARD`).
  return conPermisoDeEmpresa("producto_asignar_insumo", async (ctx) => {
    return aResultadoAccion(await asignarInsumoAProductoCasoDeUso(ctx, { productoId, insumoId }));
  });
}

/**
 * Precio de venta global de un producto puntual — usado por Precio Local para mostrar "precio global actual" sin traer el catálogo entero. Es un dato de
 * dinero: exige el «Ver» de `precio_local`, la clave de la única pantalla que lo consume (H8; antes bastaba la sesión).
 */
export async function obtenerPrecioVentaProducto(productoId: string): Promise<number | null> {
  const ctx = await requerirVer("precio_local");
  const p = await ctx.db.producto.findUnique({ where: { id: productoId }, select: { precioVenta: true } });
  return p ? Number(p.precioVenta) : null;
}

export interface PaginaProductos {
  items: {
    id: string;
    codigo: string;
    nombre: string;
    tipo: TipoProducto;
    /** Disponible EN LA SUCURSAL ACTIVA de quien mira la lista (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §10/P10). */
    disponibleAca: boolean;
    /** Cuántas sucursales (de `totalSucursales`) lo tienen disponible — para la columna "Sucursales" ("2 de 4"). */
    sucursalesDisponibles: number;
    totalSucursales: number;
  }[];
  nextCursor: string | null;
}

const TAMANO_PAGINA_CATALOGO = 50;

/** Tabla de administración de catálogo (`/catalogo/productos`) — paginado por cursor, con búsqueda opcional. Exige el «Ver» de `producto_ver_catalogo`, la clave de esa página (H8). */
export async function listarProductosPagina(cursor?: string, termino?: string): Promise<PaginaProductos> {
  const ctx = await requerirVerDeEmpresa("producto_ver_catalogo");
  const t = textoDeBusqueda(termino);
  // El cursor es un identificador que puede venir del cliente: sin NUL ni sustitutos sueltos (Postgres no los recibe), y vacío = primera página.
  const cursorLimpio = cursor ? textoDeBusqueda(cursor) : "";
  const items = await ctx.db.producto.findMany({
    where: t ? { OR: [{ nombre: { contains: escaparComodinesLike(t), mode: "insensitive" } }, { codigo: { contains: escaparComodinesLike(t), mode: "insensitive" } }] } : {},
    select: { id: true, codigo: true, nombre: true, tipo: true },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
    take: TAMANO_PAGINA_CATALOGO + 1,
    ...(cursorLimpio ? { cursor: { id: cursorLimpio }, skip: 1 } : {}),
  });

  const hayMas = items.length > TAMANO_PAGINA_CATALOGO;
  const pagina = hayMas ? items.slice(0, TAMANO_PAGINA_CATALOGO) : items;
  const ids = pagina.map((p) => p.id);

  // Batch, sin N+1 (una página entera de 50 filas): disponibilidad EN ESTA sucursal + cuántas sucursales en total la
  // tienen, para "Disponible acá" y "Sucursales" (§10/P10, ver disponibilidad-producto-consulta.ts).
  const [disponibleAcaPorProducto, conteos, totalSucursales] = await Promise.all([
    disponibilidadDeProductos(ctx.sucursalId, ids, ctx.db),
    ctx.db.disponibilidadProducto.groupBy({ by: ["productoId"], where: { productoId: { in: ids }, disponible: true }, _count: { productoId: true } }),
    ctx.db.sucursal.count({ where: { activo: true } }),
  ]);
  const sucursalesDisponiblesPorProducto = new Map(conteos.map((c) => [c.productoId, c._count.productoId]));

  return {
    items: pagina.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      tipo: p.tipo,
      disponibleAca: disponibleAcaPorProducto.get(p.id) === true,
      sucursalesDisponibles: sucursalesDisponiblesPorProducto.get(p.id) ?? 0,
      totalSucursales,
    })),
    nextCursor: hayMas ? pagina[pagina.length - 1].id : null,
  };
}

export interface DatosProducto {
  codigo?: string;
  nombre: string;
  tipo: TipoProducto;
  categoriaId?: string | null;
  unidadCompraId?: string | null;
  unidadStockId: string;
  factorConversion: number;
  observaciones?: string;
  insumoId?: string | null;
  precioVenta?: number;
  /**
   * Venta fraccionada (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): excepción de venta puntual de ESTE PV — ej. 0,5 para
   * "esta pizza se vende de a 1 o de a media". `undefined`/`null` (el caso común) = comportamiento actual, sin cambios. Solo tiene
   * sentido con `tipo: "PV"` (se rechaza si viene en un alta/edición de MP); validada contra `Unidad.decimales` de
   * `unidadStockId` cuando el producto "se produce" (R3, `validarPasoVenta`).
   */
  pasoVenta?: number | null;
  seProduce?: boolean;
  esConsignacion?: boolean;
  proveedorConsignacionId?: string | null;
  precioConsignacion?: number;
  /**
   * Tilde del alta (decisión 2 del dueño, docs/plan-disponibilidad-por-sucursal-2026-09-23.md §4): `true`/ausente (default) →
   * activo en TODAS las sucursales que existen hoy — el caso común, cero fricción. `false` explícito → activo SOLO en la
   * sucursal desde la que se da de alta; las demás lo activan a mano cuando lo necesiten.
   */
  activoEnTodasLasSucursales?: boolean;
}

/**
 * Lo que recibe la EDICIÓN (M.2-A4): como `DatosProducto`, pero el precio de venta, el factor de conversión y las dos unidades son opcionales. Ausentes (`undefined`) quedan como estaban —tenga o no la clave
 * `producto_campos_sensibles` quien edita—: el formulario abierto sin la clave no los manda, y la clave puede llegar mientras edita. `null` en la unidad de compra sigue siendo «sin unidad de compra». El alta
 * (`darDeAltaProducto`) los sigue pidiendo.
 */
export type DatosProductoEdicion = Omit<DatosProducto, CampoSensibleDelProducto> & Partial<Pick<DatosProducto, CampoSensibleDelProducto>>;

/**
 * Alta rápida inline de una MP nueva, sin salir del wizard de Compra por
 * proveedor (docs/plan-migracion.md §4 — refinamiento de UX, "el panel
 * genérico de Compra ya funciona, esto era lo que faltaba para no tener
 * que ir a /catalogo/productos e ir y volver"). Solo nombre + unidad de
 * stock — categoría/insumo/unidad de compra alternativa quedan para
 * completar después en el catálogo si hace falta, no bloquean la compra
 * de HOY. `factorConversion: 1` (compra y stock en la misma unidad),
 * mismo default que usa el form completo cuando no se toca ese campo.
 *
 * Desde el Hito 4 (H4C-12): permiso (`conPermisoDeEmpresa("alta_producto")`) → formato (`guardComandoDarDeAltaProductoRapido`,
 * core/features/catalogo/productos.guard.ts, DENTRO del envoltorio) → caso de uso (`casos-de-uso/dar-de-alta-producto-rapido.ts`: el nombre libre, el código
 * autogenerado con reintento y la disponibilidad), con la fuente de azar del proceso (`azarDelProceso`: el caso de uso no la lee por su cuenta) →
 * `aResultadoAccion`, y si salió bien el id y el nombre del producto (`okConId`).
 */
export async function darDeAltaProductoRapido(nombre: string, unidadStockId: string): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("alta_producto", async (ctx) => {
    const comando = guardComandoDarDeAltaProductoRapido({ nombre, unidadStockId });
    if (!comando.ok) return error(comando.mensaje);
    const r = await darDeAltaProductoRapidoCasoDeUso(ctx, comando.valor, azarDelProceso);
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/**
 * Devuelve también el id del producto creado: al guardar, la pantalla lleva a su ficha.
 *
 * Desde el Hito 4 (H4C-12): permiso (`conPermisoDeEmpresa("alta_producto")`) → caso de uso (`casos-de-uso/dar-de-alta-producto.ts`: la validación de los
 * datos, el código con reintento —SIN transacción a propósito, ver su docstring— y DESPUÉS la disponibilidad según el tilde), con la fuente de azar del proceso →
 * `aResultadoAccion`, y si salió bien el id y el nombre (`okConId`). Sin guard (`SIN_GUARD`: la validación lee la unidad de stock a mitad de camino).
 */
export async function darDeAltaProducto(datos: DatosProducto): Promise<ResultadoConId> {
  return conPermisoDeEmpresa("alta_producto", async (ctx) => {
    // S-52: el guard se CALCULA acá (formato y rango de los datos que no dependen de la base) pero `validarDatosDeProducto` aplica cada rechazo en el lugar de siempre, así el orden de los mensajes no cambia.
    const puerta = guardComandoDatosDeProducto({ datos });
    if (typeof datos !== "object" || datos === null) return error(puerta.antesDeLaUnidad.ok ? "Los datos del producto no son válidos." : puerta.antesDeLaUnidad.mensaje);
    // M.2 (D-2): el alta con precio, factor distinto de 1 o unidad de compra exige además `producto_campos_sensibles` (fallo cerrado, en el caso de uso).
    const r = await darDeAltaProductoCasoDeUso(ctx, datos, azarDelProceso, await puedeGestionarConsignacion(ctx), puerta, await puedeEditarCamposSensiblesDelProducto(ctx));
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/**
 * A diferencia de Apps Script (renombrarProductoEnHistorial_, Catalogo.js:
 * 1270-1314), acá el nombre es un campo más: Receta/Presentación/
 * ProveedorPorProducto referencian por `productoId` (FK real), no por
 * nombre — no hace falta reescribir nada más al renombrar.
 *
 * Si cambió el precio de venta de un producto que está en un ítem agrupado de la carta y sus hermanos del grupo quedaron a OTRO
 * precio, el resultado trae además `sincronizable` (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8): la pantalla ofrece
 * aplicar el mismo precio con un botón aparte (`sincronizarPrecioGrupoCarta`). Nunca se sincroniza solo.
 *
 * M.2: además de `producto_editar`, cambiar el precio de venta, el factor de conversión o una unidad exige `producto_campos_sensibles`: la acción calcula `puedeEditarCamposSensiblesDelProducto` (`src/server/acceso/campos-sensibles-de-producto.ts`, la fuente única que comparte con las pantallas) y el
 * caso de uso lo aplica dentro de su transacción (`SIN_PERMISO_CAMPOS_SENSIBLES`). Un campo sensible que no viene (`undefined`, ver `DatosProductoEdicion`) queda como estaba, tenga o no la clave (M.2-A4).
 *
 * Desde el Hito 4 (H4C-13): permiso (`conPermisoDeEmpresa("producto_editar")`) → caso de uso (`casos-de-uso/actualizar-producto.ts`: el producto, el tipo, la
 * validación, y el `update` con sus tres auditorías en UNA transacción) → si salió bien, revalidar la carta pública y DESPUÉS, si el precio de venta cambió, el
 * `sincronizable` (lee el ítem agrupado con la base del contexto, como antes) → el resultado sin `datos` ni `codigo` (`aResultadoAccion`, más el `sincronizable`
 * elegido a mano). Sin guard (`SIN_GUARD`: la validación lee la unidad de stock a mitad de camino).
 */
export async function actualizarProducto(productoId: string, datos: DatosProductoEdicion): Promise<ResultadoConSincronizable> {
  return conPermisoDeEmpresa<ResultadoConSincronizable>("producto_editar", async (ctx) => {
    // S-52: el guard se CALCULA acá pero `validarDatosDeProducto` aplica cada rechazo en el lugar de siempre (después de leer el producto y la unidad): un producto inexistente gana sobre un dato inválido.
    const puerta = guardComandoDatosDeProducto({ datos });
    if (typeof datos !== "object" || datos === null) return error(puerta.antesDeLaUnidad.ok ? "Los datos del producto no son válidos." : puerta.antesDeLaUnidad.mensaje);
    const puedeCamposSensibles = await puedeEditarCamposSensiblesDelProducto(ctx);
    const r = await actualizarProductoCasoDeUso(ctx, {
      productoId,
      datos,
      puerta,
      puedeGestionarConsignacion: await puedeGestionarConsignacion(ctx),
      puedeEditarCamposSensibles: puedeCamposSensibles,
    });
    const base = aResultadoAccion(r);
    if (!r.ok) return base;
    revalidarCartasPublicas(ctx.empresaSlug);

    const { precioAnterior, precioNuevo } = r.datos;
    // M-2 de la auditoría intermedia: la oferta es la de `sincronizarPrecioGrupoCarta`, que exige `producto_sincronizar_precio_carta` (EDITAR). Quien edita el producto (`producto_editar`) pero no tiene
    // esa clave veía la oferta y, al aceptarla, recibía un rechazo: la oferta se hace SOLO a quien puede aceptarla. La clave se mira solo cuando el precio cambió (la mayoría de las ediciones no).
    // M.2 (D-3): aceptarla exige además `producto_campos_sensibles`, así que la oferta pide las DOS claves (y quien cambió el precio ya la tenía: sin ella la edición se rechaza antes).
    if (precioNuevo !== precioAnterior && puedeCamposSensibles && (await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_sincronizar_precio_carta", ctx.db)).editar) {
      const sincronizable = ofrecerSincronizarPrecio(await resolverGrupoDeProducto(productoId, ctx.sucursalId, ctx.db), precioNuevo, "global");
      if (sincronizable) return { ok: true, mensaje: base.mensaje, sincronizable };
    }
    return base;
  });
}

/**
 * Aplica el mismo precio de venta GLOBAL a varios productos de UN mismo ítem agrupado de la carta (el paso que ofrece
 * `actualizarProducto` con `sincronizable`; docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8). Misma auditoría que editar el precio de cada uno a mano,
 * y desde M.2 (D-3) los mismos permisos que cambiar un precio: `producto_sincronizar_precio_carta` más `producto_campos_sensibles`. Solo toca los `productoIds` pasados, y solo si son todos del mismo ítem agrupado.
 *
 * Desde el Hito 4 (H4C-13): permiso (`conPermisoDeEmpresa("producto_sincronizar_precio_carta")`) → formato del precio y de la lista
 * (`guardComandoSincronizarPrecioGrupoCarta`, core/features/catalogo/productos.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/sincronizar-precio-grupo-carta.ts`: el ítem agrupado, y los precios con su auditoría en UNA transacción) → revalidar la carta pública si salió
 * bien → `aResultadoAccion`.
 */
export async function sincronizarPrecioGrupoCarta(productoIds: string[], precio: number): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_sincronizar_precio_carta", async (ctx) => {
    const comando = guardComandoSincronizarPrecioGrupoCarta({ productoIds, precio });
    if (!comando.ok) return error(comando.mensaje);
    // M.2 (D-3): sincronizar es cambiar el precio de venta de varios productos: además de la clave de sincronizar pide `producto_campos_sensibles` (el caso de uso lo rechaza antes de leer nada).
    const resultado = await sincronizarPrecioGrupoCartaCasoDeUso(ctx, { ...comando.valor, puedeEditarCamposSensibles: await puedeEditarCamposSensiblesDelProducto(ctx) });
    if (resultado.ok) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

/**
 * Disponibilidad de un producto EN LA SUCURSAL ACTIVA (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §6.1) — reemplaza el
 * `actualizarActivoProducto` global de antes. Desactivarlo acá lo saca de los selectores de movimiento, de Stock consolidado y
 * de la Valuación DE ESTA SUCURSAL; y si es una MP de la receta vigente de un plato disponible acá, ese plato deja de poder
 * venderse acá. Por eso al DESACTIVAR se BLOQUEA mientras algo dependa de él EN ESTA SUCURSAL (recetas vigentes de platos
 * disponibles acá, saldo en alguna sección de esta sucursal) y el mensaje dice qué es. Reactivar nunca se bloquea. Ver
 * `dependenciasParaDesactivar`.
 *
 * Desde el Hito 4 (H4C-11): permiso (`conPermiso("producto_disponibilidad")`) → caso de uso (`casos-de-uso/actualizar-disponibilidad-producto.ts`: las
 * dependencias, el valor anterior, la escritura y su auditoría, todo con la base del contexto y SIN transacción, como antes — hallazgo conocido, migrado tal cual)
 * → revalidar la carta pública si salió bien → `aResultadoAccion`. Sin guard (`SIN_GUARD`).
 */
export async function actualizarDisponibilidadProducto(productoId: string, disponible: boolean): Promise<ResultadoAccion> {
  return conPermiso("producto_disponibilidad", async (ctx) => {
    const resultado = await actualizarDisponibilidadProductoCasoDeUso(ctx, { productoId, disponible });
    if (resultado.ok) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

export interface PresentacionOpcion {
  id: string;
  unidadCompraId: string;
  unidadCompraNombre: string;
  factorConversion: number;
  activa: boolean;
}

/**
 * Solo lectura. La usan tanto la pantalla de gestión (producto-form, lista
 * completa incluyendo inactivas para poder reactivarlas) como el form de
 * Compra (filtra a `.activa` — ver PanelMovimientoForm). Exige el «Ver» de
 * alguna de esas pantallas (H8): la ficha o la edición del producto, la
 * compra o la devolución a proveedor.
 */
export async function listarPresentaciones(productoId: string): Promise<PresentacionOpcion[]> {
  const ctx = await requerirVerAlguna(["producto_ver_catalogo", "proceso_compra", "proceso_devolucion_proveedor"]);
  const filas = await ctx.db.presentacion.findMany({
    where: { productoId },
    include: { unidadCompra: true },
    orderBy: { unidadCompra: { nombre: "asc" } },
  });
  return filas.map((p) => ({
    id: p.id,
    unidadCompraId: p.unidadCompraId,
    unidadCompraNombre: p.unidadCompra.nombre,
    factorConversion: Number(p.factorConversion),
    activa: p.activa,
  }));
}

export async function agregarPresentacionAlternativa(
  productoId: string,
  unidadCompraId: string,
  factorConversion: number
): Promise<ResultadoAccion> {
  // Desde el Hito 4 (H4C-11): permiso → caso de uso (`casos-de-uso/agregar-presentacion-alternativa.ts`: el producto, el factor con los decimales de su unidad de
  // stock, y la presentación con su auditoría en UNA transacción) → `aResultadoAccion`. Sin guard (`SIN_GUARD`: el factor se valida después de leer el producto).
  return conPermisoDeEmpresa("producto_presentaciones", async (ctx) => {
    // S-52: el guard se CALCULA acá; los ids rotos se rechazan en el acto y el rango del factor lo aplica el caso de uso después de leer el producto (un producto inexistente gana sobre un factor inválido).
    const puerta = guardComandoAgregarPresentacionAlternativa({ productoId, unidadCompraId, factorConversion });
    if (!puerta.ids.ok) return error(puerta.ids.mensaje);
    // M.2: definir el factor (crear la presentación, o cambiar el de una que existe) exige además `producto_campos_sensibles`: la acción calcula el dato y el caso de uso lo aplica dentro de su transacción.
    return aResultadoAccion(
      await agregarPresentacionAlternativaCasoDeUso(ctx, { productoId, unidadCompraId, factorConversion, factor: puerta.factor, puedeEditarCamposSensibles: await puedeEditarCamposSensiblesDelProducto(ctx) }),
    );
  });
}

/**
 * Desde el Hito 4 (H4C-11): permiso → caso de uso (`casos-de-uso/actualizar-activa-presentacion.ts`) → `aResultadoAccion`. Sin guard (`SIN_GUARD`). Desde O.44 un
 * id roto devuelve «No se encontró la presentación.» (antes: un 500 de Prisma, hallazgo que H4C-11 migró tal cual).
 */
export async function actualizarActivaPresentacion(presentacionId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_presentaciones", async (ctx) => {
    return aResultadoAccion(await actualizarActivaPresentacionCasoDeUso(ctx, { presentacionId, activa }));
  });
}
