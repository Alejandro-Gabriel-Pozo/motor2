import "server-only";
import type { Prisma } from "@prisma/client";
import type { ConsumoDeConfiguracion, DiferenciaDePrecio, ModoDePrecioDeMedida, TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * Escrituras del CATÁLOGO DE OPCIONES DE VENTA (GO-2a; ADR-030). Mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro (siempre el `tx` de la
 * transacción SERIALIZABLE del caso de uso), `data` literal, sin reglas de negocio ni auditoría (la escribe el caso de uso, con el mismo `tx`).
 *
 * - Nunca DELETE (la app tampoco tiene el GRANT): la baja es desactivar. Versiones y consumos SOLO se agregan.
 * - Las ediciones son OPTIMISTAS en la base (defensa doble con la relectura del caso de uso): `updateMany({ where: { id, version: esperada } })` sube la `version` en 1 y devuelve
 *   cuántas filas tocó; 0 = otra persona la cambió en el medio (`VERSION_DESACTUALIZADA`). Solo se escriben las columnas con GRANT de UPDATE (nunca el tipo, el grupo, el ancla ni «ninguna»).
 * - `actualizadoEn` y `creadoEn` llevan la hora del pedido (`ahora`, el reloj inyectado del contexto), no la de la base.
 */

type Tx = Prisma.TransactionClient;

function columnasDeDiferencia(d: DiferenciaDePrecio | null) {
  if (d === null) return { tipoDeDiferencia: null, diferenciaPrecio: null, porcentaje: null };
  return d.tipo === "MONTO" ? { tipoDeDiferencia: "MONTO", diferenciaPrecio: d.monto, porcentaje: null } : { tipoDeDiferencia: "PORCENTAJE", diferenciaPrecio: null, porcentaje: d.porcentaje };
}

// ───────────────────────────── Grupos ─────────────────────────────

export async function crearGrupoDeOpciones(
  tx: Tx,
  args: { nombre: string; tipo: TipoDeGrupoDeOpciones; cantidadMinima: number; cantidadMaxima: number; ahora: Date }
): Promise<{ id: string }> {
  return tx.grupoDeOpciones.create({
    data: { nombre: args.nombre, tipo: args.tipo, cantidadMinima: args.cantidadMinima, cantidadMaxima: args.cantidadMaxima, creadoEn: args.ahora, actualizadoEn: args.ahora },
    select: { id: true },
  });
}

/** Devuelve cuántas filas tocó: 0 si la versión ya no es la esperada. */
export async function actualizarGrupoDeOpciones(
  tx: Tx,
  args: { id: string; versionEsperada: number; nombre: string; cantidadMinima: number; cantidadMaxima: number; activo: boolean; ahora: Date }
): Promise<number> {
  const { count } = await tx.grupoDeOpciones.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { nombre: args.nombre, cantidadMinima: args.cantidadMinima, cantidadMaxima: args.cantidadMaxima, activo: args.activo, version: { increment: 1 }, actualizadoEn: args.ahora },
  });
  return count;
}

// ───────────────────────────── Opciones y versiones ─────────────────────────────

export async function crearOpcionDeGrupo(
  tx: Tx,
  args: { grupoId: string; nombre: string; orden: number; esNinguna: boolean; productoAnclaId: string | null; ahora: Date }
): Promise<{ id: string }> {
  return tx.opcionDeGrupo.create({
    data: { grupoId: args.grupoId, nombre: args.nombre, orden: args.orden, esNinguna: args.esNinguna, productoId: args.productoAnclaId, creadoEn: args.ahora, actualizadoEn: args.ahora },
    select: { id: true },
  });
}

/** Devuelve cuántas filas tocó: 0 si la versión ya no es la esperada. */
export async function actualizarOpcionDeGrupo(tx: Tx, args: { id: string; versionEsperada: number; nombre: string; orden: number; activa: boolean; ahora: Date }): Promise<number> {
  const { count } = await tx.opcionDeGrupo.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { nombre: args.nombre, orden: args.orden, activa: args.activa, version: { increment: 1 }, actualizadoEn: args.ahora },
  });
  return count;
}

