import "server-only";
import type { Db } from "@/lib/db-tipos";
import { disponibilidadDeProductosEnSucursales } from "@/server/lecturas/catalogo/disponibilidad";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";

/*
 * CARTA-MANT F4 (ADR-034): la lectura del aviso «ESTE PRECIO SE MODIFICARÁ EN: …» de «Precios», «En toda la empresa». Vive en `server/lecturas` porque la consume una Server Action de
 * lectura (`avisoDePrecioDeEmpresa`, `src/server/actions/carta/precios-en-sucursales.ts`), no una página. Combina los dos lectores únicos de siempre: la disponibilidad por sucursal y el precio
 * local vigente (capacidad + fila habilitada).
 */

/** Una sucursal del aviso de «Aplicar a toda la empresa»: cuántos de los productos ven el precio nuevo, cuántos tienen ahí un precio local propio (no lo ven) y cuántos no se venden ahí. */
export interface SucursalDelAvisoDePrecio {
  nombre: string;
  loVen: number;
  conPrecioLocal: number;
  noLoVenden: number;
}

/** El aviso «ESTE PRECIO SE MODIFICARÁ EN: …»: las sucursales que quien lo pide VE (con su detalle) y cuántas otras sucursales activas de la empresa hay, que no se nombran. */
export interface AvisoDePrecioDeEmpresa {
  sucursales: SucursalDelAvisoDePrecio[];
  otras: number;
}

/**
 * CARTA-MANT F4 (decisión del dueño, 2026-10-14): para el aviso de «Aplicar a toda la empresa». El precio de lista de la empresa rige en una sucursal para un producto que se vende ahí (disponible) y
 * que NO tiene un precio local vigente (capacidad `precio_local` prendida y precio local habilitado: `preciosLocalesVigentes`, el lector único). `db` es la base con la LECTURA ensanchada a las
 * sucursales que el usuario ve (`lecturaEnSucursalesVisibles(ctx, "precio_local")`) y `sucursales`, esas mismas (de sus membresías, con su nombre: el nombre NO sale de esta consulta, así que una
 * sucursal fuera del alcance no se nombra aunque llegue por error; sus filas, por la RLS, no se ven). Las demás sucursales activas de la empresa solo se CUENTAN, sin nombrarlas (S-07; decisión del
 * dueño: «el cartel nombra solo las sucursales visibles por el usuario»).
 */
export async function avisoDelPrecioDeLaEmpresa(db: Db, sucursales: readonly { id: string; nombre: string }[], productoIds: readonly string[]): Promise<AvisoDePrecioDeEmpresa> {
  const ids = sucursales.map((x) => x.id);
  const [activas, disponibles] = await Promise.all([db.sucursal.count({ where: { activo: true } }), disponibilidadDeProductosEnSucursales(ids, productoIds, db)]);
  const detalle = await Promise.all(
    sucursales.map(async (x): Promise<SucursalDelAvisoDePrecio> => {
      const locales = await preciosLocalesVigentes(x.id, db, productoIds);
      const disp = disponibles.get(x.id) ?? new Map<string, boolean>();
      let loVen = 0;
      let conPrecioLocal = 0;
      let noLoVenden = 0;
      for (const id of productoIds) {
        if (disp.get(id) !== true) noLoVenden += 1;
        else if (locales.get(id)?.habilitado === true) conPrecioLocal += 1;
        else loVen += 1;
      }
      return { nombre: x.nombre, loVen, conPrecioLocal, noLoVenden };
    })
  );
  return { sucursales: [...detalle].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), otras: Math.max(0, activas - sucursales.length) };
}
