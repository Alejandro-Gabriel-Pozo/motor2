import type { ContenidoExistente, EstadoDeLaBase, PermisosDelActor, SeccionDeCarta } from "./estado";
import type { AccionDePlan, PlanDeProductos } from "./planificar-productos";
import type { CatalogoNormalizado, DescripcionDeCarta, LocalDelImportador } from "./tipos";

/**
 * PLANIFICADOR DE LA CARTA MÍNIMA del importador (E1.3b; ADENDA v2 A.2, I10 a I12). Puro. Por cada fila (SKU, local) de «Precios por local» decide si se crea su `ContenidoCartaProducto`
 * (visible, en la sección del mapeo de su categoría, con la descripción de la fila y el orden de la fila del SKU en «Catálogo»), si ya está igual (`SIN_CAMBIOS`), si queda fuera de la carta
 * (categoría sin sección o fila sin precio) o si es un error. Nunca crea una sección (se resuelven por nombre exacto y tienen que estar activas), nunca pisa un contenido existente
 * (distinto = error), nunca pone en la carta el ancla de un adicional ni un miembro de un ítem agrupado (I10).
 *
 * La regla de cada fila es `planificarFilaDeCarta` (la que recorre el oráculo de 1.296 combinaciones, `test/catalogo/importacion/oraculo-carta.ts`); `planificarCarta` le junta los hechos.
 */

export type AccionDeCarta = "CREAR" | "SIN_CAMBIOS" | "FUERA_DE_CARTA" | "NO_SE_EVALUA" | "ERROR";

/** Lo que el plan escribe de un contenido nuevo (y nada más: el guardián `DIMENSIONES_DEL_IMPORTADOR` lo compara con lo declarado). */
export interface ContenidoAEscribir {
  sucursalId: string;
  productoId: string;
  visibleEnCarta: true;
  seccionCartaId: string;
  descripcion: string | null;
  orden: number;
  especial: false;
  tags: string[];
  generoCartaId: null;
  mostrarNombreArriba: false;
}

/** Los hechos de UNA fila (SKU, local) que deciden su contenido de carta. */
export interface HechosDeLaFilaDeCarta {
  accionDelProducto: AccionDePlan;
  /** El nombre de la sección del mapeo de la categoría, o `null` = sin sección. */
  seccionDelMapeo: string | null;
  /** La sección de la base con ese nombre, o `null` si no existe. */
  seccion: SeccionDeCarta | null;
  disponible: boolean;
  tienePrecio: boolean;
  descripcion: DescripcionDeCarta;
  contenidoExistente: ContenidoExistente | null;
  permisoDeCarta: boolean;
  esAnclaDeAdicional: boolean;
  esMiembroDeAgrupado: boolean;
  orden: number;
  sucursalId: string | null;
}

export interface DecisionDeCarta {
  accion: AccionDeCarta;
  codigo: string | null;
  motivo: string;
}

/** Lo que tendría que haber en la base para esa fila (el contenido que se crea, sin el id del producto). */
function contenidoEsperado(h: HechosDeLaFilaDeCarta, seccionId: string): Omit<ContenidoExistente, "sucursalId"> {
  return { visibleEnCarta: true, seccionCartaId: seccionId, descripcion: h.descripcion.estado === "VALIDA" ? h.descripcion.valor : null, orden: h.orden, especial: false, tags: [], generoCartaId: null, mostrarNombreArriba: false };
}

function mismoContenido(existente: ContenidoExistente, esperado: Omit<ContenidoExistente, "sucursalId">): boolean {
  return (
    existente.visibleEnCarta === esperado.visibleEnCarta &&
    existente.seccionCartaId === esperado.seccionCartaId &&
    existente.descripcion === esperado.descripcion &&
    existente.orden === esperado.orden &&
    existente.especial === esperado.especial &&
    existente.tags.length === 0 &&
    existente.generoCartaId === esperado.generoCartaId &&
    existente.mostrarNombreArriba === esperado.mostrarNombreArriba
  );
}

