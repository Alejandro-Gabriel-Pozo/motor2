import type { Prisma, PrismaClient } from "@prisma/client";
import type { MensajeDeCorreo, ResultadoDeEnvio } from "@/core/correo/tipos";
import { altaDeEmpresaSchema } from "@/core/features/empresa/empresa.schema";
import { enlaceDeInvitacion, estadoEfectivoDeInvitacion, mensajeDeInvitacion, vencimientoDeInvitacion, type EstadoEfectivoDeInvitacion } from "@/core/features/empresa/invitacion";
import { cuitsRepetidos, tieneCuitPendiente } from "@/core/features/empresa/ciclo-de-vida";
import { sembrarEmpresa } from "@/core/features/empresa/sembrar-empresa";
import { esEmailReservadoDeAdminPlataforma, MENSAJE_EMAIL_RESERVADO, normalizarEmail } from "@/core/plataforma/email-reservado";
import { generarTokenOpaco, hashDeToken } from "@/core/seguridad/tokens";
import { auditarEnTransaccion, type AutorEnInstalacion } from "./auditoria";

/**
 * Alta de empresas e invitaciones desde la consola (E5, ADR-012 §6, ADR-020). Cada función recibe la base, el autor y sus dependencias: la consola les pasa
 * la conexión de `motor2_plataforma`, el reloj y el envío de mails reales; los tests, la del dueño y un envío falso.
 *
 * Reglas que valen en todas:
 *  - El cambio y su fila de auditoría (con el administrador como autor) se escriben en UNA transacción: no hay cambio sin rastro (ADR-012 §5).
 *  - El mail sale DESPUÉS de que la transacción se confirmó, nunca adentro: si la transacción falla o se reintenta, no sale ningún mail. Si el envío falla, la acción
 *    queda hecha y se reenvía a mano (canal de avisos, ADR-018): el resultado dice `enviado: false`.
 *  - El token solo existe en memoria y en el mail: la base guarda su SHA-256 y la auditoría no lo lleva.
 *  - El email de un administrador de plataforma no puede ser invitado como gerente (ADR-012 §1): se rechaza al crear, al reenviar y al invitar de nuevo.
 */
export interface DependenciasDeEmpresas {
  ahora: () => Date;
  /** Dirección pública de la app de empresas de ESTA instalación (ADR-025), a la que apunta el enlace del mail. */
  urlApp: string;
  /**
   * Los emails de los administradores de plataforma. Viven en la base de IDENTIDAD (la de la instalación principal), no en la de la instalación operada, así que se leen
   * AFUERA de la transacción de operación: dentro, en otra instalación, esa tabla está vacía y el control «un administrador no puede ser gerente» se apagaría en silencio.
   */
  emailsDeAdmins: () => Promise<readonly string[]>;
  generarToken?: () => string;
  enviar: (mensaje: MensajeDeCorreo) => Promise<ResultadoDeEnvio>;
}

type Db = PrismaClient;
export type ResultadoDeEmpresa = { ok: true; empresaId: string; enviado: boolean; mensaje: string } | { ok: false; mensaje: string };

const MENSAJE_SIN_ENVIO = "La invitación quedó creada pero el mail no salió. Reenviala desde el detalle de la empresa.";

/** `null` si el email puede ser invitado; si no, el motivo. Una cuenta desactivada a nivel global no entraría igual (kill-switch): se avisa antes. */
async function problemaDelEmail(tx: Pick<Prisma.TransactionClient, "user">, reservados: readonly string[], email: string): Promise<string | null> {
  if (esEmailReservadoDeAdminPlataforma(email, reservados)) return MENSAJE_EMAIL_RESERVADO;
  const usuario = await tx.user.findUnique({ where: { email }, select: { activoGlobal: true } });
  if (usuario && !usuario.activoGlobal) return "Esa persona tiene la cuenta desactivada en toda la plataforma: no podría entrar aunque la inviten.";
  return null;
}

