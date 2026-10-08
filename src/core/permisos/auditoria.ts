import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Única lista de entidades auditables: el tipo `CambioAuditable["entidad"]` se deriva de acá y la pantalla de auditoría arma su filtro con
 * la misma lista, así que una entidad nueva aparece en el filtro sin tocar la página (antes "Cuenta" y "DisponibilidadProducto" se
 * escribían pero no se podían filtrar).
 */
export const ENTIDADES_AUDITABLES = [
  // "RecetaVersion" (paso 2): cada versión nueva de la receta central (`guardarReceta`) — SIEMPRE `sucursalId: null`
  // (Catálogo Central, no un dato por sucursal). "RendimientoLocalIngrediente" (paso 6): al revés, SIEMPRE lleva
  // `sucursalId` — es la calibración de UNA sucursal puntual (`entidadId` es la clave estable
  // `${sucursalId}:${productoId}:${insumoProductoId}`, no el id de la fila, que cambia con el arrastre entre versiones).
  "Producto",
  "PrecioLocalProducto",
  "DisponibilidadProducto",
  "PermisoRol",
  "CapacidadSucursal",
  "Rol",
  "Operacion",
  "CuentaItem",
  // "Cuenta": cambios sobre la cuenta de una mesa (ticket corregido, cliente asignado) — `entidadId` es el id de la Cuenta.
  "Cuenta",
  "RecetaVersion",
  // "RecetaSucursal": una sucursal pasa a usar su receta propia de un plato o vuelve a la central — `entidadId` es `${sucursalId}:${productoId}`, `campo: "habilitada"`, con `sucursalId`.
  "RecetaSucursal",
  "RendimientoLocalIngrediente",
  // "Sucursal" (docs/plan-comensales-y-limite-mesas-2026-09-26.md): el límite de mesas abiertas (`maxMesasAbiertas`) se edita desde
  // el mapa de mesas con el mismo permiso que da de alta mesas (`pos_mesas`) — `entidadId` es el id de la Sucursal.
  "Sucursal",
  // "PagoConsignante" (Task #41, M14): un pago a un proveedor de consignación — `entidadId` es el id del PagoConsignante creado,
  // `campo: "importe"`, `valorAnterior: null` (siempre una creación, nunca una edición — append-only, igual que el resto del Kardex).
  "PagoConsignante",
  // "UsuarioEmpresa": el traspaso de la gerencia de la empresa (`transferirGerencia`) — `entidadId` es el usuario que pasa a ser gerente, `sucursalId` null (es de la empresa).
  "UsuarioEmpresa",
  // "DescuentoProductoSucursal": el % de descuento de un producto en UNA sucursal — `entidadId` es el id de la fila (al sacarlo, el de la fila borrada), `campo: "porcentaje"`.
  "DescuentoProductoSucursal",
  // "Cliente": alta, edición (nombre y % de descuento) y activar/desactivar — catálogo central, `sucursalId` null. `entidadId` es el id del Cliente.
  "Cliente",
  // "Empresa": un cambio de la política de plataforma (`cambiarPoliticaDeEmpresa`) — `entidadId` es el id de la Empresa, `campo` la perilla (`permisosEditables`, `dosPaneles`), `sucursalId` null.
  "Empresa",
  // "MargenObjetivo": el food cost objetivo de la empresa (sin categoría) o de una categoría — `entidadId` es la categoría (`empresa` si es el de toda la empresa), `sucursalId` null, `campo: "foodCostObjetivoPct"`.
  "MargenObjetivo",
  // "UsuarioSucursal": alta, cambio de rol y activar/desactivar un usuario en una sucursal — `entidadId` es el id de la membresía, `sucursalId` la de la membresía.
  "UsuarioSucursal",
  // "CartaSucursal": la carta propia de una sucursal se arma por copia de otra (`copiarCartaDeSucursal`) — `entidadId` es el id de la Sucursal, `campo: "cartaPropia"`, con `sucursalId`.
  "CartaSucursal",
  // "PromoCarta" (Pureza 0.7): el precio de una promo de la carta — `entidadId` es el id de la promo, `campo: "precio"`, `sucursalId` null (la promo es de la empresa). Un alta lleva `valorAnterior: null`.
  "PromoCarta",
  // "PromoCartaSucursal" (Pureza 0.7): el precio propio de una promo en UNA sucursal — `entidadId` es `${promoCartaId}:${sucursalId}`, `campo: "precioLocal"`, con `sucursalId`. Vacío = vuelve al de la empresa (`valorNuevo: null`).
  "PromoCartaSucursal",
  // "Presentacion" (Pureza 0.7): el factor de conversión de una presentación de compra (cuántas unidades de stock trae una unidad de compra: mueve el costo por unidad) — `entidadId` es el id de la presentación, `campo: "factorConversion"`.
  "Presentacion",
  // "Unidad" (Pureza 0.7): los decimales de una unidad de medida (fijan la precisión de toda cantidad que la usa) — `entidadId` es el id de la unidad, `campo: "decimales"`, `sucursalId` null.
  "Unidad",
  // "ModuloEmpresa": la plataforma activa o desactiva un módulo de la empresa (`cambiarModulosDeEmpresa`) — `entidadId` es `${empresaId}:${modulo}`, `campo: "estado"`, `valorAnterior: null` si el módulo no tenía fila, `sucursalId` null.
  "ModuloEmpresa",
  // "ConteoFisico" (Pureza, decisión del dueño 2026-10-07): el alta de un conteo físico de stock — `entidadId` es el id del conteo, `campo: "conteoReal"`, `valorAnterior` el saldo del sistema
  // y `valorNuevo` lo contado, con `sucursalId`. Un conteo sin diferencia no deja fila (no cambia nada).
  "ConteoFisico",
  // "TraspasoSucursal" (Pureza, decisión del dueño 2026-10-07): el alta de una solicitud de traspaso o de un envío directo — `entidadId` es el id del traspaso, `campo: "cantidad"`,
  // `valorAnterior: null`, con la `sucursalId` de quien lo crea (la de destino en una solicitud, la de origen en un envío directo).
  "TraspasoSucursal",
  // "ProveedorPorProducto" (Pureza, decisión del dueño 2026-10-08): el precio por unidad de stock que quedó en el vínculo proveedor↔producto tras una compra — `entidadId` es
  // `${productoId}:${proveedorId}:${unidadCompraId}`, `campo: "precioPorUnidadStock"`, `valorAnterior: null` si el par es nuevo, con la `sucursalId` de la compra.
  "ProveedorPorProducto",
  // "Insumo" (D-9, decisión del dueño 2026-10-07; Hito 4, H4C-10): renombrar un insumo (`campo: "nombre"`, del nombre anterior al nuevo) o fusionarlo con otro
  // (`campo: "fusion"`, sobre el insumo que DESAPARECE, del nombre de origen al de destino, con la cantidad de productos reasignados en la descripción) —
  // `entidadId` es el id del insumo, `sucursalId` null (catálogo central).
  "Insumo",
] as const;

