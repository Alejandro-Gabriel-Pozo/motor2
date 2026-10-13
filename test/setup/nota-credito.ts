import { randomUUID } from "node:crypto";
import { EMPRESA_DE_PRUEBA_ID } from "./empresa-de-prueba";
import { sembrarEscenarioDeGasto, type EscenarioDeGasto } from "./gasto";
import { prisma } from "./test-db";

/**
 * Ayudas de los tests de la NOTA DE CRÉDITO DE PROVEEDOR (Paquete 4, M6): el escenario (una factura con mercadería repartida en dos sucursales, con su compra y su línea de Kardex en cada una, y un gasto imputado a las dos), los datos mínimos
 * válidos de una cabecera, una línea, una imputación y un tributo, y el INSERT crudo para un cliente `pg` (los tests de privilegios, de concurrencia y de lo que ni el dueño puede violar escriben con SQL, no con Prisma, para ver el código SQLSTATE).
 * Las usan `migracion-nota-credito-proveedor`, `nota-credito-proveedor-dinero`, `nota-credito-proveedor-rls`, `nota-credito-proveedor-concurrencia` y `paquete-4-m6-subir-bajar-subir`.
 */
export interface EscenarioDeNota extends EscenarioDeGasto {
  /** La parte de la factura de la sucursal A (50 % de la mercadería, 5 kg y 50,00) y su compra. */
  parteAId: string;
  compraAId: string;
  /** La línea de COMPRA del Kardex de la sucursal A: el origen de una devolución. */
  movimientoCompraAId: string;
  parteBId: string;
  compraBId: string;
  movimientoCompraBId: string;
}

/**
 * La empresa del escenario de gasto (dos sucursales, un concepto, una factura de 300,00 con un renglón sin stock de 200,00 y uno de mercadería de 100,00) más: la mercadería repartida mitad y mitad (la parte, la `Operacion` COMPRA y su línea de
 * Kardex en cada sucursal) y el gasto imputado (120,00 a la A y 80,00 a la B). Las notas las escribe cada test.
 */
export async function sembrarEscenarioDeNota(): Promise<EscenarioDeNota> {
  const e = await sembrarEscenarioDeGasto();
  await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalA, importe: "120.00" } as never });
  await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalB, importe: "80.00" } as never });
  const parte = async (sucursalId: string, seccionId: string) => {
    const compra = await prisma.operacion.create({ data: { sucursalId, fecha: new Date("2026-09-01T15:00:00.000Z"), usuarioId: e.usuarioId, proceso: "COMPRA", proveedorId: e.proveedorId } });
    const movimiento = await prisma.movimientoStock.create({
      data: { operacionId: compra.id, productoId: e.productoId, seccionId, proceso: "COMPRA", cantidad: 5, detalle: "5 kg", precioTotal: "50.00", precioPorUnidadStock: "10", facturaProveedorRenglonId: e.renglonMercaderiaId },
    });
    const registro = await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: e.facturaId, sucursalId, porcentajeDeclaradoBp: 5000, operacionId: compra.id } });
    return { parteId: registro.id, compraId: compra.id, movimientoId: movimiento.id };
  };
  const a = await parte(e.sucursalA, e.seccionA);
  const b = await parte(e.sucursalB, e.seccionB);
  return { ...e, parteAId: a.parteId, compraAId: a.compraId, movimientoCompraAId: a.movimientoId, parteBId: b.parteId, compraBId: b.compraId, movimientoCompraBId: b.movimientoId };
}

/** Una `Operacion` DEVOLUCION_PROVEEDOR de `cantidad` kg en una sucursal, con su línea de Kardex (negativa) que apunta a la línea de compra que devuelve: lo que acredita la imputación de una nota. Devuelve los dos ids. */
export async function sembrarDevolucion(e: EscenarioDeNota, lado: "A" | "B", cantidad = 2): Promise<{ operacionId: string; movimientoId: string }> {
  const [sucursalId, seccionId, origenId] = lado === "A" ? [e.sucursalA, e.seccionA, e.movimientoCompraAId] : [e.sucursalB, e.seccionB, e.movimientoCompraBId];
  const operacion = await prisma.operacion.create({ data: { sucursalId, fecha: new Date("2026-09-05T15:00:00.000Z"), usuarioId: e.usuarioId, proceso: "DEVOLUCION_PROVEEDOR", proveedorId: e.proveedorId } });
  const movimiento = await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: e.productoId, seccionId, proceso: "DEVOLUCION_PROVEEDOR", cantidad: -cantidad, detalle: `${cantidad} kg`, precioTotal: 0, precioPorUnidadStock: 0, devuelveAMovimientoId: origenId },
  });
  return { operacionId: operacion.id, movimientoId: movimiento.id };
}

