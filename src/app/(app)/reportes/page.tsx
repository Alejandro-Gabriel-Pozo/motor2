import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo, reportePesadoSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { resolverRangoDeReporte } from "@/core/reportes/public";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { obtenerUltimaCotizacionSinRomper } from "@/server/consultas/reportes/cotizacion-dolar";
import { obtenerResumenOperativo } from "@/server/consultas/reportes/resumen-operativo";
import { TablaTopProductos, TablaTopProveedores, TablaStockBajo } from "./tabla-resumen";
import { AyudaIcono } from "@/components/ayuda-campo";
import { EnDolares } from "@/components/en-dolares";
import { SelectorRango } from "@/components/selector-rango";
import { EnlaceInterno } from "@/components/enlace-interno";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function ReportesResumenPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "rango">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_resumen", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  // S-28 (I-3): el Resumen operativo corre `obtenerReportePorPeriodo` sobre un rango del usuario de hasta 366 días, la MISMA consulta pesada que Período: cuenta en el cupo de "periodo"
  // (uno solo para las dos pantallas: alternarlas no duplica el presupuesto), antes de consultar nada.
  if (reportePesadoSinCupo(ctx.usuarioId, "periodo", new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const sp = unicosDeUrl(await searchParams);
  const rango = resolverRangoDeReporte(sp, new Date(), ctx.empresaZonaHoraria);
  const [r, cotizacion] = await Promise.all([
    obtenerResumenOperativo(ctx.sucursalId, ctx.db, new Date(), { desde: new Date(rango.desdeISO), hasta: new Date(rango.hastaISO) }, ctx.empresaZonaHoraria),
    obtenerUltimaCotizacionSinRomper(ctx.db),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Resumen operativo</h1>
        <p className="mb-2 text-sm text-tinta-tenue">
          Financiero de {diaDeCalendario(r.financiero.desde, ctx.empresaZonaHoraria)} a {diaDeCalendario(r.financiero.hasta, ctx.empresaZonaHoraria)}.
        </p>
        <SelectorRango opcion={rango.opcion} desdeISO={rango.desdeISO} hastaISO={rango.hastaISO} recortadoDesde={rango.recortadoDesde} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-tinta-tenue">
            Ventas
            <AyudaIcono texto={r.financiero.avisoVentas} />
          </p>
          <p className="text-lg font-semibold">${r.financiero.ventasTotal.toLocaleString("es-AR")}</p>
          <EnDolares pesos={r.financiero.ventasTotal} cotizacion={cotizacion} />
          {r.financiero.hayEstimados && <p className="text-xs text-aviso-tinta">incluye estimados</p>}
        </div>
        {/* Mismo tratamiento que /reportes/periodo (§2): una cifra principal (el margen Real, acá "Ganancia de lo vendido"), definiciones visibles en vez de tooltip, nominal e IPC plegados. */}
        <div className="rounded border p-4">
          <dl>
            <dt className="text-xs text-tinta-tenue">Ganancia de lo vendido</dt>
            <dd className="text-lg font-semibold">
              {r.financiero.margenRealTotal !== null
                ? `$${r.financiero.margenRealTotal.toLocaleString("es-AR")} (${r.financiero.margenRealPct}%)${r.financiero.margenRealReconstruido ? " · reconstruido" : ""}`
                : "sin datos todavía"}
            </dd>
            <dd className="text-xs text-tinta-tenue">{r.financiero.avisoMargenReal}</dd>
          </dl>
          {r.financiero.hayCostoIncompleto && (
            <p className="mt-1 text-xs text-aviso-tinta">
              Costo incompleto en algún producto —{" "}
              <EnlaceInterno href="/reportes/costos" className="underline">
                ver Costos y márgenes
              </EnlaceInterno>
            </p>
          )}
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-tinta-tenue">Otras formas de ver el margen (con qué costo se calculan)</summary>
            <dl className="mt-2 flex flex-col gap-3">
              <div>
                <dt className="font-medium text-tinta-suave">Si repusieras hoy</dt>
                <dd>
                  ${r.financiero.margenTotal.toLocaleString("es-AR")} {r.financiero.margenPct !== null && `(${r.financiero.margenPct}%)`}
                </dd>
                <dd className="text-tinta-tenue">{r.financiero.avisoMargen}</dd>
              </div>
              <div>
                <dt className="font-medium text-tinta-suave">Ajustada por inflación (IPC)</dt>
                <dd>
                  {r.financiero.margenIPCTotal !== null
                    ? `$${r.financiero.margenIPCTotal.toLocaleString("es-AR")} (${r.financiero.margenIPCPct}%)${r.financiero.ipcVencido ? " · IPC desactualizado" : r.financiero.margenIPCProvisorio ? " · provisorio" : ""}`
                    : "sin datos todavía"}
                </dd>
                <dd className="text-tinta-tenue">{r.financiero.avisoMargenIPC}</dd>
              </div>
            </dl>
          </details>
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-tinta-tenue">
            Gastado en compras
            <AyudaIcono texto={r.financiero.avisoCompras} />
          </p>
          <p className="text-lg font-semibold">${r.financiero.gastadoTotal.toLocaleString("es-AR")}</p>
          <EnDolares pesos={r.financiero.gastadoTotal} cotizacion={cotizacion} />
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-tinta-tenue">Alertas de stock</p>
          <p className="text-lg font-semibold">
            {r.alertas.criticos} crítica(s), {r.alertas.bajos} baja(s)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium">Top productos vendidos</h2>
          <TablaTopProductos filas={r.financiero.topProductos} />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium">Top proveedores</h2>
          <TablaTopProveedores filas={r.financiero.topProveedores} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Stock con saldo en 0 o negativo (top 10)</h2>
        <TablaStockBajo filas={r.topStockBajo} />
      </div>

      <p className="text-xs text-tinta-tenue">
        Stock: {r.stock.totalItems} combinaciones producto+sección con movimientos, {r.stock.negativos} en negativo. Movimientos totales: {r.movimientos.total}.
      </p>
    </div>
  );
}
