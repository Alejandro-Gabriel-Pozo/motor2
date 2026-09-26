"use server";

import type { TipoProducto } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import { crearConCodigoAutogenerado, esErrorDeUnicidad } from "@/core/catalogo/generar-codigo";
import { validarUnidadInsumo } from "@/core/catalogo/producto";
import { validarPasoVenta } from "@/core/catalogo/venta-fraccionada";
import { tieneStockReal } from "@/core/movimientos/transiciones";
import { dependenciasParaDesactivar } from "@/core/catalogo/desactivar-producto";
import { disponibilidadDeProductos, productoDisponibleEn, whereDisponibleEn, whereDisponibleEnAlguna } from "@/core/catalogo/disponibilidad-producto-consulta";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { ofrecerSincronizarPrecio, resolverGrupoDeProducto } from "@/core/carta/grupo-producto-consulta";
import { conPermiso } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId, type ResultadoConSincronizable } from "../tipos";
import { requerirSesion } from "../con-sesion";

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
export interface FiltroSelectorProducto {
  tipo?: TipoProducto;
  /** Disponible EN LA SUCURSAL ACTIVA de quien busca (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.2) — la sucursal se toma del contexto del servidor, NUNCA de un parámetro del cliente: si no, cualquiera podría mirar el catálogo disponible de otra sucursal. */
  soloDisponibles?: boolean;
  /** El equivalente "central" de `soloDisponibles`: disponible en ALGUNA sucursal (no importa cuál) — para catálogo compartido entre sucursales, como hermanar Insumos (§5.2, call-site 12). */
  soloDisponiblesEnAlguna?: boolean;
  /** MP, o PV solo si está marcado "Se produce" — mismo criterio que `tieneStockReal` (Conteo Físico, Stock consolidado). */
  soloConStockReal?: boolean;
  /** `producto.seProduce === true`, en MP o PV — quién puede ser el RESULTADO de una Producción (distinto de `soloConStockReal`: una MP comprada, no producida, tiene stock real pero no es válida acá). */
  soloSeProduce?: boolean;
  /** PV, o MP solo si está marcada "Se produce" — quién puede tener una Receta (`/catalogo/recetas`). Es el criterio inverso a `soloConStockReal`: ahí toda MP entra y el PV es la excepción, acá es al revés. */
  elegibleParaReceta?: boolean;
  /** true = solo productos en consignación (Devolución al consignante); false = excluirlos (Devolución a proveedor — nunca se "compró" algo en consignación). Sin definir = sin filtrar. */
  esConsignacion?: boolean;
}

export async function buscarProductosSelector(termino: string, filtro?: FiltroSelectorProducto): Promise<ProductoOpcion[]> {
  const ctx = await requerirSesion();
  const t = texto(termino);
  const condiciones = [
    ...(filtro?.tipo ? [{ tipo: filtro.tipo }] : []),
    ...(filtro?.soloDisponibles ? [whereDisponibleEn(ctx.sucursalId)] : []),
    ...(filtro?.soloDisponiblesEnAlguna ? [whereDisponibleEnAlguna()] : []),
    ...(filtro?.soloConStockReal ? [{ OR: [{ tipo: "MP" as const }, { tipo: "PV" as const, seProduce: true }] }] : []),
    ...(filtro?.soloSeProduce ? [{ seProduce: true }] : []),
    ...(filtro?.elegibleParaReceta ? [{ OR: [{ tipo: "PV" as const }, { tipo: "MP" as const, seProduce: true }] }] : []),
    ...(filtro?.esConsignacion !== undefined ? [{ esConsignacion: filtro.esConsignacion }] : []),
    ...(t ? [{ OR: [{ nombre: { contains: t, mode: "insensitive" as const } }, { codigo: { contains: t, mode: "insensitive" as const } }] }] : []),
  ];
  return prisma.producto.findMany({
    where: condiciones.length ? { AND: condiciones } : {},
    select: { id: true, codigo: true, nombre: true },
    orderBy: { nombre: "asc" },
    take: LIMITE_SELECTOR,
  });
}