/**
 * Agrega la versión `numero` de una opción con sus consumos (el `orden` de cada consumo es su posición en la lista). Dos versiones con el mismo número a la vez chocan con el
 * único `(opcionId, numero)`: gana una y la otra recibe 23505 (el caso de uso reintenta y su relectura la rechaza).
 */
export async function agregarVersionDeOpcion(
  tx: Tx,
  args: { opcionId: string; numero: number; diferencia: DiferenciaDePrecio; factorEscala: number | null; consumos: readonly (ConsumoDeConfiguracion & { unidadId: string })[]; creadoPorId: string; ahora: Date }
): Promise<{ id: string }> {
  const d = columnasDeDiferencia(args.diferencia);
  const version = await tx.versionDeOpcion.create({
    data: {
      opcionId: args.opcionId,
      numero: args.numero,
      tipoDeDiferencia: d.tipoDeDiferencia!,
      diferenciaPrecio: d.diferenciaPrecio,
      porcentaje: d.porcentaje,
      factorEscala: args.factorEscala,
      creadoPorId: args.creadoPorId,
      creadoEn: args.ahora,
    },
    select: { id: true },
  });
  if (args.consumos.length > 0) {
    await tx.consumoDeOpcion.createMany({
      data: args.consumos.map((c, orden) => ({
        versionDeOpcionId: version.id,
        efecto: c.efecto,
        insumoProductoId: c.insumoProductoId,
        reemplazaAProductoId: c.reemplazaAProductoId,
        cantidad: c.cantidad,
        unidadId: c.unidadId,
        mermaPorcentaje: c.mermaPorcentaje,
        escalaConLaMedida: c.escalaConLaMedida,
        orden,
      })),
    });
  }
  return version;
}

// ───────────────────────────── Lo que admite cada producto ─────────────────────────────

interface FilaDeAdmisionDeGrupo {
  orden: number;
  cantidadMinima: number | null;
  cantidadMaxima: number | null;
  modoPrecio: ModoDePrecioDeMedida | null;
  activo: boolean;
}

interface FilaDeAdmisionDeOpcion {
  cantidadMaxima: number;
  precioAbsoluto: number | null;
  diferencia: DiferenciaDePrecio | null;
  activo: boolean;
}

export async function crearAdmisionDeGrupo(tx: Tx, args: { productoId: string; grupoId: string; fila: FilaDeAdmisionDeGrupo; ahora: Date }): Promise<{ id: string }> {
  return tx.productoAdmiteGrupo.create({ data: { productoId: args.productoId, grupoId: args.grupoId, ...args.fila, creadoEn: args.ahora, actualizadoEn: args.ahora }, select: { id: true } });
}

/** Devuelve cuántas filas tocó: 0 si la versión ya no es la esperada. */
export async function actualizarAdmisionDeGrupo(tx: Tx, args: { id: string; versionEsperada: number; fila: FilaDeAdmisionDeGrupo; ahora: Date }): Promise<number> {
  const { count } = await tx.productoAdmiteGrupo.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { ...args.fila, version: { increment: 1 }, actualizadoEn: args.ahora },
  });
  return count;
}

export async function crearAdmisionDeOpcion(tx: Tx, args: { productoId: string; opcionId: string; fila: FilaDeAdmisionDeOpcion; ahora: Date }): Promise<{ id: string }> {
  const { diferencia, ...resto } = args.fila;
  return tx.productoAdmiteOpcion.create({
    data: { productoId: args.productoId, opcionId: args.opcionId, ...resto, ...columnasDeDiferencia(diferencia), creadoEn: args.ahora, actualizadoEn: args.ahora },
    select: { id: true },
  });
}

/** Devuelve cuántas filas tocó: 0 si la versión ya no es la esperada. */
export async function actualizarAdmisionDeOpcion(tx: Tx, args: { id: string; versionEsperada: number; fila: FilaDeAdmisionDeOpcion; ahora: Date }): Promise<number> {
  const { diferencia, ...resto } = args.fila;
  const { count } = await tx.productoAdmiteOpcion.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { ...resto, ...columnasDeDiferencia(diferencia), version: { increment: 1 }, actualizadoEn: args.ahora },
  });
  return count;
}
