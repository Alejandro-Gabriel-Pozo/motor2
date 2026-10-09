import type { PrismaClient } from "@prisma/client";
import { clienteDePlataforma } from "./cliente-plataforma";
import { exigirRolDePlataforma, resolverConexionDePlataforma, type ConexionDePlataforma } from "./conexion-de-plataforma";
import type { AutorDeCambioDePlataforma } from "../src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma";
import { ActorDePlataformaError, requerirAdminDePlataforma } from "../src/server/operaciones-de-plataforma/requerir-admin-de-plataforma";
import { MENSAJE_SIN_CODIGO_DE_ACTOR, probarActorDePlataforma, type PruebaDelActor } from "./plataforma/probar-actor-de-plataforma";
import { leerCodigoDelActor } from "./codigo-de-actor";

/**
 * Todo lo que un script de cambios de plataforma (`modulos-empresa`, `politica-empresa`) tiene que tener resuelto ANTES de tocar nada (S-33; decisión del dueño, 2026-10-08):
 *  1. la conexión sale del archivo de entorno de plataforma y nunca de `DATABASE_URL` (`resolverConexionDePlataforma`);
 *  2. cada conexión abierta es, de verdad, del rol `motor2_plataforma` (`select current_user`, `exigirRolDePlataforma`);
 *  3. `--actor` es un `AdminPlataforma` ACTIVO verificado contra la base de IDENTIDAD de la consola (la instalación principal, la de `PLATAFORMA_DATABASE_URL`) —no contra la base que
 *     se opera, y no por el email recibido a ciegas—, y NO tiene que ser un `User` ni se crea ninguno;
 *  4. (M-32) `--actor` ATRIBUYE pero no AUTENTICA, así que además hay que PROBARLO: un código TOTP vigente de ese administrador (`PLATAFORMA_CODIGO_ACTOR` o prompt de la terminal; nunca un
 *     argumento), verificado contra su secreto cifrado con `PLATAFORMA_CLAVE_TOTP`, con cupo de intentos y auditoría del intento fallido (`probar-actor-de-plataforma.ts`). Sin código el script
 *     ni siquiera abre una conexión;
 *  5. de ahí sale el `autor` de la auditoría: el administrador y la instalación (`PLATAFORMA_INSTALACION_ID` / `PLATAFORMA_INSTALACION_NOMBRE`).
 * Si cualquiera falla, se cierra lo abierto y el script no llega a la operación.
 */
export interface ContextoDePlataforma {
  /** Cliente de la instalación elegida (donde vive la empresa): el que recibe la operación. */
  db: PrismaClient;
  autor: AutorDeCambioDePlataforma;
  conexion: ConexionDePlataforma;
  cerrar(): Promise<void>;
}

/** Lo que se inyecta para probar sin abrir conexiones reales; por defecto, lo real. */
export interface DependenciasDelContexto {
  crearCliente(url: string): PrismaClient;
  exigirRol(db: PrismaClient): Promise<void>;
  exigirAdmin(db: PrismaClient, email: string): Promise<{ id: string; email: string }>;
  /** De dónde sale el código del actor (la variable `PLATAFORMA_CODIGO_ACTOR` o el prompt de la terminal). */
  leerCodigo(entorno: Record<string, string | undefined>): Promise<string | undefined>;
  /** Comprueba que el código es un TOTP vigente de ese administrador; lanza `ActorDePlataformaError` si no. */
  probarActor(db: PrismaClient, actor: { id: string; email: string }, prueba: PruebaDelActor): Promise<void>;
}

const DEPENDENCIAS_REALES: DependenciasDelContexto = {
  crearCliente: clienteDePlataforma,
  exigirRol: exigirRolDePlataforma,
  exigirAdmin: requerirAdminDePlataforma,
  leerCodigo: leerCodigoDelActor,
  probarActor: probarActorDePlataforma,
};

export async function abrirContextoDePlataforma(
  entorno: Record<string, string | undefined>,
  pedido: { instalacion: string | undefined; actor: string },
  dependencias: DependenciasDelContexto = DEPENDENCIAS_REALES,
): Promise<ContextoDePlataforma> {
  const conexion = resolverConexionDePlataforma(entorno, pedido.instalacion);
  // M-32: el código del actor se pide ANTES de abrir ninguna conexión; sin él no hay nada que probar y no se toca la base.
  const codigo = await dependencias.leerCodigo(entorno);
  if (!codigo?.trim()) throw new ActorDePlataformaError(MENSAJE_SIN_CODIGO_DE_ACTOR);
  // Si la instalación elegida ES la principal, la base de identidad y la de la empresa son la misma: un solo cliente.
  const mismaBase = conexion.databaseUrl === conexion.identidadDatabaseUrl;
  const identidad = dependencias.crearCliente(conexion.identidadDatabaseUrl);
  const db = mismaBase ? identidad : dependencias.crearCliente(conexion.databaseUrl);
  const cerrar = async () => {
    await Promise.allSettled([identidad.$disconnect(), ...(mismaBase ? [] : [db.$disconnect()])]);
  };

  try {
    await dependencias.exigirRol(identidad);
    if (!mismaBase) await dependencias.exigirRol(db);
    const admin = await dependencias.exigirAdmin(identidad, pedido.actor);
    await dependencias.probarActor(identidad, admin, { codigo, claveTotp: entorno.PLATAFORMA_CLAVE_TOTP, ahora: new Date(), instalacionId: conexion.id });
    return { db, conexion, cerrar, autor: { adminId: admin.id, adminEmail: admin.email, instalacionId: conexion.id, instalacionNombre: conexion.nombre } };
  } catch (error) {
    await cerrar();
    throw error;
  }
}
