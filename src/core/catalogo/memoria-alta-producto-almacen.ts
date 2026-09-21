import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { reportarError } from "@/lib/reportar-error";
import { CLAVE_MEMORIA_ALTA_PRODUCTO, parsearMemoria, type MemoriaAltaProducto } from "./memoria-alta-producto";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Dónde vive la memoria del alta de producto (E4): la tabla `PreferenciaUsuario`, una fila por usuario y clave. ES EL ÚNICO ARCHIVO que sabe
 * dónde se guarda — el resto (forma, parseo, saneo) es el módulo puro `memoria-alta-producto.ts`.
 *
 * Reglas:
 *  - Siempre se busca por el `usuarioId` de la SESIÓN, que llega como argumento; nunca por uno que venga del cliente.
 *  - La memoria es una comodidad, no un dato de negocio: ni leerla ni escribirla puede romper el alta ni la pantalla. Todo lo que falle acá se
 *    reporta y se traga (`leer` devuelve `null`, `guardar` no lanza).
 *  - No pasa por la auditoría administrativa (esa es para precios y permisos).
 *
 * La lectura NO es una Server Action: la llama la página (Server Component). Convertirla en acción crearía un endpoint público sin necesidad.
 */

export async function leerMemoriaAltaProducto(usuarioId: string, db: Db = prisma): Promise<MemoriaAltaProducto | null> {
  try {
    const fila = await db.preferenciaUsuario.findUnique({
      where: { usuarioId_clave: { usuarioId, clave: CLAVE_MEMORIA_ALTA_PRODUCTO } },
      select: { valor: true },
    });
    return fila ? parsearMemoria(fila.valor) : null;
  } catch (e) {
    await reportarError(e, "memoria-alta-producto-leer");
    return null;
  }
}

/** Best-effort: un fallo de la memoria jamás debe convertir un alta exitosa en un error. */
export async function guardarMemoriaAltaProducto(usuarioId: string, memoria: MemoriaAltaProducto, db: Db = prisma): Promise<void> {
  try {
    const valor = memoria as unknown as Prisma.InputJsonValue;
    await db.preferenciaUsuario.upsert({
      where: { usuarioId_clave: { usuarioId, clave: CLAVE_MEMORIA_ALTA_PRODUCTO } },
      create: { usuarioId, clave: CLAVE_MEMORIA_ALTA_PRODUCTO, valor },
      update: { valor },
    });
  } catch (e) {
    await reportarError(e, "memoria-alta-producto-guardar");
  }
}

/** Olvida de verdad: borra la fila, así que vale en todos los dispositivos del usuario. No falla si no había nada. */
export async function borrarMemoriaAltaProducto(usuarioId: string, db: Db = prisma): Promise<void> {
  await db.preferenciaUsuario.deleteMany({ where: { usuarioId, clave: CLAVE_MEMORIA_ALTA_PRODUCTO } });
}
