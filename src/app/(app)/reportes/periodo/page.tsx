import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { obtenerReportePorPeriodo } from "@/core/reportes/periodo";
import { TablaVentasPorProducto, TablaComprasPorProveedor, TablaGastoPorInsumo, TablaPrecioPorInsumo, TablaImpactoRecetas } from "./tabla-periodo";
import { GraficoGastoPorGrupo } from "./grafico-gasto-grupo";
import { DigestAlertas } from "./digest-alertas";
import { ComparativaPrecios } from "./comparativa-precios";
import { AyudaIcono } from "@/components/ayuda-campo";
import { EnDolares } from "@/components/en-dolares";
import { obtenerUltimaCotizacion } from "@/core/reportes/cotizacion-dolar";

function primerDiaDelMesISO() {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function PeriodoPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const desdeStr = sp.desde || primerDiaDelMesISO();
  const hastaStr = sp.hasta || hoyISO();
  const [rep, cotizacion] = await Promise.all([
    obtenerReportePorPeriodo(ctx.sucursalId, new Date(desdeStr), new Date(hastaStr)),
    obtenerUltimaCotizacion().catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Reporte por período</h1>
        <form className="flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Desde
            <input type="date" name="desde" defaultValue={desdeStr} className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={hastaStr} className="rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
      </div>

      <DigestAlertas alertas={rep.digest} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Ventas
            <AyudaIcono texto={rep.ventas.aviso} />
          </p>
          <p className="text-lg font-semibold">${rep.ventas.totalFacturado.toLocaleString("es-AR")}</p>
          <EnDolares pesos={rep.ventas.totalFacturado} cotizacion={cotizacion} />
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Margen
            <AyudaIcono texto={rep.margen.aviso} />
          </p>
          <p className="text-lg font-semibold">
            ${rep.margen.margenTotal.toLocaleString("es-AR")} {rep.margen.margenPctTotal !== null && `(${rep.margen.margenPctTotal}%)`}
          </p>
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            Real: {rep.margen.margenRealTotal !== null ? `$${rep.margen.margenRealTotal.toLocaleString("es-AR")} (${rep.margen.margenRealPctTotal}%)` : "sin datos todavía"}
            <AyudaIcono texto={rep.margen.avisoReal} />
          </p>
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            Ajustado IPC: {rep.margen.margenIPCTotal !== null ? `$${rep.margen.margenIPCTotal.toLocaleString("es-AR")} (${rep.margen.margenIPCPctTotal}%)${rep.margen.ingresoProvisorioIPC > 0 ? " · provisorio" : ""}` : "sin datos todavía"}
            <AyudaIcono texto={rep.margen.avisoIPC} />
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Compras
            <AyudaIcono texto={rep.compras.aviso} />
          </p>
          <p className="text-lg font-semibold">${rep.compras.totalGastado.toLocaleString("es-AR")}</p>
          <EnDolares pesos={rep.compras.totalGastado} cotizacion={cotizacion} />
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            {rep.ratioGastoVentas.porcentaje !== null ? `${rep.ratioGastoVentas.porcentaje}% de lo vendido` : "sin ventas en el período"}
            {rep.ratioGastoVentas.porcentaje !== null && rep.ratioGastoVentas.porcentajePeriodoAnterior !== null && (
              <span className="ml-1">
                (período anterior: {rep.ratioGastoVentas.porcentajePeriodoAnterior}%
                {rep.ratioGastoVentas.porcentaje > rep.ratioGastoVentas.porcentajePeriodoAnterior ? " ↑" : rep.ratioGastoVentas.porcentaje < rep.ratioGastoVentas.porcentajePeriodoAnterior ? " ↓" : ""})
              </span>
            )}
            <AyudaIcono texto={rep.ratioGastoVentas.aviso} />
          </p>
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
        <TablaComprasPorProveedor filas={rep.compras.porProveedor} />
      </div>

      <div>
        <h2 className="mb-1 flex items-center text-sm font-medium">
          ¿En qué se va la plata? Compras por insumo/categoría
          <AyudaIcono texto="Agrupa el mismo gasto en Compras, pero por insumo y por categoría en vez de por proveedor — para eso sirve saber cuánto le compraste a un proveedor, para saber en qué se te va la plata hace falta esta vista." />
        </h2>
        <GraficoGastoPorGrupo filas={rep.gastoPorInsumo.porGrupo} />
        <div className="mt-3">
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
