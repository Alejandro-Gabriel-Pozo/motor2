import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteConsignacion } from "@/core/reportes/consignacion";
import { TablaDebidoConsignante, TablaStockSinVenderConsignacion } from "./tabla-consignacion";

export default async function ConsignacionPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "pagar_consignante", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { desde, hasta } = await searchParams;
  // Sin filtro por defecto: "Debido por consignante" es un saldo acumulado
  // desde siempre, no una ventana — filtrar por período acá sería mostrar
  // solo el movimiento de ese lapso, no cuánto se le debe HOY. El filtro es
  // opcional, para reconciliar un período puntual con el consignante.
  const periodo = desde || hasta ? { desde: desde ? new Date(desde) : undefined, hasta: hasta ? new Date(hasta) : undefined } : undefined;

  const rep = await generarReporteConsignacion(ctx.sucursalId, undefined, periodo);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Consignación</h1>
        <p className="text-sm text-neutral-500">Cuánto se le debe a cada consignante, y cuánto stock en consignación queda sin vender.</p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Debido por consignante</h2>
        <form className="mb-2 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Desde
            <input type="date" name="desde" defaultValue={desde ?? ""} className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={hasta ?? ""} className="rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Filtrar
          </button>
          {periodo && (
            <Link href="/reportes/consignacion" className="text-sm underline">
              Ver saldo acumulado (sin filtro)
            </Link>
          )}
        </form>
        <p className="mb-2 text-xs text-neutral-500">
          {periodo
            ? "Movimiento del período elegido, no el saldo acumulado — para lo que se le debe HOY a cada consignante, sacá el filtro."
            : "Saldo acumulado desde siempre (liquidado − pagado)."}
        </p>
        <TablaDebidoConsignante filas={rep.debidoPorConsignante} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Stock en consignación sin vender</h2>
        <TablaStockSinVenderConsignacion filas={rep.stockSinVender} />
      </div>
    </div>
  );
}