/** La cabecera de una nota SOBRE LA FACTURA del escenario (válida, de 100,00, con una clave de idempotencia nueva y un número que no choca). Para una nota suelta: `{ tipo: "SUELTA", facturaProveedorId: null }`. */
export function datosDeNota(e: { facturaId: string; proveedorId: string; usuarioId: string }, extra: Record<string, unknown> = {}) {
  const numero = `0001-${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  return {
    proveedorId: e.proveedorId,
    tipo: "SOBRE_FACTURA",
    facturaProveedorId: e.facturaId,
    nroComprobante: numero,
    nroComprobanteNormalizado: numero,
    fecha: new Date("2026-09-10T15:00:00.000Z"),
    importeTotal: "100.00",
    motivo: "Mercadería devuelta por rotura",
    claveIdempotencia: randomUUID(),
    payloadHash: "huella-de-prueba",
    resultadoMensaje: "Nota de crédito registrada.",
    creadoPorId: e.usuarioId,
    ...extra,
  };
}

/** Una línea de MERCADERIA sobre el renglón de mercadería de la factura (válida, de 50,00, que admite devolución) de la nota `notaId`, con el tipo y la factura que copia de ella. */
export function datosDeLinea(e: { facturaId: string; renglonMercaderiaId: string }, notaId: string, extra: Record<string, unknown> = {}) {
  return {
    notaCreditoProveedorId: notaId,
    tipoNota: "SOBRE_FACTURA",
    facturaProveedorId: e.facturaId,
    orden: 1,
    facturaProveedorRenglonId: e.renglonMercaderiaId,
    naturaleza: "MERCADERIA",
    admiteDevolucion: true,
    origenImporte: "RENGLON",
    importe: "50.00",
    ...extra,
  };
}

/** Una línea de GASTO sobre el renglón sin stock de la factura (válida, de 100,00; no admite devolución). */
export function datosDeLineaDeGasto(e: { facturaId: string; renglonId: string }, notaId: string, extra: Record<string, unknown> = {}) {
  return datosDeLinea({ facturaId: e.facturaId, renglonMercaderiaId: e.renglonId }, notaId, { orden: 2, naturaleza: "SIN_STOCK", admiteDevolucion: false, importe: "100.00", ...extra });
}

/** La imputación de una línea de mercadería (que admite devolución) a una sucursal: 50,00, sin devolución. */
export function datosDeImputacion(e: { sucursalA: string }, lineaId: string, extra: Record<string, unknown> = {}) {
  return { notaCreditoProveedorLineaId: lineaId, lineaAdmiteDevolucion: true, sucursalId: e.sucursalA, importe: "50.00", ...extra };
}

/** Un tributo (percepción) de la nota. */
export function datosDeTributo(notaId: string, extra: Record<string, unknown> = {}) {
  return { notaCreditoProveedorId: notaId, tipo: "PERCEPCION_IIBB", importe: "5.00", ...extra };
}

/**
 * El INSERT de una fila para un cliente `pg` (con `$1...`): `datos` son las columnas, con `id` (si falta, uno nuevo) y, solo para quien escribe como DUEÑO (sin empresa en la conexión), `empresaId`. Devuelve el texto, los parámetros y el `id`.
 * Un valor `undefined` no entra; `null` entra como NULL.
 */
export function sentenciaDeInsercion(tabla: "NotaCreditoProveedor" | "NotaCreditoProveedorLinea" | "NotaCreditoProveedorImputacion" | "NotaCreditoProveedorTributo", datos: Record<string, unknown>) {
  const id = (datos.id as string | undefined) ?? randomUUID();
  const conId: Record<string, unknown> = { id, ...datos };
  const columnas = Object.keys(conId).filter((c) => conId[c] !== undefined);
  return {
    texto: `INSERT INTO "${tabla}" (${columnas.map((c) => `"${c}"`).join(",")}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(",")})`,
    params: columnas.map((c) => {
      const valor = conId[c];
      // Una fecha viaja como texto ISO (UTC): `pg` la mandaría en la hora local del proceso y un TIMESTAMP sin zona ignora el desplazamiento.
      return valor instanceof Date ? valor.toISOString() : valor;
    }),
    id,
  };
}

/** `datos` con el `empresaId` de la empresa de las pruebas: lo que hace falta para escribir como DUEÑO con `sentenciaDeInsercion`. */
export const comoDuenio = (datos: Record<string, unknown>) => ({ empresaId: EMPRESA_DE_PRUEBA_ID, ...datos });