/** La regla de UNA fila: la primera condición que se cumple decide. */
export function planificarFilaDeCarta(h: HechosDeLaFilaDeCarta): DecisionDeCarta {
  if (h.accionDelProducto === "ERROR") return { accion: "NO_SE_EVALUA", codigo: null, motivo: "el producto tiene un error: su carta no se evalúa" };
  if (h.seccionDelMapeo === null) return { accion: "FUERA_DE_CARTA", codigo: "SIN_SECCION", motivo: "la categoría no tiene sección de carta (queda en «Fuera de carta»)" };
  if (!h.tienePrecio) return { accion: "FUERA_DE_CARTA", codigo: "SIN_PRECIO", motivo: "la fila no tiene precio: no se muestra en la carta (activarlo lo mostraría a $0)" };
  if (!h.seccion) return { accion: "ERROR", codigo: "SECCION_INEXISTENTE", motivo: `no existe la sección de carta «${h.seccionDelMapeo}» (el importador no crea secciones)` };
  if (!h.seccion.activa) return { accion: "ERROR", codigo: "SECCION_APAGADA", motivo: `la sección de carta «${h.seccion.nombre}» está apagada` };
  if (!h.permisoDeCarta) return { accion: "ERROR", codigo: "SIN_PERMISO_CARTA", motivo: "el actor no tiene «carta_contenido_producto» en este local" };
  if (h.descripcion.estado === "INVALIDA") return { accion: "ERROR", codigo: "DESCRIPCION_INVALIDA", motivo: h.descripcion.mensaje };
  if (h.esAnclaDeAdicional) return { accion: "ERROR", codigo: "ES_ANCLA_DE_ADICIONAL", motivo: "el producto es el ancla de un adicional: no va suelto en la carta" };
  if (h.esMiembroDeAgrupado) return { accion: "ERROR", codigo: "ES_MIEMBRO_DE_AGRUPADO", motivo: "el producto ya sale en la carta de este local dentro de un ítem agrupado" };
  if (h.contenidoExistente) {
    return mismoContenido(h.contenidoExistente, contenidoEsperado(h, h.seccion.id))
      ? { accion: "SIN_CAMBIOS", codigo: null, motivo: "ya está en la carta, igual" }
      : { accion: "ERROR", codigo: "CONTENIDO_DISTINTO", motivo: "ya tiene contenido de carta en este local y es distinto (no se pisa)" };
  }
  return { accion: "CREAR", codigo: null, motivo: "se agrega a la carta, visible" };
}

export interface PlanDeContenido extends DecisionDeCarta {
  sku: string;
  local: LocalDelImportador;
  sucursalId: string | null;
  /** Fila de «Precios por local». */
  fila: number;
  categoria: string;
  seccion: string | null;
  seccionId: string | null;
  descripcion: string | null;
  /** Descripción que trae el Excel y no se carga (fila sin sección): se lista en la vista previa. */
  descripcionNoCargada: string | null;
  orden: number;
  disponible: boolean;
  /** Id del producto si ya existe (para escribir el contenido de un producto `SIN_CAMBIOS`). */
  productoExistenteId: string | null;
}

export interface PlanDeCarta {
  contenidos: readonly PlanDeContenido[];
}

