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

/**
 * Un choque de índice ÚNICO (SQLSTATE 23505): `P2002` de Prisma, o el `DriverAdapterError` crudo con `cause.kind === "UniqueConstraintViolation"` (la otra forma en que el adaptador `pg` de
 * Prisma 7 entrega el MISMO choque). Es LA clasificación del choque de unicidad de todo el repo (O.48, Hito 5): vive acá, en la capa neutral `core/datos`, para que la usen por igual el dominio de
 * movimientos (`esChoqueDeIndiceUnico`, reexportada por `core/movimientos/con-reintento.ts`) y el de catálogo (`esErrorDeUnicidad`, `core/catalogo/generar-codigo.ts`), que no puede importar los
 * archivos internos de otro dominio. Dentro de una transacción SERIALIZABLE, dos pedidos que leen el mismo estado y luego insertan la misma clave única no siempre reciben el 40001: si el
 * índice único no fue parte de lo que leyeron, el perdedor recibe directamente el 23505 (confirmado: `MovimientoStock_traspaso_paso_unico_key` en el reingreso simultáneo de un traspaso). Para ese
 * perdedor es lo mismo que un conflicto de serialización: al repetir ve el estado que dejó el ganador y responde el resultado de negocio que corresponde. Ver el parámetro `tambienChoqueDeUnico`
 * de `conTransaccionSerializable` (`src/lib/transaccion-serializable.ts`).
 */
export function esChoqueDeIndiceUnico(e: unknown): boolean {
  if (esErrorDeBaseConCodigo(e, "P2002")) return true;
  return causaDeErrorDeDriver(e)?.kind === "UniqueConstraintViolation";
}

/**
 * Un fallo de SERIALIZACIÓN (SQLSTATE 40001) o un deadlock (40P01) que nace en un `$executeRaw`/`$queryRaw` dentro de una transacción SERIALIZABLE: Prisma lo entrega como
 * `P2010` («raw query failed») con el código original de Postgres en `meta.driverAdapterError.cause.originalCode`, NO como `P2034`. Es lo mismo que un conflicto de escritura (el
 * perdedor tiene que repetir la transacción), pero sin este reconocimiento se vería como un error 500. Confirmado contra Postgres real con dos compras simultáneas del mismo producto,
 * proveedor y unidad (`test/movimientos/vinculo-proveedor-concurrencia.test.ts`). Cualquier OTRO `P2010` (una sintaxis rota, una columna que no existe) NO es un conflicto y sigue de largo.
 */
export function esFalloDeSerializacionEnSqlCrudo(e: unknown): boolean {
  const conocido = errorConocidoDeBase(e);
  if (conocido?.code !== "P2010") return false;
  const causa = (conocido.meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined)?.cause;
  return causa?.originalCode === "40001" || causa?.originalCode === "40P01";
}
