import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { obtenerHistorialProducto, obtenerIngredientesRecetaVigente } from "@/core/reportes/historial-producto";
import { agruparVentasPorDia, filtrarEventosKardex, resolverRangoHistorial, resumirCompras, type QueMostrar, type RangoHistorial } from "@/core/reportes/historial-vistas";
import { HistorialFiltros } from "./historial-filtros";
import { TablaHistorialEventos } from "./tabla-historial";
import { GraficoSaldoCorriente } from "./grafico-saldo";
import { CartelSinStockPropio } from "./cartel-sin-stock-propio";
import { ComoSeCompro } from "./como-se-compro";
import { ComoSeVendio } from "./como-se-vendio";

const VALORES_QUE_MOSTRAR: readonly QueMostrar[] = ["todo", "compras", "consumos-ventas", "ajustes-conteos"];

function comoQueMostrar(valor: string | undefined): QueMostrar {
  return (VALORES_QUE_MOSTRAR as readonly string[]).includes(valor ?? "") ? (valor as QueMostrar) : "todo";
}

const ETIQUETA_RANGO_HISTORIAL: Record<RangoHistorial, string> = {
  "90d": "los últimos 90 días",
  todo: "todo el historial",
  personalizado: "el rango elegido",
};

export default async function HistorialProductoPage({
  searchParams,
}: {
  searchParams: Promise<{ productoId?: string; seccionId?: string; desde?: string; hasta?: string; queMostrar?: string; rango?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_operativos");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  // Cableado ANTES de las vistas "Cómo se compró"/"Cómo se vendió" (pasos 8-9) a propósito: así ningún commit intermedio
  // llega a mostrarle precio a un rol que tiene ver_reportes_operativos pero no ver_reportes_dinero — mismo patrón que ya
  // usa /reportes/compras (que gatea la pantalla entera; acá se condicionan solo las columnas de dinero, ver grounding §7).
  const { ver: mostrarDinero } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");

  const sp = await searchParams;
  const secciones = await listarSeccionesActivas(ctx.sucursalId);
  const queMostrar = comoQueMostrar(sp.queMostrar);
  // Un solo rango para TODA la pantalla (decisión 10 de §4): los números de arriba y el Kardex de abajo siempre parten de
  // la MISMA consulta, así que siempre cierran entre sí. Default "90d"; "todo" es la alternativa explícita.
  const { rango, desde, hasta } = resolverRangoHistorial(sp);

  const historial = sp.productoId ? await obtenerHistorialProducto(ctx.sucursalId, sp.productoId, sp.seccionId || undefined, desde, hasta) : null;

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
          rango={rango}
        />
      </div>

      {historial && (
        <div>
          <h2 className="mb-2 text-sm font-medium">
            {historial.codigo} — {historial.producto} ({historial.tipo})
            {historial.tieneStockPropio && ` — saldo actual: ${historial.saldoActual} ${historial.unidadStockNombre}`}
          </h2>
          <p className="mb-2 text-xs text-neutral-500">
            Mostrando {ETIQUETA_RANGO_HISTORIAL[rango]}: {historial.eventos.length} evento(s) visible(s), de {historial.totalMovimientos} movimiento(s) y{" "}
            {historial.totalConteos} conteo(s) en total
            {historial.tieneStockPropio && " (el saldo corriente arranca del primer movimiento real, no del rango elegido)"}.
          </p>
          {historial.tieneStockPropio ? (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium">Evolución del saldo</h3>
              {/* El mismo rango elegido arriba — no "Qué mostrar" (ese filtro es solo para el Kardex de abajo, declutter, no cambia qué pasó de verdad). */}
              <GraficoSaldoCorriente eventos={historial.eventos} unidadStockNombre={historial.unidadStockNombre} />
            </div>
          ) : (
            <CartelSinStockPropio productoId={historial.productoId} ingredientes={ingredientes ?? []} />
          )}
          {historial.tipo === "MP" && <ComoSeCompro resumen={resumirCompras(historial.eventos)} unidad={historial.unidadStockNombre} mostrarDinero={mostrarDinero} />}
          {historial.tipo === "PV" && <ComoSeVendio filas={agruparVentasPorDia(historial.eventos)} mostrarDinero={mostrarDinero} />}
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium">Movimiento por movimiento (auditoría)</summary>
            <div className="mt-2">
              <TablaHistorialEventos
                filas={filtrarEventosKardex(historial.eventos, queMostrar)}
                nombreExport={`historial-${historial.codigo}`}
                mostrarSaldo={historial.tieneStockPropio}
              />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
