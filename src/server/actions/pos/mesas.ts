"use server";

import { prisma } from "@/lib/db";
import { esNumeroFinito } from "@/core/numero";
import { esErrorDeUnicidad } from "@/core/catalogo/generar-codigo";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

// Sin `export`: un archivo "use server" solo puede exportar funciones async (cada export es un endpoint).
const NUMERO_MESA_MAXIMO = 9999;

/**
 * Alta de una mesa del salón en la sucursal activa (módulo POS, docs/plan-mapa-de-mesas-2026-09-24.md, paso 3). Es la ÚNICA
 * escritura del mapa: sin baja ni renumeración. Abrir/cerrar cuentas vive en src/server/actions/pos/cuenta.ts («tomar pedido»).
 * Sin auditoría administrativa (no es un precio ni un permiso).
 *
 * El número es único por sucursal (`@@unique([sucursalId, numero])`): el choque se detecta en la base (P2002) y no con una
 * lectura previa, así dos altas simultáneas del mismo número no pueden pasar las dos.
 *
 * No llama a `refrescarVistaSiHaceFalta`: su único llamador (`NuevaMesa`, un componente de cliente) ya hace `router.refresh()`.
 */
export async function crearMesa(numero: number): Promise<ResultadoAccion> {
  return conPermiso("pos_mesas", async (ctx) => {
    if (!Number.isInteger(numero) || !esNumeroFinito(numero) || numero < 1 || numero > NUMERO_MESA_MAXIMO) {
      return error(`El número de mesa tiene que ser un entero entre 1 y ${NUMERO_MESA_MAXIMO}.`);
    }
    try {
      await prisma.mesa.create({ data: { sucursalId: ctx.sucursalId, numero } });
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error(`Ya existe la mesa ${numero} en esta sucursal.`);
      throw e;
    }
    return ok(`Mesa ${numero} creada.`);
  });
}
