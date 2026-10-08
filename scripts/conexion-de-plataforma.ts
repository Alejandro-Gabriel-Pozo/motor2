import { instalacionPorId, leerInstalaciones } from "../plataforma/src/entorno";

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

export type ConexionDePlataforma =
  | { origen: "instalacion"; id: string; nombre: string; databaseUrl: string }
  | { origen: "archivo-de-entorno"; databaseUrl: string };

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
 * la principal en silencio es justo el riesgo que ADR-025 §1 señala. Sin el flag y sin instalaciones adicionales, el comportamiento de siempre:
 * `PLATAFORMA_DATABASE_URL`; sin ella falla (S-33: ya no cae en `DATABASE_URL`).
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
    return { origen: "instalacion", id: instalacion.id, nombre: instalacion.nombre, databaseUrl: instalacion.databaseUrl };
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
  const databaseUrl = source.PLATAFORMA_DATABASE_URL || "";
  if (!databaseUrl) throw new ConexionDePlataformaError("Falta PLATAFORMA_DATABASE_URL en el archivo de entorno: no hay base a la que conectarse (no se usa DATABASE_URL: es la conexión de la app).");
  return { origen: "archivo-de-entorno", databaseUrl };
}

/** Para el cartel del script al arrancar: nunca una URL de conexión. */
export function describirConexion(conexion: ConexionDePlataforma): string {
  return conexion.origen === "instalacion" ? `${conexion.id} (${conexion.nombre})` : "la del archivo de entorno (PLATAFORMA_DATABASE_URL)";
}
