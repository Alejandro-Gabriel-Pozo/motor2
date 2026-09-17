import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { obtenerHistorialProducto } from "@/core/reportes/historial-producto";
import { HistorialFiltros } from "./historial-filtros";
import { TablaHistorialEventos } from "./tabla-historial";
import { GraficoSaldoCorriente } from "./grafico-saldo";

export default async function HistorialProductoPage({
  searchParams,
}: {
  searchParams: Promise<{ productoId?: string; seccionId?: string; desde?: string; hasta?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const secciones = await listarSeccionesActivas(ctx.sucursalId);

  const historial = sp.productoId
    ? await obtenerHistorialProducto(
        ctx.sucursalId,
        sp.productoId,
        sp.seccionId || undefined,
        sp.desde ? new Date(sp.desde) : undefined,
        sp.hasta ? new Date(sp.hasta) : undefined
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Historial de un producto</h1>
        <HistorialFiltros
          secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
          productoId={sp.productoId ?? ""}
          productoEtiqueta={historial ? `${historial.codigo} — ${historial.producto}` : ""}
          seccionId={sp.seccionId ?? ""}
          desde={sp.desde ?? ""}
          hasta={sp.hasta ?? ""}
        />
      </div>

      {historial && (
        <div>
          <h2 className="mb-2 text-sm font-medium">
            {historial.codigo} — {historial.producto} ({historial.tipo}) — saldo actual: {historial.saldoActual} {historial.unidadStockNombre}
          </h2>
          <p className="mb-2 text-xs text-neutral-500">
            {historial.totalMovimientos} movimiento(s), {historial.totalConteos} conteo(s) en total (el saldo corriente arranca del primer movimiento
            real, no del rango elegido).
          </p>
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-medium">Evolución del saldo</h3>
            <GraficoSaldoCorriente eventos={historial.eventos} unidadStockNombre={historial.unidadStockNombre} />
          </div>
          <TablaHistorialEventos filas={historial.eventos} nombreExport={`historial-${historial.codigo}`} />
        </div>
      )}
    </div>
  );
}
