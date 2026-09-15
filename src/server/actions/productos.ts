"use server";

import type { TipoProducto } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { crearConCodigoAutogenerado, esErrorDeUnicidad } from "@/core/catalogo/generar-codigo";
import { validarUnidadInsumo } from "@/core/catalogo/producto";
import { conPermiso } from "./con-permiso";
import { error, ok, type ResultadoAccion } from "./tipos";

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
}

export async function buscarProductosSelector(termino: string, filtro?: FiltroSelectorProducto): Promise<ProductoOpcion[]> {
  const t = texto(termino);
  const condiciones = [
    ...(filtro?.tipo ? [{ tipo: filtro.tipo }] : []),
    ...(filtro?.soloActivos ? [{ activo: true }] : []),
    ...(filtro?.soloConStockReal ? [{ OR: [{ tipo: "MP" as const }, { tipo: "PV" as const, seProduce: true }] }] : []),
    ...(t ? [{ OR: [{ nombre: { contains: t, mode: "insensitive" as const } }, { codigo: { contains: t, mode: "insensitive" as const } }] }] : []),
  ];
  return prisma.producto.findMany({
    where: condiciones.length ? { AND: condiciones } : {},
    select: { id: true, codigo: true, nombre: true },
    orderBy: { nombre: "asc" },
    take: LIMITE_SELECTOR,
  });
}

/** Precio de venta global de un producto puntual — usado por Precio Local para mostrar "precio global actual" sin traer el catálogo entero. */
export async function obtenerPrecioVentaProducto(productoId: string): Promise<number | null> {
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
  if (datos.esConsignacion) {
    if (!datos.proveedorConsignacionId) return "Falta el proveedor de consignación.";
    if (!(Number(datos.precioConsignacion) > 0)) return "El precio de consignación tiene que ser mayor a 0.";
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
  return conPermiso("editar_producto", async () => {
    const existente = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!existente) return error("No se encontró el producto.");

    const invalido = await validarComun(datos, productoId);
    if (invalido) return error(invalido);

    await prisma.producto.update({ where: { id: productoId }, data: datosParaGuardar(datos) });
    return ok(`Producto "${texto(datos.nombre)}" actualizado.`);
  });
}

export async function actualizarActivoProducto(productoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("editar_producto", async () => {
    await prisma.producto.update({ where: { id: productoId }, data: { activo } });
    return ok(`Producto ${activo ? "activado" : "desactivado"}.`);
  });
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
