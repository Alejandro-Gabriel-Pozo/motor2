import "server-only";
import type { PrismaClient } from "@prisma/client";
import { estadoEfectivoDeInvitacion, esTokenConFormaValida, type AccesoDeInvitacion } from "@/core/features/empresa/invitacion";
import { aceptarInvitacionDeUsuario } from "@/core/features/empresa/aceptar-invitacion-de-usuario";
import { aceptarInvitacion, ErrorDeAceptacion, MENSAJE_ENLACE_NO_VALIDO, type ResultadoDeAceptacion } from "@/core/features/empresa/aceptar-invitacion";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { InvarianteViolada } from "@/core/permisos/invariantes";
import { hashDeToken } from "@/core/seguridad/tokens";
import { dbDeEmpresa, dbDeInvitacion, transaccionDeLaEmpresa, verificarRolDeEjecucionDelProceso } from "@/core/auth/base";
import type { Transaccion } from "@/lib/db-tipos";
import { abreLaVia3, TIPO_INVITACION_USUARIO, type VistaDeInvitacion } from "@/core/auth/invitacion";

/**
 * La invitación LEÍDA por su token (Hito 3, B3-3 de `docs/plan-hito-3-pureza.md`): lo que de `core/auth/invitacion.ts` tocaba la base. El invitado todavía no tiene empresa
 * ni sesión (o tiene una de otras empresas), así que se busca por el hash con `dbDeInvitacion` (política `lectura_por_token`). Aceptar vive en
 * `core/features/empresa/aceptar-invitacion{,-de-usuario}.ts`; la vinculación de la cuenta de Google, en `vincular-cuenta.ts`. Las reglas puras (tipos, cookie, clase de
 * invitación) siguen en `core/auth/invitacion.ts`.
 */

/**
 * Busca la invitación por el token del enlace. `null` si el token no tiene la forma esperada o no corresponde a ninguna: el que llama no distingue
 * «no existe» de «mal formado», y de afuera tampoco.
 */
export async function invitacionDelToken(token: string | undefined, ahora: Date = new Date()): Promise<VistaDeInvitacion | null> {
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
export async function invitacionHabilitaElIngreso(token: string | undefined, emailPerfil: string, ahora: Date = new Date()): Promise<boolean> {
  const vista = await invitacionDelToken(token, ahora);
  if (!vista || vista.estado !== "PENDIENTE" || !abreLaVia3(vista)) return false;
  return vista.email === emailPerfil.trim().toLowerCase();
}

/**
 * Acepta la invitación del token en nombre de `usuario` (ya autenticado con Google). Resuelve la empresa por el token y corre `aceptarInvitacion` en una
 * transacción serializable bajo esa empresa. Un fallo de invariantes o de datos de la empresa deshace todo y vuelve como mensaje.
 */
export async function aceptarInvitacionDelToken(entrada: { token: string; usuario: { id: string; email: string }; cuit: unknown; ahora?: Date }): Promise<ResultadoDeAceptacion> {
  const ahora = entrada.ahora ?? new Date();
  const invitacion = await invitacionConSuBase(entrada.token, ahora);
  if (!invitacion || invitacion.vista.estado !== "PENDIENTE") return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  try {
    return await conTransaccionSerializable(
      invitacion.transaccion,
      (tx) => aceptarInvitacion(tx, { token: entrada.token, usuario: entrada.usuario, cuit: entrada.cuit, ahora }),
    );
  } catch (e) {
    if (e instanceof InvarianteViolada) return { ok: false, mensaje: e.mensaje };
    if (e instanceof ErrorDeAceptacion) return { ok: false, mensaje: e.message };
    throw e;
  }
}

/**
 * El guard del permiso «gestionar usuarios» (módulos, capacidades y rol de quien otorgó), tal como lo da `requierePermiso` del gate. Lo recibe quien llama (la Server
 * Action de la invitación) y no se importa acá: la sesión no depende del guard (regla `sesion-capa`). Una prueba de arquitectura exige que la única llamada de producción le
 * pase el `requierePermiso` REAL del gate (`test/arquitectura/invitacion-recibe-el-guard.test.ts`). El `db` se tipa con `PrismaClient` (lo que devuelve `dbDeEmpresa`) y no con
 * `ReturnType<typeof dbDeEmpresa>`: así nombrar el tipo no obliga a importar `core/auth/base` (`base-solo-desde-lista` cuenta también los `import type`).
 */
export type ExigirGestionDeUsuarios = (otorganteId: string, sucursalId: string, accion: "gestion_usuarios", db: PrismaClient) => Promise<{ ok: boolean }>;

/**
 * Acepta una invitación de USUARIO en nombre de `usuario` (ya autenticado con Google): crea sus membresías, revalidando por cada sucursal el permiso y el techo de quien la otorgó
 * (E8, ADR-024). Todo o nada, en una transacción serializable bajo la empresa de la invitación. El permiso `gestion_usuarios` de quien otorgó pasa por el guard (módulos y capacidades).
 */
export async function aceptarInvitacionDeUsuarioDelToken(
  entrada: { token: string; usuario: { id: string; email: string }; ahora?: Date },
  requierePermiso: ExigirGestionDeUsuarios,
): Promise<ResultadoDeAceptacion> {
  const ahora = entrada.ahora ?? new Date();
  const invitacion = await invitacionConSuBase(entrada.token, ahora);
  if (!invitacion || invitacion.vista.estado !== "PENDIENTE" || invitacion.vista.tipo !== TIPO_INVITACION_USUARIO) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  const dbEmpresa = invitacion.db;
  const puedeOtorgar = async (otorganteId: string, sucursalId: string) => (await requierePermiso(otorganteId, sucursalId, "gestion_usuarios", dbEmpresa)).ok;
  try {
    return await conTransaccionSerializable(
      invitacion.transaccion,
      (tx) => aceptarInvitacionDeUsuario(tx, { token: entrada.token, usuario: entrada.usuario, ahora, puedeOtorgar }),
    );
  } catch (e) {
    if (e instanceof InvarianteViolada) return { ok: false, mensaje: e.mensaje };
    throw e;
  }
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
