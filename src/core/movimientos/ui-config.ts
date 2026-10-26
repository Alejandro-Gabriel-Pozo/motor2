import type { Proceso } from "@/core/datos/enumerados-del-esquema";
import { ACCION_POR_PROCESO, TRANSICIONES } from "./transiciones";
import type { AccionClave, AccionDeSucursal } from "@/core/permisos/acciones";
import type { FiltroSelectorProducto } from "@/core/catalogo/public";
import type { PanelNav } from "@/core/navegacion/panel";

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
  if (proceso === "PRODUCCION") return { soloDisponibles: true, soloSeProduce: true };
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

export function obtenerConfigProceso(slug: string): ProcesoUiConfig | null {
  return Object.prototype.hasOwnProperty.call(PROCESOS_UI, slug) ? PROCESOS_UI[slug] : null;
}

/**
 * Los procesos con acceso DIRECTO desde el menú de Movimientos (decisión DEC-25 del dueño, Fase 7): Merma y Compra. Se abren por su propia ruta del panel genérico y NO están en el selector. Venta
 * (`/movimientos/venta`) y Conteo físico (`/movimientos/conteo-fisico`) también tienen acceso propio, pero ruta propia y no están en `PROCESOS_UI`.
 */
export const PROCESOS_DIRECTOS = ["merma", "compra"] as const;

/** Un proceso del selector «Registrar movimiento»: la ruta de su pantalla, cómo se nombra en el selector y la acción de «Ver» que la protege (la que pide su página). */
export interface ProcesoDelSelector {
  href: string;
  etiquetaCorta: string;
  accion: AccionDeSucursal;
}

/** Cómo se nombra en el selector cada proceso del panel genérico que no es directo. Si un proceso nuevo entra a `PROCESOS_UI` sin nombre acá, falla al importar (abajo). */
const ETIQUETA_CORTA_DEL_SELECTOR: Readonly<Record<string, string>> = {
  produccion: "Producción",
  consumo: "Consumo",
  ajuste: "Ajuste",
  transferencia: "Traslado entre depósitos",
  "devolucion-consignacion": "Devolución al consignante",
  "devolucion-cliente": "Devolución de cliente",
  "devolucion-proveedor": "Devolución a proveedor",
};

/**
 * Los procesos que ofrece el selector «Registrar movimiento»: los de `PROCESOS_UI` que no son directos (7), cada uno con su acción de `ACCION_POR_PROCESO` (la misma que pide su página), más Reclasificar,
 * que no es un proceso del panel genérico sino su propia pantalla de Stock. Hoy NADA lo consume: el menú sigue saliendo de `NAV_MOVIMIENTOS`; la entrada del menú (P5a) y su página la usan.
 * Un guardián (test/movimientos/selector-de-procesos.test.ts) exige que todo slug esté en exactamente un lugar (directos, selector o aparte).
 */
export const PROCESOS_DEL_SELECTOR: readonly ProcesoDelSelector[] = [
  ...Object.entries(PROCESOS_UI)
    .filter(([slug]) => !(PROCESOS_DIRECTOS as readonly string[]).includes(slug))
    .map(([slug, cfg]): ProcesoDelSelector => {
      const etiquetaCorta = Object.hasOwn(ETIQUETA_CORTA_DEL_SELECTOR, slug) ? ETIQUETA_CORTA_DEL_SELECTOR[slug] : undefined;
      const accion = ACCION_POR_PROCESO[cfg.proceso];
      if (etiquetaCorta === undefined) throw new Error(`PROCESOS_DEL_SELECTOR: "${slug}" no tiene etiqueta corta (agregala en ETIQUETA_CORTA_DEL_SELECTOR, o declaralo directo en PROCESOS_DIRECTOS).`);
      if (accion === undefined) throw new Error(`PROCESOS_DEL_SELECTOR: "${cfg.proceso}" no tiene acción en ACCION_POR_PROCESO.`);
      return { href: `/movimientos/${slug}`, etiquetaCorta, accion };
    }),
  { href: "/stock/reclasificar", etiquetaCorta: "Reclasificar", accion: "stock_reclasificar" },
];

/** Un ítem del grupo Movimientos del menú: lleva SIEMPRE una clave de «Ver», una sola (`accion`) o una lista de la que alcanza con una (`algunaDe`). Mismo molde que `ItemNav` de `core/navegacion/estructura.ts`. */
export type ItemNavDeMovimientos = { href: string; label: string; panel: PanelNav } & (
  | { accion: AccionClave; algunaDe?: never }
  | { algunaDe: readonly [AccionClave, ...AccionClave[]]; accion?: never }
);

/** Las claves de «Ver» de todo el selector, como lista no vacía: el `algunaDe` de la entrada «Registrar movimiento» (la página usa las mismas, un test lo comprueba). */
const CLAVES_DEL_SELECTOR = PROCESOS_DEL_SELECTOR.map((p) => p.accion) as [AccionDeSucursal, ...AccionDeSucursal[]];

/**
 * Fuente del grupo Movimientos del menú lateral (`estructura.ts` lo recorre) — DEC-25 del dueño (Fase 7): los procesos DIRECTOS (Merma y Compra), UNA entrada «Registrar movimiento» (`/movimientos`: el selector con el
 * resto de los procesos y Reclasificar, visible si el rol puede ver alguno), la carga de ventas sin ticket (ruta propia) y el Conteo físico (ruta propia, aparte). Las demás entradas que vivían acá se mudaron a su
 * módulo (Catálogo, Carta, Stock); las URL no cambiaron. `accion`/`algunaDe` son las claves de «Ver» que protegen la página: el menú solo muestra el ítem a quien puede verla.
 */
export const NAV_MOVIMIENTOS: ItemNavDeMovimientos[] = [
  { href: "/movimientos/merma", label: "Merma", accion: "proceso_merma", panel: "sucursal" },
  { href: "/movimientos/compra", label: "Compra", accion: "proceso_compra", panel: "sucursal" },
  { href: "/movimientos", label: "Registrar movimiento", algunaDe: CLAVES_DEL_SELECTOR, panel: "sucursal" },
  // Antes «Venta». Carga ventas que no tienen ticket (el mostrador real llegará como Salón › Mostrador); misma ruta, misma clave.
  { href: "/movimientos/venta", label: "Carga de ventas sin ticket", accion: "proceso_venta", panel: "sucursal" },
  { href: "/movimientos/conteo-fisico", label: "Conteo físico", accion: "proceso_control", panel: "sucursal" },
];

// Verificación en tiempo de import: todo slug de PROCESOS_UI tiene que
// existir en TRANSICIONES — si algún día se agrega un proceso nuevo al
// enum sin darle su config de UI, esto explota temprano (en vez de un
// "undefined.exigeSeccion" silencioso en runtime del panel).
for (const config of Object.values(PROCESOS_UI)) {
  if (!TRANSICIONES[config.proceso]) throw new Error(`PROCESOS_UI: "${config.proceso}" no tiene entrada en TRANSICIONES.`);
}
