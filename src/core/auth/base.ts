import { prisma } from "@/lib/db";
import { azarDelProceso } from "@/lib/azar";
import { numeroEnUnidad } from "@/core/seguridad/azar";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Db, OpcionesTransaccion, Transaccion } from "@/lib/db-tipos";
import { datosDelRolDeEjecucion, permitirRolPrivilegiado, verificarRolDeEjecucion, type DatosDelRol } from "./rol-de-ejecucion";

/**
 * El ALCANCE POR SUCURSAL de un pedido (M.3, plan `plan-m3-rls-por-sucursal`): en qué sucursales de la empresa puede LEER y en cuáles puede ESCRIBIR lo que
 * hace la base, aparte de la empresa. Es una capacidad general (vale para cualquier rubro con sucursales, locales o puntos de atención), no de un rubro: la fijan
 * `dbDeEmpresa`/`transaccionDeEmpresa`/`baseDeEmpresa` en la transacción (`app.sucursales_lectura`, `app.sucursales_escritura`) y la leen, desde la Fase B, las
 * políticas de las tablas por sucursal. NO existe un valor «todas»: una lista cerrada de ids (`^[a-z0-9]+$`, sin repetidos); ensancharla es de
 * `src/server/acceso/alcance.ts`, y solo después de que el gate aprobó esa sucursal. Sin alcance (o con listas vacías) las tablas por sucursal no devuelven filas
 * ni aceptan escrituras: falla cerrado. La lectura en SQL es lectura ∪ escritura.
 */
export interface AlcanceDeSucursal {
  lectura: readonly string[];
  escritura: readonly string[];
}

export interface BaseDelContexto {
  /** Base con la que opera el pedido. En el contexto de un usuario es la de su empresa activa (`dbDeEmpresa`): cada operación fija `app.empresa_id` (y el alcance por sucursal) en su transacción. */
  db: PrismaClient;
  /** Abre una transacción sobre `db`. Todo `$transaction` del negocio sale de acá, nunca de un cliente importado. */
  transaccion: Transaccion;
  /** El alcance por sucursal con el que se armaron `db` y `transaccion`; ausente = sin alcance (falla cerrado en las tablas por sucursal). */
  alcance?: AlcanceDeSucursal;
}

/** La forma de un id de sucursal (`cuid`: minúsculas y dígitos). Es lo único que entra a las listas del alcance: ni comas, ni comillas, ni comodines. */
const ID_DE_SUCURSAL_EN_EL_ALCANCE = /^[a-z0-9]+$/;

/**
 * La lista de ids como texto para `set_config` (separados por coma). Falla (no corrige) con un id que no tiene la forma de un id de sucursal o con un id repetido:
 * un alcance mal armado es un error de quien lo arma, y callarlo escondería una fuga o un recorte. Una lista vacía da `''` (sin sucursales).
 */
export function serializarSucursalesDelAlcance(ids: readonly string[]): string {
  const vistos = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !ID_DE_SUCURSAL_EN_EL_ALCANCE.test(id)) throw new Error("El alcance por sucursal trae un id que no tiene la forma de un id de sucursal.");
    if (vistos.has(id)) throw new Error("El alcance por sucursal trae un id de sucursal repetido.");
    vistos.add(id);
  }
  return ids.join(",");
}

/**
 * Una copia validada e inmutable del alcance: lo que se guarda en `BaseDelContexto.alcance` y con lo que se arman `db` y `transaccion`. Así el alcance que el contexto
 * muestra es SIEMPRE el que la base fija (nadie lo cambia después por la referencia que quedó afuera). Falla con un id inválido o repetido, como `serializarSucursalesDelAlcance`.
 */
function copiaDelAlcance(alcance: AlcanceDeSucursal): AlcanceDeSucursal {
  serializarSucursalesDelAlcance(alcance.lectura);
  serializarSucursalesDelAlcance(alcance.escritura);
  return Object.freeze({ lectura: Object.freeze([...alcance.lectura]), escritura: Object.freeze([...alcance.escritura]) });
}