function mensajeParaElInvitado(empresa: { nombre: string; zonaHoraria: string }, email: string, token: string, venceEn: Date, deps: DependenciasDeEmpresas): MensajeDeCorreo {
  return mensajeDeInvitacion({ email, nombreEmpresa: empresa.nombre, enlace: enlaceDeInvitacion(deps.urlApp, token), venceEn, zonaHoraria: empresa.zonaHoraria });
}

/** Manda el mail DESPUÉS del commit y, si salió, lo anota (`enviadaEn`). Nunca lanza: un envío que falla es `false`. */
async function enviarYAnotar(db: Db, deps: DependenciasDeEmpresas, invitacionId: string, mensaje: MensajeDeCorreo): Promise<boolean> {
  let resultado: ResultadoDeEnvio;
  try {
    resultado = await deps.enviar(mensaje);
  } catch {
    return false;
  }
  if (!resultado.ok) return false;
  try {
    await db.invitacion.update({ where: { id: invitacionId }, data: { enviadaEn: deps.ahora() } });
  } catch {
    // El mail salió; solo falló anotarlo. La lista seguirá diciendo «sin enviar» y reenviar es inofensivo.
  }
  return true;
}

function resultadoDeEnvio(empresaId: string, enviado: boolean, mensajeOk: string): ResultadoDeEmpresa {
  return { ok: true, empresaId, enviado, mensaje: enviado ? mensajeOk : MENSAJE_SIN_ENVIO };
}

export async function darDeAltaEmpresa(db: Db, deps: DependenciasDeEmpresas, autor: AutorEnInstalacion, entrada: unknown): Promise<ResultadoDeEmpresa> {
  const parseo = altaDeEmpresaSchema.safeParse(entrada);
  if (!parseo.success) return { ok: false, mensaje: parseo.error.issues.map((i) => i.message).join(" ") };
  const { nombre, slug, zonaHoraria, moneda, nombreSucursal, emailDuenio } = parseo.data;

  const ahora = deps.ahora();
  const token = (deps.generarToken ?? generarTokenOpaco)();
  const venceEn = vencimientoDeInvitacion(ahora);
  const reservados = await deps.emailsDeAdmins();

  type Hecho = { ok: true; empresaId: string; invitacionId: string } | { ok: false; mensaje: string };
  const hecho: Hecho = await db.$transaction(
    async (tx): Promise<Hecho> => {
      const problema = await problemaDelEmail(tx, reservados, emailDuenio);
      if (problema) return { ok: false, mensaje: problema };
      const existente = await tx.empresa.findFirst({ where: { OR: [{ slug }, { nombre }] }, select: { slug: true } });
      if (existente) return { ok: false, mensaje: existente.slug === slug ? `Ya existe una empresa con el slug «${slug}».` : `Ya existe una empresa con el nombre «${nombre}».` };

      const { id: empresaId } = await tx.empresa.create({ data: { nombre, slug, zonaHoraria, moneda, estado: "PROVISIONING" } });
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
      await sembrarEmpresa(tx, empresaId, nombreSucursal);
      const invitacion = await tx.invitacion.create({
        data: { empresaId, email: emailDuenio, rolEmpresa: "gerente", hashToken: hashDeToken(token), venceEn },
        select: { id: true },
      });
      await auditarEnTransaccion(tx, autor, "alta-de-empresa", empresaId, { slug, zonaHoraria, moneda });
      return { ok: true, empresaId, invitacionId: invitacion.id };
    },
    { timeout: 30_000 },
  );
  if (!hecho.ok) return hecho;

  const enviado = await enviarYAnotar(db, deps, hecho.invitacionId, mensajeParaElInvitado({ nombre, zonaHoraria }, emailDuenio, token, venceEn, deps));
  return resultadoDeEnvio(hecho.empresaId, enviado, `Empresa «${nombre}» dada de alta. Le mandamos la invitación a ${emailDuenio}.`);
}

