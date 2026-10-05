import type { Prisma, PrismaClient } from "@prisma/client";
import { confirmarAltaSchema, corregirCuitSchema, mensajeDeEmpresaActiva, motivoSchema } from "@/core/features/empresa/ciclo-de-vida";
import { esTransicionValida, type EstadoEmpresa } from "@/core/features/empresa/empresa.schema";
import { empresaTieneFacturaAutorizada, MENSAJE_CUIT_INMUTABLE } from "@/core/fiscal/factura-autorizada";
import { formatearCuit, validarCuit } from "@/core/fiscal/cuit";
import { esChoqueDeIndiceUnico } from "@/core/movimientos/con-reintento";
import { obtenerGerenteDeEmpresa } from "@/core/permisos/gerencia";
import type { Db } from "@/lib/db-tipos";
import { auditarEnTransaccion, type Autor } from "./auditoria";
import type { DependenciasDeEmpresas } from "./empresas";

/**
 * Ciclo de vida de una empresa desde la consola (E6, ADR-021): confirmar el alta, corregir el CUIT, suspender, reactivar y reenviar el aviso de activación.
 *
 * Las mismas reglas que el alta (`empresas.ts`): el cambio y su fila de auditoría en UNA transacción, el mail DESPUÉS del commit, y el `empresaId` que llega del
 * cliente se vuelve a leer en la transacción (nunca se confía en él). Cada operación toma el cerrojo de SU fila de `Empresa` (`FOR UPDATE`) y cambia el estado con un
 * `UPDATE` condicional: dos pedidos simultáneos sobre la misma empresa no pueden aplicarse los dos. La unicidad del CUIT la decide el índice `Empresa_cuit_key`; antes
 * se mira por si hay otra empresa con ese CUIT, solo para poder decir cuál.
 */
export interface DependenciasDeCicloDeVida extends DependenciasDeEmpresas {
  /** Inyectable para probar la inmutabilidad del CUIT; por defecto, el predicado real (`core/fiscal/factura-autorizada`). */
  tieneFacturaAutorizada?: (db: Db, empresaId: string) => Promise<boolean>;
}

type Cliente = PrismaClient;
export type ResultadoDeCiclo = { ok: true; mensaje: string; enviado?: boolean } | { ok: false; mensaje: string };

export interface FilaBloqueada {
  id: string;
  estado: EstadoEmpresa;
  cuit: string | null;
  nombre: string;
}

