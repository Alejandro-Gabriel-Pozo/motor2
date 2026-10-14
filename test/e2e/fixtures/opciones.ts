import { prisma } from "./db";

/**
 * GO-2d: siembra del catálogo de opciones de venta para los specs de Playwright (directo en la base, como los otros specs de catálogo). Las tablas de opciones solo se agregan
 * (ni el rol de la app ni el de pruebas tienen DELETE, GO-1): lo sembrado no se borra al terminar, y por eso cada spec usa nombres con su propia marca. La base E2E se vacía
 * entera al empezar cada corrida.
 */

export type TipoDeGrupo = "MEDIDA" | "VARIANTE" | "INCLUIDA" | "ADICIONAL";

export interface OpcionASembrar {
  nombre: string;
  /** Diferencia en pesos (MONTO). Por defecto 0. */
  monto?: number;
  /** Diferencia en porcentaje (en vez de `monto`). */
  porcentaje?: number;
  /** Solo MEDIDA. */
  factorEscala?: number;
  esNinguna?: boolean;
  /** Solo ADICIONAL: el producto ancla que respalda el stock (un PV sin disponibilidad, como lo crea el caso de uso). */
  conAncla?: boolean;
  /** Consumos de la versión 1 (insumo MP y cantidad en su unidad de stock). */
  consumos?: { insumoProductoId: string; cantidad: number; efecto?: "SUMA" | "REEMPLAZA"; reemplazaAProductoId?: string }[];
}

export interface GrupoSembrado {
  grupoId: string;
  /** Por nombre de la opción. */
  opciones: Record<string, { opcionId: string; versionId: string; anclaId: string | null }>;
}

/** El usuario administrador de las pruebas (lo crea `fixtures/auth.ts` al pedir `paginaAutenticada` o `sucursalId`): carga las versiones sembradas. */
async function idDelAdminE2E(): Promise<string> {
  return (await prisma.user.findFirstOrThrow({ where: { email: "e2e-admin@local.test" }, select: { id: true } })).id;
}

export async function sembrarGrupo(args: { nombre: string; tipo: TipoDeGrupo; cantidadMinima: number; cantidadMaxima: number; opciones: OpcionASembrar[]; marca: string }): Promise<GrupoSembrado> {
  const creadoPorId = await idDelAdminE2E();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: args.nombre, tipo: args.tipo, cantidadMinima: args.cantidadMinima, cantidadMaxima: args.cantidadMaxima } });
  const opciones: GrupoSembrado["opciones"] = {};
  for (const [i, o] of args.opciones.entries()) {
    const anclaId = o.conAncla
      ? (await prisma.producto.create({ data: { codigo: `PV_E2E_ANCLA_${args.marca}_${i}`, nombre: `${o.nombre} (respaldo ${args.marca})`, tipo: "PV", unidadStockId: unidad.id } })).id
      : null;
    const opcion = await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: o.nombre, orden: (i + 1) * 10, esNinguna: o.esNinguna ?? false, ...(anclaId ? { productoId: anclaId } : {}) } });
    const enPorcentaje = o.porcentaje !== undefined;
    const version = await prisma.versionDeOpcion.create({
      data: {
        opcionId: opcion.id,
        numero: 1,
        tipoDeDiferencia: enPorcentaje ? "PORCENTAJE" : "MONTO",
        diferenciaPrecio: enPorcentaje ? null : (o.monto ?? 0).toFixed(2),
        porcentaje: enPorcentaje ? o.porcentaje!.toFixed(4) : null,
        factorEscala: o.factorEscala !== undefined ? o.factorEscala.toFixed(4) : null,
        creadoPorId,
      },
    });
    for (const [orden, c] of (o.consumos ?? []).entries()) {
      const insumo = await prisma.producto.findUniqueOrThrow({ where: { id: c.insumoProductoId }, select: { unidadStockId: true } });
      await prisma.consumoDeOpcion.create({
        data: {
          versionDeOpcionId: version.id,
          efecto: c.efecto ?? "SUMA",
          insumoProductoId: c.insumoProductoId,
          reemplazaAProductoId: c.reemplazaAProductoId ?? null,
          cantidad: c.cantidad.toFixed(4),
          unidadId: insumo.unidadStockId,
          orden,
        },
      });
    }
    opciones[o.nombre] = { opcionId: opcion.id, versionId: version.id, anclaId };
  }
  return { grupoId: grupo.id, opciones };
}

/**
 * Un producto de venta disponible en la sucursal (con precio de venta) que admite los grupos dados, en ese orden, con todas sus opciones. `modoPrecio` va en la MEDIDA (por
 * defecto DIFERENCIA); con ABSOLUTO, `preciosAbsolutos` da el precio del producto en cada tamaño (por nombre de opción).
 */
export async function sembrarProductoConOpciones(args: {
  nombre: string;
  codigo: string;
  precioVenta: number;
  sucursalId: string;
  grupos: { grupo: GrupoSembrado; modoPrecio?: "ABSOLUTO" | "DIFERENCIA"; preciosAbsolutos?: Record<string, number>; cantidadMinima?: number; cantidadMaxima?: number }[];
}): Promise<{ productoId: string }> {
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const producto = await prisma.producto.create({ data: { codigo: args.codigo, nombre: args.nombre, tipo: "PV", unidadStockId: unidad.id, precioVenta: args.precioVenta.toFixed(2) } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId: args.sucursalId, productoId: producto.id, disponible: true } });
  for (const [orden, g] of args.grupos.entries()) {
    const tipo = (await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: g.grupo.grupoId }, select: { tipo: true } })).tipo;
    await prisma.productoAdmiteGrupo.create({
      data: {
        productoId: producto.id,
        grupoId: g.grupo.grupoId,
        orden,
        modoPrecio: tipo === "MEDIDA" ? (g.modoPrecio ?? "DIFERENCIA") : null,
        cantidadMinima: g.cantidadMinima ?? null,
        cantidadMaxima: g.cantidadMaxima ?? null,
      },
    });
    for (const [nombre, o] of Object.entries(g.grupo.opciones)) {
      const absoluto = g.preciosAbsolutos?.[nombre];
      await prisma.productoAdmiteOpcion.create({
        data: { productoId: producto.id, opcionId: o.opcionId, cantidadMaxima: tipo === "ADICIONAL" ? 3 : 1, precioAbsoluto: absoluto !== undefined ? absoluto.toFixed(2) : null },
      });
    }
  }
  return { productoId: producto.id };
}
