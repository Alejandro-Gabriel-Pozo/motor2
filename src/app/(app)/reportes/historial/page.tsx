import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { obtenerHistorialProducto, obtenerIngredientesRecetaVigente } from "@/core/reportes/historial-producto";
import { agruparVentasPorDia, filtrarEventosKardex, quitarDineroDeEventos, resolverRangoHistorial, resumirCompras, type QueMostrar, type RangoHistorial } from "@/core/reportes/historial-vistas";
import { HistorialFiltros } from "./historial-filtros";
import { TablaHistorialEventos } from "./tabla-historial";
import { GraficoSaldoCorriente } from "./grafico-saldo";
import { CartelSinStockPropio } from "./cartel-sin-stock-propio";
import { ComoSeCompro } from "./como-se-compro";
import { ComoSeVendio } from "./como-se-vendio";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

const VALORES_QUE_MOSTRAR: readonly QueMostrar[] = ["todo", "compras", "consumos-ventas", "ajustes-conteos"];

function comoQueMostrar(valor: string | undefined): QueMostrar {
  return (VALORES_QUE_MOSTRAR as readonly string[]).includes(valor ?? "") ? (valor as QueMostrar) : "todo";
}

const ETIQUETA_RANGO_HISTORIAL: Record<RangoHistorial, string> = {
  "10d": "los últimos 10 días",
  "90d": "los últimos 90 días",
  todo: "todo el historial",
  personalizado: "el rango elegido",
};

export default async function HistorialProductoPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosDeUrl<"productoId" | "seccionId" | "desde" | "hasta" | "queMostrar" | "rango">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_historial", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  // Cableado ANTES de las vistas "Cómo se compró"/"Cómo se vendió" (pasos 8-9) a propósito: así ningún commit intermedio
  // llega a mostrarle precio a un rol que tiene reporte_historial pero no reporte_historial_importes — mismo patrón que ya
  // usa /reportes/compras (que gatea la pantalla entera; acá se condicionan solo las columnas de dinero, ver grounding §7).
  const { ver: mostrarDinero } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "reporte_historial_importes", ctx.db);

  const sp = unicosDeUrl(await searchParams);
  const secciones = await listarSeccionesActivas(ctx.sucursalId);
  const queMostrar = comoQueMostrar(sp.queMostrar);
  // Un solo rango para TODA la pantalla (decisión 10 de §4): los números de arriba y el Kardex de abajo siempre parten de
  // la MISMA consulta, así que siempre cierran entre sí. Default "10d"; «Ver más» pasa a "90d" y después a "todo".
  const { rango, desde, hasta } = resolverRangoHistorial(sp);

  // «Ver más»: 10 días → 90 días → todo. En un rango personalizado no hay a dónde ampliar (el usuario ya eligió las fechas).
  const rangoMasAmplio = rango === "10d" ? "90d" : rango === "90d" ? "todo" : null;
  const parametrosVerMas = new URLSearchParams();
  if (sp.productoId) parametrosVerMas.set("productoId", sp.productoId);
  if (sp.seccionId) parametrosVerMas.set("seccionId", sp.seccionId);
  if (queMostrar !== "todo") parametrosVerMas.set("queMostrar", queMostrar);
  if (rangoMasAmplio) parametrosVerMas.set("rango", rangoMasAmplio);

  const historial = sp.productoId ? await obtenerHistorialProducto(ctx.sucursalId, sp.productoId, sp.seccionId || undefined, desde, hasta, ctx.db) : null;

  // Sin la clave de importes el dinero no sale del servidor: ocultar la columna al dibujar no alcanza, los props de un componente cliente viajan en el payload.
  const eventos = historial ? (mostrarDinero ? historial.eventos : quitarDineroDeEventos(historial.eventos)) : [];

  // Solo para un PV sin stock propio (§4, decisiones 7-8) — para el resto, ni se consulta.
  const ingredientes = historial && !historial.tieneStockPropio ? await obtenerIngredientesRecetaVigente(historial.productoId, ctx.db, ctx.sucursalId) : null;

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
            Mostrando {ETIQUETA_RANGO_HISTORIAL[rango]}: {eventos.length} evento(s) visible(s), de {historial.totalMovimientos} movimiento(s) y{" "}
            {historial.totalConteos} conteo(s) en total
            {historial.tieneStockPropio && " (el saldo corriente arranca del primer movimiento real, no del rango elegido)"}.{" "}
            {rangoMasAmplio && (
              <Link href={`/reportes/historial?${parametrosVerMas.toString()}`} className="underline">
                Ver más ({rangoMasAmplio === "90d" ? "últimos 90 días" : "todo el historial"})
              </Link>
            )}
          </p>
          {historial.tieneStockPropio ? (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium">Evolución del saldo</h3>
              {/* El mismo rango elegido arriba — no "Qué mostrar" (ese filtro es solo para el Kardex de abajo, declutter, no cambia qué pasó de verdad). */}
              <GraficoSaldoCorriente eventos={eventos} unidadStockNombre={historial.unidadStockNombre} />
            </div>
          ) : (
            <CartelSinStockPropio productoId={historial.productoId} ingredientes={ingredientes ?? []} />
          )}
          {historial.tipo === "MP" && <ComoSeCompro resumen={resumirCompras(eventos)} unidad={historial.unidadStockNombre} mostrarDinero={mostrarDinero} />}
          {historial.tipo === "PV" && <ComoSeVendio filas={agruparVentasPorDia(eventos)} mostrarDinero={mostrarDinero} />}
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium">Movimiento por movimiento (auditoría)</summary>
            <div className="mt-2">
              <TablaHistorialEventos
                filas={filtrarEventosKardex(eventos, queMostrar)}
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
