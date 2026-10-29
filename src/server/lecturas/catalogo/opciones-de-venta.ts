import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Las LECTURAS del catálogo de opciones de venta (GO-2a; ADR-030): lo que la pantalla de administración necesita mostrar y, de cada fila editable, la `version` que tiene que
 * mandar de vuelta como esperada. Sin guarda de permiso adentro (como `grupos.ts`): la pone la página o la acción que las use (GO-2b trae las pantallas); hoy las consumen los
 * tests. `select` explícito siempre (`sin-filas-enteras`): nunca una fila entera de `Producto`.
 *
 * La VERSIÓN VIGENTE de una opción es la de `numero` MAYOR (derivada, sin columna de bandera; ADR-030 §2): se lee con `orderBy: { numero: "desc" }, take: 1`, así que da lo mismo
 * en qué orden se cargaron las versiones. Rige desde que se carga (`creadoEn`, en UTC; la pantalla la muestra en la zona de la empresa con `formatearFechaHora`).
 *
 * Los `Decimal` pasan a `number` en este borde (importes de 2 decimales, porcentaje y factor de 4, cantidad de 4, merma de 2: todos exactos en un `number`); ninguna cuenta se hace acá.
 */

const SELECT_CONSUMO = {
  id: true,
  efecto: true,
  insumoProductoId: true,
  reemplazaAProductoId: true,
  cantidad: true,
  unidadId: true,
  mermaPorcentaje: true,
  escalaConLaMedida: true,
  orden: true,
} as const;

const SELECT_VERSION = {
  id: true,
  numero: true,
  tipoDeDiferencia: true,
  diferenciaPrecio: true,
  porcentaje: true,
  factorEscala: true,
  creadoPorId: true,
  creadoEn: true,
  consumos: { select: SELECT_CONSUMO, orderBy: { orden: "asc" } },
} as const;

interface FilaDeConsumo {
  id: string;
  efecto: string;
  insumoProductoId: string;
  reemplazaAProductoId: string | null;
  cantidad: unknown;
  unidadId: string;
  mermaPorcentaje: unknown;
  escalaConLaMedida: boolean;
  orden: number;
}

interface FilaDeVersion {
  id: string;
  numero: number;
  tipoDeDiferencia: string;
  diferenciaPrecio: unknown;
  porcentaje: unknown;
  factorEscala: unknown;
  creadoPorId: string;
  creadoEn: Date;
  consumos: FilaDeConsumo[];
}

const aNumero = (d: unknown): number | null => (d === null || d === undefined ? null : Number(d));

function consumoPlano(c: FilaDeConsumo) {
  return { ...c, cantidad: Number(c.cantidad), mermaPorcentaje: Number(c.mermaPorcentaje) };
}

function versionPlana(v: FilaDeVersion) {
  return {
    id: v.id,
    numero: v.numero,
    tipoDeDiferencia: v.tipoDeDiferencia,
    diferenciaPrecio: aNumero(v.diferenciaPrecio),
    porcentaje: aNumero(v.porcentaje),
    factorEscala: aNumero(v.factorEscala),
    creadoPorId: v.creadoPorId,
    creadoEn: v.creadoEn,
    consumos: v.consumos.map(consumoPlano),
  };
}

export type VersionDeOpcionLeida = ReturnType<typeof versionPlana>;

const SELECT_OPCION = { id: true, nombre: true, orden: true, activa: true, esNinguna: true, productoId: true, version: true } as const;

/**
 * Los grupos de la empresa con sus opciones y, de cada opción, la VERSIÓN VIGENTE con sus consumos, más cuántos productos admiten el grupo (filas activas). Tres consultas en total
 * para todo el catálogo (sin N+1: las versiones vigentes y el conteo van en la misma consulta de Prisma, por relación). `incluirInactivos: false` deja solo los grupos y las opciones activos.
 */
