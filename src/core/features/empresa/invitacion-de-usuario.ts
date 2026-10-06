import type { Prisma } from "@prisma/client";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { generarTokenOpaco, hashDeToken } from "@/core/seguridad/tokens";
import { vencimientoDeInvitacion, type TipoDeInvitacion } from "./invitacion";

/**
 * Crear, extender, volver a firmar y revocar invitaciones de USUARIO y de VINCULACIÓN (E8, ADR-024) dentro de una transacción de la empresa. La invitación es una
 * credencial de vinculación: prueba que quien entra controla el buzón del email invitado. NO crea `User` ni membresías (eso pasa al aceptar). El permiso de quien invita lo
 * verifica quien llama (el gate de `gestion_usuarios` y el techo de privilegio); acá solo se mantiene el estado y su auditoría. El mail NO se manda acá: sale DESPUÉS del
 * commit (ADR-018), con el token que devuelven estas funciones (que solo existe en memoria: en la base queda el hash).
 */
type Tx = Prisma.TransactionClient;

const TIPO_USUARIO: TipoDeInvitacion = "usuario";
const TIPO_VINCULACION: TipoDeInvitacion = "vinculacion";

export interface AccesoPedido {
  sucursalId: string;
  rolId: string;
  notas?: string | null;
}

export type ResultadoDeInvitacion =
  | { ok: true; invitacionId: string; accion: "creada" | "extendida" | "rotada"; token: string | null }
  | { ok: false; mensaje: string };

/** La hora del pedido y la fuente de azar con la que se generan los tokens (Pureza 1.2 y 1.5): el dominio no lee el reloj ni el generador criptográfico. */
interface Reloj {
  ahora: Date;
  azar: FuenteDeAzar;
  /** Solo para los tests que necesitan un token conocido. */
  generarToken?: () => string;
}

const minuscula = (email: string) => email.trim().toLowerCase();

async function auditar(tx: Tx, entrada: { invitacionId: string; email: string; actorId: string; anterior: string | null; nuevo: string }) {
  await registrarCambioAuditado(tx, {
    entidad: "UsuarioEmpresa",
    entidadId: entrada.invitacionId,
    campo: "invitacion",
    descripcion: `Invitación de "${entrada.email}"`,
    valorAnterior: entrada.anterior,
    valorNuevo: entrada.nuevo,
    actorId: entrada.actorId,
    sucursalId: null,
  });
}

async function sumarAcceso(tx: Tx, empresaId: string, invitacionId: string, acceso: AccesoPedido, invitadoPorId: string) {
  await tx.invitacionSucursal.upsert({
    where: { invitacionId_sucursalId: { invitacionId, sucursalId: acceso.sucursalId } },
    update: { rolId: acceso.rolId, invitadoPorId, ...(acceso.notas !== undefined && { notas: acceso.notas }) },
    create: { empresaId, invitacionId, sucursalId: acceso.sucursalId, rolId: acceso.rolId, invitadoPorId, ...(acceso.notas !== undefined && { notas: acceso.notas }) },
  });
}

/**
 * Deja una invitación de USUARIO pendiente para `email` con el acceso pedido (una sucursal y su rol):
 *  - no hay ninguna: la crea con su fila de sucursal y devuelve el token (hay que mandar el mail);
 *  - hay una de usuario vigente: suma o actualiza la sucursal y NO devuelve token (el enlace ya enviado cubre la sucursal nueva: no se manda otro mail);
 *  - hay una de usuario vencida: rota el token, suma la sucursal y devuelve el token (hay que mandar el mail);
 *  - hay una de gerente o de vinculación pendiente: no se puede, lo explica.
 */
export async function asegurarInvitacionDeUsuario(tx: Tx, entrada: { empresaId: string; email: string; invitadoPorId: string; acceso: AccesoPedido } & Reloj): Promise<ResultadoDeInvitacion> {
  const email = minuscula(entrada.email);
  const generar = entrada.generarToken ?? (() => generarTokenOpaco(entrada.azar));
  const pendiente = await tx.invitacion.findFirst({ where: { empresaId: entrada.empresaId, email, estado: "PENDIENTE" } });

  const tipoPendiente = pendiente?.rolEmpresa;
  if (pendiente && tipoPendiente !== TIPO_USUARIO) {
    return { ok: false, mensaje: `Ya hay una invitación pendiente para ${email} que no es de usuario. Revocala o esperá a que se acepte.` };
  }

  if (pendiente && pendiente.venceEn.getTime() > entrada.ahora.getTime()) {
    await sumarAcceso(tx, entrada.empresaId, pendiente.id, entrada.acceso, entrada.invitadoPorId);
    await auditar(tx, { invitacionId: pendiente.id, email, actorId: entrada.invitadoPorId, anterior: "pendiente", nuevo: "pendiente (suma una sucursal)" });
    return { ok: true, invitacionId: pendiente.id, accion: "extendida", token: null };
  }

  if (pendiente) {
    const token = generar();
    await tx.invitacion.update({ where: { id: pendiente.id }, data: { hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), enviadaEn: null, invitadoPorId: entrada.invitadoPorId } });
    await sumarAcceso(tx, entrada.empresaId, pendiente.id, entrada.acceso, entrada.invitadoPorId);
    await auditar(tx, { invitacionId: pendiente.id, email, actorId: entrada.invitadoPorId, anterior: "vencida", nuevo: "pendiente" });
    return { ok: true, invitacionId: pendiente.id, accion: "rotada", token };
  }

  const token = generar();
  const creada = await tx.invitacion.create({
    data: { empresaId: entrada.empresaId, email, rolEmpresa: TIPO_USUARIO, hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), invitadoPorId: entrada.invitadoPorId },
  });
  await sumarAcceso(tx, entrada.empresaId, creada.id, entrada.acceso, entrada.invitadoPorId);
  await auditar(tx, { invitacionId: creada.id, email, actorId: entrada.invitadoPorId, anterior: null, nuevo: "pendiente" });
  return { ok: true, invitacionId: creada.id, accion: "creada", token };
}

