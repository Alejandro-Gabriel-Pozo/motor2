import type { PrismaClient } from "@prisma/client";
import { instalacionPorId, leerInstalaciones, ROL_DE_PLATAFORMA } from "../plataforma/src/entorno";

/**
 * Qué base operan los scripts de plataforma (`modulos-empresa`, `politica-empresa`, ADR-025): puro, no lee `process.env` ni abre ninguna conexión —
 * así se testea sin un `.env` ni un `PrismaClient` de por medio. Los mensajes nombran el id pedido y las variables, NUNCA una URL de conexión.
 */
export class ConexionDePlataformaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ConexionDePlataformaError";
  }
}

/**
 * La base que se opera y la de identidad. `databaseUrl` es la de la instalación elegida (donde vive la empresa a cambiar); `identidadDatabaseUrl` es la de la instalación PRINCIPAL
 * (`PLATAFORMA_DATABASE_URL`), donde viven los administradores de plataforma (ADR-025 §1): el actor se verifica ahí, no en la base que se opera. `id` y `nombre` son los de la instalación
 * (para la principal, `PLATAFORMA_INSTALACION_ID` / `PLATAFORMA_INSTALACION_NOMBRE`, por defecto `principal`) y van a la auditoría.
 */
export interface ConexionDePlataforma {
  origen: "instalacion" | "archivo-de-entorno";
  id: string;
  nombre: string;
  databaseUrl: string;
  identidadDatabaseUrl: string;
}

function instalacionesValidadas(source: Record<string, string | undefined>) {
  try {
    return leerInstalaciones(source);
  } catch (error) {
    // El mensaje de entorno.ts ya nombra solo variables, nunca un valor: se reenvía tal cual.
    throw new ConexionDePlataformaError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Resuelve qué base operar: con `--instalacion <id>`, esa instalación de la lista configurada (nunca cae en la principal ante un id desconocido). Sin
 * el flag, si el archivo de entorno administra varias instalaciones (`PLATAFORMA_INSTALACIONES_ADICIONALES`), falla pidiendo que se elija una —operar
 * la principal en silencio es justo el riesgo que ADR-025 §1 señala. Sin el flag y sin instalaciones adicionales, la principal: `PLATAFORMA_DATABASE_URL`; sin ella falla
 * (S-33: ya no cae en `DATABASE_URL`).
 *
 * En TODOS los caminos la configuración pasa por `leerInstalaciones` —la misma que valida la consola—, que exige que cada URL de conexión sea del usuario de base
 * `motor2_plataforma`: antes el camino sin flag devolvía `PLATAFORMA_DATABASE_URL` sin mirar con qué rol conectaba, y un archivo de entorno con la URL del dueño o de la app pasaba.
 */
export function resolverConexionDePlataforma(source: Record<string, string | undefined>, instalacionPedida: string | undefined): ConexionDePlataforma {
  if (instalacionPedida !== undefined) {
    const id = instalacionPedida.trim();
    if (!id) throw new ConexionDePlataformaError("--instalacion necesita el id de una instalación (por ejemplo: --instalacion zuluhub).");
    const lista = instalacionesValidadas(source);
    const instalacion = instalacionPorId(lista, id);
    if (!instalacion) {
      const ids = lista.map((i) => i.id).join(", ");
      throw new ConexionDePlataformaError(`No hay una instalación "${id}" configurada en este archivo de entorno. Las configuradas son: ${ids}.`);
    }
    return { origen: "instalacion", id: instalacion.id, nombre: instalacion.nombre, databaseUrl: instalacion.databaseUrl, identidadDatabaseUrl: lista[0].databaseUrl };
  }

  if ((source.PLATAFORMA_INSTALACIONES_ADICIONALES ?? "").trim()) {
    const ids = instalacionesValidadas(source)
      .map((i) => i.id)
      .join(", ");
    throw new ConexionDePlataformaError(
      `Este archivo de entorno administra varias instalaciones (${ids}): elegí una con --instalacion <id>. Sin el flag el script operaría la principal, y dos instalaciones pueden tener una empresa con el mismo slug.`,
    );
  }

  // S-33: NUNCA cae en `DATABASE_URL` (la conexión de la app, o la del dueño en un `.env` local): un script de plataforma que opera con otro rol que `motor2_plataforma` se salta sus grants y su RLS por rol.
  if (!source.PLATAFORMA_DATABASE_URL) throw new ConexionDePlataformaError("Falta PLATAFORMA_DATABASE_URL en el archivo de entorno: no hay base a la que conectarse (no se usa la conexión de la app ni la del dueño).");
  const [principal] = instalacionesValidadas(source);
  return { origen: "archivo-de-entorno", id: principal.id, nombre: principal.nombre, databaseUrl: principal.databaseUrl, identidadDatabaseUrl: principal.databaseUrl };
}

/** Para el cartel del script al arrancar: nunca una URL de conexión. */
export function describirConexion(conexion: ConexionDePlataforma): string {
  return conexion.origen === "instalacion" ? `${conexion.id} (${conexion.nombre})` : "la del archivo de entorno (PLATAFORMA_DATABASE_URL)";
}

/**
 * Comprueba, ya conectado, que la sesión es la del rol `motor2_plataforma` (`select current_user`): la URL puede decir un usuario y la sesión ser otra (un pooler que cambia el rol, un
 * `SET ROLE` del servidor), y solo ese rol tiene los grants mínimos y el RLS por nombre de rol que los scripts de plataforma dan por supuestos. Se llama sobre cada cliente ANTES de
 * leer o escribir nada.
 */
export async function exigirRolDePlataforma(db: Pick<PrismaClient, "$queryRaw">): Promise<void> {
  const filas = await db.$queryRaw<Array<{ rol: string }>>`SELECT current_user::text AS rol`;
  const rol = filas[0]?.rol;
  if (rol !== ROL_DE_PLATAFORMA) {
    throw new ConexionDePlataformaError(`La conexión no es del rol ${ROL_DE_PLATAFORMA} (es ${rol ? `«${rol}»` : "desconocido"}): un script de plataforma solo corre con ese rol, no con el del dueño ni el de la app.`);
  }
}
