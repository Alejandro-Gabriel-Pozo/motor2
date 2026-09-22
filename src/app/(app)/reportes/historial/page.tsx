import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { obtenerHistorialProducto, obtenerIngredientesRecetaVigente } from "@/core/reportes/historial-producto";
import { filtrarEventosKardex, type QueMostrar } from "@/core/reportes/historial-vistas";
import { HistorialFiltros } from "./historial-filtros";
import { TablaHistorialEventos } from "./tabla-historial";
import { GraficoSaldoCorriente } from "./grafico-saldo";
import { CartelSinStockPropio } from "./cartel-sin-stock-propio";

const VALORES_QUE_MOSTRAR: readonly QueMostrar[] = ["todo", "compras", "consumos-ventas", "ajustes-conteos"];

function comoQueMostrar(valor: string | undefined): QueMostrar {
  return (VALORES_QUE_MOSTRAR as readonly string[]).includes(valor ?? "") ? (valor as QueMostrar) : "todo";
}

export default async function HistorialProductoPage({
  searchParams,
}: {
  searchParams: Promise<{ productoId?: string; seccionId?: string; desde?: string; hasta?: string; queMostrar?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_operativos");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const secciones = await listarSeccionesActivas(ctx.sucursalId);
  const queMostrar = comoQueMostrar(sp.queMostrar);

  const historial = sp.productoId
    ? await obtenerHistorialProducto(
        ctx.sucursalId,
        sp.productoId,
        sp.seccionId || undefined,
        sp.desde ? new Date(sp.desde) : undefined,
        sp.hasta ? new Date(sp.hasta) : undefined
      )
    : null;

  // Solo para un PV sin stock propio (§4, decisiones 7-8) — para el resto, ni se consulta.
  const ingredientes = historial && !historial.tieneStockPropio ? await obtenerIngredientesRecetaVigente(historial.productoId) : null;

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
          queMostrar={queMostrar}
        />
      </div>

      {historial && (
        <div>
          <h2 className="mb-2 text-sm font-medium">
            {historial.codigo} — {historial.producto} ({historial.tipo})
            {historial.tieneStockPropio && ` — saldo actual: ${historial.saldoActual} ${historial.unidadStockNombre}`}
          </h2>
          <p className="mb-2 text-xs text-neutral-500">
            {historial.totalMovimientos} movimiento(s), {historial.totalConteos} conteo(s) en total
            {historial.tieneStockPropio && " (el saldo corriente arranca del primer movimiento real, no del rango elegido)"}.
          </p>
          {historial.tieneStockPropio ? (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium">Evolución del saldo</h3>
              {/* SIEMPRE el historial completo, nunca filtrado por "Qué mostrar" — ese filtro es solo para la tabla de abajo (declutter), no cambia qué pasó de verdad. */}
              <GraficoSaldoCorriente eventos={historial.eventos} unidadStockNombre={historial.unidadStockNombre} />
            </div>
          ) : (
            <CartelSinStockPropio productoId={historial.productoId} ingredientes={ingredientes ?? []} />
          )}
          <TablaHistorialEventos
            filas={filtrarEventosKardex(historial.eventos, queMostrar)}
            nombreExport={`historial-${historial.codigo}`}
            mostrarSaldo={historial.tieneStockPropio}
          />
        </div>
      )}
    </div>
  );
}
