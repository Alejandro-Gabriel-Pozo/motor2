import type { DestinoConsumo, MotivoMerma, Proceso } from "@prisma/client";
import { TRANSICIONES } from "./transiciones";

/** Etiquetas de MOTIVOS_MERMA (Movimientos.js:56) — import type-only de @prisma/client, no arrastra el cliente de Prisma al bundle del navegador. */
export const MOTIVOS_MERMA: { value: MotivoMerma; label: string }[] = [
  { value: "VENCIDO", label: "Vencido" },
  { value: "ROTO_O_CAIDO", label: "Roto o caído" },
  { value: "MAL_PREPARADO_O_QUEMADO", label: "Mal preparado / quemado" },
  { value: "DEVOLUCION_CLIENTE_NO_REVENDIBLE", label: "Devolución de cliente (no revendible)" },
  { value: "ROBO_O_FALTANTE", label: "Robo o faltante" },
  { value: "OTRO", label: "Otro" },
];

/** Etiquetas de DESTINOS_CONSUMO (Movimientos.js:59). */
export const DESTINOS_CONSUMO: { value: DestinoConsumo; label: string }[] = [
  { value: "PERSONAL", label: "Personal" },
  { value: "DEGUSTACION_CORTESIA", label: "Degustación / cortesía" },
  { value: "EVENTO", label: "Evento" },
  { value: "ELABORACION_INTERNA", label: "Elaboración interna" },
  { value: "OTRO", label: "Otro" },
];

/**
 * Config de UI para los 9 procesos que comparten el panel genérico
 * (`/movimientos/[proceso]`) — equivalente a `mostrarPanelOperacion_`
 * parametrizado (Movimientos.js:1777-1825). Venta y Control (Conteo
 * Físico) tienen su propia página, no pasan por acá — mismo criterio que
 * ya separa `registrarVenta`/`registrarConteoFisico` de `registrarMovimiento`.
 */
export interface ProcesoUiConfig {
  proceso: Exclude<Proceso, "VENTA" | "CONTROL" | "LIQUIDACION_CONSIGNACION" | "RECLASIFICACION">;
  titulo: string;
  /** Compra/Devolución a Proveedor: hay un proveedor real y conviene pedir N° de factura. */
  requiereProveedor: boolean;
  /** Compra/Devolución a Proveedor: aplica factor de conversión — tiene sentido mostrar Precio Total/Peso Real. */
  esCompraLike: boolean;
  /** Solo Merma. */
  pideMotivo: boolean;
  /** Solo Consumo. */
  pideDestino: boolean;
  /** Solo Ajuste: la cantidad puede ser negativa (el delta ya viene firmado). */
  cantidadConSigno: boolean;
}

export const PROCESOS_UI: Record<string, ProcesoUiConfig> = {
  compra: { proceso: "COMPRA", titulo: "Compra", requiereProveedor: true, esCompraLike: true, pideMotivo: false, pideDestino: false, cantidadConSigno: false },
  produccion: { proceso: "PRODUCCION", titulo: "Producción", requiereProveedor: false, esCompraLike: false, pideMotivo: false, pideDestino: false, cantidadConSigno: false },
  consumo: { proceso: "CONSUMO", titulo: "Consumo", requiereProveedor: false, esCompraLike: false, pideMotivo: false, pideDestino: true, cantidadConSigno: false },
  ajuste: { proceso: "AJUSTE", titulo: "Ajuste de stock", requiereProveedor: false, esCompraLike: false, pideMotivo: false, pideDestino: false, cantidadConSigno: true },
  transferencia: { proceso: "TRANSFERENCIA", titulo: "Transferencia entre secciones", requiereProveedor: false, esCompraLike: false, pideMotivo: false, pideDestino: false, cantidadConSigno: false },
  merma: { proceso: "MERMA", titulo: "Merma", requiereProveedor: false, esCompraLike: false, pideMotivo: true, pideDestino: false, cantidadConSigno: false },
  "devolucion-consignacion": { proceso: "DEVOLUCION_CONSIGNACION", titulo: "Devolución al consignante", requiereProveedor: false, esCompraLike: false, pideMotivo: false, pideDestino: false, cantidadConSigno: false },
  "devolucion-cliente": { proceso: "DEVOLUCION_CLIENTE", titulo: "Devolución de cliente (revendible)", requiereProveedor: false, esCompraLike: false, pideMotivo: false, pideDestino: false, cantidadConSigno: false },
  "devolucion-proveedor": { proceso: "DEVOLUCION_PROVEEDOR", titulo: "Devolución a proveedor", requiereProveedor: true, esCompraLike: true, pideMotivo: false, pideDestino: false, cantidadConSigno: false },
};

export type ProcesoSlug = keyof typeof PROCESOS_UI;

export function obtenerConfigProceso(slug: string): ProcesoUiConfig | null {
  return Object.prototype.hasOwnProperty.call(PROCESOS_UI, slug) ? PROCESOS_UI[slug] : null;
}

/** Para el nav (`/movimientos/layout.tsx`) — incluye Venta/Conteo Físico, que tienen ruta propia. */
export const NAV_MOVIMIENTOS: { href: string; label: string }[] = [
  { href: "/movimientos/compra", label: "Compra" },
  { href: "/movimientos/produccion", label: "Producción" },
  { href: "/movimientos/venta", label: "Venta" },
  { href: "/movimientos/consumo", label: "Consumo" },
  { href: "/movimientos/merma", label: "Merma" },
  { href: "/movimientos/ajuste", label: "Ajuste" },
  { href: "/movimientos/transferencia", label: "Transferencia" },
  { href: "/movimientos/devolucion-consignacion", label: "Dev. consignación" },
  { href: "/movimientos/devolucion-cliente", label: "Dev. cliente" },
  { href: "/movimientos/devolucion-proveedor", label: "Dev. proveedor" },
  { href: "/movimientos/conteo-fisico", label: "Conteo físico" },
  { href: "/movimientos/secciones", label: "Secciones" },
  { href: "/movimientos/precio-local", label: "Precio local" },
  { href: "/stock/consolidado", label: "Stock →" },
  { href: "/reportes", label: "Reportes →" },
];

// Verificación en tiempo de import: todo slug de PROCESOS_UI tiene que
// existir en TRANSICIONES — si algún día se agrega un proceso nuevo al
// enum sin darle su config de UI, esto explota temprano (en vez de un
// "undefined.exigeSeccion" silencioso en runtime del panel).
for (const config of Object.values(PROCESOS_UI)) {
  if (!TRANSICIONES[config.proceso]) throw new Error(`PROCESOS_UI: "${config.proceso}" no tiene entrada en TRANSICIONES.`);
}
