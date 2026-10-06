"use server";

import { precioMinimoPromo } from "@/core/pos/public";
import { seleccionDeSucursalDePromo } from "@/core/carta/promo-sucursal";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import {
  validarCantidadCupoPromo,
  validarOrdenCarta,
  validarPrecioCarta,
  validarTextoLibreCarta,
  LARGO_MAXIMO_DESCRIPCION_CARTA,
  LARGO_MAXIMO_TITULO_CARTA,
} from "@/core/carta/validaciones";
import { conPermiso, conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Promos de la carta (docs/plan-carta-catalogo-2026-09-24.md, M9, D5): título, descripción y precio dentro de una sección de
 * carta. Desde 2026-10-01 una promo es de la EMPRESA (se define una vez) y cada sucursal la prende, la apaga y, si quiere, le
 * pone su precio (`PromoCartaSucursal`). Una clave por acción: definir/cupos/apagado general = `carta_promo_definir` (empresa);
 * prender o apagar en la sucursal activa = `carta_promo_activar`; precio local = `carta_promo_precio_local` (sucursal: las dos
 * escriben solo la fila de la sucursal ACTIVA de quien llama). Nunca se borran: se apagan.
 *
 * SIN ningún cupo (`guardarCuposPromoCarta` nunca la tocó, o se le guardó una lista vacía): sigue siendo puramente
 * INFORMATIVA, no referencia productos ni mueve stock — el POS la ignora (`selector-carta.ts`). CON uno o más cupos
 * (Task #16, docs/plan-promo-combo-2026-09-26.md): pasa a ser ARMABLE, ver el docstring de `PromoCarta` en schema.prisma.
 */

export interface DatosPromoCarta {
  /** Sin id = alta; con id = edición. */
  id?: string;
  seccionCartaId: string;
  titulo: string;
  descripcion?: string | null;
  precio: number | string;
  orden?: number | string | null;
}

export async function guardarPromoCarta(datos: DatosPromoCarta): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_promo_definir", async (ctx) => {
    const titulo = validarTextoLibreCarta(datos.titulo, "El título", LARGO_MAXIMO_TITULO_CARTA);
    if (!titulo.ok) return error(titulo.mensaje);
    if (!titulo.valor) return error("La promo necesita un título.");
    const tituloDePromo = titulo.valor;
    const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
    if (!descripcion.ok) return error(descripcion.mensaje);
    const precio = validarPrecioCarta(datos.precio);
    if (!precio.ok) return error(precio.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);

    const seccion = await ctx.db.seccionCarta.findUnique({ where: { id: datos.seccionCartaId } });
    if (!seccion) return error("No se encontró la sección de carta.");

    const data = { seccionCartaId: seccion.id, titulo: titulo.valor, descripcion: descripcion.valor, precio: precio.valor, orden: orden.valor };
    if (datos.id) {
      const existente = await ctx.db.promoCarta.findUnique({ where: { id: datos.id } });
      if (!existente) return error("No se encontró la promo.");
      // El cambio y su rastro van en UNA transacción (Pureza 0.7): un precio de promo cambiado sin dejar quién ni cuándo no puede existir.
      await ctx.transaccion(async (tx) => {
        await tx.promoCarta.update({ where: { id: existente.id }, data });
        if (Number(existente.precio) !== precio.valor) await auditarPrecioDePromo(tx, ctx.usuarioId, existente.id, tituloDePromo, Number(existente.precio), precio.valor);
      });
      revalidarCartasPublicas();
      return ok(`Promo "${titulo.valor}" guardada.`);
    }
    // La sucursal desde la que se crea la ofrece desde el primer momento; las demás la prenden cuando quieran (opt-in, sin fila = no la ofrecen).
    await ctx.transaccion(async (tx) => {
      const creada = await tx.promoCarta.create({ data: { ...data, sucursales: { create: { sucursalId: ctx.sucursalId } } } });
      await auditarPrecioDePromo(tx, ctx.usuarioId, creada.id, tituloDePromo, null, precio.valor);
    });
    revalidarCartasPublicas();
    return ok(`Promo "${titulo.valor}" creada en "${seccion.nombre}" y prendida en esta sucursal.`);
  });
}

/** Apagado GENERAL de la promo (todas las sucursales): una promo apagada en la empresa no se ofrece en ninguna, tenga lo que tenga cada sucursal. */
export async function actualizarActivaPromoCarta(promoCartaId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_promo_definir", async (ctx) => {
    const existente = await ctx.db.promoCarta.findUnique({ where: { id: promoCartaId } });
    if (!existente) return error("No se encontró la promo.");
    await ctx.db.promoCarta.update({ where: { id: promoCartaId }, data: { activa } });
    revalidarCartasPublicas();
    return ok(`Promo "${existente.titulo}" ${activa ? "activada" : "desactivada"} en toda la empresa.`);
  });
}

