import type { OrigenVenta } from "@/core/movimientos/origen-venta-datos";

/**
 * TIPOS del núcleo de la Venta (Pureza Fase 4: la función `registrarVentaEnTx` vive ahora en `server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`). Núcleo de la Venta, SIN permisos ni transacción propia (no es una Server Action: sin "use server"). Extraído tal cual de
 * `registrarVenta` (src/server/actions/movimientos/venta.ts) para que el cierre de una cuenta del salón (`cerrarCuenta`,
 * src/server/actions/pos/cuenta-cierre.ts) registre la venta con EXACTAMENTE la misma validación y escritura, dentro de SU transacción
 * (docs/plan-tomar-pedido-2026-09-25.md, B6). Quien llama es responsable de: el permiso, la transacción serializable
 * (`conTransaccionSerializable`) y — si aplica — el chequeo de idempotencia previo.
 *
 * Tres extensiones internas, que la Server Action pública NUNCA expone (mapea cada línea a `{ productoId, cantidadVendida }` a mano):
 * - `precioUnitario` por línea: reemplaza a `resolverPrecioVenta`. Lo usa `cerrarCuenta` para cobrar el precio CONGELADO al tomar
 *   el pedido, no el de hoy — y, con un cliente con descuento asignado (Task #14), el precio YA CON el descuento aplicado
 *   (`precioConDescuento`, src/core/moneda.ts): esta función no sabe nada de clientes ni de porcentajes, solo recibe el número final.
 * - `precioListaUnitario` por línea (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 3): el precio de LISTA de esa línea,
 *   cuando difiere de `precioUnitario` (venta con descuento) — se guarda tal cual en `MovimientoStock.precioListaUnitario` de la fila
 *   VENTA. Quien llama decide si lo manda (`cerrarCuenta` lo omite cuando no hay descuento, o cuando el descuento no cambió el
 *   precio por el piso de 0,01 — no hay nada que este núcleo tenga que comparar).
 * - `datos.clienteId` (Task #14): el cliente de la cuenta, si tiene uno asignado — va en CADA Operacion que crea este lote
 *   (`Operacion.clienteId`, FK RESTRICT). `undefined`/`null` = sin cliente, el caso de siempre (mostrador, o una mesa sin cliente
 *   asignado).
 * - `opciones.permitirStockNegativo` (B6bis, decisión del dueño): con `true`, un insumo sin stock suficiente NO aborta la venta; el
 *   movimiento se escribe igual (el Kardex es un ledger por suma: el saldo queda negativo) y se devuelve en `avisosStockNegativo`.
 *   Ausente o `false` (el caso de `registrarVenta`): rechaza igual que siempre.
 * - `promoCuentaId` por línea (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 7): la `PromoCuenta` de la que ese componente
 *   forma parte, si la línea viene de armar una promo en el POS — va en la `Operacion` que registra ESA línea (`Operacion.
 *   promoCuentaId`, FK RESTRICT), igual patrón que `datos.clienteId`. `undefined`/`null` = un suelto de siempre (el caso de
 *   `registrarVenta`, D7: la venta de mostrador nunca lo pasa — mapea cada línea a mano a `{ productoId, cantidadVendida }`,
 *   ver `src/server/actions/movimientos/venta.ts`). Convive con el arrastre de redondeo de la Task #27 (`cargarDeudaDeRedondeo`/
 *   `crearArrastreDeRedondeo`, más abajo) sin tocarlo: son dos campos independientes de la misma `Operacion`/línea, y el
 *   arrastre se calcula por (sucursal, producto CONSUMIDO), nunca por promo.
 *
 * DE QUÉ SECCIÓN SALE cada consumo lo decide `origen` (docs/plan-seccion-habitual-stock-2026-09-25.md, C5): `{ tipo: "seccion" }` (la
 * elegida por una persona: mostrador) o `{ tipo: "automatico" }` (el cierre del POS). En los dos casos los consumos se asignan con el
 * LIBRO de `origen-venta.ts`, que lleva la cuenta de lo ya asignado entre las líneas de la misma venta (arregla H9).
 */

export type { OrigenVenta };

export interface ActorVenta {
  usuarioId: string;
  sucursalId: string;
  sucursalNombre: string;
}

export interface LineaVentaEnTx {
  productoId: string;
  cantidadVendida: number;
  /** Override INTERNO del precio de venta (ver el docstring del módulo). Ausente = Precio Local o global de hoy. */
  precioUnitario?: number;
  /** Precio de LISTA, si difiere de `precioUnitario` (Task #14 — ver el docstring del módulo). Ausente = coinciden, no se guarda. */
  precioListaUnitario?: number;
  /** La `PromoCuenta` de la que este componente forma parte (Task #16 — ver el docstring del módulo). Ausente/null = un suelto. */
  promoCuentaId?: string | null;
}

export interface DatosVentaEnTx {
  fecha: Date;
  origen: OrigenVenta;
  proveedorId?: string | null;
  /** Cliente con descuento de la cuenta, si tiene uno asignado (Task #14 — ver el docstring del módulo). */
  clienteId?: string | null;
  nroFactura?: string;
  detalle?: string;
  lineas: LineaVentaEnTx[];
}

export interface OpcionesVentaEnTx {
  permitirStockNegativo?: boolean;
  /** I3: clave y hash del intento, que se guardan en la PRIMERA Operacion del lote junto con el mensaje devuelto (ver registrarVenta). */
  idempotencia?: { clave: string; payloadHash: string };
}

export interface AvisoStockNegativo {
  productoId: string;
  nombre: string;
  /** Sección en la que quedó en negativo. */
  seccionId: string;
  seccionNombre: string;
  /** Saldo del insumo en la sección ANTES de esta venta. */
  actual: number;
  /** Lo que la venta consumió de ese insumo. */
  requerido: number;
  /** Saldo con el que quedó después de la venta (negativo). */
  resultante: number;
}

export type ResultadoVentaEnTx =
  | { ok: true; mensaje: string; operacionIds: string[]; avisosStockNegativo: AvisoStockNegativo[] }
  | { ok: false; mensaje: string };

