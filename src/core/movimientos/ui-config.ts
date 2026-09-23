import type { DestinoConsumo, MotivoMerma, Proceso } from "@prisma/client";
import { TRANSICIONES } from "./transiciones";
import type { AccionClave } from "@/core/permisos/acciones";
import type { FiltroSelectorProducto } from "@/server/actions/catalogo/productos";

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
  proceso: Exclude<
    Proceso,
    "VENTA" | "CONTROL" | "LIQUIDACION_CONSIGNACION" | "RECLASIFICACION" | "TRANSFERENCIA_SALIDA_SUCURSAL" | "TRANSFERENCIA_ENTRADA_SUCURSAL" | "REINGRESO_TRANSFERENCIA_SUCURSAL"
  >;
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
  /** TRANSICIONES[proceso].exigeSeccion (ver transiciones.ts) — si false, el panel puede preseleccionar una sección por defecto en vez de forzar la elección. Derivado, nunca a mano: mismo criterio anti-duplicación que ya defendió esSignoFijo (bug de Merma sin signo, v2.1.0). */
  exigeSeccion: boolean;
  /**
   * Filtro del selector de producto — antes panel-movimiento-form.tsx
   * hardcodeaba `{ soloDisponibles: true }` para los 9 procesos por igual, a
   * diferencia de Venta/Conteo Físico (que sí filtran), así que se podía
   * elegir p. ej. un PV en Compra o un producto no-consignación en
   * Devolución al consignante, y el error recién aparecía al confirmar el
   * form completo. Espejo de las mismas reglas de productoValidoParaProceso
   * (transiciones.ts) traducidas a un filtro de query — no se pueden
   * compartir literalmente (un predicado sobre un producto ya cargado vs.
   * un `where` de Prisma), pero es la misma fuente de verdad.
   */
  filtroProducto: FiltroSelectorProducto;
}

/** Espejo de productoValidoParaProceso (transiciones.ts) para el selector — ver el docstring de `filtroProducto`. */
function filtroProductoDeProceso(proceso: ProcesoUiConfig["proceso"]): FiltroSelectorProducto {
  if (proceso === "COMPRA") return { soloDisponibles: true, tipo: "MP" };
  if (proceso === "DEVOLUCION_CONSIGNACION") return { soloDisponibles: true, soloConStockReal: true, esConsignacion: true };
  if (proceso === "DEVOLUCION_PROVEEDOR") return { soloDisponibles: true, soloConStockReal: true, esConsignacion: false };
  return { soloDisponibles: true, soloConStockReal: true };
}

const PROCESOS_UI_SIN_DERIVADOS: Record<string, Omit<ProcesoUiConfig, "exigeSeccion" | "filtroProducto">> = {
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

export const PROCESOS_UI: Record<string, ProcesoUiConfig> = Object.fromEntries(
  Object.entries(PROCESOS_UI_SIN_DERIVADOS).map(([slug, cfg]) => [
    slug,
    { ...cfg, exigeSeccion: TRANSICIONES[cfg.proceso].exigeSeccion, filtroProducto: filtroProductoDeProceso(cfg.proceso) },
  ])
);

export type ProcesoSlug = keyof typeof PROCESOS_UI;

export function obtenerConfigProceso(slug: string): ProcesoUiConfig | null {
  return Object.prototype.hasOwnProperty.call(PROCESOS_UI, slug) ? PROCESOS_UI[slug] : null;
}

/**
 * Fuente del grupo Movimientos del menú lateral (`estructura.ts` la filtra) — incluye Venta/Conteo Físico, que tienen ruta propia.
 * `accion` es la acción de «Ver» que protege la página: el menú solo muestra el ítem a quien puede verla.
 */
export const NAV_MOVIMIENTOS: { href: string; label: string; accion?: AccionClave }[] = [
  { href: "/movimientos/compra", label: "Compra", accion: "proceso_compra" },
  { href: "/movimientos/produccion", label: "Producción", accion: "proceso_produccion" },
  { href: "/movimientos/venta", label: "Venta", accion: "proceso_venta" },
  { href: "/movimientos/consumo", label: "Consumo", accion: "proceso_consumo" },
  { href: "/movimientos/merma", label: "Merma", accion: "proceso_merma" },
  { href: "/movimientos/ajuste", label: "Ajuste", accion: "proceso_ajuste" },
  { href: "/movimientos/transferencia", label: "Transferencia", accion: "proceso_transferencia" },
  { href: "/movimientos/devolucion-consignacion", label: "Dev. consignación", accion: "proceso_devolucion_consignacion" },
  { href: "/movimientos/devolucion-cliente", label: "Dev. cliente", accion: "proceso_devolucion_cliente" },
  { href: "/movimientos/devolucion-proveedor", label: "Dev. proveedor", accion: "proceso_devolucion_proveedor" },
  { href: "/movimientos/conteo-fisico", label: "Conteo físico", accion: "proceso_control" },
  { href: "/movimientos/secciones", label: "Secciones", accion: "secciones" },
  { href: "/movimientos/precio-local", label: "Precio local", accion: "precio_local" },
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