/** Prende o apaga la promo EN LA SUCURSAL ACTIVA (apagada no va en la carta ni en el POS de esta sucursal; las demás no se tocan). */
export async function actualizarActivaPromoCartaEnSucursal(promoCartaId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta_promo_activar", async (ctx) => {
    const existente = await ctx.db.promoCarta.findUnique({ where: { id: promoCartaId } });
    if (!existente) return error("No se encontró la promo.");
    await ctx.db.promoCartaSucursal.upsert({
      where: { promoCartaId_sucursalId: { promoCartaId, sucursalId: ctx.sucursalId } },
      create: { promoCartaId, sucursalId: ctx.sucursalId, activa },
      update: { activa },
    });
    revalidarCartasPublicas();
    return ok(`Promo "${existente.titulo}" ${activa ? "prendida" : "apagada"} en esta sucursal.`);
  });
}

/**
 * Precio de la promo SOLO en la sucursal activa (`null`/vacío = vuelve al precio de la empresa). Mismo piso de $0,01 por unidad en el peor
 * caso que el precio de la empresa (`precioMinimoPromo`). Si la sucursal todavía no la ofrece, la fila se crea apagada: el precio queda
 * guardado pero no la prende (prender es otra acción, con su propia clave).
 */
export async function guardarPrecioLocalPromoCarta(promoCartaId: string, precioLocal: number | string | null): Promise<ResultadoAccion> {
  return conPermiso("carta_promo_precio_local", async (ctx) => {
    const promo = await ctx.db.promoCarta.findUnique({ where: { id: promoCartaId }, include: { cupos: { select: { cantidadMaxima: true } } } });
    if (!promo) return error("No se encontró la promo.");

    let valor: number | null = null;
    if (precioLocal !== null && String(precioLocal).trim() !== "") {
      const precio = validarPrecioCarta(precioLocal);
      if (!precio.ok) return error(precio.mensaje);
      valor = precio.valor;
      const piso = pisoDePrecioDePromo(promo.cupos);
      if (piso !== null && valor < piso.minimo) return error(mensajePisoDePromo(promo.titulo, valor, piso));
    }
    await ctx.transaccion(async (tx) => {
      // El precio anterior se lee por la relación de la promo (el embudo `seleccionDeSucursalDePromo`, ver promo-sucursal-en-un-solo-lugar.test.ts), en la misma transacción que lo cambia.
      const previa = await tx.promoCarta.findUnique({ where: { id: promoCartaId }, select: { sucursales: seleccionDeSucursalDePromo(ctx.sucursalId) } });
      const precioAnterior = previa?.sucursales[0]?.precioLocal != null ? Number(previa.sucursales[0].precioLocal) : null;
      await tx.promoCartaSucursal.upsert({
        where: { promoCartaId_sucursalId: { promoCartaId, sucursalId: ctx.sucursalId } },
        create: { promoCartaId, sucursalId: ctx.sucursalId, activa: false, precioLocal: valor },
        update: { precioLocal: valor },
      });
      if (precioAnterior !== valor) {
        await registrarCambioAuditado(tx, {
          entidad: "PromoCartaSucursal",
          entidadId: `${promoCartaId}:${ctx.sucursalId}`,
          campo: "precioLocal",
          descripcion: `Promo "${promo.titulo}": precio en esta sucursal`,
          valorAnterior: precioAnterior,
          valorNuevo: valor,
          actorId: ctx.usuarioId,
          sucursalId: ctx.sucursalId,
        });
      }
    });
    revalidarCartasPublicas();
    return ok(valor === null ? `"${promo.titulo}" vuelve al precio de la empresa en esta sucursal.` : `Precio de "${promo.titulo}" en esta sucursal: $${valor}.`);
  });
}

/** El piso de precio de una promo con estos cupos (peor caso: todos en su máximo), o null si no tiene cupos (informativa: sin piso). */
function pisoDePrecioDePromo(cupos: readonly { cantidadMaxima: number }[]): { minimo: number; unidades: number } | null {
  if (!cupos.length) return null;
  const unidades = cupos.reduce((suma, c) => suma + c.cantidadMaxima, 0);
  return { minimo: precioMinimoPromo([{ cantidad: unidades }]), unidades };
}

function mensajePisoDePromo(titulo: string, precio: number, piso: { minimo: number; unidades: number }): string {
  return (
    `El precio de "${titulo}" ($${precio}) no alcanza el piso de $0,01 por unidad en el peor caso ` +
    `(${piso.unidades} unidades si se elige el máximo de cada cupo: hace falta al menos $${piso.minimo}). Subí el precio o bajá los máximos.`
  );
}

/** Un cupo tal como lo manda el formulario del admin (paso 5, docs/plan-promo-combo-2026-09-26.md). */
export interface DatosCupoPromoCarta {
  seccionCartaId: string;
  /** Vacío/null → 0 (D1: el mínimo por defecto es 0). */
  cantidadMinima?: number | string | null;
  cantidadMaxima: number | string;
}