/** Datos de la empresa y de su invitación vigente (la pendiente, o si no hay, la última). */
async function empresaEnAltaConInvitacion(tx: Prisma.TransactionClient, empresaId: string) {
  const empresa = await tx.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true, zonaHoraria: true, estado: true } });
  if (!empresa) return null;
  const invitacion = await tx.invitacion.findFirst({ where: { empresaId, rolEmpresa: "gerente" }, orderBy: { creadaEn: "desc" } });
  return { empresa, invitacion };
}

/**
 * Reenvía la invitación pendiente: genera un token NUEVO (el enlace anterior deja de servir), renueva el vencimiento y manda el mail. Sirve también para una
 * vencida, que sigue «pendiente» en la base.
 */
export async function reenviarInvitacion(db: Db, deps: DependenciasDeEmpresas, autor: AutorEnInstalacion, empresaId: string): Promise<ResultadoDeEmpresa> {
  const ahora = deps.ahora();
  const token = (deps.generarToken ?? generarTokenOpaco)();
  const venceEn = vencimientoDeInvitacion(ahora);
  const reservados = await deps.emailsDeAdmins();

  type Hecho = { ok: true; invitacionId: string; email: string; empresa: { nombre: string; zonaHoraria: string } } | { ok: false; mensaje: string };
  const hecho: Hecho = await db.$transaction(async (tx): Promise<Hecho> => {
    const datos = await empresaEnAltaConInvitacion(tx, empresaId);
    if (!datos) return { ok: false, mensaje: "La empresa no existe." };
    if (!datos.invitacion || datos.invitacion.estado !== "PENDIENTE") return { ok: false, mensaje: "No hay una invitación pendiente para reenviar. Invitá de nuevo." };
    const problema = await problemaDelEmail(tx, reservados, datos.invitacion.email);
    if (problema) return { ok: false, mensaje: problema };
    const cambio = await tx.invitacion.updateMany({
      where: { id: datos.invitacion.id, estado: "PENDIENTE" },
      data: { hashToken: hashDeToken(token), venceEn, enviadaEn: null },
    });
    if (cambio.count !== 1) return { ok: false, mensaje: "La invitación cambió mientras tanto. Recargá la pantalla." };
    await auditarEnTransaccion(tx, autor, "invitacion-reenviada", empresaId, { vencida: datos.invitacion.venceEn.getTime() <= ahora.getTime() });
    return { ok: true, invitacionId: datos.invitacion.id, email: datos.invitacion.email, empresa: datos.empresa };
  });
  if (!hecho.ok) return hecho;

  const enviado = await enviarYAnotar(db, deps, hecho.invitacionId, mensajeParaElInvitado(hecho.empresa, hecho.email, token, venceEn, deps));
  return resultadoDeEnvio(empresaId, enviado, `Invitación reenviada a ${hecho.email}. El enlace anterior ya no sirve.`);
}

/** Revoca la invitación pendiente: el enlace deja de servir. La empresa queda en alta, sin gerente, hasta que se invite de nuevo. */
export async function revocarInvitacion(db: Db, autor: AutorEnInstalacion, empresaId: string, ahora: Date): Promise<{ ok: boolean; mensaje: string }> {
  return db.$transaction(async (tx) => {
    const datos = await empresaEnAltaConInvitacion(tx, empresaId);
    if (!datos?.invitacion || datos.invitacion.estado !== "PENDIENTE") return { ok: false, mensaje: "No hay una invitación pendiente para revocar." };
    const cambio = await tx.invitacion.updateMany({ where: { id: datos.invitacion.id, estado: "PENDIENTE" }, data: { estado: "REVOCADA", revocadaEn: ahora } });
    if (cambio.count !== 1) return { ok: false, mensaje: "La invitación cambió mientras tanto. Recargá la pantalla." };
    await auditarEnTransaccion(tx, autor, "invitacion-revocada", empresaId, {});
    return { ok: true, mensaje: "Invitación revocada: el enlace ya no sirve." };
  });
}

