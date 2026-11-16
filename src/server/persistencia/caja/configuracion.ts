import "server-only";
import type { CuentaGuardada, MedioGuardado } from "@/core/caja/public";
import type { DatosQuePideElMedio, TipoDeCuenta, TipoDeMedio } from "@/core/caja/public";
import type { Prisma } from "@prisma/client";
import { errorConocidoDeBase, esChoqueDeIndiceUnico } from "@/core/datos/errores-de-base";

/**
 * Persistencia de la CONFIGURACIÓN de caja (etapa C3): medios de pago y cuentas de cobro. Mismo contrato que `caja.ts`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio ni auditoría. La base decide lo que
 * ninguna lectura puede asegurar (ver la migración 20261117112000_caja_c3_cuenta_de_cobro): nombre único sin mayúsculas, un solo efectivo que no se desactiva, el tipo que no cambia y el techo de datos por tipo. Los cambios se
 * condicionan a la versión (`updateMany` con `version`): 0 filas = otro cambió antes.
 */

export interface MedioConPide extends MedioGuardado {
  readonly pide: DatosQuePideElMedio;
}

const SELECCION_DE_MEDIO = { id: true, tipo: true, nombre: true, activo: true, version: true, pideCupon: true, pideUltimos4: true, pideMarca: true, pideCuotas: true, pideDni: true } as const satisfies Prisma.MedioDePagoSelect;

function aMedio(f: Prisma.MedioDePagoGetPayload<{ select: typeof SELECCION_DE_MEDIO }>): MedioConPide {
  return { id: f.id, tipo: f.tipo as TipoDeMedio, nombre: f.nombre, activo: f.activo, version: f.version, pide: { cupon: f.pideCupon, ultimos4: f.pideUltimos4, marca: f.pideMarca, cuotas: f.pideCuotas, dni: f.pideDni } };
}

export async function cargarMedio(db: Prisma.TransactionClient, empresaId: string, id: string): Promise<MedioConPide | null> {
  const f = await db.medioDePago.findFirst({ where: { empresaId, id }, select: SELECCION_DE_MEDIO });
  return f ? aMedio(f) : null;
}

/** El medio que usa ese nombre sin distinguir mayúsculas (`lower`, igual que el índice único), o `null`. */
export async function cargarMedioPorNombre(db: Prisma.TransactionClient, empresaId: string, nombre: string): Promise<MedioConPide | null> {
  const ids = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MedioDePago" WHERE "empresaId" = ${empresaId} AND lower("nombre") = lower(${nombre}) LIMIT 1`;
  return ids[0] ? cargarMedio(db, empresaId, ids[0].id) : null;
}

/** El medio EFECTIVO de la empresa (uno solo), o `null`. */
export async function cargarEfectivoDeLaEmpresa(db: Prisma.TransactionClient, empresaId: string): Promise<MedioConPide | null> {
  const f = await db.medioDePago.findFirst({ where: { empresaId, tipo: "EFECTIVO" }, select: SELECCION_DE_MEDIO });
  return f ? aMedio(f) : null;
}

/** El medio SIN nombre propio de ese tipo (hay a lo sumo uno por tipo), o `null`. */
export async function cargarMedioSinNombre(db: Prisma.TransactionClient, empresaId: string, tipo: TipoDeMedio): Promise<MedioConPide | null> {
  const f = await db.medioDePago.findFirst({ where: { empresaId, tipo, nombre: null }, select: SELECCION_DE_MEDIO });
  return f ? aMedio(f) : null;
}

export async function insertarMedio(db: Prisma.TransactionClient, args: { id: string; empresaId: string; tipo: TipoDeMedio; nombre: string | null; ahora: Date }): Promise<void> {
  await db.medioDePago.create({ data: { id: args.id, empresaId: args.empresaId, tipo: args.tipo, nombre: args.nombre, creadoEn: args.ahora, actualizadoEn: args.ahora }, select: { id: true } });
}

/** Cambia el nombre y/o lo que pide el medio si la versión sigue siendo `versionEsperada`. Devuelve si escribió. */
export async function editarMedioEnBase(
  db: Prisma.TransactionClient,
  args: { empresaId: string; id: string; versionEsperada: number; ahora: Date; nombre?: string | null; pide?: DatosQuePideElMedio },
): Promise<boolean> {
  const { count } = await db.medioDePago.updateMany({
    where: { empresaId: args.empresaId, id: args.id, version: args.versionEsperada },
    data: {
      ...(args.nombre !== undefined ? { nombre: args.nombre } : {}),
      ...(args.pide ? { pideCupon: args.pide.cupon, pideUltimos4: args.pide.ultimos4, pideMarca: args.pide.marca, pideCuotas: args.pide.cuotas, pideDni: args.pide.dni } : {}),
      actualizadoEn: args.ahora,
      version: { increment: 1 },
    },
  });
  return count > 0;
}

export async function cambiarActivoDeMedio(db: Prisma.TransactionClient, args: { empresaId: string; id: string; versionEsperada: number; ahora: Date; activo: boolean }): Promise<boolean> {
  const { count } = await db.medioDePago.updateMany({
    where: { empresaId: args.empresaId, id: args.id, version: args.versionEsperada },
    data: { activo: args.activo, actualizadoEn: args.ahora, version: { increment: 1 } },
  });
  return count > 0;
}