/** El plan de la carta: una decisión por fila de «Precios por local», en su orden. */
export function planificarCarta(catalogo: CatalogoNormalizado, productos: PlanDeProductos, estado: EstadoDeLaBase, permisos: PermisosDelActor): PlanDeCarta {
  const productoPorSku = new Map(catalogo.productos.map((p) => [p.sku, p]));
  const planPorSku = new Map(productos.productos.map((p) => [p.sku, p]));
  const existentePorCodigo = new Map(estado.productos.map((p) => [p.codigo, p]));
  const seccionPorNombre = new Map(estado.secciones.map((s) => [s.nombre, s]));
  const contenidos = catalogo.filas.flatMap((f): PlanDeContenido[] => {
    const producto = productoPorSku.get(f.sku);
    const plan = planPorSku.get(f.sku);
    if (!producto || !plan) return [];
    const existente = existentePorCodigo.get(f.sku) ?? null;
    const sucursalId = estado.sucursales[f.local]?.id ?? null;
    const seccionDelMapeo = catalogo.correcciones.mapeoDeSecciones[producto.categoria] ?? null;
    const seccion = seccionDelMapeo === null ? null : (seccionPorNombre.get(seccionDelMapeo) ?? null);
    const hechos: HechosDeLaFilaDeCarta = {
      accionDelProducto: plan.accion,
      seccionDelMapeo,
      seccion,
      disponible: f.disponible,
      tienePrecio: f.precioCentavos !== null,
      descripcion: f.descripcion,
      contenidoExistente: (existente && sucursalId && existente.contenidos.find((c) => c.sucursalId === sucursalId)) || null,
      permisoDeCarta: permisos.porLocal[f.local]?.carta === true,
      esAnclaDeAdicional: existente?.esAnclaDeAdicional === true,
      esMiembroDeAgrupado: existente !== null && sucursalId !== null && existente.agrupadoEn.includes(sucursalId),
      orden: producto.fila,
      sucursalId,
    };
    const decision = planificarFilaDeCarta(hechos);
    const textoDescripcion = f.descripcion.estado === "VALIDA" ? f.descripcion.valor : f.descripcion.estado === "INVALIDA" ? f.descripcion.texto : null;
    return [
      {
        ...decision,
        sku: f.sku,
        local: f.local,
        sucursalId,
        fila: f.fila,
        categoria: producto.categoria,
        seccion: seccionDelMapeo,
        seccionId: seccion?.id ?? null,
        descripcion: decision.accion !== "FUERA_DE_CARTA" && f.descripcion.estado === "VALIDA" ? f.descripcion.valor : null,
        descripcionNoCargada: decision.accion === "FUERA_DE_CARTA" ? textoDescripcion : null,
        orden: producto.fila,
        disponible: f.disponible,
        productoExistenteId: existente?.id ?? null,
      },
    ];
  });
  return { contenidos };
}

/** Los contenidos que se escriben (solo los `CREAR`), con el id del producto: el recién creado (por código) o el que ya existía. */
export function contenidosAEscribir(plan: PlanDeCarta, idPorCodigo: ReadonlyMap<string, string>): ContenidoAEscribir[] {
  return plan.contenidos
    .filter((c) => c.accion === "CREAR")
    .map((c) => {
      const productoId = idPorCodigo.get(c.sku) ?? c.productoExistenteId;
      if (!productoId || !c.sucursalId || !c.seccionId) throw new Error(`El contenido de ${c.sku} en «${c.local}» no tiene producto, sucursal o sección: el plan no tendría que haber llegado a escribir.`);
      return { sucursalId: c.sucursalId, productoId, visibleEnCarta: true, seccionCartaId: c.seccionId, descripcion: c.descripcion, orden: c.orden, especial: false, tags: [], generoCartaId: null, mostrarNombreArriba: false };
    });
}

/**
 * Comprobación INTERNA antes de escribir (I6 de la ADENDA, adaptada a un precio por empresa): el plan que se va a escribir es coherente consigo mismo. Lanza (es un defecto del programa, no
 * un error del Excel) si un producto nuevo no tiene precio, si el precio que rige en algún local no es el único del producto, si una disponibilidad no tiene sucursal o si un contenido nuevo
 * es de un producto con error o no tiene sección. No hay precios locales que comprobar: el plan no los tiene (A.1).
 */
export function comprobarPlanAntesDeEscribir(productos: PlanDeProductos, carta: PlanDeCarta): void {
  const accionPorSku = new Map(productos.productos.map((p) => [p.sku, p.accion]));
  for (const p of productos.productos) {
    if (p.accion !== "CREAR") continue;
    if (!p.precio) throw new Error(`Plan incoherente: ${p.sku} se crearía sin precio único.`);
    for (const d of p.diferencias) if (d.precioUnico !== p.precio.centavos) throw new Error(`Plan incoherente: en ${d.local} ${p.sku} regiría otro precio que el único.`);
    for (const d of p.disponibilidad) if (!d.sucursalId) throw new Error(`Plan incoherente: ${p.sku} tiene disponibilidad en «${d.local}» sin sucursal.`);
  }
  for (const c of carta.contenidos) {
    if (c.accion !== "CREAR") continue;
    const accion = accionPorSku.get(c.sku);
    if (accion !== "CREAR" && accion !== "SIN_CAMBIOS") throw new Error(`Plan incoherente: contenido de carta de ${c.sku}, que no se crea ni existe.`);
    if (!c.seccionId || !c.sucursalId) throw new Error(`Plan incoherente: contenido de ${c.sku} en «${c.local}» sin sección o sin sucursal.`);
  }
}