/**
 * Reemplaza TODOS los cupos de una promo, todo o nada (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): la lista que llega
 * es la lista final — un cupo que no está en `cupos` se borra. Una lista VACÍA vuelve la promo a informativa (sin backfill: no
 * hay forma de "recuperar" cupos borrados salvo cargarlos de nuevo). Gate: `carta_promo_definir` (empresa: los cupos son de la promo, valen para todas las sucursales).
 *
 * Validación:
 * - cada cupo elige una `SeccionCarta` que existe, sin repetir sección entre cupos de la MISMA promo (`@@unique` de
 *   `PromoCartaCupo`, pero se valida antes para un mensaje claro en vez de un error de unicidad crudo);
 * - `cantidadMinima` (0 por defecto) ≤ `cantidadMaxima`, las dos enteras entre 0 y 999;
 * - el precio de la promo tiene que alcanzar el PISO de $0,01 por unidad en el PEOR CASO (todos los cupos en su máximo) —
 *   `precioMinimoPromo` (`src/core/pos/promo-combo.ts`, D3): sin esto, una elección real podría no tener forma de prorratear
 *   sin dejar algún componente en $0 (`prorratearPrecioPromo` vuelve a validarlo, por si la composición real de una
 *   instancia queda más chica que el peor caso, D1).
 */
export async function guardarCuposPromoCarta(promoCartaId: string, cupos: readonly DatosCupoPromoCarta[]): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_promo_definir", async (ctx) => {
    const promo = await ctx.db.promoCarta.findUnique({ where: { id: promoCartaId }, include: { sucursales: { select: { precioLocal: true } } } });
    if (!promo) return error("No se encontró la promo.");

    const seccionIds = new Set<string>();
    const cuposValidados: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number; orden: number }[] = [];
    for (const [i, c] of cupos.entries()) {
      if (!c.seccionCartaId) return error("Elegí la sección de cada cupo.");
      if (seccionIds.has(c.seccionCartaId)) return error("No se puede repetir la misma sección de carta en dos cupos de la misma promo.");
      seccionIds.add(c.seccionCartaId);

      const minima = validarCantidadCupoPromo(c.cantidadMinima, "La cantidad mínima", 0);
      if (!minima.ok) return error(minima.mensaje);
      const maxima = validarCantidadCupoPromo(c.cantidadMaxima, "La cantidad máxima");
      if (!maxima.ok) return error(maxima.mensaje);
      if (maxima.valor < 1) return error("La cantidad máxima de un cupo tiene que ser al menos 1.");
      if (minima.valor > maxima.valor) return error("En cada cupo, el mínimo no puede ser mayor que el máximo.");

      cuposValidados.push({ seccionCartaId: c.seccionCartaId, cantidadMinima: minima.valor, cantidadMaxima: maxima.valor, orden: i });
    }

    if (cuposValidados.length) {
      const secciones = await ctx.db.seccionCarta.findMany({ where: { id: { in: [...seccionIds] } }, select: { id: true } });
      if (secciones.length !== seccionIds.size) return error("Alguna sección de carta de los cupos no existe.");

      // D3: peor caso = todos los cupos en su máximo — el precio tiene que alcanzar el piso de $0,01 por unidad ahí también,
      // no solo en la elección mínima.
      // Vale para el precio de la empresa y para el precio local de CUALQUIER sucursal que lo tenga.
      const piso = pisoDePrecioDePromo(cuposValidados)!;
      for (const precio of [Number(promo.precio), ...promo.sucursales.flatMap((s) => (s.precioLocal !== null ? [Number(s.precioLocal)] : []))]) {
        if (precio < piso.minimo) return error(mensajePisoDePromo(promo.titulo, precio, piso));
      }
    }

    await ctx.transaccion(async (tx) => {
      await tx.promoCartaCupo.deleteMany({ where: { promoCartaId } });
      if (cuposValidados.length) await tx.promoCartaCupo.createMany({ data: cuposValidados.map((c) => ({ promoCartaId, ...c })) });
    });

    return ok(
      cuposValidados.length
        ? `Cupos de "${promo.titulo}" guardados (${cuposValidados.length}): ahora es una promo armable en el POS.`
        : `"${promo.titulo}" volvió a ser informativa (sin cupos): el POS deja de ofrecerla para armar.`
    );
  });
}

/** Deja en la auditoría quién cambió (o definió) el precio de una promo de la empresa y cuándo; va dentro de la transacción del cambio. */
async function auditarPrecioDePromo(tx: Parameters<typeof registrarCambioAuditado>[0], actorId: string, promoCartaId: string, titulo: string, anterior: number | null, nuevo: number) {
  await registrarCambioAuditado(tx, {
    entidad: "PromoCarta",
    entidadId: promoCartaId,
    campo: "precio",
    descripcion: `Promo "${titulo}": precio`,
    valorAnterior: anterior,
    valorNuevo: nuevo,
    actorId,
  });
}