/**
 * Deja una invitación de VINCULACIÓN pendiente para `email` (un usuario que ya es miembro de la empresa y todavía no entró con Google). Sin pendiente, la crea y devuelve el token;
 * con una vigente no devuelve token (reenviar es una acción aparte que rota); con una vencida la rota. Una pendiente de otro tipo lo impide.
 */
export async function asegurarInvitacionDeVinculacion(tx: Tx, entrada: { empresaId: string; email: string; invitadoPorId: string } & Reloj): Promise<ResultadoDeInvitacion> {
  const email = minuscula(entrada.email);
  const generar = entrada.generarToken ?? (() => generarTokenOpaco(entrada.azar));
  const pendiente = await tx.invitacion.findFirst({ where: { empresaId: entrada.empresaId, email, estado: "PENDIENTE" } });

  const tipoPendiente = pendiente?.rolEmpresa;
  if (pendiente && tipoPendiente !== TIPO_VINCULACION) {
    return { ok: false, mensaje: `Ya hay una invitación pendiente para ${email} que no es de vinculación.` };
  }
  if (pendiente && pendiente.venceEn.getTime() > entrada.ahora.getTime()) return { ok: true, invitacionId: pendiente.id, accion: "extendida", token: null };

  if (pendiente) {
    const token = generar();
    await tx.invitacion.update({ where: { id: pendiente.id }, data: { hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), enviadaEn: null, invitadoPorId: entrada.invitadoPorId } });
    await auditar(tx, { invitacionId: pendiente.id, email, actorId: entrada.invitadoPorId, anterior: "vencida", nuevo: "pendiente" });
    return { ok: true, invitacionId: pendiente.id, accion: "rotada", token };
  }

  const token = generar();
  const creada = await tx.invitacion.create({
    data: { empresaId: entrada.empresaId, email, rolEmpresa: TIPO_VINCULACION, hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), invitadoPorId: entrada.invitadoPorId },
  });
  await auditar(tx, { invitacionId: creada.id, email, actorId: entrada.invitadoPorId, anterior: null, nuevo: "pendiente" });
  return { ok: true, invitacionId: creada.id, accion: "creada", token };
}

/**
 * Reenviar: rota el token (el enlace anterior deja de servir), renueva el vencimiento y VUELVE A FIRMAR la invitación y todas sus sucursales a nombre de `actorId`. Quien llama ya
 * verificó que `actorId` puede otorgar TODAS esas sucursales con sus roles: es la salida cuando quien invitó perdió el permiso.
 */
export async function rotarInvitacionPendiente(tx: Tx, entrada: { empresaId: string; invitacionId: string; actorId: string } & Reloj): Promise<ResultadoDeInvitacion> {
  const generar = entrada.generarToken ?? (() => generarTokenOpaco(entrada.azar));
  const inv = await tx.invitacion.findFirst({ where: { id: entrada.invitacionId, empresaId: entrada.empresaId, estado: "PENDIENTE", rolEmpresa: { in: ["usuario", "vinculacion"] } } });
  if (!inv) return { ok: false, mensaje: "No se encontró esa invitación pendiente." };
  const token = generar();
  await tx.invitacion.update({ where: { id: inv.id }, data: { hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), enviadaEn: null, invitadoPorId: entrada.actorId } });
  await tx.invitacionSucursal.updateMany({ where: { invitacionId: inv.id }, data: { invitadoPorId: entrada.actorId } });
  await auditar(tx, { invitacionId: inv.id, email: inv.email, actorId: entrada.actorId, anterior: "pendiente", nuevo: "pendiente (reenviada)" });
  return { ok: true, invitacionId: inv.id, accion: "rotada", token };
}

/** Revoca una invitación de usuario o de vinculación pendiente (el enlace deja de servir). `false` si no había nada que revocar. */
export async function revocarInvitacionPendiente(tx: Tx, entrada: { empresaId: string; invitacionId: string; actorId: string; ahora: Date }): Promise<boolean> {
  const inv = await tx.invitacion.findFirst({ where: { id: entrada.invitacionId, empresaId: entrada.empresaId, estado: "PENDIENTE", rolEmpresa: { in: ["usuario", "vinculacion"] } } });
  if (!inv) return false;
  const r = await tx.invitacion.updateMany({ where: { id: inv.id, estado: "PENDIENTE" }, data: { estado: "REVOCADA", revocadaEn: entrada.ahora } });
  if (r.count !== 1) return false;
  await auditar(tx, { invitacionId: inv.id, email: inv.email, actorId: entrada.actorId, anterior: "pendiente", nuevo: "revocada" });
  return true;
}
