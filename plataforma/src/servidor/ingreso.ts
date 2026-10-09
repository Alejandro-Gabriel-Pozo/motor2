import { azarDelProceso } from "@/lib/azar";
import type { PrismaClient } from "@prisma/client";
import { esDireccionValida } from "@/core/correo/direcciones";
import type { MensajeDeCorreo } from "@/core/correo/tipos";
import { generarCodigoDeIngreso, hashDeCodigo, hashDeCodigoDeRecuperacion, hashesIguales } from "@/core/plataforma/codigos";
import { generarTokenOpaco, hashDeToken } from "@/core/seguridad/tokens";
import { descifrarSecreto } from "@/core/plataforma/cifrado";
import { normalizarEmail } from "@/core/plataforma/email-reservado";
import type { PedidoDeIngreso } from "@/core/plataforma/pedido-de-ingreso";
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
 *  - El código del mail pertenece al NAVEGADOR que lo pidió (S-08): se comprueba con el `PedidoDeIngreso` de su cookie (ver `core/plataforma/pedido-de-ingreso.ts`), nunca
 *    como «el último vigente del administrador». Un anónimo que conoce el email de un administrador no le invalida el código, no le gasta los intentos y no le quita
 *    el cupo de pedidos que el administrador alcanza a usar (el tope se cuenta bajo el cerrojo de su fila).
 */
export interface DependenciasDeIngreso {
  ahora: () => Date;
  /** `PLATAFORMA_SECRETO_CODIGOS` (≥ 32 caracteres). */
  secretoDeCodigos: string;
  /** `PLATAFORMA_CLAVE_TOTP` (32 bytes en base64). */
  claveTotp: string;
}

type Db = PrismaClient;

/** El contexto del HMAC: ata el hash al administrador, al código y al navegador que lo pidió (el nonce vive solo en su cookie, no en la base). */
const contextoDeIngreso = (adminId: string, codigoId: string, nonce: string) => `ingreso:${adminId}:${codigoId}:${nonce}`;

/** Para que verificar haga las mismas consultas y la misma cuenta de HMAC cuando no hay pedido o no hay administrador: no existe ningún código con este id. */
const CODIGO_ID_INEXISTENTE = "0".repeat(32);

/**
 * Paso 1a: arma el mail con el código para ese email y lo ata al `pedido` (la cookie del navegador que lo pide), o `null` si no hay nada que mandar (el email no
 * es de un administrador activo, o ya se pidieron demasiados códigos esta hora). Quien llama responde SIEMPRE lo mismo, haya o no mensaje, y corre ESTA función
 * después de responder (en `after()`): ni el contenido ni el tiempo de la respuesta delatan qué emails son de administradores (B-C15).
 *
 * El tope por hora se cuenta DENTRO de la transacción, bajo el cerrojo de la fila del administrador (`FOR UPDATE`): pedidos en paralelo se hacen la cola y ninguno
 * supera el tope (antes se contaba antes de crear y los paralelos lo pasaban). Un código nuevo ya NO invalida los anteriores: cada uno es de su navegador, y un
 * pedido de un anónimo no le toca el código vigente al administrador.
 */
export async function prepararCodigoDeIngreso(db: Db, deps: DependenciasDeIngreso, emailCrudo: string, pedido: PedidoDeIngreso): Promise<MensajeDeCorreo | null> {
  const email = normalizarEmail(emailCrudo);
  if (!esDireccionValida(email)) return null;

  const ahora = deps.ahora();
  const codigo = generarCodigoDeIngreso(azarDelProceso);
  const admin = await db.$transaction(async (tx) => {
    const filas = await tx.$queryRaw<Array<{ id: string; email: string }>>`SELECT id, email FROM "AdminPlataforma" WHERE email = ${email} AND activo = true FOR UPDATE`;
    const encontrado = filas[0];
    if (!encontrado) return null;
    const pedidos = await tx.codigoDeIngresoPlataforma.count({ where: { adminId: encontrado.id, creadoEn: { gt: new Date(ahora.getTime() - VENTANA_DE_PEDIDOS_MS) } } });
    if (pedidos >= MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA) return null;
    await tx.codigoDeIngresoPlataforma.create({
      data: {
        id: pedido.codigoId,
        adminId: encontrado.id,
        hashCodigo: hashDeCodigo(codigo, deps.secretoDeCodigos, contextoDeIngreso(encontrado.id, pedido.codigoId, pedido.nonce)),
        creadoEn: ahora,
        venceEn: new Date(ahora.getTime() + VIDA_DEL_CODIGO_DE_INGRESO_MS),
      },
    });
    return encontrado;
  });
  if (!admin) return null;

  const minutos = VIDA_DEL_CODIGO_DE_INGRESO_MS / 60_000;
  return {
    para: [admin.email],
    asunto: "Tu código de ingreso a la consola de plataforma",
    texto: `Tu código de ingreso es ${codigo}.\n\nVence en ${minutos} minutos y sirve una sola vez. Si no lo pediste vos, ignorá este mensaje: sin tu segundo factor nadie puede entrar.`,
  };
}

