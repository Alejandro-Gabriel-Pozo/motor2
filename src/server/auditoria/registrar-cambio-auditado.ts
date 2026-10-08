import type { Prisma, PrismaClient } from "@prisma/client";
import type { CambioAuditable } from "@/core/permisos/auditoria";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * El ESCRITOR de la auditoría administrativa (A3, Pivote 6 — docs/auditoria-motor2-pivotes-2026-09-16.md "Pivote 6", docs/auditoria-motor2-fase6-seguridad-2026-09-18.md): el único punto
 * de escritura de `RegistroAuditoria` (mismo criterio que `conPermiso`/`conTransaccionSerializable`: un solo lugar, nunca una copia divergente en cada Server Action).
 *
 * Hito 5, pieza 5.4 (B3): mudado TAL CUAL desde `core/permisos/auditoria.ts` (mismo nombre, misma firma y mismo cuerpo); allá quedó lo puro (el catálogo de entidades
 * auditables, el tipo `CambioAuditable`, las claves de acción renombradas y `descripcionParaMostrar`). La capa nueva `src/server/auditoria/` la fija `auditoria-capa` en
 * `.dependency-cruiser.cjs` (B5): no importa la UI, ni lo demás de `server/`, ni Next, ni la sesión; y a ella solo llegan los casos de uso, las operaciones de plataforma y la sesión —la
 * auditoría la registra el caso de uso, DENTRO de la transacción del cambio que audita, nunca la persistencia ni una lectura—. Lista cerrada de archivos: `test/arquitectura/server-auditoria.test.ts`.
 *
 * SIN `import "server-only"` a propósito: lo cargan scripts que corren con `tsx` fuera de Next (`scripts/modulos-empresa.ts` y `scripts/politica-empresa.ts`, vía las operaciones de
 * plataforma), donde ese paquete tira al importarse; ponerlo obligaría a correr esos scripts con `--conditions=react-server` y a editar `package.json`. No hace falta: recibe la base por
 * parámetro (`db`) y no lee la sesión, las cookies ni el entorno, así que no hay nada de servidor que proteger de un componente de cliente (mismo criterio que `server/acceso/capacidades-sucursal.ts`).
 */

function aTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  return String(valor);
}

/**
 * No-op si el valor no cambió en absoluto — evita ensuciar el registro
 * con "cambios" de un `update`/`upsert` que en realidad reescribió el
 * mismo valor (ej. guardar un formulario sin tocar ese campo puntual).
 */
export async function registrarCambioAuditado(db: Db, cambio: CambioAuditable): Promise<void> {
  const anterior = aTexto(cambio.valorAnterior);
  const nuevo = aTexto(cambio.valorNuevo);
  if (anterior === nuevo) return;

  await db.registroAuditoria.create({
    data: {
      entidad: cambio.entidad,
      entidadId: cambio.entidadId,
      descripcion: cambio.descripcion,
      campo: cambio.campo,
      valorAnterior: anterior,
      valorNuevo: nuevo,
      actorId: cambio.actorId,
      sucursalId: cambio.sucursalId ?? null,
    },
  });
}
