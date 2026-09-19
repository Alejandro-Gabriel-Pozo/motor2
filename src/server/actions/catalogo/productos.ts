"use server";

import type { TipoProducto } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import { crearConCodigoAutogenerado, esErrorDeUnicidad } from "@/core/catalogo/generar-codigo";
import { validarUnidadInsumo } from "@/core/catalogo/producto";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
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
  soloActivos?: boolean;
  /** MP, o PV solo si está marcado "Se produce" — mismo criterio que `tieneStockReal` (Conteo Físico, Stock consolidado). */
  soloConStockReal?: boolean;
  /** PV, o MP solo si está marcada "Se produce" — quién puede tener una Receta (`/catalogo/recetas`). Es el criterio inverso a `soloConStockReal`: ahí toda MP entra y el PV es la excepción, acá es al revés. */
  elegibleParaReceta?: boolean;
  /** true = solo productos en consignación (Devolución al consignante); false = excluirlos (Devolución a proveedor — nunca se "compró" algo en consignación). Sin definir = sin filtrar. */
  esConsignacion?: boolean;
}

export async function buscarProductosSelector(termino: string, filtro?: FiltroSelectorProducto): Promise<ProductoOpcion[]> {
  await requerirSesion();
  const t = texto(termino);
  const condiciones = [
    ...(filtro?.tipo ? [{ tipo: filtro.tipo }] : []),
    ...(filtro?.soloActivos ? [{ activo: true }] : []),
    ...(filtro?.soloConStockReal ? [{ OR: [{ tipo: "MP" as const }, { tipo: "PV" as const, seProduce: true }] }] : []),
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
  items: { id: string; codigo: string; nombre: string; tipo: TipoProducto; activo: boolean }[];
  nextCursor: string | null;
}

const TAMANO_PAGINA_CATALOGO = 50;

/** Tabla de administración de catálogo (`/catalogo/productos`) — paginado por cursor, con búsqueda opcional. */
export async function listarProductosPagina(cursor?: string, termino?: string): Promise<PaginaProductos> {
  await requerirSesion();
  const t = texto(termino ?? "");
  const items = await prisma.producto.findMany({
    where: t ? { OR: [{ nombre: { contains: t, mode: "insensitive" } }, { codigo: { contains: t, mode: "insensitive" } }] } : {},
    select: { id: true, codigo: true, nombre: true, tipo: true, activo: true },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
    take: TAMANO_PAGINA_CATALOGO + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hayMas = items.length > TAMANO_PAGINA_CATALOGO;
  const pagina = hayMas ? items.slice(0, TAMANO_PAGINA_CATALOGO) : items;
  return { items: pagina, nextCursor: hayMas ? pagina[pagina.length - 1].id : null };
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
  seProduce?: boolean;
  esConsignacion?: boolean;
  proveedorConsignacionId?: string | null;
  precioConsignacion?: number;
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

  const dup = await prisma.producto.findFirst({
    where: {
      activo: true,
      nombre: { equals: nombre, mode: "insensitive" },
      ...(productoIdExcluir ? { id: { not: productoIdExcluir } } : {}),
    },
  });
  if (dup) return `Ya existe un producto activo llamado "${nombre}".`;

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

    const dup = await prisma.producto.findFirst({ where: { activo: true, nombre: { equals: n, mode: "insensitive" } } });
    if (dup) return error(`Ya existe un producto activo llamado "${n}".`);

    try {
      const producto = await crearConCodigoAutogenerado("MP", undefined, (codigo) =>
        prisma.producto.create({ data: { codigo, tipo: "MP", nombre: n, unidadStockId, factorConversion: 1 } })
      );
      return okConId(`Producto "${producto.nombre}" (${producto.codigo}) creado.`, producto.id, producto.nombre);
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error("Ya existe un producto con ese código.");
      throw e;
    }
  });
}

export async function darDeAltaProducto(datos: DatosProducto): Promise<ResultadoAccion> {
  return conPermiso("alta_producto", async () => {
    const invalido = await validarComun(datos);
    if (invalido) return error(invalido);

    try {
      const producto = await crearConCodigoAutogenerado(datos.tipo, datos.codigo, (codigo) =>
        prisma.producto.create({ data: { codigo, tipo: datos.tipo, ...datosParaGuardar(datos) } })
      );
      return ok(`Producto "${producto.nombre}" (${producto.codigo}) creado.`);
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
 */
export async function actualizarProducto(productoId: string, datos: DatosProducto): Promise<ResultadoAccion> {
  return conPermiso("editar_producto", async (ctx) => {
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

    return ok(`Producto "${nombreActual}" actualizado.`);
  });
}

export async function actualizarActivoProducto(productoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("editar_producto", async () => {
    await prisma.producto.update({ where: { id: productoId }, data: { activo } });
    return ok(`Producto ${activo ? "activado" : "desactivado"}.`);
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
