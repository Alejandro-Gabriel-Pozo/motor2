import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Escrituras del PEDIDO de la cuenta de una mesa (Hito 4 de la pureza, bloque 4.1 — `docs/plan-hito-4-pureza.md` §5; mismo contrato que el resto de
 * `server/persistencia/pos/`: `tx` OBLIGATORIO y primer parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras que antes hacía en
 * línea `src/server/actions/pos/cuenta-pedido.ts`; el orden y las validaciones los pone cada caso de uso de `src/server/actions/pos/casos-de-uso/`. Sin
 * auditoría: `CuentaItem` y `PromoCuenta` son documentos del POS con su usuario y su estado («su propia historia», `escrituras-auditadas.test.ts`).
 */

/**
 * Una `PromoCuenta` nueva en la cuenta, con el precio y el título CONGELADOS de la promo de la carta (ya revalidada y prorrateada por el caso de uso) y quién
 * la cargó. Devuelve su id: los `CuentaItem` componentes la referencian, así que va ANTES que `escribirItemsDeCuenta`.
 */
export async function escribirPromoDeCuenta(
  tx: Prisma.TransactionClient,
  args: { cuentaId: string; promoCartaId: string; precio: number; titulo: string; creadoPorId: string },
): Promise<string> {
  const promoCuenta = await tx.promoCuenta.create({ data: { cuentaId: args.cuentaId, promoCartaId: args.promoCartaId, precio: args.precio, titulo: args.titulo, creadoPorId: args.creadoPorId } });
  return promoCuenta.id;
}

/**
 * Todos los `CuentaItem` SIN ENVIAR de un agregado (sueltos y componentes de promo, ya validados y con el precio congelado) en UN solo `createMany`: una sola
 * escritura por agregado, siempre la última (lo fija `test/pos/agregar-items-consultas.test.ts`).
 */
export async function escribirItemsDeCuenta(tx: Prisma.TransactionClient, filas: Prisma.CuentaItemCreateManyInput[]): Promise<void> {
  await tx.cuentaItem.createMany({ data: filas });
}

/** GO-2b: la FOTO de una opción elegida (las columnas de `OpcionElegidaEnLinea`, sin la línea: la pone `escribirLineaConfigurada`). */
export interface FotoAEscribir {
  grupoId: string;
  opcionId: string;
  versionDeOpcionId: string;
  tipoGrupo: string;
  nombreGrupo: string;
  nombreOpcion: string;
  cantidad: number;
  modoPrecio: string | null;
  tipoDeDiferencia: string | null;
  porcentaje: number | null;
  importeUnitario: number;
  precioDeSucursal: boolean;
  factorEscala: number | null;
  orden: number;
}

/**
 * GO-2b (ADR-030): una LÍNEA CONFIGURADA sin enviar, ya validada y con el precio congelado por el caso de uso: un `cuentaItem.create` para la línea del producto
 * (devuelve el id, que referencian sus adicionales y su foto), un `create` por adicional con `lineaPadreId` (el padre ya existe: lo exige el disparador
 * `CuentaItem_opciones_chk`) y UN `opcionElegidaEnLinea.createMany` con TODAS las fotos (las del producto y la de cada adicional, en su propia línea; lo exige
 * `OpcionElegidaEnLinea_coherente_chk`). Va en la MISMA transacción que el resto del pedido: si cualquier escritura falla (un disparador o un CHECK), se deshace todo.
 * Sin auditoría: como `CuentaItem`, la foto es un documento del POS que solo se agrega.
 */
export async function escribirLineaConfigurada(
  tx: Prisma.TransactionClient,
  args: {
    cuentaId: string;
    creadoPorId: string;
    linea: { productoId: string; cantidad: number; precioUnitario: number; precioCartaUnitario: number | null; huellaOpciones: string | null; fotos: readonly FotoAEscribir[] };
    adicionales: readonly { productoId: string; cantidad: number; precioUnitario: number; foto: FotoAEscribir }[];
  },
): Promise<{ lineaId: string; adicionalIds: string[] }> {
  const { cuentaId, creadoPorId, linea } = args;
  const padre = await tx.cuentaItem.create({
    data: {
      cuentaId,
      productoId: linea.productoId,
      cantidad: linea.cantidad,
      precioUnitario: linea.precioUnitario,
      precioCartaUnitario: linea.precioCartaUnitario,
      huellaOpciones: linea.huellaOpciones,
      numeroEnvio: null,
      creadoPorId,
    },
    select: { id: true },
  });
  const fotos: Prisma.OpcionElegidaEnLineaCreateManyInput[] = linea.fotos.map((f) => ({ ...f, cuentaItemId: padre.id }));
  const adicionalIds: string[] = [];
  for (const a of args.adicionales) {
    const adicional = await tx.cuentaItem.create({
      data: { cuentaId, productoId: a.productoId, cantidad: a.cantidad, precioUnitario: a.precioUnitario, lineaPadreId: padre.id, numeroEnvio: null, creadoPorId },
      select: { id: true },
    });
    adicionalIds.push(adicional.id);
    fotos.push({ ...a.foto, cuentaItemId: adicional.id });
  }
  if (fotos.length > 0) await tx.opcionElegidaEnLinea.createMany({ data: fotos });
  return { lineaId: padre.id, adicionalIds };
}

/**
 * P3 (I3): el comprobante de «agregar al pedido» que lleva esta clave, o `null` si ninguno la usó (o no se ve desde esta empresa: la política `aislamiento_empresa` oculta los ajenos
 * aunque la unicidad de la clave sea global). Sirve a las dos lecturas del caso de uso: el chequeo de adentro de la transacción (`tx`) y la relectura del ganador de una carrera, de afuera (`db`).
 */
export async function cargarAgregadoDeCuentaPorClave(
  db: Prisma.TransactionClient | PrismaClient,
  claveIdempotencia: string,
): Promise<{ payloadHash: string; resultadoMensaje: string } | null> {
  return db.agregadoDeCuenta.findUnique({ where: { claveIdempotencia }, select: { payloadHash: true, resultadoMensaje: true } });
}

/**
 * P3 (I3): el comprobante del agregado, con el mensaje YA ARMADO que se le devuelve a quien lo pidió. Va en la MISMA transacción que `escribirItemsDeCuenta` y siempre DESPUÉS: si falla
 * (clave ya usada por otro), se deshacen también los ítems — todo o nada. Solo se agrega: la app no tiene UPDATE ni DELETE sobre esta tabla, así que sobrevive a que se quiten los ítems.
 */
export async function escribirAgregadoDeCuenta(
  tx: Prisma.TransactionClient,
  args: { cuentaId: string; claveIdempotencia: string; payloadHash: string; resultadoMensaje: string; creadoPorId: string },
): Promise<void> {
  await tx.agregadoDeCuenta.create({ data: { cuentaId: args.cuentaId, claveIdempotencia: args.claveIdempotencia, payloadHash: args.payloadHash, resultadoMensaje: args.resultadoMensaje, creadoPorId: args.creadoPorId } });
}

/**
 * Borra un ítem que TODAVÍA NO SALIÓ a cocina (un borrador: DELETE físico). La condición vive en el MISMO borrado (`numeroEnvio: null` y nunca una fila
 * espejo): si otro mozo lo envió un instante antes, no se borra nada. Devuelve cuántas filas borró (0 o 1): con 0 el caso de uso responde «ya salió a cocina».
 */
export async function borrarItemSinEnviar(tx: Prisma.TransactionClient, args: { cuentaItemId: string }): Promise<number> {
  const borrados = await tx.cuentaItem.deleteMany({ where: { id: args.cuentaItemId, numeroEnvio: null, anulaAItemId: null } });
  return borrados.count;
}

/**
 * Borra una promo que TODAVÍA NO SALIÓ a cocina, entera: primero TODOS sus `CuentaItem` componentes y después la `PromoCuenta` (en ese orden: los
 * componentes la referencian y la relación no borra en cascada). Que ningún componente haya salido lo chequea antes el caso de uso, en la misma transacción.
 */
export async function borrarPromoSinEnviar(tx: Prisma.TransactionClient, args: { promoCuentaId: string }): Promise<void> {
  await tx.cuentaItem.deleteMany({ where: { promoCuentaId: args.promoCuentaId } });
  await tx.promoCuenta.delete({ where: { id: args.promoCuentaId } });
}

/**
 * «Enviar a cocina»: los ítems pedidos (los ids que calculó el caso de uso, ya con los hermanos de promo) que sigan SIN enviar y no sean filas espejo pasan al
 * envío `numeroEnvio` de la cuenta. La condición vive en el MISMO `UPDATE`: un ítem que otro mozo envió o quitó un instante antes no se toca. Devuelve cuántas
 * filas cambió (con 0, el caso de uso responde el caso idempotente).
 */
export async function enviarItemsACocina(tx: Prisma.TransactionClient, args: { cuentaId: string; itemIds: string[]; numeroEnvio: number }): Promise<number> {
  const enviados = await tx.cuentaItem.updateMany({
    where: { id: { in: args.itemIds }, cuentaId: args.cuentaId, numeroEnvio: null, anulaAItemId: null },
    data: { numeroEnvio: args.numeroEnvio },
  });
  return enviados.count;
}
