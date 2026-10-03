import type { Db } from "@/lib/db-tipos";
import { whereCartaDeSucursal } from "@/core/carta/public";

/**
 * Validación del género (docs/plan-genero-carta-2026-09-26.md) compartida entre `contenido-producto.ts` y `items-agrupados.ts`:
 * OPCIONAL, y si viene tiene que existir y estar activo. SIN `"use server"`: no es una Server Action (en un archivo con esa
 * directiva todo lo exportado queda expuesto como endpoint) — es una función interna que llaman las que sí lo son.
 */
export async function validarGeneroCartaOpcional(db: Db, sucursalId: string, generoCartaId: string | null | undefined): Promise<{ ok: true; valor: string | null } | { ok: false; mensaje: string }> {
  const id = generoCartaId?.trim() || null;
  if (!id) return { ok: true, valor: null };
  const genero = await db.generoCarta.findUnique({ where: { id, ...whereCartaDeSucursal(sucursalId) }, select: { id: true, activo: true } });
  if (!genero) return { ok: false, mensaje: "No se encontró el género." };
  if (!genero.activo) return { ok: false, mensaje: "Ese género está apagado: elegí uno activo, o ninguno." };
  return { ok: true, valor: id };
}
