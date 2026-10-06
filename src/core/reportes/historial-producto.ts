import { Prisma } from "@prisma/client";

export interface FilaBusquedaProducto {
  productoId: string;
  codigo: string;
  nombre: string;
  tipo: "MP" | "PV";
  /** Disponible EN `sucursalId` (docs/plan-disponibilidad-por-sucursal-2026-09-23.md) — ya no es `Producto.activo` global. */
  disponible: boolean;
}

export interface EventoHistorialProducto {
  tipo: "movimiento" | "conteo";
  fecha: Date;
  detalle: string;
  seccionNombre: string;
  // Solo `tipo === "movimiento"`:
  proceso?: string;
  loteVencimiento?: Date | null;
  proveedorNombre?: string | null;
  nroFactura?: string | null;
  idOperacion?: string;
  cantidadConSigno?: number;
  saldoCorriente?: number;
  /** Importe real de la línea (0 si no representa un hecho financiero propio — ver docstring de MovimientoStock.precioTotal). Para "Cómo se vendió" (§4). */
  precioTotal?: number;
  /** Precio por unidad de stock (0 en líneas sin hecho financiero propio). Para "Cómo se compró" — variación contra la compra anterior (§4, decisión 3). */
  precioPorUnidadStock?: number;
  /** La Operación de esta línea está anulada — mismo criterio que ItemPeriodo.anulada (periodo.ts): el Kardex la sigue mostrando (append-only, auditoría), pero "Cómo se compró"/"Cómo se vendió" la excluyen (una compra/venta anulada no ocurrió). */
  anulada?: boolean;
  /** D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): solo en un CONSUMO que salió de un insumo SUSTITUTO — el nombre del
   * producto de la receta al que reemplazó. Ausente/null en todo lo demás (incluido un consumo de un hermano del mismo Insumo). */
  sustituyeANombre?: string | null;
  // Solo `tipo === "conteo"`:
  saldoSistema?: number;
  conteoReal?: number;
  diferencia?: number;
  estado?: string;
}

export interface FilaMovimientoHistorial {
  id: string;
  operacionId: string;
  proceso: string;
  cantidad: Prisma.Decimal;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: Prisma.Decimal;
  precioPorUnidadStock: Prisma.Decimal;
  seccionNombre: string;
  fecha: Date;
  nroFactura: string | null;
  anuladaEn: Date | null;
  proveedorNombre: string | null;
  sustituyeANombre: string | null;
}

export interface HistorialProducto {
  productoId: string;
  codigo: string;
  producto: string;
  tipo: "MP" | "PV";
  unidadStockNombre: string;
  saldoActual: number;
  eventos: EventoHistorialProducto[];
  totalMovimientos: number;
  totalConteos: number;
  /**
   * `tieneStockReal(tipo, seProduce)` — mismo predicado que ya filtra
   * consolidado/valuación/alertas/conteo/traspasos/catálogo (docs/grounding-
   * historial-producto-mp-pv-2026-09-22.md §1.3: esta pantalla era la única
   * superficie de stock del proyecto que no lo consultaba). `false` para un
   * PV que no se produce: el saldo corriente de ese producto es un
   * artefacto contable (unidades vendidas acumuladas, sin sentido físico de
   * stock) — la UI usa este flag para mostrar el cartel "Producto de
   * reventa" en vez del saldo (§4, decisiones 7-8).
   */
  tieneStockPropio: boolean;
}

export interface IngredienteRecetaVigente {
  nombre: string;
  cantidad: number;
  unidad: string;
}