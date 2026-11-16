import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  PlanesError,
  asignacionVigenteEn,
  estadoDeModulosFrenteAlTecho,
  huellaCanonica,
  validarClaveDeReintento,
  validarCodigoDePlan,
  validarModulosDelPlan,
  validarMotivo,
  validarNombreComercial,
  type EstadoDelModuloEnElPlan,
} from "@/core/features/empresa/planes";
import { azarDelProceso } from "@/lib/azar";
import { auditarCambioDePlataforma, type AutorDeCambioDePlataforma } from "./auditar-cambio-de-plataforma";

/**
 * Los casos de PLANES VERSIONADOS de la plataforma (frente 4, M1; «Planes con versiones desde el inicio, como Pedernal», 2026-11-16): crear un plan, guardar su borrador, publicar una versión
 * (inmutable) y asignarle un plan a una empresa. SOLO la plataforma los hace (los llama `scripts/plan-de-plataforma.ts` y nada del resto de `src/`; regla `operaciones-de-plataforma-solo-desde-scripts`),
 * y la base lo exige (RLS `solo_plataforma` + REVOKE a la app + triggers). Sin `import "server-only"`: los importan scripts con `tsx` y tests.
 *
 * Reglas comunes (concurrencia, idempotencia, atomicidad, trazabilidad): cada caso es UNA transacción con su fila de `AuditoriaPlataforma` (si el cambio se revierte, la fila también); toma la fila
 * del plan o de la empresa con `FOR UPDATE` ANTES de leer, así dos corridas a la vez se serializan y la segunda planifica sobre lo que dejó la primera; y un reintento con la misma clave de
 * reintento y el mismo pedido devuelve lo ya hecho SIN escribir (la misma clave con OTRO pedido es un error). Si dos corridas con claves distintas chocan en un único (código, número), la base
 * deja pasar a una y la otra se reintenta UNA vez sobre el estado nuevo. M1 NO conecta el techo al guard ni al menú (M1b): estos casos solo guardan y calculan.
 */
type Db = PrismaClient;
type Azar = { uuid: () => string };

const huella = (valor: Parameters<typeof huellaCanonica>[0]): string => createHash("sha256").update(huellaCanonica(valor)).digest("hex");

const esChoqueDeUnicidad = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Corre el caso; si la base frena un duplicado por una carrera, lo repite UNA vez: ahora ve lo que dejó la otra corrida y decide (devuelve lo hecho o falla con un mensaje claro). */
async function conUnReintentoPorUnicidad<T>(caso: () => Promise<T>): Promise<T> {
  try {
    return await caso();
  } catch (e) {
    if (!esChoqueDeUnicidad(e)) throw e;
    return caso();
  }
}

// ── Crear un plan (con su primer borrador) ────────────────────────────────────────────────────────────────────────────────────────────────

export interface PedidoDeCrearPlan {
  clave: string;
  codigo: string;
  nombreComercial: string;
  modulos: readonly string[];
}
export interface PlanCreado {
  planId: string;
  versionDePlanId: string;
  /** `false` si era un reintento de algo ya hecho: no se escribió nada. */
  creado: boolean;
}

export async function crearPlan(db: Db, pedido: PedidoDeCrearPlan, autor: AutorDeCambioDePlataforma, azar: Azar = azarDelProceso): Promise<PlanCreado> {
  const clave = validarClaveDeReintento(pedido.clave);
  const codigo = validarCodigoDePlan(pedido.codigo);
  const nombreComercial = validarNombreComercial(pedido.nombreComercial);
  const modulos = validarModulosDelPlan(pedido.modulos);
  const payloadHash = huella({ accion: "crear", codigo, nombreComercial, modulos });

  return conUnReintentoPorUnicidad(() =>
    db.$transaction(async (tx): Promise<PlanCreado> => {
      const porClave = await tx.plan.findUnique({ where: { claveIdempotencia: clave }, select: { id: true, payloadHash: true } });
      if (porClave) {
        if (porClave.payloadHash !== payloadHash) throw new PlanesError("Esa clave de reintento ya se usó para otro pedido.", "CLAVE_REUTILIZADA");
        const borrador = await tx.versionDePlan.findFirst({ where: { planId: porClave.id }, orderBy: { creadoEn: "asc" }, select: { id: true } });
        return { planId: porClave.id, versionDePlanId: borrador!.id, creado: false };
      }
      if (await tx.plan.findUnique({ where: { codigo }, select: { id: true } })) throw new PlanesError(`Ya existe un plan con el código "${codigo}".`, "ESTADO_INVALIDO");

      const planId = azar.uuid();
      const versionDePlanId = azar.uuid();
      await tx.plan.create({ data: { id: planId, codigo, claveIdempotencia: clave, payloadHash } });
      await tx.versionDePlan.create({ data: { id: versionDePlanId, planId, nombreComercial, modulos, claveIdempotencia: azar.uuid(), payloadHash } });
      await auditarCambioDePlataforma(tx, autor, "plan-creado", null, { plan: codigo, modulos: modulos.join(",") });
      return { planId, versionDePlanId, creado: true };
    }),
  );
}