/**
 * Auditoría administrativa (A3, Pivote 6 — docs/auditoria-motor2-pivotes-
 * 2026-09-16.md "Pivote 6", docs/auditoria-motor2-fase6-seguridad-
 * 2026-09-18.md): catálogo/precios/permisos no dejaban ningún rastro de
 * quién cambió qué y cuándo. Este es el único punto de escritura del
 * registro (mismo criterio que `conPermiso`/`conTransaccionSerializable`:
 * un solo lugar, nunca una copia divergente en cada Server Action).
 */
export interface CambioAuditable {
  entidad: (typeof ENTIDADES_AUDITABLES)[number];
  entidadId: string;
  /** Legible de entrada, ej. `Producto "Pan Francés": precio de venta`. */
  descripcion: string;
  /** Nombre técnico del campo cambiado, ej. "precioVenta". */
  campo: string;
  valorAnterior: unknown;
  valorNuevo: unknown;
  actorId: string;
  sucursalId?: string | null;
}

/**
 * Claves de acción renombradas («boleta» pasó a «ticket»). La auditoría no se reescribe: las filas viejas conservan en su `descripcion` la clave
 * de entonces, y la pantalla las muestra con la vigente.
 */
export const CLAVES_DE_ACCION_RENOMBRADAS: Readonly<Record<string, string>> = {
  reporte_boletas: "reporte_tickets",
  pos_emitir_boleta_corregida: "pos_emitir_ticket_corregido",
};

/** La descripción de una fila de auditoría con las claves de acción renombradas puestas al día (solo para mostrar). */
export function descripcionParaMostrar(descripcion: string): string {
  let texto = descripcion;
  for (const [vieja, nueva] of Object.entries(CLAVES_DE_ACCION_RENOMBRADAS)) texto = texto.replaceAll(`"${vieja}"`, `"${nueva}"`);
  return texto;
}

function aTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  return String(valor);
}

/**
 * No-op si el valor no cambió en absoluto — evita ensuciar el registro
 * con "cambios" de un `update`/`upsert` que en realidad reescribió el
 * mismo valor (ej. guardar un formulario sin tocar ese campo puntual).
 */
export async function registrarCambioAuditado(db: Db, cambio: CambioAuditable): Promise<void> {
  const anterior = aTexto(cambio.valorAnterior);
  const nuevo = aTexto(cambio.valorNuevo);
  if (anterior === nuevo) return;

  await db.registroAuditoria.create({
    data: {
      entidad: cambio.entidad,
      entidadId: cambio.entidadId,
      descripcion: cambio.descripcion,
      campo: cambio.campo,
      valorAnterior: anterior,
      valorNuevo: nuevo,
      actorId: cambio.actorId,
      sucursalId: cambio.sucursalId ?? null,
    },
  });
}
