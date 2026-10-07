import "server-only";
import type { PrismaClient } from "@prisma/client";
import { estadoEfectivoDeInvitacion, esTokenConFormaValida, type AccesoDeInvitacion } from "@/core/features/empresa/invitacion";
import { hashDeToken } from "@/core/seguridad/tokens";
import { dbDeEmpresa, dbDeInvitacion, transaccionDeLaEmpresa, verificarRolDeEjecucionDelProceso } from "@/core/auth/base";
import type { Transaccion } from "@/lib/db-tipos";
import { abreLaVia3, type VistaDeInvitacion } from "@/core/auth/invitacion";

/**
 * La invitación LEÍDA por su token (Hito 3, B3-3 de `docs/plan-hito-3-pureza.md`): lo que de `core/auth/invitacion.ts` tocaba la base. El invitado todavía no tiene empresa
 * ni sesión (o tiene una de otras empresas), así que se busca por el hash con `dbDeInvitacion` (política `lectura_por_token`). Aceptar la del primer gerente es un caso de uso
 * (`server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts`, B3-5); la de usuario también (`aceptar-invitacion-de-usuario.ts`, B3-7); la vinculación de la cuenta de Google, en `vincular-cuenta.ts`. Las reglas puras (tipos, cookie, clase de
 * invitación) siguen en `core/auth/invitacion.ts`.
 */

/**
 * Busca la invitación por el token del enlace. `null` si el token no tiene la forma esperada o no corresponde a ninguna: el que llama no distingue
 * «no existe» de «mal formado», y de afuera tampoco. `ahora` es obligatorio (O.24, B3-9): decide si la invitación está VENCIDA, y la fija quien está en el borde (la pantalla,
 * la acción, el gate de login), no un valor por defecto escondido acá.
 */
export async function invitacionDelToken(token: string | undefined, ahora: Date): Promise<VistaDeInvitacion | null> {
  if (!token || !esTokenConFormaValida(token)) return null;
  await verificarRolDeEjecucionDelProceso();
  const hash = hashDeToken(token);
  const db = dbDeInvitacion(hash);
  // Por hash y no solo por el RLS: sin `where`, un token bien formado pero inexistente devolvería OTRA fila visible (por ejemplo la de la única empresa activa).
  const invitacion = await db.invitacion.findFirst({
    where: { hashToken: hash },
    select: { id: true, empresaId: true, email: true, rolEmpresa: true, estado: true, venceEn: true },
  });
  if (!invitacion) return null;
  const empresa = await db.empresa.findUnique({ where: { id: invitacion.empresaId }, select: { nombre: true, estado: true } });
  if (!empresa) return null;
  return {
    id: invitacion.id,
    empresaId: invitacion.empresaId,
    nombreEmpresa: empresa.nombre,
    estadoEmpresa: empresa.estado,
    email: invitacion.email,
    tipo: invitacion.rolEmpresa,
    estado: estadoEfectivoDeInvitacion(invitacion, ahora),
    venceEn: invitacion.venceEn,
  };
}

/** Una invitación leída por su token, con la base de SU empresa: la única forma de llegar desde un token a esa base. */
export interface InvitacionConSuBase {
  vista: VistaDeInvitacion;
  /** La base fijada en la empresa de la invitación (RLS `aislamiento_empresa`), para leer fuera de la transacción (el guard de quien otorgó, las sucursales). */
  db: PrismaClient;
  /** La transacción bajo esa misma empresa. */
  transaccion: Transaccion;
}

/**
 * La ÚNICA puerta de un token de invitación a la base de su empresa (Hito 3, B3-4 de `docs/plan-hito-3-pureza.md`). Quien acepta todavía no tiene contexto de empresa: la
 * empresa sale de la invitación misma, leída por el hash del token (`invitacionDelToken`), nunca de un id que mande el llamador. Las aceptaciones, la vinculación de la cuenta
 * y las sucursales de la invitación piden la base por acá; `server-sesion.test.ts` vigila que en `server/sesion` nadie más fije una empresa a partir de una invitación.
 * `null` si el token no corresponde a ninguna invitación (mismo criterio que `invitacionDelToken`: no se distingue «no existe» de «mal formado»).
 */
export async function invitacionConSuBase(token: string | undefined, ahora: Date): Promise<InvitacionConSuBase | null> {
  const vista = await invitacionDelToken(token, ahora);
  if (!vista) return null;
  return { vista, db: dbDeEmpresa(vista.empresaId), transaccion: transaccionDeLaEmpresa(vista.empresaId) };
}

/**
 * ¿Esta invitación deja iniciar sesión con la cuenta de Google de `emailPerfil`? Sí cuando sigue pendiente (no aceptada, revocada ni vencida) y el email
 * es EL MISMO que se invitó. Es la cuarta vía del gate de login: no da acceso a nada más que a llegar a la pantalla de aceptación.
 */
export async function invitacionHabilitaElIngreso(token: string | undefined, emailPerfil: string, ahora: Date): Promise<boolean> {
  const vista = await invitacionDelToken(token, ahora);
  if (!vista || vista.estado !== "PENDIENTE" || !abreLaVia3(vista)) return false;
  return vista.email === emailPerfil.trim().toLowerCase();
}

/**
 * Las sucursales (con su rol) que da una invitación de USUARIO, para mostrárselas a quien la va a aceptar. `InvitacionSucursal` solo se lee bajo la empresa, no por el hash:
 * por eso se llama recién DESPUÉS de comprobar que la sesión es del email invitado, y con la base que dio `invitacionConSuBase` (nunca con una empresa que mande el llamador).
 */
export async function accesosDeLaInvitacion(invitacion: InvitacionConSuBase): Promise<AccesoDeInvitacion[]> {
  const filas = await invitacion.db.invitacionSucursal.findMany({
    where: { invitacionId: invitacion.vista.id },
    orderBy: { creadaEn: "asc" },
    select: { sucursal: { select: { nombre: true } }, rol: { select: { nombre: true } } },
  });
  return filas.map((f) => ({ sucursal: f.sucursal.nombre, rol: f.rol.nombre }));
}
