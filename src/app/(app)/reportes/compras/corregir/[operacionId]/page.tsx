import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { listarComprasRegistradas } from "@/server/consultas/reportes/compras-registradas";
import { obtenerCostoActualPorMP } from "@/server/lecturas/reportes/comun";
import { formatearNumeroComprobante, leerNumeroComprobante } from "@/core/datos/numero-comprobante";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { CorregirFacturaDosColumnas } from "./corregir-factura-dos-columnas";

/**
 * MAQUETA (rama temporal, no se mergea): «Corregir una factura de compra», PASO 2 de 2 — otra página. El original congelado a la izquierda y la copia editable con «qué cambia» a la derecha (dos columnas en
 * escritorio, apiladas en celular). Pantalla real con el stock real; muestra y calcula, NO guarda (docs/diseno-correccion-de-compras-2026-11-06.md).
 */
export default async function CorregirFacturaPagina({ params }: { params: Promise<{ operacionId: string }> }) {
  const { operacionId } = await params;
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_compras", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { items } = await listarComprasRegistradas(ctx.sucursalId, {}, ctx.db, ctx.empresaZonaHoraria);
  const c = items.find((x) => x.idOperacion === operacionId);
  if (!c) return <p className="text-error">No encontramos esa factura en esta sucursal.</p>;

  const productos = await ctx.db.producto.findMany({ where: { codigo: { in: c.renglones.map((l) => l.productoCodigo) } }, select: { id: true, codigo: true } });
  const idPorCodigo = new Map(productos.map((p) => [p.codigo, p.id]));
  const saldos = await ctx.db.movimientoStock.groupBy({ by: ["productoId"], where: { productoId: { in: productos.map((p) => p.id) }, seccion: { sucursalId: ctx.sucursalId } }, _sum: { cantidad: true } });
  const saldoDe = new Map(saldos.map((x) => [x.productoId, Number(x._sum.cantidad ?? 0)]));
  const costos = await obtenerCostoActualPorMP(ctx.sucursalId, ctx.db);
  const numero = c.nroFactura ? formatearNumeroComprobante(leerNumeroComprobante(c.nroFactura)) : "sin N.º de factura";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/reportes/compras/corregir" className="text-sm underline">
          ← Volver a la búsqueda
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Corregir la factura {numero}</h1>
        <ol className="flex gap-4 text-sm" aria-label="Pasos">
          <li className="text-tinta-tenue">1. Buscar la factura</li>
          <li className="font-semibold">2. Corregirla</li>
        </ol>
        <p className="mt-1 text-sm text-tinta-tenue">
          {c.proveedorNombre ?? "Sin proveedor"} · del {diaDeCalendario(c.fecha, ctx.empresaZonaHoraria)} · cargada por {c.cargadaPor}
        </p>
      </div>
      {c.anuladaEn || c.facturaProveedorId ? (
        <p className="rounded border p-3 text-sm">{c.anuladaEn ? "Esta compra está anulada: no se corrige." : "Es parte de una factura repartida entre sucursales: se corrige la factura entera (etapa posterior)."}</p>
      ) : (
        <CorregirFacturaDosColumnas
          sinProveedor={!c.proveedorNombre}
          renglones={c.renglones.map((l) => {
            const productoId = idPorCodigo.get(l.productoCodigo) ?? "";
            const costo = costos.get(productoId);
            return {
              idMovimiento: l.idMovimiento,
              producto: l.productoNombre,
              cantidad: l.cantidad,
              unidad: l.unidad,
              importeCentavos: Math.round(l.precioTotal * 100),
              saldo: saldoDe.get(productoId) ?? 0,
              esUltimaEntrada: Boolean(costo?.fecha && costo.fecha.getTime() === c.fecha.getTime() && Math.round(costo.precioPorUnidadStock * 100) === Math.round(l.precioPorUnidadStock * 100)),
            };
          })}
        />
      )}
    </div>
  );
}