/** Los tres valores de contexto de una transacción de empresa, ya validados: `[empresa, lectura, escritura]`. Sin alcance, las dos listas van vacías. */
function valoresDeContexto(empresaId: string, alcance: AlcanceDeSucursal | undefined): [string, string, string] {
  return [empresaId, serializarSucursalesDelAlcance(alcance?.lectura ?? []), serializarSucursalesDelAlcance(alcance?.escritura ?? [])];
}

/**
 * Fija el contexto de empresa y de sucursal en la transacción en curso con UNA sola sentencia (los tres `set_config` van en el mismo `SELECT`: el alcance no suma un viaje a la base).
 * El `true` los hace LOCALES a la transacción: nada queda en la conexión. Es lo único de `src/` que escribe estas variables en una transacción de empresa (la excepción es
 * `incluirSucursalCreadaEnLaTransaccion`, de `server/acceso/alcance.ts`, que agrega la sucursal recién creada a las dos listas).
 */
function fijarContexto(cliente: Db, [empresa, lectura, escritura]: [string, string, string]) {
  return cliente.$executeRaw`SELECT set_config('app.empresa_id', ${empresa}, true), set_config('app.sucursales_lectura', ${lectura}, true), set_config('app.sucursales_escritura', ${escritura}, true)`;
}

/**
 * Le pone a una función de transacción la fuente de azar del PROCESO para el jitter del reintento (`Transaccion.aleatorio`; Pureza 1.5): el núcleo no lee el azar por su cuenta, así que
 * toda transacción que sale de este archivo, y por eso toda `ctx.transaccion` de producción, la trae.
 */
function conAzarDelProceso(abrir: Transaccion): Transaccion {
  return Object.assign(abrir, { aleatorio: () => numeroEnUnidad(azarDelProceso) });
}

/** Base SIN empresa: para lo global (crons de índices y cotización, tablas sin `empresaId`). Lo que es de una empresa va por `baseDeEmpresa`. */
export function baseDelContexto(): BaseDelContexto {
  return { db: prisma, transaccion: conAzarDelProceso((fn, opciones) => prisma.$transaction(fn, opciones)) };
}

/**
 * Cliente cuyas operaciones corren con `app.empresa_id` = `empresaId` (ADR-007, A5) y con el `alcance` por sucursal (M.3): cada una se envuelve en una transacción
 * `[set_config('app.empresa_id', …, true), set_config('app.sucursales_lectura', …, true), set_config('app.sucursales_escritura', …, true), operación]`. El `true` los hace
 * LOCALES a la transacción: nada queda en la conexión, así que es seguro con un pool o con pgbouncer en modo transacción (un `SET` de sesión se filtraría a otro pedido).
 * El default de las columnas `empresaId` (`app_empresa_actual()`) y, desde la Migración 2, las políticas RLS leen ese valor. El `alcance` es OPCIONAL: sin él las dos listas van
 * vacías (las tablas por sucursal no devuelven ni aceptan filas) y el cliente sigue sirviendo para lo que se lee antes de saber la sucursal (login, elegir empresa). Un id mal
 * formado o repetido en el alcance falla acá, al armar el cliente, no en la primera consulta.
 *
 * Solo para operaciones sueltas: NO abrir `$transaction` sobre este cliente (usar `transaccionDeEmpresa`), porque el `set_config` va en una
 * transacción aparte y no alcanzaría a la interactiva. El cast a `PrismaClient` es solo de tipo: la extensión cambia el comportamiento,
 * no la forma del cliente.
 */
export function dbDeEmpresa(empresaId: string, alcance?: AlcanceDeSucursal): PrismaClient {
  const valores = valoresDeContexto(empresaId, alcance);
  const conEmpresa = prisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        const [, resultado] = await prisma.$transaction([fijarContexto(prisma, valores), query(args)]);
        return resultado;
      },
    },
  });
  return conEmpresa as unknown as PrismaClient;
}