/**
 * Invita a otro email (o al mismo, si la anterior se perdió): revoca la pendiente que hubiera y crea una nueva, en una sola transacción. Solo para una empresa que
 * sigue en alta y todavía no tiene gerente: es la salida cuando el email se escribió mal.
 */
export async function invitarDeNuevo(db: Db, deps: DependenciasDeEmpresas, autor: AutorEnInstalacion, empresaId: string, emailCrudo: string): Promise<ResultadoDeEmpresa> {
  const parseo = altaDeEmpresaSchema.shape.emailDuenio.safeParse(emailCrudo);
  if (!parseo.success) return { ok: false, mensaje: "Ese email no es válido." };
  const email = normalizarEmail(parseo.data);
  const ahora = deps.ahora();
  const token = (deps.generarToken ?? generarTokenOpaco)();
  const venceEn = vencimientoDeInvitacion(ahora);
  const reservados = await deps.emailsDeAdmins();

  type Hecho = { ok: true; invitacionId: string; empresa: { nombre: string; zonaHoraria: string } } | { ok: false; mensaje: string };
  const hecho: Hecho = await db.$transaction(async (tx): Promise<Hecho> => {
    const datos = await empresaEnAltaConInvitacion(tx, empresaId);
    if (!datos) return { ok: false, mensaje: "La empresa no existe." };
    if (datos.empresa.estado !== "PROVISIONING") return { ok: false, mensaje: "Solo se puede invitar de nuevo a una empresa que sigue en alta." };
    if (datos.invitacion?.estado === "ACEPTADA") return { ok: false, mensaje: "La invitación ya fue aceptada: la empresa tiene gerente." };
    const problema = await problemaDelEmail(tx, reservados, email);
    if (problema) return { ok: false, mensaje: problema };
    await tx.invitacion.updateMany({ where: { empresaId, rolEmpresa: "gerente", estado: "PENDIENTE" }, data: { estado: "REVOCADA", revocadaEn: ahora } });
    const nueva = await tx.invitacion.create({ data: { empresaId, email, rolEmpresa: "gerente", hashToken: hashDeToken(token), venceEn }, select: { id: true } });
    await auditarEnTransaccion(tx, autor, "invitacion-creada", empresaId, { revocoLaAnterior: datos.invitacion?.estado === "PENDIENTE" });
    return { ok: true, invitacionId: nueva.id, empresa: datos.empresa };
  });
  if (!hecho.ok) return hecho;

  const enviado = await enviarYAnotar(db, deps, hecho.invitacionId, mensajeParaElInvitado(hecho.empresa, email, token, venceEn, deps));
  return resultadoDeEnvio(empresaId, enviado, `Invitación enviada a ${email}.`);
}

export type FiltroDeEmpresas = "todas" | "cuit-pendiente" | "en-alta" | "activas" | "activas-sin-cuit" | "suspendidas";
export const FILTROS_DE_EMPRESAS: readonly FiltroDeEmpresas[] = ["todas", "cuit-pendiente", "en-alta", "activas", "activas-sin-cuit", "suspendidas"];

export interface FilaDeEmpresa {
  id: string;
  nombre: string;
  slug: string;
  estado: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DELETING";
  cuit: string | null;
  invitacion: {
    email: string;
    estado: EstadoEfectivoDeInvitacion;
    venceEn: Date;
    enviada: boolean;
    cuitDeclarado: string | null;
  } | null;
  /** Nombres de las OTRAS empresas que tienen o declararon el mismo CUIT: la plataforma tiene que decidir cuál es la real. */
  cuitRepetidoCon: string[];
}

type FilaCruda = {
  id: string;
  nombre: string;
  slug: string;
  estado: FilaDeEmpresa["estado"];
  cuit: string | null;
  invitacionRel: Array<{ email: string; estado: "PENDIENTE" | "ACEPTADA" | "REVOCADA"; venceEn: Date; enviadaEn: Date | null; cuitDeclarado: string | null }>;
};

