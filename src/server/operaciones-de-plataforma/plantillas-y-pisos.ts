import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { huellaCanonica, validarClaveDeReintento, validarMotivo } from "@/core/features/empresa/planes";
import { ACCIONES } from "@/core/permisos/acciones";
import {
  PLANTILLAS,
  PLANTILLAS_CON_LISTA,
  PlantillasError,
  TIPOS_DE_PISO,
  aplicarCambiosALaPlantilla,
  incumplimientosDeLaPlantilla,
  planDeSincronizacion,
  validarClaveDeAccion,
  type ListaDePlantilla,
  type PisoDeAccion,
  type PlantillaConLista,
  type TipoDePiso,
} from "@/core/permisos/plantillas-y-pisos";
import { azarDelProceso } from "@/lib/azar";
import { auditarCambioDePlataforma, type AutorDeCambioDePlataforma } from "./auditar-cambio-de-plataforma";

/**
 * Los casos de PLANTILLAS Y PISOS de la plataforma (roles propios, EB-1): publicar una versión de plantilla (inmutable), fijar el piso de una acción y sincronizar las acciones nuevas del catálogo. SOLO la plataforma los
 * hace (los llama `scripts/plantillas-y-pisos.ts` y nada del resto de `src/`; regla `operaciones-de-plataforma-solo-desde-scripts`), y la base lo exige (RLS `solo_plataforma` + REVOKE a la app + triggers). Sin
 * `import "server-only"`: los importan scripts con `tsx` y tests. EB-1 NO conecta nada al guard ni a las pantallas: estos casos solo guardan y calculan.
 *
 * Reglas comunes (concurrencia, idempotencia, atomicidad, trazabilidad): cada caso es UNA transacción con su fila de `AuditoriaPlataforma` (si el cambio se revierte, la fila también) que empieza tomando un candado
 * consultivo de transacción: dos corridas a la vez se serializan y la segunda decide sobre lo que dejó la primera (D-L: las tablas son globales y no hay una fila de empresa que bloquear). Un reintento con la misma
 * clave y el mismo pedido devuelve lo ya hecho SIN escribir; la misma clave con OTRO pedido es un error. Un choque de unicidad residual (algo escribió por fuera del candado) se traduce a VERSION_DESACTUALIZADA.
 */
type Db = PrismaClient;
type Azar = { uuid: () => string };

const huella = (valor: Parameters<typeof huellaCanonica>[0]): string => createHash("sha256").update(huellaCanonica(valor)).digest("hex");

const ordenadas = (claves: readonly string[]): string[] => [...new Set(claves)].sort();