// ── Guardar el borrador ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PedidoDeGuardarBorrador {
  clave: string;
  codigo: string;
  nombreComercial: string;
  modulos: readonly string[];
}
export interface BorradorGuardado {
  versionDePlanId: string;
  cambiado: boolean;
}

/**
 * Guarda el contenido del borrador del plan (lo crea si la última versión ya está publicada). Reintento: la misma clave con el mismo pedido no vuelve a escribir. Límite honesto: la base guarda
 * solo la ÚLTIMA clave del borrador; repetir una clave anterior a otra edición se toma como un pedido nuevo (es una edición de estado, no suma filas ni cobra nada).
 */
export async function guardarBorradorDePlan(db: Db, pedido: PedidoDeGuardarBorrador, autor: AutorDeCambioDePlataforma, azar: Azar = azarDelProceso): Promise<BorradorGuardado> {
  const clave = validarClaveDeReintento(pedido.clave);
  const codigo = validarCodigoDePlan(pedido.codigo);
  const nombreComercial = validarNombreComercial(pedido.nombreComercial);
  const modulos = validarModulosDelPlan(pedido.modulos);
  const payloadHash = huella({ accion: "borrador", codigo, nombreComercial, modulos });

  return conUnReintentoPorUnicidad(() =>
    db.$transaction(async (tx): Promise<BorradorGuardado> => {
      await tx.$queryRaw`SELECT id FROM "Plan" WHERE codigo = ${codigo} FOR UPDATE`;
      const plan = await tx.plan.findUnique({ where: { codigo }, select: { id: true, estado: true } });
      if (!plan) throw new PlanesError(`No existe el plan "${codigo}".`, "NO_EXISTE");
      if (plan.estado !== "ACTIVO") throw new PlanesError(`El plan "${codigo}" está retirado.`, "ESTADO_INVALIDO");

      const borrador = await tx.versionDePlan.findFirst({ where: { planId: plan.id, estado: "BORRADOR" }, select: { id: true, claveIdempotencia: true, payloadHash: true } });
      if (borrador && borrador.claveIdempotencia === clave) {
        if (borrador.payloadHash !== payloadHash) throw new PlanesError("Esa clave de reintento ya se usó para otro pedido.", "CLAVE_REUTILIZADA");
        return { versionDePlanId: borrador.id, cambiado: false };
      }
      if (!borrador && (await tx.versionDePlan.findUnique({ where: { claveIdempotencia: clave }, select: { id: true } }))) {
        throw new PlanesError("Esa clave de reintento ya se usó para otro pedido.", "CLAVE_REUTILIZADA");
      }

      let versionDePlanId: string;
      if (borrador) {
        versionDePlanId = borrador.id;
        await tx.versionDePlan.update({ where: { id: borrador.id }, data: { nombreComercial, modulos, claveIdempotencia: clave, payloadHash } });
      } else {
        versionDePlanId = azar.uuid();
        await tx.versionDePlan.create({ data: { id: versionDePlanId, planId: plan.id, nombreComercial, modulos, claveIdempotencia: clave, payloadHash } });
      }
      await auditarCambioDePlataforma(tx, autor, "plan-borrador-guardado", null, { plan: codigo, modulos: modulos.join(",") });
      return { versionDePlanId, cambiado: true };
    }),
  );
}