/** El CUIT con el que la empresa compite: el confirmado, o —si está en alta y su gerente aceptó— el que declaró. */
function cuitEnJuego(f: FilaDeEmpresa): string | null {
  if (f.cuit) return f.cuit;
  return f.estado === "PROVISIONING" && f.invitacion?.estado === "ACEPTADA" ? f.invitacion.cuitDeclarado : null;
}

function filaDe(e: FilaCruda, ahora: Date): FilaDeEmpresa {
  const i = e.invitacionRel[0];
  return {
    id: e.id,
    nombre: e.nombre,
    slug: e.slug,
    estado: e.estado,
    cuit: e.cuit,
    invitacion: i ? { email: i.email, estado: estadoEfectivoDeInvitacion(i, ahora), venceEn: i.venceEn, enviada: i.enviadaEn !== null, cuitDeclarado: i.cuitDeclarado } : null,
    cuitRepetidoCon: [],
  };
}

/** Marca en cada fila cuáles otras empresas comparten su CUIT (confirmado o declarado). */
function marcarRepetidos(filas: FilaDeEmpresa[]): FilaDeEmpresa[] {
  const grupos = cuitsRepetidos(filas.map((f) => ({ id: f.id, cuit: cuitEnJuego(f) })));
  const nombrePorId = new Map(filas.map((f) => [f.id, f.nombre]));
  return filas.map((f) => {
    const cuit = cuitEnJuego(f);
    const ids = cuit ? (grupos.get(cuit) ?? []) : [];
    return { ...f, cuitRepetidoCon: ids.filter((id) => id !== f.id).map((id) => nombrePorId.get(id) ?? id) };
  });
}

const SELECCION = {
  id: true,
  nombre: true,
  slug: true,
  estado: true,
  cuit: true,
  invitacionRel: { where: { rolEmpresa: "gerente" }, orderBy: { creadaEn: "desc" as const }, take: 1, select: { email: true, estado: true, venceEn: true, enviadaEn: true, cuitDeclarado: true } },
} satisfies Prisma.EmpresaSelect;

function coincideConElFiltro(f: FilaDeEmpresa, filtro: FiltroDeEmpresas): boolean {
  switch (filtro) {
    case "todas":
      return true;
    case "cuit-pendiente":
      return tieneCuitPendiente(f);
    case "en-alta":
      return f.estado === "PROVISIONING";
    case "activas":
      return f.estado === "ACTIVE";
    case "activas-sin-cuit":
      return f.estado === "ACTIVE" && f.cuit === null;
    case "suspendidas":
      return f.estado === "SUSPENDED";
  }
}

/** Las empresas de la instalación (el rol de plataforma no tiene RLS sobre `Empresa`) con su última invitación y los CUIT repetidos, filtradas. */
export async function listarEmpresas(db: Db, ahora: Date, filtro: FiltroDeEmpresas = "todas"): Promise<FilaDeEmpresa[]> {
  const filas = await db.empresa.findMany({ select: SELECCION, orderBy: { creadoEn: "desc" } });
  return marcarRepetidos(filas.map((f) => filaDe(f, ahora))).filter((f) => coincideConElFiltro(f, filtro));
}

/** Cuántas empresas esperan que la plataforma confirme su CUIT. */
export async function contarCuitPendiente(db: Db, ahora: Date): Promise<number> {
  return (await listarEmpresas(db, ahora, "cuit-pendiente")).length;
}

export async function obtenerEmpresa(db: Db, empresaId: string, ahora: Date): Promise<FilaDeEmpresa | null> {
  const todas = await listarEmpresas(db, ahora);
  return todas.find((f) => f.id === empresaId) ?? null;
}

/** La historia de la empresa en la auditoría de plataforma (lo más reciente primero). */
export async function historialDeEmpresa(db: Db, empresaId: string) {
  return db.auditoriaPlataforma.findMany({ where: { empresaAfectadaId: empresaId }, orderBy: { creadoEn: "desc" }, take: 50, select: { id: true, accion: true, adminEmail: true, creadoEn: true, detalle: true } });
}
