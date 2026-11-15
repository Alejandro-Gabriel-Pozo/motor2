import "server-only";
import type { Prisma } from "@prisma/client";
import { columnasDeParte, type DatosDeParte } from "@/core/datos/datos-de-parte";

/**
 * Persistencia de la FICHA DE PARTE (`Parte`; ficha única de personas y empresas, docs/diseno-parte-ficha-unica-2026-11-15.md, etapa P1 (b)). Mismo contrato que el resto de `server/persistencia/`: el cliente
 * es el PRIMER parámetro, `data` literal, sin reglas de negocio ni auditoría (las pone el caso de uso, dentro de su transacción). La base decide lo que ninguna lectura puede asegurar: el único del documento
 * (`Parte_documento_uk`), el único de la clave de alta (`Parte_idempotenciaAlta_uk`), los CHECK y la versión (la fija un disparador). `estado`, `version`, `creadoEn`, `actualizadoEn`, `migradaDe` y las tres
 * columnas calculadas no se escriben: la app no tiene ese privilegio.
 */

/** Las columnas de la ficha que ve un caso de uso o una pantalla (todas las de identidad más el control de versión y el estado). */
export const SELECCION_DE_PARTE = {
  id: true, naturaleza: true, nombre: true, apellido: true, alias: true, documentoTipo: true, documentoPais: true, documentoNumero: true, condicionIva: true, email: true, telefono: true,
  domPais: true, domCalle: true, domNumero: true, domPiso: true, domDepartamento: true, domLocalidad: true, domProvincia: true, domCodigoPostal: true, domTexto: true, nota: true,
  estado: true, version: true, documentoNormalizado: true, payloadHash: true,
} as const satisfies Prisma.ParteSelect;
export type ParteGuardada = Prisma.ParteGetPayload<{ select: typeof SELECCION_DE_PARTE }>;

/** La ficha que se creó con esa clave de alta (con la huella para comparar), o `null`. La RLS oculta las de otra empresa. */
export async function cargarParteDeClaveDeAlta(db: Prisma.TransactionClient, empresaId: string, idempotenciaAlta: string): Promise<ParteGuardada | null> {
  return db.parte.findFirst({ where: { empresaId, idempotenciaAlta }, select: SELECCION_DE_PARTE });
}

/** La ficha con ese documento normalizado (activa o no: un documento, una ficha por empresa), o `null`. */
export async function cargarParteDeDocumento(db: Prisma.TransactionClient, empresaId: string, documentoNormalizado: string): Promise<ParteGuardada | null> {
  return db.parte.findFirst({ where: { empresaId, documentoNormalizado }, select: SELECCION_DE_PARTE });
}

export async function cargarParte(db: Prisma.TransactionClient, empresaId: string, id: string): Promise<ParteGuardada | null> {
  return db.parte.findFirst({ where: { empresaId, id }, select: SELECCION_DE_PARTE });
}

/** Inserta la ficha. El id lo manda la aplicación; un documento o una clave repetidos hacen lanzar el P2002 del índice único (el árbitro final). */
export async function insertarParte(db: Prisma.TransactionClient, args: { id: string; empresaId: string; idempotenciaAlta: string; payloadHash: string; datos: DatosDeParte; creadoPorId: string }): Promise<void> {
  await db.parte.create({
    data: { id: args.id, empresaId: args.empresaId, idempotenciaAlta: args.idempotenciaAlta, payloadHash: args.payloadHash, creadoPorId: args.creadoPorId, ...columnasDeParte(args.datos) },
    select: { id: true },
  });
}

/** Reescribe las columnas de identidad CON CONTROL OPTIMISTA: el `where` lleva la versión leída; devuelve si escribió (0 filas = otra edición se adelantó o la ficha no existe). */
export async function actualizarParteConVersion(db: Prisma.TransactionClient, args: { empresaId: string; id: string; versionEsperada: number; datos: DatosDeParte }): Promise<boolean> {
  const { count } = await db.parte.updateMany({ where: { empresaId: args.empresaId, id: args.id, version: args.versionEsperada }, data: columnasDeParte(args.datos) });
  return count > 0;
}

/** Pasa la ficha de un estado a otro SOLO si está en `de` (dos desactivaciones a la vez: una sola escribe). Devuelve si escribió. */
export async function cambiarEstadoDeParte(db: Prisma.TransactionClient, args: { empresaId: string; id: string; de: "ACTIVA" | "INACTIVA"; a: "ACTIVA" | "INACTIVA" }): Promise<boolean> {
  const { count } = await db.parte.updateMany({ where: { empresaId: args.empresaId, id: args.id, estado: args.de }, data: { estado: args.a } });
  return count > 0;
}

/**
 * Las fichas que podrían ser la misma persona o empresa que `id`: mismo nombre (sin acentos ni mayúsculas, las columnas calculadas de la base), mismo correo o mismos dígitos de teléfono. Es un AVISO, no un bloqueo
 * (como Pedernal): hasta 5, las más antiguas primero. Solo ids: el resto lo pide la pantalla con su permiso de lectura.
 */
export async function cargarPosiblesDuplicadosDeParte(db: Prisma.TransactionClient, empresaId: string, id: string): Promise<string[]> {
  const filas = await db.$queryRaw<Array<{ id: string }>>`
    SELECT b."id"::text AS id
      FROM "Parte" a
      JOIN "Parte" b ON b."empresaId" = a."empresaId" AND b."id" <> a."id"
     WHERE a."empresaId" = ${empresaId} AND a."id" = ${id}::uuid
       AND (b."nombreBusqueda" = a."nombreBusqueda"
         OR (a."email" IS NOT NULL AND b."email" = a."email")
         OR (a."telefonoDigitos" IS NOT NULL AND a."telefonoDigitos" <> '' AND b."telefonoDigitos" = a."telefonoDigitos"))
     ORDER BY b."creadoEn", b."id"
     LIMIT 5`;
  return filas.map((f) => f.id);
}
