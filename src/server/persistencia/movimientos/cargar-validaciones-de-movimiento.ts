import type { Prisma } from "@prisma/client";
import type { CompraCandidata } from "@/core/compras/public";
import { redondearMoneda } from "@/core/moneda";
import { ZONA_ARGENTINA, diaDeCalendario, finDelDia, inicioDelDia } from "@/core/tiempo/zona-horaria";

/**
 * Persistencia de las validaciones de `registrarMovimiento` (Task #41, Fase M, M13a — docs/arquitectura-casos-de-uso-2026-09-27.md). Las de motivo, destino, proveedor
 * y factura corren ANTES de abrir la transacción y son EXACTAMENTE las lecturas de Prisma que antes hacía en línea la Server Action
 * `registrarMovimiento` (src/server/actions/movimientos/movimientos.ts), copiadas tal cual; la del aviso C25 (`cargarComprasParaAvisoDeDuplicado`) también corre ANTES de la transacción (P2), pero con la base de VERIFICACIÓN (lectura en toda la empresa). Qué hacer con lo cargado (mensajes,
 * cuándo llamarlas) lo decide el caso de uso `casos-de-uso/registrar-movimiento.ts`. Sin reglas de negocio.
 *
 * Contrato: el cliente es SIEMPRE el primer parámetro, obligatorio (nunca `db = prisma` por defecto) — salvo la excepción documentada
 * acá, calcada del docstring de `guardar-version-de-receta.ts` de P1: las lecturas de motivo, destino, proveedor y factura corren FUERA de la
 * transacción, con el cliente GLOBAL `prisma` (es el camino rápido previo a la SERIALIZABLE; el árbitro real es un índice único o la propia
 * transacción — nunca esta lectura sola). El caso de uso les pasa el cliente global a propósito. Desde P2 ninguna corre adentro: `cargarComprasParaAvisoDeDuplicado` recibe
 * la base de VERIFICACIÓN del caso de uso (cada función dice dónde corre en su propio docstring).
 */

/** `null` si el motivo no existe. Corre FUERA de la transacción (ver el docstring del archivo). */
export async function cargarMotivoMerma(db: Prisma.TransactionClient, motivoId: string): Promise<{ activo: boolean } | null> {
  const motivo = await db.motivoMerma.findUnique({ where: { id: motivoId } });
  if (!motivo) return null;
  return { activo: motivo.activo };
}

/** `null` si el destino no existe. Corre FUERA de la transacción (ver el docstring del archivo). */
export async function cargarDestinoConsumo(db: Prisma.TransactionClient, destinoId: string): Promise<{ activo: boolean } | null> {
  const destino = await db.destinoConsumo.findUnique({ where: { id: destinoId } });
  if (!destino) return null;
  return { activo: destino.activo };
}

/** `null` si el proveedor no existe (o es de otra empresa: la RLS no lo deja ver). Corre FUERA de la transacción (ver el docstring del archivo). */
export async function cargarProveedor(db: Prisma.TransactionClient, proveedorId: string): Promise<{ activo: boolean } | null> {
  const proveedor = await db.proveedor.findUnique({ where: { id: proveedorId }, select: { activo: true } });
  return proveedor ?? null;
}

/**
 * true si ya existe una Compra VIGENTE (no anulada) con ese proveedor + N.º de factura en esta sucursal (Movimientos.js:402-416).
 * Camino RÁPIDO previo a la SERIALIZABLE — ver el docstring del archivo: bajo concurrencia real el árbitro es el índice único parcial
 * `Operacion_factura_unica_vigente_key`, no esta lectura.
 */
export async function existeCompraVigenteConFactura(
  db: Prisma.TransactionClient,
  args: { sucursalId: string; proveedorId: string; nroFactura: string }
): Promise<boolean> {
  const yaExiste = await db.operacion.findFirst({
    where: { sucursalId: args.sucursalId, proceso: "COMPRA", proveedorId: args.proveedorId, nroFactura: args.nroFactura, anuladaEn: null },
  });
  return !!yaExiste;
}

/**
 * Las Compras VIGENTES (no anuladas) de ese proveedor entre dos días de calendario («AAAA-MM-DD», ambos inclusive), de TODAS las sucursales de la empresa, con el
 * nombre de la sucursal y el importe (suma de `precioTotal` de sus líneas, redondeada a centavos, como el reporte de compras registradas). Es la lectura del aviso C25 de posible
 * factura repetida (`posiblesDuplicados`, src/core/compras/posible-duplicado.ts). P2: corre ANTES de la transacción de `registrarMovimiento` y con la base de VERIFICACIÓN
 * (`lecturaDeVerificacionEnLaEmpresa`: lectura en todas las sucursales de la empresa), así que cuando rija la RLS por sucursal (Fase B) sigue viendo toda la empresa y el aviso no se achica. Lo que
 * devuelve NO se muestra tal cual: el texto da el día solo de las compras de sucursales que quien carga puede ver y nunca el importe ni el N.º de factura.
 *
 * La fecha de una compra de formulario es el mediodía argentino del día elegido (P1, `mediodiaDelDia`): el rango y el día de cada compra se calculan en hora argentina, igual que
 * el día que arma el caso de uso para la compra nueva. (Una compra vieja guardada a medianoche UTC se lee un día antes; sin relleno, ver O.250.)
 */
export async function cargarComprasParaAvisoDeDuplicado(
  db: Prisma.TransactionClient,
  args: { proveedorId: string; desde: string; hasta: string }
): Promise<CompraCandidata[]> {
  const compras = await db.operacion.findMany({
    where: {
      proceso: "COMPRA",
      proveedorId: args.proveedorId,
      anuladaEn: null,
      fecha: { gte: inicioDelDia(args.desde, ZONA_ARGENTINA), lte: finDelDia(args.hasta, ZONA_ARGENTINA) },
    },
    select: {
      id: true,
      proveedorId: true,
      sucursalId: true,
      sucursal: { select: { nombre: true } },
      fecha: true,
      movimientos: { where: { proceso: "COMPRA" }, select: { precioTotal: true } },
    },
  });
  return compras.map((c) => ({
    id: c.id,
    proveedorId: c.proveedorId,
    sucursalId: c.sucursalId,
    sucursalNombre: c.sucursal.nombre,
    dia: diaDeCalendario(c.fecha, ZONA_ARGENTINA),
    importe: redondearMoneda(c.movimientos.reduce((suma, m) => suma + Number(m.precioTotal), 0)),
    anulado: false,
  }));
}