export type ResultadoPrimerFactor = { ok: true; token: string } | { ok: false };

/**
 * Paso 1b: verifica el código del mail contra el código de SU pedido (`pedido`, la cookie del navegador que lo pidió; `null` si no la trae). Si acierta, abre una
 * sesión PENDIENTE (todavía sin segundo factor) y devuelve su token para la cookie.
 *
 * Todo fallo hace EXACTAMENTE las mismas consultas y la misma cuenta de HMAC —no hay administrador, no hay fila de ese pedido, el email es de otro, venció o está
 * agotado, el código está mal—: cualquier camino que saliera antes dejaría a un anónimo medir el tiempo de respuesta y averiguar qué emails son de administradores.
 * Los intentos que gasta un anónimo son los de SUS códigos (los ata a su cookie), no los del código vigente del administrador.
 */
export async function verificarCodigoDeIngreso(db: Db, deps: DependenciasDeIngreso, emailCrudo: string, codigoCrudo: string, pedido: PedidoDeIngreso | null): Promise<ResultadoPrimerFactor> {
  const email = normalizarEmail(emailCrudo);
  const codigo = codigoCrudo.replace(/\s/g, "");
  const ahora = deps.ahora();
  const codigoId = pedido?.codigoId ?? CODIGO_ID_INEXISTENTE;
  const delAdministrador = { email, activo: true };

  const fila = await db.codigoDeIngresoPlataforma.findFirst({
    where: { id: codigoId, usadoEn: null, invalidadoEn: null, admin: delAdministrador },
    select: { adminId: true, creadoEn: true, hashCodigo: true },
  });

  // Se reserva un intento (atómico: cuenta solo si quedaba alguno) y recién después se compara. Sin fila no cuenta ninguno, pero la consulta se hace igual.
  const reservado = await db.codigoDeIngresoPlataforma.updateMany({
    where: { id: codigoId, usadoEn: null, invalidadoEn: null, intentosFallidos: { lt: MAXIMO_DE_INTENTOS_POR_CODIGO }, admin: delAdministrador },
    data: { intentosFallidos: { increment: 1 } },
  });

  const esperado = hashDeCodigo(codigo, deps.secretoDeCodigos, contextoDeIngreso(fila?.adminId ?? "", codigoId, pedido?.nonce ?? ""));
  const acierta = fila !== null && !codigoVencido(fila.creadoEn, ahora) && reservado.count === 1 && /^\d{6}$/.test(codigo) && hashesIguales(esperado, fila.hashCodigo);
  if (!acierta) return { ok: false };

  // Usarlo es atómico: dos pedidos con el código correcto no abren dos sesiones.
  const usado = await db.codigoDeIngresoPlataforma.updateMany({ where: { id: codigoId, usadoEn: null, invalidadoEn: null }, data: { usadoEn: ahora } });
  if (usado.count !== 1) return { ok: false };

  const token = generarTokenOpaco(azarDelProceso);
  await db.sesionPlataforma.create({ data: { adminId: fila.adminId, hashToken: hashDeToken(token), creadaEn: ahora, ultimaActividad: ahora } });
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
    const token = generarTokenOpaco(azarDelProceso);
    await tx.sesionPlataforma.update({ where: { id: sesion.id }, data: { hashToken: hashDeToken(token), creadaEn: ahora, ultimaActividad: ahora, segundoFactorEn: ahora } });
    return { ok: true, token, ...quien, vencimiento: vencimientoDeSesion(ahora) };
  });
}
