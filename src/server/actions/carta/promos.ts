"use server";

import { mensajePisoDePromo, pisoDePrecioDePromo } from "@/core/carta/piso-de-promo";
import { validarCantidadCupoPromo } from "@/core/carta/validaciones";
import { guardComandoGuardarPromoCarta } from "@/core/features/carta/promos.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso, conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { guardarPrecioLocalPromoCartaCasoDeUso } from "./casos-de-uso/guardar-precio-local-promo-carta";
import { guardarPromoCartaCasoDeUso } from "./casos-de-uso/guardar-promo-carta";
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

/**
 * Alta (sin `id`) o edición (con `id`) de una promo de la empresa. Desde el Hito 4 de la pureza (bloque 4.2, paso H4C-2) es un adaptador fino: permiso
 * (`conPermisoDeEmpresa("carta_promo_definir")`) → formato de los datos (`guardComandoGuardarPromoCarta`, core/features/carta/promos.guard.ts, DENTRO del
 * envoltorio) → caso de uso (`casos-de-uso/guardar-promo-carta.ts`: la sección, la promo, la escritura en server/persistencia/carta/promos.ts y la auditoría del
 * precio en la misma transacción) → revalidar la carta pública si salió bien (las dos ramas revalidaban, los rechazos no) → `aResultadoAccion`.
 */
export async function guardarPromoCarta(datos: DatosPromoCarta): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_promo_definir", async (ctx) => {
    const comando = guardComandoGuardarPromoCarta(datos);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarPromoCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
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
 * caso que el precio de la empresa (`core/carta/piso-de-promo.ts`). Si la sucursal todavía no la ofrece, la fila se crea apagada: el precio queda
 * guardado pero no la prende (prender es otra acción, con su propia clave).
 *
 * Desde el Hito 4 de la pureza (bloque 4.2, paso H4C-2) es un adaptador fino: permiso (`conPermiso("carta_promo_precio_local")`) → caso de uso
 * (`casos-de-uso/guardar-precio-local-promo-carta.ts`: la promo, el precio y su piso, el precio anterior, la escritura en server/persistencia/carta/promos.ts y
 * su auditoría) → revalidar la carta pública si salió bien → `aResultadoAccion`. Sin guard: el precio se valida DESPUÉS de leer la promo (`SIN_GUARD`).
 */
export async function guardarPrecioLocalPromoCarta(promoCartaId: string, precioLocal: number | string | null): Promise<ResultadoAccion> {
  return conPermiso("carta_promo_precio_local", async (ctx) => {
    const resultado = await guardarPrecioLocalPromoCartaCasoDeUso(ctx, { promoCartaId, precioLocal });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
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