// ── Publicar una versión ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PedidoDePublicar {
  codigo: string;
  /** El número que el administrador espera que tenga la versión (la última publicada + 1). Si otro publicó antes, falla con «VERSION_DESACTUALIZADA» y no pisa nada. */
  numeroEsperado: number;
  motivo: string;
}
export interface VersionPublicada {
  versionDePlanId: string;
  numero: number;
}

export async function publicarVersionDePlan(db: Db, pedido: PedidoDePublicar, autor: AutorDeCambioDePlataforma): Promise<VersionPublicada> {
  const codigo = validarCodigoDePlan(pedido.codigo);
  const motivo = validarMotivo(pedido.motivo);
  if (!Number.isInteger(pedido.numeroEsperado) || pedido.numeroEsperado < 1) throw new PlanesError("El número esperado tiene que ser un entero desde 1.");

  return db.$transaction(async (tx): Promise<VersionPublicada> => {
    await tx.$queryRaw`SELECT id FROM "Plan" WHERE codigo = ${codigo} FOR UPDATE`;
    const plan = await tx.plan.findUnique({ where: { codigo }, select: { id: true, estado: true } });
    if (!plan) throw new PlanesError(`No existe el plan "${codigo}".`, "NO_EXISTE");
    if (plan.estado !== "ACTIVO") throw new PlanesError(`El plan "${codigo}" está retirado.`, "ESTADO_INVALIDO");

    const ultima = await tx.versionDePlan.aggregate({ where: { planId: plan.id, estado: "PUBLICADA" }, _max: { numero: true } });
    const siguiente = (ultima._max.numero ?? 0) + 1;
    if (siguiente !== pedido.numeroEsperado) {
      throw new PlanesError(`La próxima versión del plan "${codigo}" es la ${siguiente}, no la ${pedido.numeroEsperado}: puede ser un reintento o que otra persona ya publicó. Releé el plan antes de seguir.`, "VERSION_DESACTUALIZADA");
    }
    const borrador = await tx.versionDePlan.findFirst({ where: { planId: plan.id, estado: "BORRADOR" }, select: { id: true, modulos: true } });
    if (!borrador) throw new PlanesError(`El plan "${codigo}" no tiene un borrador para publicar.`, "ESTADO_INVALIDO");
    // El catálogo pudo cambiar desde que se guardó el borrador: el techo se vuelve a validar al publicar.
    validarModulosDelPlan(borrador.modulos);

    await tx.versionDePlan.update({ where: { id: borrador.id }, data: { estado: "PUBLICADA", numero: siguiente, motivo, publicadaEn: new Date(), publicadaPor: autor.adminEmail } });
    await auditarCambioDePlataforma(tx, autor, "plan-version-publicada", null, { plan: codigo, numero: siguiente, modulos: borrador.modulos.join(",") });
    return { versionDePlanId: borrador.id, numero: siguiente };
  });
}

// ── Asignar un plan a una empresa ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PedidoDeAsignar {
  clave: string;
  slug: string;
  codigoDePlan: string;
  numeroDeVersion: number;
  motivo: string;
}
export interface PlanAsignado {
  empresaId: string;
  planDeEmpresaId: string;
  numero: number;
  /** `false` si no se escribió nada: reintento de lo ya hecho, o la empresa ya tenía esa versión vigente. */
  asignado: boolean;
  /** Los módulos que la empresa tiene activos hoy y el techo de esta versión NO incluye: quedarían en SOLO LECTURA cuando el techo se conecte (M1b). Hoy es solo un aviso. */
  fueraDelTecho: Record<string, EstadoDelModuloEnElPlan>;
}