/** Corre el caso en UNA transacción que toma primero el candado de plantillas y pisos; un P2002 residual se vuelve un error claro. */
async function enTransaccion<T>(db: Db, caso: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('plantillas-y-pisos', 0))::text`;
      return caso(tx);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new PlantillasError("Otra persona escribió plantillas o pisos a la vez: releé el estado antes de seguir.", "VERSION_DESACTUALIZADA");
    }
    throw e;
  }
}

const esPlantillaConLista = (plantilla: string): plantilla is PlantillaConLista => (PLANTILLAS_CON_LISTA as readonly string[]).includes(plantilla);

async function pisosDeLaBase(tx: Prisma.TransactionClient): Promise<PisoDeAccion[]> {
  const filas = await tx.pisoDePlataforma.findMany({ select: { accionClave: true, tipo: true }, orderBy: { accionClave: "asc" } });
  return filas.map((f) => ({ accionClave: f.accionClave, tipo: f.tipo as TipoDePiso }));
}

async function ultimaVersion(tx: Prisma.TransactionClient, plantilla: PlantillaConLista): Promise<{ numero: number } & ListaDePlantilla> {
  const v = await tx.versionDePlantilla.findFirst({ where: { plantillaClave: plantilla }, orderBy: { numero: "desc" }, select: { numero: true, accionesVer: true, accionesEditar: true } });
  if (!v) throw new PlantillasError(`La plantilla "${plantilla}" no tiene ninguna versión: falta la semilla de la migración.`, "ESTADO_INVALIDO");
  return { numero: v.numero, ver: v.accionesVer, editar: v.accionesEditar };
}

// ── Publicar una versión de plantilla ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PedidoDePublicarVersion {
  clave: string;
  plantilla: string;
  /** El número que se espera para la versión nueva (la última + 1). Si otra persona publicó antes, falla con «VERSION_DESACTUALIZADA» y no pisa nada. */
  numeroEsperado: number;
  darVer?: readonly string[];
  darEditar?: readonly string[];
  quitar?: readonly string[];
  quitarEditar?: readonly string[];
  motivo: string;
}
export interface VersionPublicada {
  versionId: string;
  numero: number;
  /** `false` si era un reintento de algo ya hecho: no se escribió nada. */
  publicada: boolean;
}

export async function publicarVersionDePlantilla(db: Db, pedido: PedidoDePublicarVersion, autor: AutorDeCambioDePlataforma, azar: Azar = azarDelProceso): Promise<VersionPublicada> {
  const clave = validarClaveDeReintento(pedido.clave);
  const motivo = validarMotivo(pedido.motivo);
  if (!(PLANTILLAS as readonly string[]).includes(pedido.plantilla)) throw new PlantillasError(`No existe la plantilla "${pedido.plantilla}".`, "NO_EXISTE");
  if (!esPlantillaConLista(pedido.plantilla)) throw new PlantillasError(`La plantilla "${pedido.plantilla}" no lleva versiones: el gerente no pasa por la matriz.`, "ESTADO_INVALIDO");
  const plantilla = pedido.plantilla;
  if (!Number.isInteger(pedido.numeroEsperado) || pedido.numeroEsperado < 1) throw new PlantillasError("El número esperado tiene que ser un entero desde 1.");
  const cambios = {
    darVer: ordenadas((pedido.darVer ?? []).map(validarClaveDeAccion)),
    darEditar: ordenadas((pedido.darEditar ?? []).map(validarClaveDeAccion)),
    quitar: ordenadas((pedido.quitar ?? []).map(validarClaveDeAccion)),
    quitarEditar: ordenadas((pedido.quitarEditar ?? []).map(validarClaveDeAccion)),
  };
  const payloadHash = huella({ accion: "publicar", plantilla, numeroEsperado: pedido.numeroEsperado, ...cambios, motivo });

  return enTransaccion(db, async (tx): Promise<VersionPublicada> => {
    const previa = await tx.versionDePlantilla.findUnique({ where: { claveIdempotencia: clave }, select: { id: true, numero: true, payloadHash: true } });
    if (previa) {
      if (previa.payloadHash !== payloadHash) throw new PlantillasError("Esa clave de reintento ya se usó para otro pedido.", "CLAVE_REUTILIZADA");
      return { versionId: previa.id, numero: previa.numero, publicada: false };
    }
    if (!(await tx.plantillaDeRol.findUnique({ where: { clave: plantilla }, select: { id: true } }))) throw new PlantillasError(`No existe la plantilla "${plantilla}" en la base.`, "NO_EXISTE");

    const ultima = await ultimaVersion(tx, plantilla);
    const siguiente = ultima.numero + 1;
    if (siguiente !== pedido.numeroEsperado) {
      throw new PlantillasError(`La próxima versión de la plantilla "${plantilla}" es la ${siguiente}, no la ${pedido.numeroEsperado}: puede ser un reintento o que otra persona ya publicó. Releé la plantilla antes de seguir.`, "VERSION_DESACTUALIZADA");
    }
    const nueva = aplicarCambiosALaPlantilla(ultima, cambios);
    const incumplimientos = incumplimientosDeLaPlantilla(plantilla, nueva.ver, nueva.editar, await pisosDeLaBase(tx));
    if (incumplimientos.length > 0) throw new PlantillasError(`La versión no se puede publicar: ${incumplimientos.map((i) => i.mensaje).join(" ")}`);

    const versionId = azar.uuid();
    await tx.versionDePlantilla.create({
      data: { id: versionId, plantillaClave: plantilla, numero: siguiente, accionesVer: nueva.ver, accionesEditar: nueva.editar, autor: autor.adminEmail, claveIdempotencia: clave, payloadHash },
    });
    await auditarCambioDePlataforma(tx, autor, "plantilla-version-publicada", null, { plantilla, numero: siguiente, agregadas: nueva.agregadas.join(","), quitadas: nueva.quitadas.join(","), motivo });
    return { versionId, numero: siguiente, publicada: true };
  });
}

// ── Fijar el piso de una acción ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PedidoDeFijarPiso {
  accion: string;
  tipo: string;
  /** La versión del piso que se espera (0 = «la acción no tiene piso todavía»). Si otra persona lo cambió antes, falla con «VERSION_DESACTUALIZADA». */
  versionEsperada: number;
  motivo: string;
}
export interface PisoFijado {
  /** `false` si el piso ya tenía ese tipo: no se escribió nada. */
  cambiado: boolean;
  version: number;
  /** Las plantillas cuya última versión contiene esta acción. El piso manda, pero no toca las listas: la próxima publicación de esas plantillas tendrá que ajustarlas. Es solo un aviso. */
  plantillasQueLaTienen: PlantillaConLista[];
}

export async function fijarPisoDePlataforma(db: Db, pedido: PedidoDeFijarPiso, autor: AutorDeCambioDePlataforma, azar: Azar = azarDelProceso): Promise<PisoFijado> {
  const accion = validarClaveDeAccion(pedido.accion);
  if (!(TIPOS_DE_PISO as readonly string[]).includes(pedido.tipo)) throw new PlantillasError(`El tipo de piso tiene que ser uno de: ${TIPOS_DE_PISO.join(", ")}.`);
  const tipo = pedido.tipo as TipoDePiso;
  const motivo = validarMotivo(pedido.motivo);
  if (!Number.isInteger(pedido.versionEsperada) || pedido.versionEsperada < 0) throw new PlantillasError("La versión esperada tiene que ser un entero desde 0 (0 = la acción no tiene piso todavía).");

  return enTransaccion(db, async (tx): Promise<PisoFijado> => {
    const aviso = async (): Promise<PlantillaConLista[]> => {
      const ultimas = await tx.versionDePlantilla.findMany({ orderBy: { numero: "desc" }, distinct: ["plantillaClave"], select: { plantillaClave: true, accionesVer: true } });
      return ultimas.filter((v) => v.accionesVer.includes(accion) && esPlantillaConLista(v.plantillaClave)).map((v) => v.plantillaClave as PlantillaConLista).sort();
    };
    const piso = await tx.pisoDePlataforma.findUnique({ where: { accionClave: accion }, select: { id: true, tipo: true, version: true } });
    if (!piso) {
      if (pedido.versionEsperada !== 0) throw new PlantillasError(`La acción "${accion}" no tiene piso todavía (versión 0), no la ${pedido.versionEsperada}. Releé el estado antes de seguir.`, "VERSION_DESACTUALIZADA");
      await tx.pisoDePlataforma.create({ data: { id: azar.uuid(), accionClave: accion, tipo, autor: autor.adminEmail } });
      await auditarCambioDePlataforma(tx, autor, "piso-fijado", null, { accion, tipo, tipoAnterior: null, version: 1, motivo });
      return { cambiado: true, version: 1, plantillasQueLaTienen: await aviso() };
    }
    if (piso.tipo === tipo) return { cambiado: false, version: piso.version, plantillasQueLaTienen: await aviso() };
    if (piso.version !== pedido.versionEsperada) {
      throw new PlantillasError(`El piso de "${accion}" está en la versión ${piso.version}, no en la ${pedido.versionEsperada}: otra persona lo cambió. Releé el estado antes de seguir.`, "VERSION_DESACTUALIZADA");
    }
    // La base sube `version` y `actualizadoEn` (trigger): se lee lo que devuelve el UPDATE.
    const nuevo = await tx.pisoDePlataforma.update({ where: { id: piso.id }, data: { tipo, autor: autor.adminEmail }, select: { version: true } });
    await auditarCambioDePlataforma(tx, autor, "piso-fijado", null, { accion, tipo, tipoAnterior: piso.tipo, version: nuevo.version, motivo });
    return { cambiado: true, version: nuevo.version, plantillasQueLaTienen: await aviso() };
  });
}

// ── Sincronizar las acciones nuevas del catálogo ──────────────────────────────────────────────────────────────────────────────────────────

export interface AccionesSincronizadas {
  introducidas: number;
  versiones: number;
  pisos: number;
}

/**
 * El catálogo de acciones del CÓDIGO puede traer acciones que la base todavía no conoce (`AccionIntroducida`). Cada una se suma a las plantillas que su semilla indica (Ver = Editar, en una versión nueva por plantilla) y
 * crea su piso por la equivalencia de nivel, salvo que ya tenga fila de piso. NUNCA quita ni repone una acción de una plantilla. Sin acciones nuevas no escribe nada (ni siquiera audita).
 * Se corre a mano por la plataforma (D-J): en Pedernal este paso no está verificado como automático.
 */
export async function sincronizarAccionesNuevas(db: Db, autor: AutorDeCambioDePlataforma, azar: Azar = azarDelProceso): Promise<AccionesSincronizadas> {
  return enTransaccion(db, async (tx): Promise<AccionesSincronizadas> => {
    const conocidas = new Set((await tx.accionIntroducida.findMany({ select: { accionClave: true } })).map((a) => a.accionClave));
    const nuevas = ACCIONES.filter((a) => !conocidas.has(a.clave));
    if (nuevas.length === 0) return { introducidas: 0, versiones: 0, pisos: 0 };

    const pisosActuales = await pisosDeLaBase(tx);
    const ultimas = { ADMINISTRADOR: await ultimaVersion(tx, "ADMINISTRADOR"), OPERADOR: await ultimaVersion(tx, "OPERADOR") };
    const plan = planDeSincronizacion(nuevas, ultimas, pisosActuales.map((p) => p.accionClave));
    const pisosDespues = [...pisosActuales, ...plan.pisosNuevos];

    if (plan.pisosNuevos.length > 0) {
      await tx.pisoDePlataforma.createMany({ data: plan.pisosNuevos.map((p) => ({ id: azar.uuid(), accionClave: p.accionClave, tipo: p.tipo, autor: autor.adminEmail })) });
    }
    let versiones = 0;
    for (const plantilla of PLANTILLAS_CON_LISTA) {
      const v = plan.versiones[plantilla];
      if (!v) continue;
      const incumplimientos = incumplimientosDeLaPlantilla(plantilla, v.ver, v.editar, pisosDespues);
      if (incumplimientos.length > 0) throw new PlantillasError(`La sincronización dejaría a la plantilla ${plantilla} fuera de las reglas: ${incumplimientos.map((i) => i.mensaje).join(" ")}`, "ESTADO_INVALIDO");
      await tx.versionDePlantilla.create({
        data: {
          id: azar.uuid(),
          plantillaClave: plantilla,
          numero: ultimas[plantilla].numero + 1,
          accionesVer: v.ver,
          accionesEditar: v.editar,
          autor: autor.adminEmail,
          claveIdempotencia: azar.uuid(),
          payloadHash: huella({ accion: "sincronizar", plantilla, agregadas: v.agregadas }),
        },
      });
      versiones += 1;
    }
    await tx.accionIntroducida.createMany({ data: nuevas.map((a) => ({ id: azar.uuid(), accionClave: a.clave })) });
    await auditarCambioDePlataforma(tx, autor, "acciones-sincronizadas", null, { acciones: nuevas.map((a) => a.clave).sort().join(","), versiones, pisos: plan.pisosNuevos.length });
    return { introducidas: nuevas.length, versiones, pisos: plan.pisosNuevos.length };
  });
}
