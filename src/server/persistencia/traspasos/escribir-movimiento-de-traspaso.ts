import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * EL escritor de las dos escrituras que hace cada paso de un traspaso en el Kardex (Hito 5, pieza 5.4, A4; O.13 de `docs/pureza-integracion.md`):
 *  1. la `Operacion` de ESTA sucursal, con la clave de idempotencia I3 y su hash si vinieron (`null` si no);
 *  2. su única línea de Kardex —`create` de UNA fila, no `createMany`—, a precio 0 y atada al traspaso, con la cantidad ya con signo
 *     (negativa en la salida de Origen, positiva en la entrada de Destino y en el reingreso a Origen).
 * Antes eran dos copias casi iguales: `escribirSalidaDeTraspaso` (`escribir-aprobacion-de-traspaso.ts`, sin clave de idempotencia: ni la aprobación
 * ni el envío directo tienen I3) y `escribirOperacionDeEntrada` (`escribir-entrada-de-traspaso.ts`, con la clave si vino). Las dos delegan acá y las
 * escrituras que llegan a la base son las mismas, en el mismo orden y con las mismas claves (las dos mandaban `claveIdempotencia` y `payloadHash`,
 * con `null` cuando no había): lo prueba la huella `test/persistencia/kardex-escritores-huella.test.ts`.
 *
 * Mismo contrato que el resto de `server/persistencia/`: `tx` obligatorio, sin reglas de negocio. Quién llama decide el proceso, la sección y el signo.
 */
export interface MovimientoDeTraspasoAEscribir {
  proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" | "TRANSFERENCIA_ENTRADA_SUCURSAL" | "REINGRESO_TRANSFERENCIA_SUCURSAL";
  /** La sucursal dueña de la `Operacion` (la que mueve el stock) y quien lo hace. */
  sucursalId: string;
  usuarioId: string;
  /** El mismo instante para la fecha de la `Operacion` (y, en quien llama, para la decisión sobre el traspaso). */
  ahora: Date;
  /** I3: clave y hash del payload, o `null` si no hay (la salida del traspaso nunca la tiene). */
  idempotencia: { claveIdempotencia: string; payloadHash: string } | null;
  productoId: string;
  seccionId: string;
  /** Ya con signo: negativa si sale del stock, positiva si entra. */
  cantidadConSigno: number;
  detalle: string;
  traspasoId: string;
}

export async function escribirMovimientoDeTraspaso(tx: Prisma.TransactionClient, m: MovimientoDeTraspasoAEscribir): Promise<{ operacionId: string }> {
  const operacion = await tx.operacion.create({
    data: {
      sucursalId: m.sucursalId,
      proceso: m.proceso,
      fecha: m.ahora,
      usuarioId: m.usuarioId,
      claveIdempotencia: m.idempotencia?.claveIdempotencia ?? null,
      payloadHash: m.idempotencia?.payloadHash ?? null,
    },
  });
  await tx.movimientoStock.create({
    data: {
      operacionId: operacion.id,
      productoId: m.productoId,
      seccionId: m.seccionId,
      proceso: m.proceso,
      cantidad: m.cantidadConSigno,
      detalle: m.detalle,
      precioTotal: 0,
      precioPorUnidadStock: 0,
      traspasoSucursalId: m.traspasoId,
    },
  });
  return { operacionId: operacion.id };
}
