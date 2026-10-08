import "server-only";
import type { Prisma } from "@prisma/client";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { generarTokenOpaco, hashDeToken } from "@/core/seguridad/tokens";
import { decidirSobreLaInvitacionPendiente, vencimientoDeInvitacion, type TipoDeInvitacion } from "@/core/features/empresa/invitacion";
import {
  crearInvitacion,
  refirmarSucursalesDeInvitacion,
  renovarTokenDeInvitacion,
  revocarInvitacionSiSiguePendiente,
  sumarAccesoAInvitacion,
  type AccesoDeLaInvitacion,
} from "@/server/persistencia/auth/invitaciones-de-usuario";

/**
 * Crear, extender, volver a firmar y revocar invitaciones de USUARIO y de VINCULACIÓN (E8, ADR-024) dentro de una transacción de la empresa. La invitación es una
 * credencial de vinculación: prueba que quien entra controla el buzón del email invitado. NO crea `User` ni membresías (eso pasa al aceptar). El permiso de quien invita lo
 * verifica quien llama (el gate de `gestion_usuarios` y el techo de privilegio); acá solo se mantiene el estado y su auditoría. El mail NO se manda acá: sale DESPUÉS del
 * commit (ADR-018), con el token que devuelven estas funciones (que solo existe en memoria: en la base queda el hash).
 *
 * PASO COMPARTIDO (sin ficha: lo componen los casos de uso de esta carpeta). Hito 3, Fase I: el archivo vivía en `core/features/empresa/invitacion-de-usuario.ts`
 * (heredado del núcleo: escribía la base); en I.5e se mudó entero acá y en I.5e2 se partió, con los MISMOS nombres y firmas (las huellas, los tests de persistencia y
 * `prisma/seed.ts` —bajo `tsx --conditions=react-server`, por el `server-only`— los llaman directo): la decisión vigente/vencida/otro tipo es la función pura
 * `decidirSobreLaInvitacionPendiente` (`core/features/empresa/invitacion.ts`), las escrituras están en `server/persistencia/auth/invitaciones-de-usuario.ts`, y acá
 * quedan las lecturas, el token, la composición y la auditoría, en el mismo orden que antes.
 */
type Tx = Prisma.TransactionClient;

const TIPO_USUARIO: Extract<TipoDeInvitacion, "usuario"> = "usuario";
const TIPO_VINCULACION: Extract<TipoDeInvitacion, "vinculacion"> = "vinculacion";

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

/** La pendiente de una lectura, como la pide la decisión pura (`rolEmpresa` es el TIPO de la invitación). */
const comoPendiente = (fila: { rolEmpresa: string; venceEn: Date } | null) => (fila ? { tipo: fila.rolEmpresa, venceEn: fila.venceEn } : null);

/**
 * Deja una invitación de USUARIO pendiente para `email` con el acceso pedido (una sucursal y su rol):
 *  - no hay ninguna: la crea con su fila de sucursal y devuelve el token (hay que mandar el mail);
 *  - hay una de usuario vigente: suma o actualiza la sucursal y NO devuelve token (el enlace ya enviado cubre la sucursal nueva: no se manda otro mail);
 *  - hay una de usuario vencida: rota el token, suma la sucursal y devuelve el token (hay que mandar el mail);
 *  - hay una de gerente o de vinculación pendiente: no se puede, lo explica.
 */
