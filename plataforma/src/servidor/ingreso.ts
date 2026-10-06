import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { esDireccionValida } from "@/core/correo/direcciones";
import type { MensajeDeCorreo } from "@/core/correo/tipos";
import { generarCodigoDeIngreso, hashDeCodigo, hashDeCodigoDeRecuperacion, hashesIguales } from "@/core/plataforma/codigos";
import { generarTokenOpaco, hashDeToken } from "@/core/seguridad/tokens";
import { descifrarSecreto } from "@/core/plataforma/cifrado";
import { normalizarEmail } from "@/core/plataforma/email-reservado";
import {
  MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA,
  MAXIMO_DE_INTENTOS_POR_CODIGO,
  VENTANA_DE_PEDIDOS_MS,
  VIDA_DEL_CODIGO_DE_INGRESO_MS,
  bloqueoVigente,
  codigoVencido,
  despuesDeUnAcierto,
  despuesDeUnFallo,
} from "@/core/plataforma/limites";
import { sesionPendienteVigente, vencimientoDeSesion } from "@/core/plataforma/sesion";
import { verificarTotp } from "@/core/plataforma/totp";

/**
 * Los dos factores de ingreso de la consola (ADR-012 §2, ADR-019): 1) un código de 6 dígitos que llega por mail, 2) siempre un TOTP (o un código de
 * recuperación). Cada función recibe la base y el reloj: la consola les pasa la conexión de `motor2_plataforma`, los tests la del dueño.
 *
 * Reglas que valen en todas:
 *  - Quien falla no se entera de POR QUÉ falla: no se distingue «no existe», «está inactivo», «código vencido» ni «código equivocado».
 *  - Nada se guarda ni se devuelve en claro: los códigos se guardan como HMAC con el secreto del servidor, las sesiones como SHA-256 del token.
 *  - Los intentos se reservan de forma atómica ANTES de comparar: mil pedidos en paralelo no consiguen más intentos que los permitidos.
 */
export interface DependenciasDeIngreso {
  ahora: () => Date;
  /** `PLATAFORMA_SECRETO_CODIGOS` (≥ 32 caracteres). */
  secretoDeCodigos: string;
  /** `PLATAFORMA_CLAVE_TOTP` (32 bytes en base64). */
  claveTotp: string;
}

type Db = PrismaClient;

const contextoDeIngreso = (adminId: string, codigoId: string) => `ingreso:${adminId}:${codigoId}`;

/**
 * Paso 1a: arma el mail con el código para ese email, o `null` si no hay nada que mandar (el email no es de un administrador activo, o ya pidió
 * demasiados códigos esta hora). Quien llama responde SIEMPRE lo mismo, haya o no mensaje, y manda el mail después de responder: así la respuesta
 * no delata qué emails son de administradores.
 */
export async function prepararCodigoDeIngreso(db: Db, deps: DependenciasDeIngreso, emailCrudo: string): Promise<MensajeDeCorreo | null> {
  const email = normalizarEmail(emailCrudo);
  if (!esDireccionValida(email)) return null;
  const admin = await db.adminPlataforma.findUnique({ where: { email }, select: { id: true, email: true, activo: true } });
  if (!admin || !admin.activo) return null;

  const ahora = deps.ahora();
  const pedidos = await db.codigoDeIngresoPlataforma.count({ where: { adminId: admin.id, creadoEn: { gt: new Date(ahora.getTime() - VENTANA_DE_PEDIDOS_MS) } } });
  if (pedidos >= MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA) return null;

  const codigo = generarCodigoDeIngreso();
  const id = randomUUID();
  await db.$transaction([
    // Un código nuevo invalida los anteriores que siguieran sin usarse.
    db.codigoDeIngresoPlataforma.updateMany({ where: { adminId: admin.id, usadoEn: null, invalidadoEn: null }, data: { invalidadoEn: ahora } }),
    db.codigoDeIngresoPlataforma.create({
      data: { id, adminId: admin.id, hashCodigo: hashDeCodigo(codigo, deps.secretoDeCodigos, contextoDeIngreso(admin.id, id)), creadoEn: ahora, venceEn: new Date(ahora.getTime() + VIDA_DEL_CODIGO_DE_INGRESO_MS) },
    }),
  ]);

  const minutos = VIDA_DEL_CODIGO_DE_INGRESO_MS / 60_000;
  return {
    para: [admin.email],
    asunto: "Tu código de ingreso a la consola de plataforma",
    texto: `Tu código de ingreso es ${codigo}.\n\nVence en ${minutos} minutos y sirve una sola vez. Si no lo pediste vos, ignorá este mensaje: sin tu segundo factor nadie puede entrar.`,
  };
}