/**
 * Cliente cuyas operaciones corren con `app.usuario_id` = `usuarioId`: lo único que habilita la política `lectura_propia_usuario` de `UsuarioEmpresa`
 * (leer las pertenencias PROPIAS en cualquier empresa). Es para las lecturas que ocurren antes de tener empresa (login, resolución del contexto); todo
 * lo demás va con `dbDeEmpresa`. Mismo mecanismo que `dbDeEmpresa`: valor local a la transacción.
 */
export function dbDeUsuario(usuarioId: string): PrismaClient {
  const conUsuario = prisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        const [, resultado] = await prisma.$transaction([prisma.$executeRaw`SELECT set_config('app.usuario_id', ${usuarioId}, true)`, query(args)]);
        return resultado;
      },
    },
  });
  return conUsuario as unknown as PrismaClient;
}

/**
 * Cliente cuyas operaciones corren con `app.invitacion_hash` = `hash`: lo único que habilita la política `lectura_por_token` de `Invitacion` (leer UNA
 * invitación sabiendo el hash de su token, antes de tener empresa). Solo lectura: aceptar escribe dentro de `transaccionDeEmpresa`. Mismo mecanismo que
 * `dbDeUsuario`: valor local a la transacción.
 */
export function dbDeInvitacion(hash: string): PrismaClient {
  const conHash = prisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        const [, resultado] = await prisma.$transaction([prisma.$executeRaw`SELECT set_config('app.invitacion_hash', ${hash}, true)`, query(args)]);
        return resultado;
      },
    },
  });
  return conHash as unknown as PrismaClient;
}

/**
 * Transacción interactiva con `app.empresa_id` y el `alcance` por sucursal fijados (locales a ella) ANTES de cualquier consulta de `fn`; el `tx` que recibe ya está bajo esa
 * empresa y ese alcance. Sin `alcance`, las listas van vacías (ver `dbDeEmpresa`). Valida el alcance antes de abrir la transacción.
 */
export function transaccionDeEmpresa<T>(empresaId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>, opciones?: OpcionesTransaccion, alcance?: AlcanceDeSucursal): Promise<T> {
  const valores = valoresDeContexto(empresaId, alcance);
  return prisma.$transaction(async (tx) => {
    await fijarContexto(tx, valores);
    return fn(tx);
  }, opciones);
}

/** La función de transacción de una empresa (`transaccionDeEmpresa` con la fuente de azar del proceso para el reintento): la usa `baseDeEmpresa` y los flujos sin contexto de usuario (el login por invitación). */
export function transaccionDeLaEmpresa(empresaId: string, alcance?: AlcanceDeSucursal): Transaccion {
  const fijo = alcance && copiaDelAlcance(alcance);
  return conAzarDelProceso((fn, opciones) => transaccionDeEmpresa(empresaId, fn, opciones, fijo));
}

/** La base (`db` + `transaccion`) de una empresa con su alcance por sucursal (opcional): lo que `obtenerContextoUsuario` le da al negocio. */
export function baseDeEmpresa(empresaId: string, alcance?: AlcanceDeSucursal): BaseDelContexto {
  const fijo = alcance && copiaDelAlcance(alcance);
  return { db: dbDeEmpresa(empresaId, fijo), transaccion: transaccionDeLaEmpresa(empresaId, fijo), ...(fijo ? { alcance: fijo } : {}) };
}

let datosDelRolDelProceso: Promise<DatosDelRol> | undefined;

/** `verificarRolDeEjecucion` sobre el cliente del proceso (ADR-022: estricto siempre; `MOTOR2_ROL_ESTRICTO=0` es el escape de las herramientas de demo); lee el rol una sola vez. */
export async function verificarRolDeEjecucionDelProceso(): Promise<void> {
  datosDelRolDelProceso ??= datosDelRolDeEjecucion(prisma).catch((error) => {
    datosDelRolDelProceso = undefined;
    throw error;
  });
  await verificarRolDeEjecucion(prisma, await datosDelRolDelProceso, permitirRolPrivilegiado(process.env));
}
