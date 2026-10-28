import type { LocalDelImportador } from "./tipos";

/**
 * El ESTADO DE LA BASE que el planificador del importador necesita (lo lee el caso de uso, dentro de la transacción en la confirmación). Solo lo que decide el plan; todo entra en la
 * huella (A.5): si cambia entre la vista previa y la confirmación, la huella cambia y la confirmación se rechaza (`VERSION_DESACTUALIZADA`).
 *
 * Los importes viajan como TEXTO con dos decimales («3000.00»: el `Decimal(14,2)` de la base pasado a texto), nunca como `number`.
 */
export interface SucursalDelImportador {
  id: string;
  nombre: string;
  activa: boolean;
}

export interface SeccionDeCarta {
  id: string;
  nombre: string;
  activa: boolean;
}

export interface ContenidoExistente {
  sucursalId: string;
  visibleEnCarta: boolean;
  seccionCartaId: string | null;
  descripcion: string | null;
  orden: number;
  especial: boolean;
  tags: readonly string[];
  generoCartaId: string | null;
  mostrarNombreArriba: boolean;
}

export interface ProductoExistente {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  precioVenta: string;
  modoDeVenta: string;
  seProduce: boolean;
  factorConversion: string;
  unidadStockId: string;
  /** Solo las de las 5 sucursales del importador. */
  filasDeDisponibilidad: readonly { sucursalId: string; disponible: boolean }[];
  /** Solo las de las 5 sucursales del importador (con un precio por empresa, tiene que ser vacío: A.1). */
  preciosLocales: readonly { sucursalId: string; precio: string }[];
  /** Solo los de las 5 sucursales del importador. */
  contenidos: readonly ContenidoExistente[];
  /** Sucursales (de las 5) donde el producto es miembro de un ítem agrupado de la carta (I10). */
  agrupadoEn: readonly string[];
  /** Es el ancla de una opción ADICIONAL (I10: se vende solo como adicional, nunca suelto en la carta). */
  esAnclaDeAdicional: boolean;
}

/** Las claves que el gate aprobó: las de empresa y, por local, las de sucursal (A.6). Un local sin aprobar = sin alcance allí. */
export interface PermisosDelActor {
  altaProducto: boolean;
  camposSensibles: boolean;
  porLocal: Readonly<Partial<Record<LocalDelImportador, { disponibilidad: boolean; carta: boolean }>>>;
}

export interface EstadoDeLaBase {
  /** Local → la sucursal de la empresa con ese nombre EXACTO, o ausente si no existe. */
  sucursales: Readonly<Partial<Record<LocalDelImportador, SucursalDelImportador>>>;
  /** La unidad de stock «unidad» (defecto declarado del diseño, 4.3), o `null` si la empresa no la tiene. */
  unidadId: string | null;
  /** Las secciones de carta de la empresa cuyo nombre está en el mapeo. */
  secciones: readonly SeccionDeCarta[];
  /** Los productos de la empresa con un código del archivo o con un nombre que choca (sin distinguir mayúsculas) con uno del archivo. */
  productos: readonly ProductoExistente[];
}