export type ResultadoPrimerFactor = { ok: true; token: string } | { ok: false };

/** Paso 1b: verifica el código del mail. Si acierta, abre una sesión PENDIENTE (todavía sin segundo factor) y devuelve su token para la cookie. */
export async function verificarCodigoDeIngreso(db: Db, deps: DependenciasDeIngreso, emailCrudo: string, codigoCrudo: string): Promise<ResultadoPrimerFactor> {
  const email = normalizarEmail(emailCrudo);
  const codigo = codigoCrudo.replace(/\s/g, "");
  const admin = await db.adminPlataforma.findUnique({ where: { email }, select: { id: true, activo: true } });
  if (!admin || !admin.activo) return { ok: false };

  const ahora = deps.ahora();
  const vigente = await db.codigoDeIngresoPlataforma.findFirst({
    where: { adminId: admin.id, usadoEn: null, invalidadoEn: null },
    orderBy: { creadoEn: "desc" },
    select: { id: true, creadoEn: true, hashCodigo: true },
  });
  if (!vigente || codigoVencido(vigente.creadoEn, ahora)) return { ok: false };

  // Se reserva un intento (atómico: cuenta solo si quedaba alguno) y recién después se compara.
  const reservado = await db.codigoDeIngresoPlataforma.updateMany({
    where: { id: vigente.id, usadoEn: null, invalidadoEn: null, intentosFallidos: { lt: MAXIMO_DE_INTENTOS_POR_CODIGO } },
    data: { intentosFallidos: { increment: 1 } },
  });
  if (reservado.count !== 1) return { ok: false };

  const esperado = hashDeCodigo(codigo, deps.secretoDeCodigos, contextoDeIngreso(admin.id, vigente.id));
  if (!/^\d{6}$/.test(codigo) || !hashesIguales(esperado, vigente.hashCodigo)) return { ok: false };

  // Usarlo es atómico: dos pedidos con el código correcto no abren dos sesiones.
  const usado = await db.codigoDeIngresoPlataforma.updateMany({ where: { id: vigente.id, usadoEn: null, invalidadoEn: null }, data: { usadoEn: ahora } });
  if (usado.count !== 1) return { ok: false };

  const token = generarTokenOpaco();
  await db.sesionPlataforma.create({ data: { adminId: admin.id, hashToken: hashDeToken(token), creadaEn: ahora, ultimaActividad: ahora } });
  return { ok: true, token };
}

export type ResultadoSegundoFactor =
  | { ok: true; token: string; adminId: string; adminEmail: string; vencimiento: Date }
  | { ok: false; motivo: "INCORRECTO" | "BLOQUEADO" | "SESION_INVALIDA"; adminId?: string; adminEmail?: string; seBloqueo?: boolean };

const PARECE_CODIGO_DE_RECUPERACION = /^[A-Za-z2-9]{5}[\s-]?[A-Za-z2-9]{5}$/;

/**
 * Paso 2: verifica el TOTP (o un código de recuperación) de la sesión pendiente. Si acierta, la sesión pasa a vigente CON UN TOKEN NUEVO (el del paso
 * 1 deja de servir: no se reusa una credencial que ya viajó antes de tener el segundo factor) y empieza a contar sus 8 horas.
 *
 * Todo corre bajo el cerrojo de la fila del administrador (`SELECT … FOR UPDATE`): dos pedidos simultáneos se hacen la cola, así que ni el contador de
 * fallos, ni el anti-replay del TOTP, ni el consumo de un código de recuperación tienen carrera.
 */
