/**
 * Reconocimiento de los errores de la base POR FORMA (Pureza 1.6). El dominio necesita saber «¿esto fue un choque de unicidad?» o «¿un conflicto de escritura de
 * una transacción serializable?» para reintentar o traducir el error a un mensaje de negocio, pero no tiene por qué importar las clases del ORM
 * (`Prisma.PrismaClientKnownRequestError`) para eso: los errores de Prisma 7 se reconocen por su `name`, su `code` y su `meta`, y los de un driver adapter por su
 * `cause.kind`. Puro: sin imports.
 *
 * Esta forma fue confirmada contra una instancia real (`name: "PrismaClientKnownRequestError"`, `code`, `meta`) y la cubren los tests de concurrencia
 * (`test/auditoria/*`), que provocan los errores de verdad contra Postgres.
 */

export interface ErrorConocidoDeBase {
  code: string;
  meta?: Record<string, unknown>;
}

/** El error conocido de la base (`PrismaClientKnownRequestError`: tiene `code`, como `P2002` o `P2034`), o `null` si `e` es otra cosa. */
export function errorConocidoDeBase(e: unknown): ErrorConocidoDeBase | null {
  if (!(e instanceof Error) || e.name !== "PrismaClientKnownRequestError") return null;
  const { code, meta } = e as Error & { code?: unknown; meta?: unknown };
  if (typeof code !== "string") return null;
  return { code, ...(meta && typeof meta === "object" ? { meta: meta as Record<string, unknown> } : {}) };
}

/** `true` si `e` es un error conocido de la base con ese código (`P2002`: choque de índice único, `P2034`: conflicto de escritura). */
export function esErrorDeBaseConCodigo(e: unknown, codigo: string): boolean {
  return errorConocidoDeBase(e)?.code === codigo;
}

/** La causa de un `DriverAdapterError` crudo (`@prisma/adapter-pg`): su `kind` y, si trae, la restricción violada. `null` si `e` no es uno. */
export function causaDeErrorDeDriver(e: unknown): { kind: string; constraint?: unknown } | null {
  if (!(e instanceof Error) || e.name !== "DriverAdapterError") return null;
  const causa = (e as Error & { cause?: unknown }).cause;
  if (!causa || typeof causa !== "object" || !("kind" in causa) || typeof causa.kind !== "string") return null;
  return { kind: causa.kind, ...("constraint" in causa ? { constraint: causa.constraint } : {}) };
}
