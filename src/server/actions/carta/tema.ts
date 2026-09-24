"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { contarValoresTema, validarValoresTema } from "@/core/carta/tema";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Tema visual de la carta pública de una sucursal (docs/plan-tema-carta-2026-09-24.md, M8): lo que restaurant-menu-design lee
 * por GET /api/carta/[sucursal]/tema en lugar de la tab "Config" de la sheet del tenant. Solo escriben en `TemaCartaSucursal`
 * (lo fija test/arquitectura/carta-solo-lectura.test.ts). Gate: `carta`, la misma acción que el resto del admin de la carta (no
 * hace falta una migración de permisos).
 *
 * Reciben el `Sucursal.id` (la fila es 1:1 con la sucursal; la pantalla trabaja sobre la sucursal activa). Guardar y aplicar son
 * acciones separadas (D4): un tema guardado sin aplicar es un borrador y la carta sigue con la sheet.
 */

/**
 * Guarda los valores del tema (reemplaza TODO lo guardado por lo que llega: el formulario manda las 67 claves). Valida con
 * `validarValoresTema`: normaliza, ignora lo que no es del catálogo (incluidas las `precio_*`, convención fija del sistema) y, si
 * hay errores, devuelve hasta 5 juntos sin escribir nada. `upsert` por `sucursalId`: al crear la fila no toca `aplicarEnCarta`
 * (queda en borrador); al editar, un tema ya aplicado sigue aplicado.
 */
export async function guardarTemaCarta(sucursalId: string, valores: Readonly<Record<string, unknown>>): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const validados = validarValoresTema(valores);
    if (!validados.ok) return error(validados.mensaje);

    const sucursal = await prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { nombre: true } });
    if (!sucursal) return error("No se encontró la sucursal.");

    const json = validados.valor as Prisma.InputJsonObject;
    const fila = await prisma.temaCartaSucursal.upsert({
      where: { sucursalId },
      create: { sucursalId, valores: json },
      update: { valores: json },
      select: { aplicarEnCarta: true },
    });
    const cantidad = Object.keys(validados.valor).length;
    const estado = fila.aplicarEnCarta ? "Está aplicado: la carta toma los cambios en hasta 5 minutos." : "Es un borrador: la carta sigue con la sheet hasta que lo apliques.";
    return ok(`Tema de "${sucursal.nombre}" guardado (${cantidad} ${cantidad === 1 ? "valor cargado" : "valores cargados"}; el resto usa el default de la carta). ${estado}`);
  });
}

/**
 * Aplica o desaplica el tema en la carta. Aplicar exige que el tema exista y tenga al menos un valor válido (no se aplica un tema
 * vacío, D4). Si la sucursal no está en el portal (o no está publicada) se guarda igual y se avisa: no tiene efecto hasta que la
 * carta la conozca. Desaplicar es la vuelta atrás: la carta vuelve a la tab Config de la sheet y los valores se conservan.
 */
export async function cambiarAplicacionTema(sucursalId: string, aplicar: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const fila = await prisma.temaCartaSucursal.findUnique({
      where: { sucursalId },
      select: { valores: true, sucursal: { select: { nombre: true, publica: { select: { publicada: true } } } } },
    });
    if (!fila) return error("Esta sucursal todavía no tiene tema: guardalo primero.");
    const nombre = fila.sucursal.nombre;

    if (!aplicar) {
      await prisma.temaCartaSucursal.update({ where: { sucursalId }, data: { aplicarEnCarta: false } });
      return ok(`Tema de "${nombre}" desaplicado: la carta vuelve a la tab Config de la sheet (los valores guardados se conservan).`);
    }

    if (contarValoresTema(fila.valores) === 0) return error("No se puede aplicar un tema vacío: cargá al menos un valor y guardalo.");
    await prisma.temaCartaSucursal.update({ where: { sucursalId }, data: { aplicarEnCarta: true } });
    const publica = fila.sucursal.publica;
    if (!publica) return ok(`Tema de "${nombre}" aplicado, pero sin efecto hasta agregarla al portal (Portal de sucursales).`);
    if (!publica.publicada) return ok(`Tema de "${nombre}" aplicado, pero sin efecto hasta publicarla en el portal.`);
    return ok(`Tema de "${nombre}" aplicado: la carta lo toma en hasta 5 minutos.`);
  });
}
