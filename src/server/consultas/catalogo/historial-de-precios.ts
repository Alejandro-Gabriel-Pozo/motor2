import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CAMBIOS_DE_PRECIO_A_MOSTRAR, armarHistorialDePrecios, type LineaDelHistorialDePrecios } from "@/core/catalogo/public";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * El historial de precios de un producto para su ficha (Frente 6, paso 7; dueño, 2026-11-17: «A»): los cambios del precio de lista y los del precio de la sucursal ACTIVA, del `RegistroAuditoria` que ya existe
 * (sin tablas ni migración, solo lectura). Quien llama ya validó el permiso de VER el catálogo (la pestaña «Precios» lo exige); acá NO se pide «Ver auditoría» porque no sale nada de lo que esa acción protege:
 * la consulta SELECCIONA solo fecha, tipo y valores, NUNCA el actor (quién cambió el precio) ni la descripción. Lo vigila `test/catalogo/historial-de-precios.test.ts` con un rol sin «Ver auditoría».
 * El aislamiento por empresa y por sucursal lo sigue haciendo el `db` (RLS): una fila de otra sucursal no se ve y la consulta, además, la filtra por la sucursal activa.
 */
export async function historialDePreciosDelProducto(db: Db, productoId: string, sucursalId: string): Promise<LineaDelHistorialDePrecios[]> {
  const propios = await db.precioLocalProducto.findMany({ where: { productoId, sucursalId }, select: { id: true } });
  const filas = await db.registroAuditoria.findMany({
    where: {
      OR: [
        { entidad: "Producto", entidadId: productoId, campo: "precioVenta" },
        ...(propios.length > 0 ? [{ entidad: "PrecioLocalProducto", entidadId: { in: propios.map((p) => p.id) }, campo: "precio", sucursalId }] : []),
      ],
    },
    // Lista cerrada de lo que se lee: fecha, tipo y valores. Sin `actorId`, sin `descripcion`, sin `include`.
    select: { creadoEn: true, entidad: true, valorAnterior: true, valorNuevo: true },
    // `id` desempata: `creadoEn` se repite dentro de una misma transacción.
    orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
    take: CAMBIOS_DE_PRECIO_A_MOSTRAR,
  });
  return armarHistorialDePrecios(filas);
}
