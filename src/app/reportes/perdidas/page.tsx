import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReportePerdidas } from "@/core/reportes/perdidas";

export default async function PerdidasPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const dias = Number(sp.dias) > 0 ? Number(sp.dias) : 30;
  const rep = await generarReportePerdidas(ctx.sucursalId, dias);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Pérdidas y consumo interno</h1>
        <form className="flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Días atrás
            <input type="number" name="dias" min={1} defaultValue={dias} className="w-24 rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
        <p className="mt-2 text-sm text-neutral-500">
          Desde {rep.desde.toISOString().slice(0, 10)} — merma total: ${rep.totalMerma.toLocaleString("es-AR")}, consumo interno total: $
          {rep.totalConsumo.toLocaleString("es-AR")}.
        </p>
        {rep.hayCostoIncompleto && <p className="text-xs text-amber-600">Algún producto no tiene costo de reposición conocido: no se suma al valor total.</p>}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Mermas por motivo</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Motivo</th>
              <th>Cantidad</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {rep.mermas.map((m, i) => (
              <tr key={i} className="border-b">
                <td className="py-1">
                  {m.motivo} {m.costoIncompleto && <span className="text-amber-600">(costo incompleto)</span>}
                </td>
                <td>{m.cantidad}</td>
                <td>${m.valor.toLocaleString("es-AR")}</td>
              </tr>
            ))}
            {!rep.mermas.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={3}>
                  Sin mermas en el período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Consumo interno por destino</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Destino</th>
              <th>Cantidad</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {rep.consumos.map((c, i) => (
              <tr key={i} className="border-b">
                <td className="py-1">
                  {c.motivo} {c.costoIncompleto && <span className="text-amber-600">(costo incompleto)</span>}
                </td>
                <td>{c.cantidad}</td>
                <td>${c.valor.toLocaleString("es-AR")}</td>
              </tr>
            ))}
            {!rep.consumos.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={3}>
                  Sin consumo interno en el período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
