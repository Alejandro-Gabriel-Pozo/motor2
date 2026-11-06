import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { listarMotivosDeCorreccionActivos } from "@/server/actions/movimientos/motivos";
import { obtenerCompraParaCorregir } from "@/server/consultas/reportes/compra-para-corregir";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { formatearNumeroComprobante, leerNumeroComprobante } from "@/core/datos/numero-comprobante";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { CorregirFacturaDosColumnas } from "./corregir-factura-dos-columnas";

/**
 * «Corregir una factura de compra», PASO 2 de 2 — otra página (etapa C0, docs/diseno-correccion-de-compras-2026-11-06.md). El original congelado a la izquierda y la copia editable con «qué cambia» a la derecha (dos columnas en
 * escritorio, apiladas en celular). Guarda por ejemplar: la original queda anulada con su motivo y un ejemplar nuevo la reemplaza.
 */
export default async function CorregirFacturaPagina({ params }: { params: Promise<{ operacionId: string }> }) {
  const { operacionId } = await params;
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario, antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;
  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "corregir_compra", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  const { editar: puedeCorregir } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "corregir_compra", ctx.db);
  if (!puedeCorregir) return <p className="text-error">Corregir compras requiere un permiso que tu rol no tiene.</p>;

  const datos = await obtenerCompraParaCorregir(ctx.sucursalId, operacionId, ctx.db, ctx.empresaZonaHoraria);
  if (!datos) return <p className="text-error">No encontramos esa factura en esta sucursal.</p>;
  const { compra: c, renglonesQueFijanElCosto } = datos;
  const motivos = await listarMotivosDeCorreccionActivos();
  const numero = c.nroFactura ? formatearNumeroComprobante(leerNumeroComprobante(c.nroFactura)) : "sin N.º de factura";
  const noSeCorrige = c.reemplazadaPorId
    ? "Esta factura ya fue corregida: la versión vigente es la corrección."
    : c.anuladaEn
      ? "Esta compra está anulada: no se corrige."
      : c.facturaProveedorId
        ? "Es parte de una factura repartida entre sucursales: se corrige la factura entera (etapa posterior)."
        : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/movimientos/corregir-compra" className="text-sm underline">
          ← Volver a la búsqueda
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Corregir la factura {numero}</h1>
        <ol className="flex gap-4 text-sm" aria-label="Pasos">
          <li className="text-tinta-tenue">1. Buscar la factura</li>
          <li className="font-semibold">2. Corregirla</li>
        </ol>
        <p className="mt-1 text-sm text-tinta-tenue">
          {c.proveedorNombre ?? "Sin proveedor"} · del {diaDeCalendario(c.fecha, ctx.empresaZonaHoraria)}
        </p>
      </div>
      {noSeCorrige ? (
        <p className="rounded border p-3 text-sm">{noSeCorrige}</p>
      ) : (
        <CorregirFacturaDosColumnas
          operacionId={c.idOperacion}
          motivos={motivos.map((m) => ({ id: m.id, nombre: m.nombre }))}
          sinProveedor={!c.proveedorNombre}
          renglones={c.renglones.map((l) => {
            return {
              idMovimiento: l.idMovimiento,
              producto: l.productoNombre,
              cantidad: l.cantidad,
              unidad: l.unidad,
              importeCentavos: Math.round(l.precioTotal * 100),
              esUltimaEntrada: renglonesQueFijanElCosto.has(l.idMovimiento),
            };
          })}
        />
      )}
    </div>
  );
}
