import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Lectura de las MARCAS DE TARJETA (etapa C3): la lista global `MARCAS_DE_TARJETA` que administra la plataforma y ven todas las empresas (`ValorDeLista`, sin `empresaId`: la app solo lee, lo exigen los privilegios de la
 * migración 20261117112000_caja_c3_cuenta_de_cobro). Sin reglas de negocio ni permiso propio: quien la consuma (la pantalla de cobro, cuando exista) pide el «Ver» de su pantalla. Solo lectura.
 */
export interface MarcaDeTarjeta {
  id: string;
  nombre: string;
  activo: boolean;
  /** «Otra»: fija, no se renombra ni se desactiva. */
  fija: boolean;
}

/** Las marcas, «Otra» al final y el resto por nombre. Con `soloActivas` (lo que se ofrece en un cobro nuevo) se saltean las desactivadas, que los cobros viejos conservan. */
export async function listarMarcasDeTarjeta(db: PrismaClient | Prisma.TransactionClient, opciones: { soloActivas: boolean }): Promise<MarcaDeTarjeta[]> {
  const filas = await db.valorDeLista.findMany({
    where: { lista: "MARCAS_DE_TARJETA", ...(opciones.soloActivas ? { activo: true } : {}) },
    select: { id: true, nombre: true, activo: true, fija: true },
    orderBy: [{ fija: "asc" }, { nombre: "asc" }],
  });
  return filas;
}