export async function verificarSegundoFactor(db: Db, deps: DependenciasDeIngreso, tokenPendiente: string, codigoCrudo: string): Promise<ResultadoSegundoFactor> {
  const sesion = await db.sesionPlataforma.findUnique({
    where: { hashToken: hashDeToken(tokenPendiente) },
    select: { id: true, adminId: true, segundoFactorEn: true },
  });
  if (!sesion || sesion.segundoFactorEn !== null) return { ok: false, motivo: "SESION_INVALIDA" };

  return db.$transaction(async (tx): Promise<ResultadoSegundoFactor> => {
    await tx.$queryRaw`SELECT id FROM "AdminPlataforma" WHERE id = ${sesion.adminId} FOR UPDATE`;
    const admin = await tx.adminPlataforma.findUnique({
      where: { id: sesion.adminId },
      select: { id: true, email: true, activo: true, bloqueadoHasta: true, secretoTotp: true, ultimoPasoTotp: true, fallosSegundoFactor: true },
    });
    // Se vuelve a leer la sesión ya con el cerrojo: otro pedido pudo haberla promovido o cerrado mientras tanto.
    const actual = await tx.sesionPlataforma.findUnique({
      where: { id: sesion.id },
      select: { segundoFactorEn: true, creadaEn: true, cerradaEn: true },
    });
    const ahora = deps.ahora();
    if (!admin || !admin.activo || !actual || actual.segundoFactorEn !== null || !sesionPendienteVigente(actual, ahora)) return { ok: false, motivo: "SESION_INVALIDA" };
    const quien = { adminId: admin.id, adminEmail: admin.email };
    if (bloqueoVigente(admin.bloqueadoHasta, ahora)) return { ok: false, motivo: "BLOQUEADO", ...quien };

    const codigo = codigoCrudo.trim();
    const secreto = descifrarSecreto(admin.secretoTotp, deps.claveTotp, admin.id);
    const totp = secreto === null ? ({ ok: false } as const) : verificarTotp(secreto, codigo, ahora.getTime(), admin.ultimoPasoTotp);

    let acierto = false;
    if (totp.ok) {
      await tx.adminPlataforma.update({ where: { id: admin.id }, data: { ultimoPasoTotp: totp.paso } });
      acierto = true;
    } else if (PARECE_CODIGO_DE_RECUPERACION.test(codigo)) {
      const consumido = await tx.codigoDeRecuperacionPlataforma.updateMany({
        where: { adminId: admin.id, hashCodigo: hashDeCodigoDeRecuperacion(codigo, deps.secretoDeCodigos, admin.id), usadoEn: null },
        data: { usadoEn: ahora },
      });
      acierto = consumido.count === 1;
    }

    if (!acierto) {
      const despues = despuesDeUnFallo({ fallos: admin.fallosSegundoFactor, bloqueadoHasta: admin.bloqueadoHasta }, ahora);
      await tx.adminPlataforma.update({ where: { id: admin.id }, data: { fallosSegundoFactor: despues.fallos, bloqueadoHasta: despues.bloqueadoHasta } });
      // Al bloquear, la sesión pendiente se cierra: para volver a intentar hay que empezar de cero (otro código del mail).
      const seBloqueo = despues.bloqueadoHasta !== null && despues.bloqueadoHasta !== admin.bloqueadoHasta;
      if (seBloqueo) await tx.sesionPlataforma.update({ where: { id: sesion.id }, data: { cerradaEn: ahora } });
      return { ok: false, motivo: "INCORRECTO", ...quien, seBloqueo };
    }

    const limpio = despuesDeUnAcierto();
    await tx.adminPlataforma.update({ where: { id: admin.id }, data: { fallosSegundoFactor: limpio.fallos, bloqueadoHasta: limpio.bloqueadoHasta } });
    const token = generarTokenOpaco();
    await tx.sesionPlataforma.update({ where: { id: sesion.id }, data: { hashToken: hashDeToken(token), creadaEn: ahora, ultimaActividad: ahora, segundoFactorEn: ahora } });
    return { ok: true, token, ...quien, vencimiento: vencimientoDeSesion(ahora) };
  });
}