export async function asignarPlanAEmpresa(db: Db, pedido: PedidoDeAsignar, autor: AutorDeCambioDePlataforma, azar: Azar = azarDelProceso, ahora: () => Date = () => new Date()): Promise<PlanAsignado> {
  const clave = validarClaveDeReintento(pedido.clave);
  const codigo = validarCodigoDePlan(pedido.codigoDePlan);
  const motivo = validarMotivo(pedido.motivo);
  if (!Number.isInteger(pedido.numeroDeVersion) || pedido.numeroDeVersion < 1) throw new PlanesError("El número de versión tiene que ser un entero desde 1.");
  const payloadHash = huella({ accion: "asignar", slug: pedido.slug, codigo, numeroDeVersion: pedido.numeroDeVersion, motivo });

  return conUnReintentoPorUnicidad(() =>
    db.$transaction(async (tx): Promise<PlanAsignado> => {
      // La fila de la empresa se toma ANTES de leer su historial: dos asignaciones a la vez se serializan y la segunda calcula su número sobre lo que dejó la primera.
      await tx.$queryRaw`SELECT id FROM "Empresa" WHERE slug = ${pedido.slug} FOR UPDATE`;
      const empresa = await tx.empresa.findUnique({ where: { slug: pedido.slug }, select: { id: true, estado: true } });
      if (!empresa) throw new PlanesError(`No existe una empresa con el slug "${pedido.slug}".`, "NO_EXISTE");
      if (empresa.estado === "DELETING") throw new PlanesError("Una empresa en baja no cambia de plan.", "ESTADO_INVALIDO");
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresa.id}, true)`;

      const registro = await tx.moduloEmpresa.findMany({ where: { empresaId: empresa.id, estado: "ACTIVO" }, select: { modulo: true } });
      const activos = registro.map((f) => f.modulo);

      const previa = await tx.planDeEmpresa.findUnique({ where: { claveIdempotencia: clave }, select: { id: true, numero: true, empresaId: true, payloadHash: true, versionDePlan: { select: { modulos: true } } } });
      if (previa) {
        if (previa.payloadHash !== payloadHash || previa.empresaId !== empresa.id) throw new PlanesError("Esa clave de reintento ya se usó para otro pedido.", "CLAVE_REUTILIZADA");
        return { empresaId: empresa.id, planDeEmpresaId: previa.id, numero: previa.numero, asignado: false, fueraDelTecho: soloFuera(estadoDeModulosFrenteAlTecho(activos, previa.versionDePlan.modulos)) };
      }

      const version = await tx.versionDePlan.findFirst({
        where: { numero: pedido.numeroDeVersion, estado: "PUBLICADA", plan: { codigo } },
        select: { id: true, modulos: true, plan: { select: { estado: true } } },
      });
      if (!version) throw new PlanesError(`No existe la versión ${pedido.numeroDeVersion} publicada del plan "${codigo}".`, "NO_EXISTE");
      if (version.plan.estado !== "ACTIVO") throw new PlanesError(`El plan "${codigo}" está retirado.`, "ESTADO_INVALIDO");
      const fueraDelTecho = soloFuera(estadoDeModulosFrenteAlTecho(activos, version.modulos));

      const historial = await tx.planDeEmpresa.findMany({ where: { empresaId: empresa.id }, select: { id: true, numero: true, versionDePlanId: true, vigenteDesde: true } });
      const vigente = asignacionVigenteEn(historial, ahora());
      if (vigente && vigente.versionDePlanId === version.id) return { empresaId: empresa.id, planDeEmpresaId: vigente.id, numero: vigente.numero, asignado: false, fueraDelTecho };

      const numero = historial.reduce((m, a) => Math.max(m, a.numero), 0) + 1;
      const planDeEmpresaId = azar.uuid();
      await tx.planDeEmpresa.create({
        data: { id: planDeEmpresaId, empresaId: empresa.id, versionDePlanId: version.id, numero, vigenteDesde: ahora(), origen: "CAMBIO", motivo, asignadoPor: autor.adminEmail, claveIdempotencia: clave, payloadHash },
      });
      await auditarCambioDePlataforma(tx, autor, "plan-asignado", empresa.id, { plan: codigo, version: pedido.numeroDeVersion, numero, fueraDelTecho: Object.keys(fueraDelTecho).join(",") });
      return { empresaId: empresa.id, planDeEmpresaId, numero, asignado: true, fueraDelTecho };
    }),
  );
}

function soloFuera(estados: Record<string, EstadoDelModuloEnElPlan>): Record<string, EstadoDelModuloEnElPlan> {
  return Object.fromEntries(Object.entries(estados).filter(([, e]) => e === "SOLO_LECTURA"));
}
