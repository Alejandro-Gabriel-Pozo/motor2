import "server-only";
import type { Db } from "@/lib/db-tipos";
import { armarVentasPorOpcion, type FilaVentaPorOpcion } from "@/core/reportes/public";
import { ZONA_ARGENTINA, rangoDeDias } from "@/core/tiempo/zona-horaria";

/**
 * «Ventas por opción» de Período (ventas con opciones, 2026-10-29): de las ventas vigentes de la sucursal en el rango, unidades, importe y costo de cada opción elegida DENTRO del precio. La fuente de
 * verdad ya existe, sin migración: `OpcionElegidaEnLinea` (la foto de lo elegido) → `CuentaItem.operacionId` → `Operacion` → filas VENTA de `MovimientoStock`.
 *
 * Mismo filtro que «Ventas por producto»: la sucursal por la sección de la fila VENTA, el rango de días cortado en la zona de la empresa (`rangoDeDias`, como Período y Tickets) y las operaciones
 * anuladas afuera (la anulación es de la operación entera; los ítems anulados antes de cobrar ya vienen netos en la operación). Los ADICIONALES no van (aparecen como su producto ancla). La foto se
 * deduplica por (operación, opción): una línea de ×2 puede venir de dos ítems con la misma foto. Se agrega en SQL (como `ventas-sin-receta.ts`): una fila por (producto, grupo, opción).
 *
 * (Sin asteriscos con espacio antes en la lista de columnas: el guardián de campos sensibles lee un `*` como «devuelve todo» y falla cerrado.)
 * El aislamiento lo hace el `db` recibido (RLS por empresa y sucursal; la foto es `HEREDADA` de `CuentaItem`) más el filtro explícito por sucursal. No lee `VersionDeOpcion` ni `ConsumoDeOpcion`.
 */
export async function generarVentasPorOpcion(sucursalId: string, desdeIn: Date, hastaIn: Date, db: Db, zona: string = ZONA_ARGENTINA): Promise<FilaVentaPorOpcion[]> {
  const { desde, hasta } = rangoDeDias(desdeIn, hastaIn, zona);
  const filas = await db.$queryRaw<
    Array<{
      productoId: string;
      producto: string;
      grupoId: string;
      grupo: string;
      opcionId: string;
      opcion: string;
      unidades: string;
      importeCentavos: bigint;
      costoCentavos: bigint;
      ventas: bigint;
      ventasSinCosto: bigint;
    }>
  >`
    WITH ventas AS (
      SELECT m."operacionId", m."productoId", max(o."fecha") AS "fecha",
             sum(abs(m."cantidad")) AS "unidades",
             sum(m."precioTotal") AS "importe",
             sum(abs(m."cantidad")*m."costoUnitarioVenta") AS "costo",
             count(*) AS "ventas",
             count(*) FILTER (WHERE m."costoUnitarioVenta" IS NULL) AS "ventasSinCosto"
      FROM "MovimientoStock" m
      JOIN "Operacion" o ON o."id" = m."operacionId"
      JOIN "Seccion" s ON s."id" = m."seccionId"
      WHERE m."proceso" = 'VENTA' AND s."sucursalId" = ${sucursalId}
        AND o."anuladaEn" IS NULL AND o."fecha" >= ${desde} AND o."fecha" <= ${hasta}
      GROUP BY m."operacionId", m."productoId"
    ),
    fotos AS (
      SELECT DISTINCT ON (ci."operacionId", oe."opcionId")
             ci."operacionId", ci."productoId", oe."grupoId", oe."opcionId", oe."nombreGrupo", oe."nombreOpcion"
      FROM "OpcionElegidaEnLinea" oe
      JOIN "CuentaItem" ci ON ci."id" = oe."cuentaItemId" AND ci."empresaId" = oe."empresaId"
      WHERE oe."tipoGrupo" <> 'ADICIONAL' AND ci."operacionId" IN (SELECT "operacionId" FROM ventas)
      ORDER BY ci."operacionId", oe."opcionId", ci."creadoEn" DESC, ci."id"
    )
    SELECT v."productoId", p."nombre" AS "producto", f."grupoId", f."opcionId",
           (array_agg(f."nombreGrupo" ORDER BY v."fecha" DESC))[1] AS "grupo",
           (array_agg(f."nombreOpcion" ORDER BY v."fecha" DESC))[1] AS "opcion",
           sum(v."unidades")::text AS "unidades",
           round(sum(v."importe")*100)::bigint AS "importeCentavos",
           round(coalesce(sum(v."costo"), 0)*100)::bigint AS "costoCentavos",
           sum(v."ventas")::bigint AS "ventas",
           sum(v."ventasSinCosto")::bigint AS "ventasSinCosto"
    FROM ventas v
    JOIN fotos f ON f."operacionId" = v."operacionId" AND f."productoId" = v."productoId"
    JOIN "Producto" p ON p."id" = v."productoId"
    GROUP BY v."productoId", p."nombre", f."grupoId", f."opcionId"
  `;
  return armarVentasPorOpcion(
    filas.map((f) => ({
      productoId: f.productoId,
      producto: f.producto,
      grupoId: f.grupoId,
      grupo: f.grupo,
      opcionId: f.opcionId,
      opcion: f.opcion,
      unidades: Number(f.unidades),
      importeCentavos: Number(f.importeCentavos),
      costoCentavos: Number(f.costoCentavos),
      ventas: Number(f.ventas),
      ventasSinCosto: Number(f.ventasSinCosto),
    }))
  );
}
