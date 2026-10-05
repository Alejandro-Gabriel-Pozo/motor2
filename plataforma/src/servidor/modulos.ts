import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { validarCambioDeModulos } from "@/core/modulos/clausura";
import { explicarErrorDeCambio, nombreDeModulo, vistaDeModulos, type FilaDeModulo } from "@/core/modulos/vista-de-modulos";
import { auditarEnTransaccion, type Autor } from "./auditoria";
import { bloquearEmpresa } from "./ciclo-de-vida";

/**
 * Módulos de una empresa desde la consola (E7, ADR-023): activar y desactivar vendibles en el registro. Es la vía normal; `scripts/modulos-empresa.ts` queda de emergencia.
 *
 * Mismas reglas que el resto de la consola: el cambio y su fila de auditoría de plataforma (el administrador como autor, ADR-012 §5) en UNA transacción, con el cerrojo de la
 * fila de la empresa (`FOR UPDATE`); el `empresaId` del cliente se vuelve a leer en la transacción; desactivar deja la fila en INACTIVO y nunca la borra (la plataforma no
 * tiene DELETE). La validación es la de `validarCambioDeModulos`, la MISMA clausura que usa el guard de la app: el cambio rige en el próximo pedido de los usuarios.
 */
type Db = PrismaClient;

export type ResultadoDeModulos =
  | { ok: true; mensaje: string; cambiados: Array<{ modulo: string; antes: "sin fila" | "ACTIVO" | "INACTIVO"; despues: "ACTIVO" | "INACTIVO" }> }
  | { ok: false; mensaje: string };

export interface ModulosDeLaEmpresa {
  empresa: { id: string; nombre: string; estado: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DELETING" };
  vista: FilaDeModulo[];
  activos: string[];
}

export async function leerModulosDeEmpresa(db: Db, empresaId: string): Promise<ModulosDeLaEmpresa | null> {
  const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true, estado: true } });
  if (!empresa) return null;
  const filas = await db.moduloEmpresa.findMany({ where: { empresaId, estado: "ACTIVO" }, select: { modulo: true } });
  const activos = filas.map((f) => f.modulo);
  return { empresa, vista: vistaDeModulos(activos), activos };
}

const entradaSchema = z.object({ activar: z.array(z.string().min(1).max(60)).max(20).default([]), desactivar: z.array(z.string().min(1).max(60)).max(20).default([]) });

export async function cambiarModulosDesdeLaConsola(db: Db, autor: Autor, empresaId: string, entrada: unknown): Promise<ResultadoDeModulos> {
  const parseo = entradaSchema.safeParse(entrada);
  if (!parseo.success) return { ok: false, mensaje: "El pedido de módulos no es válido." };
  const { activar, desactivar } = parseo.data;
  if (activar.length === 0 && desactivar.length === 0) return { ok: false, mensaje: "No hay nada que cambiar." };

  return db.$transaction(
    async (tx): Promise<ResultadoDeModulos> => {
      const empresa = await bloquearEmpresa(tx, empresaId);
      if (!empresa) return { ok: false, mensaje: "La empresa no existe." };
      if (empresa.estado === "DELETING") return { ok: false, mensaje: "Una empresa en baja no cambia de módulos." };

      const filas = await tx.moduloEmpresa.findMany({ where: { empresaId }, select: { modulo: true, estado: true } });
      const estadoActual = new Map(filas.map((f) => [f.modulo, f.estado]));
      const validacion = validarCambioDeModulos(filas.filter((f) => f.estado === "ACTIVO").map((f) => f.modulo), { activar, desactivar });
      if (!validacion.ok) return { ok: false, mensaje: validacion.errores.map(explicarErrorDeCambio).join(" ") };

      const cambiados: Extract<ResultadoDeModulos, { ok: true }>["cambiados"] = [];
      for (const [modulos, despues] of [[activar, "ACTIVO"], [desactivar, "INACTIVO"]] as const) {
        for (const modulo of modulos) {
          const antes = estadoActual.get(modulo) ?? null;
          if (antes === despues || (antes === null && despues === "INACTIVO")) continue;
          await tx.moduloEmpresa.upsert({ where: { empresaId_modulo: { empresaId, modulo } }, create: { empresaId, modulo, estado: despues }, update: { estado: despues } });
          await auditarEnTransaccion(tx, autor, despues === "ACTIVO" ? "modulo-activado" : "modulo-desactivado", empresaId, { modulo, antes: antes ?? "sin fila" });
          cambiados.push({ modulo, antes: antes ?? "sin fila", despues });
        }
      }
      if (cambiados.length === 0) return { ok: true, mensaje: "Sin cambios: ya estaba así.", cambiados };
      const verbo = (d: string) => (d === "ACTIVO" ? "activado" : "desactivado");
      return { ok: true, mensaje: cambiados.map((c) => `${nombreDeModulo(c.modulo)} ${verbo(c.despues)}`).join(", ") + ".", cambiados };
    },
    { timeout: 15_000 },
  );
}