/** Toma el cerrojo de la fila de la empresa y la devuelve; `null` si no existe. */
export async function bloquearEmpresa(tx: Prisma.TransactionClient, empresaId: string): Promise<FilaBloqueada | null> {
  const filas = await tx.$queryRaw<FilaBloqueada[]>`SELECT "id", "estado"::text AS "estado", "cuit", "nombre" FROM "Empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
  return filas[0] ?? null;
}

/** El mensaje que nombra a la empresa que ya tiene ese CUIT (la plataforma sí puede ver su nombre). */
async function mensajeDeCuitRepetido(db: Pick<Cliente, "empresa">, cuit: string, excepto: string): Promise<string | null> {
  const otra = await db.empresa.findFirst({ where: { cuit, id: { not: excepto } }, select: { nombre: true, estado: true } });
  if (!otra) return null;
  return `El CUIT ${formatearCuit(cuit)} ya es de «${otra.nombre}» (${ETIQUETA_DE_ESTADO[otra.estado]}). Revisá con la constancia de ARCA cuál es la empresa real; si es esta, primero corregí o quitá el CUIT de «${otra.nombre}».`;
}

const ETIQUETA_DE_ESTADO: Record<EstadoEmpresa, string> = { PROVISIONING: "en alta", ACTIVE: "activa", SUSPENDED: "suspendida", DELETING: "en baja" };

/** Un fallo de unicidad del CUIT que escapó a la comprobación previa (carrera): se traduce al mismo mensaje. */
async function traducirChoqueDeCuit(db: Cliente, e: unknown, cuit: string, empresaId: string): Promise<ResultadoDeCiclo> {
  if (!esChoqueDeIndiceUnico(e)) throw e;
  const mensaje = await mensajeDeCuitRepetido(db, cuit, empresaId);
  if (!mensaje) throw e;
  return { ok: false, mensaje };
}

/** Manda el aviso de activación (después del commit) y anota en la auditoría si salió, para mostrarlo y poder reenviarlo. Nunca lanza. */
async function enviarAvisoDeActivacion(
  db: Cliente,
  deps: DependenciasDeEmpresas,
  autor: Autor,
  d: { empresaId: string; nombreEmpresa: string; cuit: string; email: string },
  reenvio: boolean,
): Promise<boolean> {
  let enviado = false;
  try {
    const r = await deps.enviar(mensajeDeEmpresaActiva({ email: d.email, nombreEmpresa: d.nombreEmpresa, cuit: d.cuit, urlApp: deps.urlApp }));
    enviado = r.ok;
  } catch {
    enviado = false;
  }
  try {
    await db.auditoriaPlataforma.create({ data: { adminId: autor.adminId, adminEmail: autor.adminEmail, accion: "aviso-de-activacion", empresaAfectadaId: d.empresaId, detalle: { enviado, reenvio } } });
  } catch {
    // El aviso salió (o no) igual; solo falló anotarlo. Reenviar es inofensivo.
  }
  return enviado;
}

/** El gerente actual y su email, leídos DENTRO de la transacción con `app.empresa_id` fijado. */
async function gerenteConEmail(tx: Prisma.TransactionClient, empresaId: string): Promise<{ email: string; cuentaActiva: boolean } | null> {
  await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
  const gerente = await obtenerGerenteDeEmpresa(tx, empresaId);
  if (!gerente) return null;
  const usuario = await tx.user.findUnique({ where: { id: gerente.usuarioId }, select: { email: true, activoGlobal: true } });
  return usuario ? { email: usuario.email, cuentaActiva: usuario.activoGlobal } : null;
}

export async function confirmarAltaDeEmpresa(db: Cliente, deps: DependenciasDeEmpresas, autor: Autor, empresaId: string, entrada: unknown): Promise<ResultadoDeCiclo> {
  const parseo = confirmarAltaSchema.safeParse(entrada);
  if (!parseo.success) return { ok: false, mensaje: parseo.error.issues.map((i) => i.message).join(" ") };
  const cuitValidado = validarCuit(parseo.data.cuit);
  if (!cuitValidado.ok) return { ok: false, mensaje: cuitValidado.mensaje };
  if (cuitValidado.valor === null) return { ok: false, mensaje: "Falta el CUIT." };
  const cuit = cuitValidado.valor;

  type Hecho = { ok: true; nombre: string; email: string; avisoCuentaDesactivada: boolean } | { ok: false; mensaje: string };
  let hecho: Hecho;
  try {
    hecho = await db.$transaction(
      async (tx): Promise<Hecho> => {
        const empresa = await bloquearEmpresa(tx, empresaId);
        if (!empresa) return { ok: false, mensaje: "La empresa no existe." };
        if (!esTransicionValida(empresa.estado, "ACTIVE") || empresa.estado !== "PROVISIONING") return { ok: false, mensaje: "Esta empresa ya no está en alta." };

        const invitacion = await tx.invitacion.findFirst({ where: { empresaId, rolEmpresa: "gerente", estado: "ACEPTADA" }, orderBy: { creadaEn: "desc" }, select: { cuitDeclarado: true } });
        if (!invitacion?.cuitDeclarado) return { ok: false, mensaje: "El gerente todavía no aceptó la invitación ni declaró el CUIT." };
        if (cuit !== invitacion.cuitDeclarado && !parseo.data.aceptoCuitDistinto) {
          return { ok: false, mensaje: `El gerente declaró el CUIT ${formatearCuit(invitacion.cuitDeclarado)}. Para confirmar otro, tildá que aceptás confirmar un CUIT distinto del declarado.` };
        }
        const repetido = await mensajeDeCuitRepetido(tx, cuit, empresaId);
        if (repetido) return { ok: false, mensaje: repetido };

        const gerente = await gerenteConEmail(tx, empresaId);
        if (!gerente) return { ok: false, mensaje: "La empresa no tiene gerente: no hay a quién avisar. Revisá la invitación." };

        const cambio = await tx.empresa.updateMany({ where: { id: empresaId, estado: "PROVISIONING" }, data: { estado: "ACTIVE", cuit } });
        if (cambio.count !== 1) return { ok: false, mensaje: "La empresa cambió mientras tanto. Recargá la pantalla." };
        await auditarEnTransaccion(tx, autor, "empresa-confirmada", empresaId, {
          cuit,
          cuitDeclarado: invitacion.cuitDeclarado,
          corregidoAlConfirmar: cuit !== invitacion.cuitDeclarado,
          revisado: true,
        });
        return { ok: true, nombre: empresa.nombre, email: gerente.email, avisoCuentaDesactivada: !gerente.cuentaActiva };
      },
      { timeout: 15_000 },
    );
  } catch (e) {
    return traducirChoqueDeCuit(db, e, cuit, empresaId);
  }
  if (!hecho.ok) return hecho;

  const enviado = await enviarAvisoDeActivacion(db, deps, autor, { empresaId, nombreEmpresa: hecho.nombre, cuit, email: hecho.email }, false);
  const base = `«${hecho.nombre}» quedó activa con el CUIT ${formatearCuit(cuit)}.`;
  const cuenta = hecho.avisoCuentaDesactivada ? " Atención: la cuenta del gerente está desactivada en toda la plataforma." : "";
  return { ok: true, enviado, mensaje: enviado ? `${base} Le avisamos a ${hecho.email}.${cuenta}` : `${base} El aviso por mail no salió: reenvialo desde el detalle.${cuenta}` };
}

export async function reenviarAvisoDeActivacion(db: Cliente, deps: DependenciasDeEmpresas, autor: Autor, empresaId: string): Promise<ResultadoDeCiclo> {
  type Datos = { ok: true; nombre: string; cuit: string; email: string } | { ok: false; mensaje: string };
  const datos: Datos = await db.$transaction(async (tx): Promise<Datos> => {
    const empresa = await bloquearEmpresa(tx, empresaId);
    if (!empresa) return { ok: false, mensaje: "La empresa no existe." };
    if (empresa.estado !== "ACTIVE" || !empresa.cuit) return { ok: false, mensaje: "El aviso de activación se reenvía solo a una empresa activa." };
    const gerente = await gerenteConEmail(tx, empresaId);
    if (!gerente) return { ok: false, mensaje: "La empresa no tiene gerente." };
    return { ok: true, nombre: empresa.nombre, cuit: empresa.cuit, email: gerente.email };
  });
  if (!datos.ok) return datos;
  const enviado = await enviarAvisoDeActivacion(db, deps, autor, { empresaId, nombreEmpresa: datos.nombre, cuit: datos.cuit, email: datos.email }, true);
  return enviado ? { ok: true, enviado, mensaje: `Aviso reenviado a ${datos.email}.` } : { ok: true, enviado, mensaje: "El aviso no salió. Probá de nuevo más tarde." };
}

/**
 * Corrige (o carga, o quita) el CUIT de una empresa activa o suspendida. Mientras no haya una factura autorizada en producción (`core/fiscal/factura-autorizada`).
 * `cuit` vacío = quitarlo, y eso solo se permite en una empresa SUSPENDIDA. `Invitacion.cuitDeclarado` NO se toca: queda como lo que declaró el gerente.
 */
export async function corregirCuitDeEmpresa(db: Cliente, deps: DependenciasDeCicloDeVida, autor: Autor, empresaId: string, entrada: unknown): Promise<ResultadoDeCiclo> {
  const parseo = corregirCuitSchema.safeParse(entrada);
  if (!parseo.success) return { ok: false, mensaje: parseo.error.issues.map((i) => i.message).join(" ") };
  let nuevo: string | null = null;
  if (parseo.data.cuit !== "") {
    const v = validarCuit(parseo.data.cuit);
    if (!v.ok) return { ok: false, mensaje: v.mensaje };
    nuevo = v.valor;
  }
  const tieneFactura = deps.tieneFacturaAutorizada ?? empresaTieneFacturaAutorizada;

  try {
    return await db.$transaction(
      async (tx): Promise<ResultadoDeCiclo> => {
        const empresa = await bloquearEmpresa(tx, empresaId);
        if (!empresa) return { ok: false, mensaje: "La empresa no existe." };
        if (empresa.estado !== "ACTIVE" && empresa.estado !== "SUSPENDED") return { ok: false, mensaje: "El CUIT de una empresa en alta se corrige al confirmarla." };
        if (await tieneFactura(tx, empresaId)) return { ok: false, mensaje: MENSAJE_CUIT_INMUTABLE };
        if (nuevo === null && empresa.estado !== "SUSPENDED") return { ok: false, mensaje: "El CUIT solo se puede quitar de una empresa suspendida." };
        if (nuevo === null && empresa.cuit === null) return { ok: true, mensaje: "Sin cambios: la empresa ya no tiene CUIT." };
        if (nuevo === empresa.cuit) return { ok: true, mensaje: "Sin cambios: ese ya es el CUIT de la empresa." };
        if (nuevo !== null) {
          const repetido = await mensajeDeCuitRepetido(tx, nuevo, empresaId);
          if (repetido) return { ok: false, mensaje: repetido };
        }
        const cambio = await tx.empresa.updateMany({ where: { id: empresaId, estado: empresa.estado }, data: { cuit: nuevo } });
        if (cambio.count !== 1) return { ok: false, mensaje: "La empresa cambió mientras tanto. Recargá la pantalla." };
        await auditarEnTransaccion(tx, autor, "cuit-corregido", empresaId, { cuitAnterior: empresa.cuit ?? "", cuitNuevo: nuevo ?? "", motivo: parseo.data.motivo });
        return { ok: true, mensaje: nuevo === null ? "CUIT quitado." : `CUIT ${empresa.cuit === null ? "cargado" : "corregido"}: ${formatearCuit(nuevo)}.` };
      },
      { timeout: 15_000 },
    );
  } catch (e) {
    if (nuevo === null) throw e;
    return traducirChoqueDeCuit(db, e, nuevo, empresaId);
  }
}

async function cambiarEstado(
  db: Cliente,
  autor: Autor,
  empresaId: string,
  desde: EstadoEmpresa,
  hacia: EstadoEmpresa,
  accion: "empresa-suspendida" | "empresa-reactivada",
  motivoCrudo: unknown,
  motivoObligatorio: boolean,
): Promise<ResultadoDeCiclo> {
  let motivo = "";
  if (motivoObligatorio || (typeof motivoCrudo === "string" && motivoCrudo.trim() !== "")) {
    const m = motivoSchema.safeParse(motivoCrudo);
    if (!m.success) return { ok: false, mensaje: m.error.issues.map((i) => i.message).join(" ") };
    motivo = m.data;
  }
  return db.$transaction(async (tx): Promise<ResultadoDeCiclo> => {
    const empresa = await bloquearEmpresa(tx, empresaId);
    if (!empresa) return { ok: false, mensaje: "La empresa no existe." };
    if (empresa.estado !== desde || !esTransicionValida(desde, hacia)) {
      return { ok: false, mensaje: hacia === "SUSPENDED" ? "Solo se suspende una empresa activa." : "Solo se reactiva una empresa suspendida." };
    }
    const cambio = await tx.empresa.updateMany({ where: { id: empresaId, estado: desde }, data: { estado: hacia } });
    if (cambio.count !== 1) return { ok: false, mensaje: "La empresa cambió mientras tanto. Recargá la pantalla." };
    await auditarEnTransaccion(tx, autor, accion, empresaId, motivo ? { motivo } : {});
    return { ok: true, mensaje: hacia === "SUSPENDED" ? `«${empresa.nombre}» quedó suspendida: sus usuarios dejan de entrar en su próximo pedido.` : `«${empresa.nombre}» quedó activa de nuevo.` };
  });
}

export function suspenderEmpresa(db: Cliente, autor: Autor, empresaId: string, motivo: unknown): Promise<ResultadoDeCiclo> {
  return cambiarEstado(db, autor, empresaId, "ACTIVE", "SUSPENDED", "empresa-suspendida", motivo, true);
}

export function reactivarEmpresa(db: Cliente, autor: Autor, empresaId: string, motivo: unknown): Promise<ResultadoDeCiclo> {
  return cambiarEstado(db, autor, empresaId, "SUSPENDED", "ACTIVE", "empresa-reactivada", motivo, false);
}