export async function asegurarInvitacionDeUsuario(tx: Tx, entrada: { empresaId: string; email: string; invitadoPorId: string; acceso: AccesoDeLaInvitacion } & Reloj): Promise<ResultadoDeInvitacion> {
  const email = minuscula(entrada.email);
  const generar = entrada.generarToken ?? (() => generarTokenOpaco(entrada.azar));
  const pendiente = await tx.invitacion.findFirst({ where: { empresaId: entrada.empresaId, email, estado: "PENDIENTE" } });

  const decision = decidirSobreLaInvitacionPendiente(comoPendiente(pendiente), TIPO_USUARIO, email, entrada.ahora);
  if (decision.accion === "rechazar") return { ok: false, mensaje: decision.mensaje };

  if (pendiente && decision.accion === "extender") {
    await sumarAccesoAInvitacion(tx, { empresaId: entrada.empresaId, invitacionId: pendiente.id, acceso: entrada.acceso, invitadoPorId: entrada.invitadoPorId });
    await auditar(tx, { invitacionId: pendiente.id, email, actorId: entrada.invitadoPorId, anterior: "pendiente", nuevo: "pendiente (suma una sucursal)" });
    return { ok: true, invitacionId: pendiente.id, accion: "extendida", token: null };
  }

  if (pendiente && decision.accion === "rotar") {
    const token = generar();
    await renovarTokenDeInvitacion(tx, { invitacionId: pendiente.id, hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), invitadoPorId: entrada.invitadoPorId });
    await sumarAccesoAInvitacion(tx, { empresaId: entrada.empresaId, invitacionId: pendiente.id, acceso: entrada.acceso, invitadoPorId: entrada.invitadoPorId });
    await auditar(tx, { invitacionId: pendiente.id, email, actorId: entrada.invitadoPorId, anterior: "vencida", nuevo: "pendiente" });
    return { ok: true, invitacionId: pendiente.id, accion: "rotada", token };
  }

  const token = generar();
  const creada = await crearInvitacion(tx, {
    empresaId: entrada.empresaId, email, tipo: "usuario", hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), invitadoPorId: entrada.invitadoPorId,
  });
  await sumarAccesoAInvitacion(tx, { empresaId: entrada.empresaId, invitacionId: creada.id, acceso: entrada.acceso, invitadoPorId: entrada.invitadoPorId });
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

  const decision = decidirSobreLaInvitacionPendiente(comoPendiente(pendiente), TIPO_VINCULACION, email, entrada.ahora);
  if (decision.accion === "rechazar") return { ok: false, mensaje: decision.mensaje };
  if (pendiente && decision.accion === "extender") return { ok: true, invitacionId: pendiente.id, accion: "extendida", token: null };

  if (pendiente && decision.accion === "rotar") {
    const token = generar();
    await renovarTokenDeInvitacion(tx, { invitacionId: pendiente.id, hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), invitadoPorId: entrada.invitadoPorId });
    await auditar(tx, { invitacionId: pendiente.id, email, actorId: entrada.invitadoPorId, anterior: "vencida", nuevo: "pendiente" });
    return { ok: true, invitacionId: pendiente.id, accion: "rotada", token };
  }

  const token = generar();
  const creada = await crearInvitacion(tx, {
    empresaId: entrada.empresaId, email, tipo: "vinculacion", hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), invitadoPorId: entrada.invitadoPorId,
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
  await renovarTokenDeInvitacion(tx, { invitacionId: inv.id, hashToken: hashDeToken(token), venceEn: vencimientoDeInvitacion(entrada.ahora), invitadoPorId: entrada.actorId });
  await refirmarSucursalesDeInvitacion(tx, { invitacionId: inv.id, invitadoPorId: entrada.actorId });
  await auditar(tx, { invitacionId: inv.id, email: inv.email, actorId: entrada.actorId, anterior: "pendiente", nuevo: "pendiente (reenviada)" });
  return { ok: true, invitacionId: inv.id, accion: "rotada", token };
}

/** Revoca una invitación de usuario o de vinculación pendiente (el enlace deja de servir). `false` si no había nada que revocar. */
export async function revocarInvitacionPendiente(tx: Tx, entrada: { empresaId: string; invitacionId: string; actorId: string; ahora: Date }): Promise<boolean> {
  const inv = await tx.invitacion.findFirst({ where: { id: entrada.invitacionId, empresaId: entrada.empresaId, estado: "PENDIENTE", rolEmpresa: { in: ["usuario", "vinculacion"] } } });
  if (!inv) return false;
  const revocadas = await revocarInvitacionSiSiguePendiente(tx, { invitacionId: inv.id, ahora: entrada.ahora });
  if (revocadas !== 1) return false;
  await auditar(tx, { invitacionId: inv.id, email: inv.email, actorId: entrada.actorId, anterior: "pendiente", nuevo: "revocada" });
  return true;
}