export async function listarGruposDeOpciones(db: Db, opciones: { incluirInactivos: boolean }) {
  const soloActivos = !opciones.incluirInactivos;
  const grupos = await db.grupoDeOpciones.findMany({
    where: soloActivos ? { activo: true } : {},
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      tipo: true,
      cantidadMinima: true,
      cantidadMaxima: true,
      activo: true,
      version: true,
      _count: { select: { productosQueLoAdmiten: { where: { activo: true } } } },
      opciones: {
        where: soloActivos ? { activa: true } : {},
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
        select: { ...SELECT_OPCION, versiones: { select: SELECT_VERSION, orderBy: { numero: "desc" }, take: 1 } },
      },
    },
  });
  return grupos.map(({ _count, opciones: ops, ...g }) => ({
    ...g,
    productosQueLoAdmiten: _count.productosQueLoAdmiten,
    opciones: ops.map(({ versiones, ...o }) => ({ ...o, vigente: versiones[0] ? versionPlana(versiones[0]) : null })),
  }));
}

/** Un grupo con TODAS sus opciones (activas o no) y el historial completo de versiones de cada una (la de número mayor primero: `versiones[0]` es la vigente). `null` si no existe (o es de otra empresa). */
export async function cargarGrupoDeOpciones(db: Db, grupoId: string) {
  const grupo = await db.grupoDeOpciones.findFirst({
    where: { id: grupoId },
    select: {
      id: true,
      nombre: true,
      tipo: true,
      cantidadMinima: true,
      cantidadMaxima: true,
      activo: true,
      version: true,
      // Fase 4 (ADR-035): «se lee en la carta como».
      prefijoEnCarta: true,
      creadoEn: true,
      actualizadoEn: true,
      opciones: {
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
        select: { ...SELECT_OPCION, producto: { select: { id: true, nombre: true, codigo: true } }, versiones: { select: SELECT_VERSION, orderBy: { numero: "desc" } } },
      },
    },
  });
  if (!grupo) return null;
  return {
    ...grupo,
    opciones: grupo.opciones.map(({ versiones, ...o }) => ({ ...o, versiones: versiones.map(versionPlana) })),
  };
}

/**
 * Lo que admite un producto: cada grupo (activo o no en el producto), con sus cantidades propias y su modo de precio, y las opciones de ese grupo que el producto admite, con su
 * tope y su precio o diferencia propios. Cada fila lleva su `version` (la esperada de la próxima edición). Dos consultas.
 */
export async function cargarAdmisionDeProducto(db: Db, productoId: string) {
  const [grupos, opciones] = await Promise.all([
    db.productoAdmiteGrupo.findMany({
      where: { productoId },
      orderBy: [{ orden: "asc" }, { grupoId: "asc" }],
      select: {
        id: true,
        grupoId: true,
        orden: true,
        cantidadMinima: true,
        cantidadMaxima: true,
        modoPrecio: true,
        activo: true,
        seMuestraEnCarta: true,
        version: true,
        grupo: { select: { nombre: true, tipo: true, cantidadMinima: true, cantidadMaxima: true, activo: true } },
      },
    }),
    db.productoAdmiteOpcion.findMany({
      where: { productoId },
      orderBy: { opcionId: "asc" },
      select: {
        id: true,
        opcionId: true,
        cantidadMaxima: true,
        precioAbsoluto: true,
        tipoDeDiferencia: true,
        diferenciaPrecio: true,
        porcentaje: true,
        activo: true,
        version: true,
        opcion: { select: { grupoId: true, nombre: true, activa: true, esNinguna: true } },
      },
    }),
  ]);
  return grupos.map((g) => ({
    ...g,
    opciones: opciones
      .filter((o) => o.opcion.grupoId === g.grupoId)
      .map((o) => ({ ...o, precioAbsoluto: aNumero(o.precioAbsoluto), diferenciaPrecio: aNumero(o.diferenciaPrecio), porcentaje: aNumero(o.porcentaje) })),
  }));
}

/** Las opciones APAGADAS en una sucursal (ADR-009 familia `optout`: sin fila = prendida; una fila con `apagada = false` también es prendida). La RLS por sucursal solo deja ver las del alcance. */
export async function opcionesApagadasEnSucursal(db: Db, sucursalId: string) {
  return db.opcionApagadaEnSucursal.findMany({
    where: { sucursalId, apagada: true },
    orderBy: { opcionId: "asc" },
    select: { opcionId: true, actualizadoPorId: true, actualizadoEn: true },
  });
}