const SELECCION_DE_CUENTA = { id: true, tipo: true, nombre: true, identificadorExterno: true, sucursalId: true, activa: true, version: true } as const satisfies Prisma.CuentaDeCobroSelect;

function aCuenta(f: Prisma.CuentaDeCobroGetPayload<{ select: typeof SELECCION_DE_CUENTA }>): CuentaGuardada {
  return { ...f, tipo: f.tipo as TipoDeCuenta };
}

export async function cargarCuentaDeCobro(db: Prisma.TransactionClient, empresaId: string, id: string): Promise<CuentaGuardada | null> {
  const f = await db.cuentaDeCobro.findFirst({ where: { empresaId, id }, select: SELECCION_DE_CUENTA });
  return f ? aCuenta(f) : null;
}

/** La cuenta que usa ese nombre sin distinguir mayúsculas (`lower`, igual que el índice único), o `null`. */
export async function cargarCuentaPorNombre(db: Prisma.TransactionClient, empresaId: string, nombre: string): Promise<CuentaGuardada | null> {
  const ids = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CuentaDeCobro" WHERE "empresaId" = ${empresaId} AND lower("nombre") = lower(${nombre}) LIMIT 1`;
  return ids[0] ? cargarCuentaDeCobro(db, empresaId, ids[0].id) : null;
}

export async function insertarCuentaDeCobro(
  db: Prisma.TransactionClient,
  args: { id: string; empresaId: string; sucursalId: string; tipo: TipoDeCuenta; nombre: string; identificadorExterno: string | null; ahora: Date },
): Promise<void> {
  const { ahora, ...resto } = args;
  await db.cuentaDeCobro.create({ data: { ...resto, creadoEn: ahora, actualizadoEn: ahora }, select: { id: true } });
}

/** Cambia nombre, identificador y sucursal si la versión sigue siendo `versionEsperada`. Devuelve si escribió. */
export async function editarCuentaEnBase(
  db: Prisma.TransactionClient,
  args: { empresaId: string; id: string; versionEsperada: number; ahora: Date; nombre: string; identificadorExterno: string | null; sucursalId: string },
): Promise<boolean> {
  const { count } = await db.cuentaDeCobro.updateMany({
    where: { empresaId: args.empresaId, id: args.id, version: args.versionEsperada },
    data: { nombre: args.nombre, identificadorExterno: args.identificadorExterno, sucursalId: args.sucursalId, actualizadoEn: args.ahora, version: { increment: 1 } },
  });
  return count > 0;
}

export async function cambiarActivaDeCuenta(db: Prisma.TransactionClient, args: { empresaId: string; id: string; versionEsperada: number; ahora: Date; activa: boolean }): Promise<boolean> {
  const { count } = await db.cuentaDeCobro.updateMany({
    where: { empresaId: args.empresaId, id: args.id, version: args.versionEsperada },
    data: { activa: args.activa, actualizadoEn: args.ahora, version: { increment: 1 } },
  });
  return count > 0;
}

/** ¿Hay en la sucursal otra cuenta de cobro ACTIVA (distinta de `exceptoId`, si se pasa)? Es la lectura previa de la regla «una sola activa por sucursal»; la barrera real es el índice único parcial de la base. */
export async function hayOtraCuentaActivaEnSucursal(db: Prisma.TransactionClient, empresaId: string, sucursalId: string, exceptoId: string | null): Promise<boolean> {
  const f = await db.cuentaDeCobro.findFirst({ where: { empresaId, sucursalId, activa: true, ...(exceptoId === null ? {} : { id: { not: exceptoId } }) }, select: { id: true } });
  return f !== null;
}

/** ¿El error es el choque del índice único parcial «una cuenta activa por sucursal» (`CuentaDeCobro_una_activa_por_sucursal_key`)? Los otros choques de unicidad (el nombre) no lo son. */
export function esChoqueDeUnaActivaPorSucursal(e: unknown): boolean {
  if (!esChoqueDeIndiceUnico(e)) return false;
  const meta = errorConocidoDeBase(e)?.meta;
  const texto = `${e instanceof Error ? e.message : ""} ${meta ? JSON.stringify(meta) : ""} ${JSON.stringify((e as { cause?: unknown }).cause ?? "")}`;
  return texto.includes("CuentaDeCobro_una_activa_por_sucursal_key");
}

/** ¿La sucursal existe en la empresa? (`Sucursal` es de gobierno: se lee sin alcance.) */
export async function existeSucursal(db: Prisma.TransactionClient, empresaId: string, sucursalId: string): Promise<boolean> {
  return (await db.sucursal.findFirst({ where: { empresaId, id: sucursalId }, select: { id: true } })) !== null;
}

/** ¿Es el id de una marca de tarjeta ACTIVA de la lista global? (Los cobros viejos conservan la que se desactivó después.) */
export async function esMarcaDeTarjetaActiva(db: Prisma.TransactionClient, id: string): Promise<boolean> {
  return (await db.valorDeLista.findFirst({ where: { id, lista: "MARCAS_DE_TARJETA", activo: true }, select: { id: true } })) !== null;
}
