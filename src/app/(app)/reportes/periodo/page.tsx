import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { resolverRangoDeReporte } from "@/core/reportes/public";
import { obtenerUltimaCotizacionSinRomper } from "@/server/consultas/reportes/cotizacion-dolar";
import { obtenerReportePorPeriodo } from "@/server/consultas/reportes/periodo";
import { TablaVentasPorProducto, TablaComprasPorProveedor, TablaGastoPorInsumo, TablaPrecioPorInsumo, TablaImpactoRecetas } from "./tabla-periodo";
import { GraficoGastoPorGrupo } from "./grafico-gasto-grupo";
import { DigestAlertas } from "./digest-alertas";
import { ComparativaPrecios } from "./comparativa-precios";
import { AyudaIcono } from "@/components/ayuda-campo";
import { EnDolares } from "@/components/en-dolares";
import { SelectorRango } from "@/components/selector-rango";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function PeriodoPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "rango">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_periodo", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  // La hora se fija acá, en el borde (D.3b): el rango por defecto y la antigüedad del IPC del reporte se miden contra la misma.
  const ahora = new Date();
  const rango = resolverRangoDeReporte(sp, ahora);
  const desdeStr = rango.desdeISO;
  const hastaStr = rango.hastaISO;
  const [rep, cotizacion, gateCostos] = await Promise.all([
    obtenerReportePorPeriodo(ctx.sucursalId, new Date(desdeStr), new Date(hastaStr), undefined, ctx.db, ahora),
    obtenerUltimaCotizacionSinRomper(ctx.db),
    requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_costos", ctx.db),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Reporte por período</h1>
        <SelectorRango opcion={rango.opcion} desdeISO={desdeStr} hastaISO={hastaStr} />
      </div>

      <DigestAlertas alertas={rep.digest} puedeVerCostos={gateCostos.ok} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Ventas
            <AyudaIcono texto={rep.ventas.aviso} />
          </p>
          <p className="text-lg font-semibold">${rep.ventas.totalFacturado.toLocaleString("es-AR")}</p>
          <EnDolares pesos={rep.ventas.totalFacturado} cotizacion={cotizacion} />
        </div>
        {/*
          Ganancia = Ventas costeadas − Costo de lo vendido, con la resta a la vista (los dos números están acá, uno debajo del
          otro) — decisión del usuario, 2026-09-22 (docs/planes-demo-y-claridad-reportes-2026-09-21.md §2): el margen "principal"
          es el Real (costo del momento de cada venta, no el de reposición de hoy), porque es lo que de verdad ganó. El nominal
          ("Si repusieras hoy") y el ajustado por IPC quedan plegados: siguen ahí, pero no compiten por atención con el número
          que más importa. Las tres definiciones van en texto VISIBLE (antes vivían solo en un `title=`, casi invisible).
          `<dl>` en vez de `<table>`: es una lista de término→definición, no una grilla, y no se rompe a 1024 px.
        */}
        <div className="rounded border p-4">
          <dl>
            <dt className="text-xs text-neutral-500">Ganancia de lo vendido</dt>
            <dd className="text-lg font-semibold">
              {rep.margen.margenRealTotal !== null
                ? `$${rep.margen.margenRealTotal.toLocaleString("es-AR")} (${rep.margen.margenRealPctTotal}%)${rep.margen.ingresoRealReconstruido > 0 ? " · reconstruido" : ""}`
                : "sin datos todavía"}
            </dd>
            <dd className="text-xs text-neutral-500">{rep.margen.avisoReal}</dd>
          </dl>
          {/* Consumo (lo que costó lo que SE VENDIÓ) — el otro lado de la resta de arriba: costoDeLoVendidoTotal ≈ ingresoConCostoReal − margenRealTotal. */}
          <dl data-costo-de-lo-vendido className="mt-3">
            <dt className="text-xs text-neutral-500">Costo de lo vendido (consumo):</dt>
            <dd className="flex flex-wrap items-center text-sm">
              {rep.margen.costoDeLoVendidoTotal !== null ? (
                <>
                  ${rep.margen.costoDeLoVendidoTotal.toLocaleString("es-AR")} ({rep.margen.costoDeLoVendidoPctTotal}%)
                  {rep.margen.ingresoRealReconstruido > 0 && " · reconstruido"}
                  {rep.margen.coberturaCostoRealPct !== null && rep.margen.coberturaCostoRealPct < 100 && (
                    <span className="ml-1 text-amber-700 dark:text-amber-600">· parcial (cubre {rep.margen.coberturaCostoRealPct}% de lo vendido)</span>
                  )}
                </>
              ) : (
                "sin datos todavía"
              )}
              <AyudaIcono texto={rep.margen.avisoCostoDeLoVendido} />
            </dd>
          </dl>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-neutral-500">Otras formas de ver el margen (con qué costo se calculan)</summary>
            <dl className="mt-2 flex flex-col gap-3">
              <div>
                <dt className="font-medium text-neutral-700 dark:text-neutral-300">Si repusieras hoy</dt>
                <dd>
                  ${rep.margen.margenTotal.toLocaleString("es-AR")} {rep.margen.margenPctTotal !== null && `(${rep.margen.margenPctTotal}%)`}
                </dd>
                <dd className="text-neutral-500">{rep.margen.aviso}</dd>
              </div>
              <div>
                <dt className="font-medium text-neutral-700 dark:text-neutral-300">Ajustada por inflación (IPC)</dt>
                <dd>
                  {rep.margen.margenIPCTotal !== null
                    ? `$${rep.margen.margenIPCTotal.toLocaleString("es-AR")} (${rep.margen.margenIPCPctTotal}%)${rep.margen.antiguedadIPC.estado === "vencida" ? " · IPC desactualizado" : rep.margen.ingresoProvisorioIPC > 0 ? " · provisorio" : ""}`
                    : "sin datos todavía"}
                </dd>
                <dd className="text-neutral-500">{rep.margen.avisoIPC}</dd>
              </div>
            </dl>
          </details>
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Compras
            <AyudaIcono texto={rep.compras.aviso} />
          </p>
          <p className="text-lg font-semibold">${rep.compras.totalGastado.toLocaleString("es-AR")}</p>
          <EnDolares pesos={rep.compras.totalGastado} cotizacion={cotizacion} />
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            Compras / Ventas (desembolso): {rep.ratioGastoVentas.porcentaje !== null ? `${rep.ratioGastoVentas.porcentaje}% de lo vendido${rep.ratioGastoVentas.excluyeNoComestibles ? " (comida y bebida)" : ""}` : "sin ventas en el período"}
            {rep.ratioGastoVentas.porcentaje !== null && rep.ratioGastoVentas.porcentajePeriodoAnterior !== null && (
              <span className="ml-1">
                (período anterior: {rep.ratioGastoVentas.porcentajePeriodoAnterior}%
                {rep.ratioGastoVentas.porcentaje > rep.ratioGastoVentas.porcentajePeriodoAnterior ? " ↑" : rep.ratioGastoVentas.porcentaje < rep.ratioGastoVentas.porcentajePeriodoAnterior ? " ↓" : ""})
              </span>
            )}
            <AyudaIcono texto={rep.ratioGastoVentas.aviso} />
          </p>
          {rep.ratioGastoVentas.excluyeNoComestibles && rep.ratioGastoVentas.gastoNoComestibles > 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              No comestibles (packaging, limpieza): ${rep.ratioGastoVentas.gastoNoComestibles.toLocaleString("es-AR")}, fuera de ese porcentaje
            </p>
          )}
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Movimientos</p>
          <p className="text-lg font-semibold">{rep.total}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Ventas por producto</h2>
        <TablaVentasPorProducto filas={rep.margen.porProducto} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Compras por proveedor</h2>
        <TablaComprasPorProveedor filas={rep.compras.porProveedor} desde={desdeStr} hasta={hastaStr} />
      </div>

      <div>
        <h2 className="mb-1 flex items-center text-sm font-medium">
          ¿En qué se va la plata? Compras por insumo/categoría
          <AyudaIcono texto="Agrupa el mismo gasto en Compras, pero por insumo y por categoría en vez de por proveedor — para eso sirve saber cuánto le compraste a un proveedor, para saber en qué se te va la plata hace falta esta vista." />
        </h2>
        <GraficoGastoPorGrupo filas={rep.gastoPorInsumo.porGrupo} />
        <div className="mt-3">
          <p className="mb-2 text-xs text-neutral-500">
            Las filas resaltadas son los insumos que, de mayor a menor gasto, concentran el 80 % de lo que compraste (regla 80/20): ahí conviene mirar primero.
          </p>
          <TablaGastoPorInsumo filas={rep.gastoPorInsumo.porInsumo} />
        </div>
      </div>

      <div>
        <h2 className="mb-1 flex items-center text-sm font-medium">
          ¿Estoy pagando más que antes? Precio y tendencia por insumo
          <AyudaIcono texto="Compara el precio pagado en este período contra el precio de la última compra anterior de cada insumo, ordenado por cuánto costó (o ahorró) ese cambio a la cantidad que realmente compraste — no por el % de variación, que puede engañar entre insumos baratos y caros." />
        </h2>
        <TablaPrecioPorInsumo filas={rep.tendenciaPrecios} />
      </div>

      <div>
        <h2 className="mb-1 flex items-center text-sm font-medium">
          ¿Tu carta acompaña estos cambios?
          <AyudaIcono texto={rep.comparativaPrecios.aviso} />
        </h2>
        <ComparativaPrecios datos={rep.comparativaPrecios} />
      </div>

      <div>
        <h2 className="mb-1 flex items-center text-sm font-medium">
          ¿A qué platos les pega? Impacto en recetas
          <AyudaIcono texto="Recalcula el costo de cada receta con el precio de sus insumos de antes del período y con el de ahora — solo aparecen los platos donde el resultado cambió de verdad, incluyendo cuando el aumento viene de un intermedio 'se produce' (ej. una masa premezclada), no solo de un ingrediente comprado directo." />
        </h2>
        <TablaImpactoRecetas filas={rep.impactoRecetas} />
      </div>
    </div>
  );
}