/** Un producto puntual por id, en la misma forma que el combobox — para mostrar su etiqueta después de elegirlo (ej. Conteo Físico, al agregar una fila manual). */
export async function obtenerProductoOpcion(productoId: string): Promise<ProductoOpcion | null> {
  await requerirSesion();
  return prisma.producto.findUnique({ where: { id: productoId }, select: { id: true, codigo: true, nombre: true } });
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
  await requerirSesion();
  const p = await prisma.producto.findUnique({
    where: { id: productoId },
    include: { insumo: true, unidadStock: true },
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
  return conPermiso("editar_producto", async () => {
    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");
    if (producto.tipo !== "MP") return error("Solo una materia prima (MP) puede tener Insumo asignado.");

    const invalido = await validarUnidadInsumo(insumoId, producto.unidadStockId, productoId);
    if (invalido) return error(invalido);

    await prisma.producto.update({ where: { id: productoId }, data: { insumoId } });
    return ok("Insumo asignado.");
  });
}

/** Precio de venta global de un producto puntual — usado por Precio Local para mostrar "precio global actual" sin traer el catálogo entero. */
export async function obtenerPrecioVentaProducto(productoId: string): Promise<number | null> {
  await requerirSesion();
  const p = await prisma.producto.findUnique({ where: { id: productoId }, select: { precioVenta: true } });
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

/** Tabla de administración de catálogo (`/catalogo/productos`) — paginado por cursor, con búsqueda opcional. */
export async function listarProductosPagina(cursor?: string, termino?: string): Promise<PaginaProductos> {
  const ctx = await requerirSesion();
  const t = texto(termino ?? "");
  const items = await prisma.producto.findMany({
    where: t ? { OR: [{ nombre: { contains: t, mode: "insensitive" } }, { codigo: { contains: t, mode: "insensitive" } }] } : {},
    select: { id: true, codigo: true, nombre: true, tipo: true },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
    take: TAMANO_PAGINA_CATALOGO + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hayMas = items.length > TAMANO_PAGINA_CATALOGO;
  const pagina = hayMas ? items.slice(0, TAMANO_PAGINA_CATALOGO) : items;
  const ids = pagina.map((p) => p.id);

  // Batch, sin N+1 (una página entera de 50 filas): disponibilidad EN ESTA sucursal + cuántas sucursales en total la
  // tienen, para "Disponible acá" y "Sucursales" (§10/P10, ver disponibilidad-producto-consulta.ts).
  const [disponibleAcaPorProducto, conteos, totalSucursales] = await Promise.all([
    disponibilidadDeProductos(ctx.sucursalId, ids, prisma),
    prisma.disponibilidadProducto.groupBy({ by: ["productoId"], where: { productoId: { in: ids }, disponible: true }, _count: { productoId: true } }),
    prisma.sucursal.count({ where: { activo: true } }),
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

async function validarComun(datos: DatosProducto, productoIdExcluir?: string): Promise<string | null> {
  const nombre = texto(datos.nombre);
  if (!nombre) return "El nombre no puede estar vacío.";
  const invalido = validarTextoCatalogo(nombre, "El nombre");
  if (invalido) return invalido;
  if (!datos.unidadStockId) return "La unidad de stock es obligatoria.";
  if (!(Number(datos.factorConversion) > 0)) return "El factor de conversión tiene que ser mayor a 0.";
  if (!esNumeroFinito(datos.factorConversion)) return "El factor de conversión no es un número válido.";
  if (datos.precioVenta !== undefined && !esNumeroFinito(datos.precioVenta)) return "El precio de venta no es un número válido.";
  if (datos.esConsignacion) {
    if (!datos.proveedorConsignacionId) return "Falta el proveedor de consignación.";
    if (!(Number(datos.precioConsignacion) > 0)) return "El precio de consignación tiene que ser mayor a 0.";
    if (!esNumeroFinito(datos.precioConsignacion)) return "El precio de consignación no es un número válido.";
  }

  if (datos.pasoVenta !== undefined && datos.pasoVenta !== null) {
    if (datos.tipo !== "PV") return "El paso de venta solo aplica a productos de venta (PV).";
    const unidad = await prisma.unidad.findUnique({ where: { id: datos.unidadStockId }, select: { decimales: true } });
    if (!unidad) return "La unidad de stock es obligatoria.";
    const r = validarPasoVenta(datos.pasoVenta, { decimalesUnidad: unidad.decimales, tieneStockReal: tieneStockReal("PV", datos.seProduce ?? false) });
    if (!r.ok) return r.mensaje;
  }

  const dup = await prisma.producto.findFirst({
    where: {
      ...whereDisponibleEnAlguna(),
      nombre: { equals: nombre, mode: "insensitive" },
      ...(productoIdExcluir ? { id: { not: productoIdExcluir } } : {}),
    },
  });
  if (dup) return `Ya existe un producto disponible llamado "${nombre}".`;

  return validarUnidadInsumo(datos.insumoId, datos.unidadStockId, productoIdExcluir);
}

function datosParaGuardar(datos: DatosProducto) {
  return {
    nombre: texto(datos.nombre),
    categoriaId: datos.categoriaId || null,
    unidadCompraId: datos.unidadCompraId || null,
    unidadStockId: datos.unidadStockId,
    factorConversion: datos.factorConversion,
    insumoId: datos.insumoId || null,
    precioVenta: datos.precioVenta ?? 0,
    // Defensivo (validarComun ya lo rechaza para MP): un paso de venta nunca se guarda fuera de un PV.
    pasoVenta: datos.tipo === "PV" ? (datos.pasoVenta ?? null) : null,
    seProduce: datos.seProduce ?? false,
    esConsignacion: datos.esConsignacion ?? false,
    proveedorConsignacionId: datos.proveedorConsignacionId || null,
    precioConsignacion: datos.precioConsignacion ?? 0,
    observaciones: datos.observaciones,
  };
}

/**
 * Alta rápida inline de una MP nueva, sin salir del wizard de Compra por
 * proveedor (docs/plan-migracion.md §4 — refinamiento de UX, "el panel
 * genérico de Compra ya funciona, esto era lo que faltaba para no tener
 * que ir a /catalogo/productos e ir y volver"). Solo nombre + unidad de
 * stock — categoría/insumo/unidad de compra alternativa quedan para
 * completar después en el catálogo si hace falta, no bloquean la compra
 * de HOY. `factorConversion: 1` (compra y stock en la misma unidad),
 * mismo default que usa el form completo cuando no se toca ese campo.
 */
export async function darDeAltaProductoRapido(nombre: string, unidadStockId: string): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("alta_producto", async () => {
    const n = texto(nombre);
    if (!n) return error("El nombre no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre");
    if (invalido) return error(invalido);
    if (!unidadStockId) return error("La unidad de stock es obligatoria.");

    const dup = await prisma.producto.findFirst({ where: { ...whereDisponibleEnAlguna(), nombre: { equals: n, mode: "insensitive" } } });
    if (dup) return error(`Ya existe un producto disponible llamado "${n}".`);

    try {
      const producto = await crearConCodigoAutogenerado("MP", undefined, (codigo) =>
        prisma.producto.create({ data: { codigo, tipo: "MP", nombre: n, unidadStockId, factorConversion: 1 } })
      );
      // Sin formulario donde poner el tilde de §4.1 — sigue su mismo default: activo en todas las sucursales que existen hoy.
      const sucursalIds = (await prisma.sucursal.findMany({ select: { id: true } })).map((s) => s.id);
      await prisma.disponibilidadProducto.createMany({ data: sucursalIds.map((sucursalId) => ({ sucursalId, productoId: producto.id, disponible: true })) });
      return okConId(`Producto "${producto.nombre}" (${producto.codigo}) creado.`, producto.id, producto.nombre);
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error("Ya existe un producto con ese código.");
      throw e;
    }
  });
}

/**
 * Devuelve también el id del producto creado: al guardar, la pantalla lleva a su ficha.
 *
 * El `createMany` de disponibilidad va DESPUÉS de crear el producto, fuera de una transacción interactiva con él a propósito
 * (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §4.2): `crearConCodigoAutogenerado` reintenta hasta 5 veces atrapando el
 * `P2002` del INSERT, y dentro de una transacción interactiva de Postgres el primer INSERT fallido aborta la transacción
 * entera, así que los reintentos fallarían todos. Si el `createMany` fallara después de crear el producto, éste queda sin
 * ninguna fila de disponibilidad ⇒ no disponible en ninguna sucursal ⇒ invisible pero inofensivo (nunca a medias activo en
 * algunas sucursales sin querer), y se puede arreglar desde `/catalogo/productos`, donde aparece con "0 de N sucursales".
 */
export async function darDeAltaProducto(datos: DatosProducto): Promise<ResultadoConId> {
  return conPermiso("alta_producto", async (ctx) => {
    const invalido = await validarComun(datos);
    if (invalido) return error(invalido);

    try {
      const producto = await crearConCodigoAutogenerado(datos.tipo, datos.codigo, (codigo) =>
        prisma.producto.create({ data: { codigo, tipo: datos.tipo, ...datosParaGuardar(datos) } })
      );
      const sucursalIds =
        datos.activoEnTodasLasSucursales !== false ? (await prisma.sucursal.findMany({ select: { id: true } })).map((s) => s.id) : [ctx.sucursalId];
      await prisma.disponibilidadProducto.createMany({
        data: sucursalIds.map((sucursalId) => ({ sucursalId, productoId: producto.id, disponible: true })),
      });
      return okConId(`Producto "${producto.nombre}" (${producto.codigo}) creado.`, producto.id, producto.nombre);
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error("Ya existe un producto con ese código.");
      throw e;
    }
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
 */
export async function actualizarProducto(productoId: string, datos: DatosProducto): Promise<ResultadoConSincronizable> {
  return conPermiso<ResultadoConSincronizable>("editar_producto", async (ctx) => {
    const existente = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!existente) return error("No se encontró el producto.");
    // datosParaGuardar (abajo) no incluye `tipo` a propósito — cambiar el
    // tipo de un producto con historial (recetas, ventas, stock) rompe
    // invariantes reales, así que se rechaza explícito en vez de
    // silenciarlo (antes: se ignoraba sin aviso, "Producto actualizado"
    // mostraba éxito con el tipo viejo intacto).
    if (datos.tipo !== existente.tipo) {
      return error(`El tipo no se puede cambiar — este producto ya es "${existente.tipo}". Dado de baja y creá uno nuevo si necesitás el otro tipo.`);
    }

    const invalido = await validarComun(datos, productoId);
    if (invalido) return error(invalido);

    const nuevos = datosParaGuardar(datos);
    await prisma.producto.update({ where: { id: productoId }, data: nuevos });

    // Auditoría administrativa (A3, Pivote 6) — solo los precios, que son
    // los campos de mayor impacto de negocio/control interno (ver
    // docs/auditoria-motor2-fase6-seguridad-2026-09-18.md).
    const nombreActual = texto(datos.nombre);
    await registrarCambioAuditado(prisma, {
      entidad: "Producto", entidadId: productoId, campo: "precioVenta",
      descripcion: `Producto "${nombreActual}": precio de venta`,
      valorAnterior: Number(existente.precioVenta), valorNuevo: Number(nuevos.precioVenta), actorId: ctx.usuarioId,
    });
    await registrarCambioAuditado(prisma, {
      entidad: "Producto", entidadId: productoId, campo: "precioConsignacion",
      descripcion: `Producto "${nombreActual}": precio de consignación`,
      valorAnterior: Number(existente.precioConsignacion), valorNuevo: Number(nuevos.precioConsignacion), actorId: ctx.usuarioId,
    });
    // Venta fraccionada (Task #25): se audita igual que el resto de los campos de mayor impacto de negocio.
    await registrarCambioAuditado(prisma, {
      entidad: "Producto", entidadId: productoId, campo: "pasoVenta",
      descripcion: `Producto "${nombreActual}": paso de venta`,
      valorAnterior: existente.pasoVenta !== null ? Number(existente.pasoVenta) : null,
      valorNuevo: nuevos.pasoVenta,
      actorId: ctx.usuarioId,
    });

    const mensaje = `Producto "${nombreActual}" actualizado.`;
    const precioNuevo = Number(nuevos.precioVenta);
    if (precioNuevo !== Number(existente.precioVenta)) {
      const sincronizable = ofrecerSincronizarPrecio(await resolverGrupoDeProducto(productoId, ctx.sucursalId), precioNuevo, "global");
      if (sincronizable) return { ok: true, mensaje, sincronizable };
    }
    return ok(mensaje);
  });
}

/**
 * Aplica el mismo precio de venta GLOBAL a varios productos de UN mismo ítem agrupado de la carta (el paso que ofrece
 * `actualizarProducto` con `sincronizable`; docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8). Mismo permiso y misma auditoría
 * que editar el precio de cada uno a mano. Solo toca los `productoIds` pasados, y solo si son todos del mismo ítem agrupado.
 */
export async function sincronizarPrecioGrupoCarta(productoIds: string[], precio: number): Promise<ResultadoAccion> {
  return conPermiso("editar_producto", async (ctx) => {
    if (!esNumeroFinito(precio)) return error("El precio de venta no es un número válido.");
    if (!(precio >= 0)) return error("El precio de venta no puede ser negativo.");
    const ids = [...new Set(productoIds)];
    if (!ids.length) return error("No hay productos para actualizar.");

    const grupo = await resolverGrupoDeProducto(ids[0], ctx.sucursalId);
    const delGrupo = new Set(grupo ? [ids[0], ...grupo.hermanos.map((h) => h.productoId)] : []);
    if (!grupo || ids.some((id) => !delGrupo.has(id))) return error("Esos productos no están todos en el mismo ítem agrupado de la carta.");

    const productos = await prisma.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, precioVenta: true } });
    for (const p of productos) {
      await prisma.producto.update({ where: { id: p.id }, data: { precioVenta: precio } });
      await registrarCambioAuditado(prisma, {
        entidad: "Producto", entidadId: p.id, campo: "precioVenta",
        descripcion: `Producto "${p.nombre}": precio de venta`,
        valorAnterior: Number(p.precioVenta), valorNuevo: precio, actorId: ctx.usuarioId,
      });
    }
    return ok(`Precio de venta de ${productos.map((p) => `"${p.nombre}"`).join(", ")} actualizado a $${precio.toLocaleString("es-AR")} («${grupo.nombreItem}»).`);
  });
}

/** «A, B y C» / «A, B y 2 más»: para que un mensaje de error no crezca sin límite con un catálogo grande. */
function enumerar(items: string[], tope = 4): string {
  const vistos = items.slice(0, tope);
  const resto = items.length - vistos.length;
  const cola = resto > 0 ? ` y ${resto} más` : "";
  return vistos.length > 1 && resto === 0 ? `${vistos.slice(0, -1).join(", ")} y ${vistos[vistos.length - 1]}` : `${vistos.join(", ")}${cola}`;
}

/**
 * Disponibilidad de un producto EN LA SUCURSAL ACTIVA (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §6.1) — reemplaza el
 * `actualizarActivoProducto` global de antes. Desactivarlo acá lo saca de los selectores de movimiento, de Stock consolidado y
 * de la Valuación DE ESTA SUCURSAL; y si es una MP de la receta vigente de un plato disponible acá, ese plato deja de poder
 * venderse acá. Por eso al DESACTIVAR se BLOQUEA mientras algo dependa de él EN ESTA SUCURSAL (recetas vigentes de platos
 * disponibles acá, saldo en alguna sección de esta sucursal) y el mensaje dice qué es. Reactivar nunca se bloquea. Ver
 * `dependenciasParaDesactivar`.
 */
export async function actualizarDisponibilidadProducto(productoId: string, disponible: boolean): Promise<ResultadoAccion> {
  return conPermiso("editar_producto", async (ctx) => {
    const existente = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!existente) return error("No se encontró el producto.");
    if (!disponible) {
      const { recetasVigentes, saldos } = await dependenciasParaDesactivar(productoId, ctx.sucursalId);
      const motivos: string[] = [];
      if (recetasVigentes.length) motivos.push(`está en la receta vigente de ${enumerar(recetasVigentes.map((r) => r.nombre))}: sacalo de esas recetas`);
      if (saldos.length) {
        const donde = enumerar(saldos.map((s) => `${s.sucursalNombre} / ${s.seccionNombre} (${s.saldo})`));
        motivos.push(`tiene saldo en ${donde}: dejalo en cero con un ajuste`);
      }
      if (motivos.length) return error(`No se puede desactivar "${existente.nombre}" en "${ctx.sucursalNombre}": ${motivos.join("; y ")} antes de desactivarlo.`);
    }
    // El valor anterior se lee ANTES del upsert — registrarCambioAuditado necesita comparar contra el estado previo real, no
    // contra el que se está por escribir (si no, "repetir el mismo estado no deja registro" dejaría de cumplirse).
    const anterior = await productoDisponibleEn(ctx.sucursalId, productoId);
    await prisma.disponibilidadProducto.upsert({
      where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } },
      update: { disponible },
      create: { sucursalId: ctx.sucursalId, productoId, disponible },
    });
    // Auditoría administrativa, como el cambio de activo de un rol. No-op si el valor no cambió (registrarCambioAuditado).
    await registrarCambioAuditado(prisma, {
      entidad: "DisponibilidadProducto", entidadId: `${ctx.sucursalId}:${productoId}`, campo: "disponible",
      descripcion: `Producto "${existente.nombre}" en "${ctx.sucursalNombre}": disponible`,
      valorAnterior: anterior, valorNuevo: disponible, actorId: ctx.usuarioId,
    });
    return ok(`Producto "${existente.nombre}" ${disponible ? "activado" : "desactivado"} en "${ctx.sucursalNombre}".`);
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
 * Compra (filtra a `.activa` — ver PanelMovimientoForm).
 */
export async function listarPresentaciones(productoId: string): Promise<PresentacionOpcion[]> {
  await requerirSesion();
  const filas = await prisma.presentacion.findMany({
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
  return conPermiso("alta_producto", async () => {
    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");
    if (producto.unidadCompraId === unidadCompraId) {
      return error("Esa ya es la unidad de compra por defecto de este producto.");
    }
    if (!(Number(factorConversion) > 0)) return error("El factor de conversión tiene que ser mayor a 0.");
    if (!esNumeroFinito(factorConversion)) return error("El factor de conversión no es un número válido.");

    await prisma.presentacion.upsert({
      where: { productoId_unidadCompraId: { productoId, unidadCompraId } },
      update: { factorConversion, activa: true },
      create: { productoId, unidadCompraId, factorConversion },
    });
    return ok("Presentación agregada.");
  });
}

export async function actualizarActivaPresentacion(presentacionId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("alta_producto", async () => {
    await prisma.presentacion.update({ where: { id: presentacionId }, data: { activa } });
    return ok(`Presentación ${activa ? "activada" : "desactivada"}.`);
  });
}
