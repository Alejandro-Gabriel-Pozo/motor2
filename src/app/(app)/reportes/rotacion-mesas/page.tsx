import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteRotacionMesas } from "@/core/reportes/rotacion-mesas";
import { resolverRangoDeReporte } from "@/core/reportes/rango-por-defecto";
import { SelectorRango } from "@/components/selector-rango";

const MINUTOS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const UNO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

/**
 * Reporte de rotación de mesas (módulo POS, docs/plan-comensales-y-limite-mesas-2026-09-26.md): comensales/cuenta promedio,
 * duración de mesa, y rotación por franja horaria (hora LOCAL de Argentina, ver el docstring de `generarReporteRotacionMesas`) y
 * por tamaño de grupo. Mismo permiso que el resto de los reportes operativos (`ver_reportes_operativos`, sin migración de
 * permisos) y mismo selector de rango que Período/Categorías (`SelectorRango`, rango en UTC — solo la franja horaria difiere).
 */
export default async function RotacionMesasPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; rango?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_operativos", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const rango = resolverRangoDeReporte(sp);
  const rep = await generarReporteRotacionMesas(ctx.sucursalId, new Date(rango.desdeISO), new Date(rango.hastaISO));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Rotación de mesas</h1>
        <SelectorRango opcion={rango.opcion} desdeISO={rango.desdeISO} hastaISO={rango.hastaISO} />
      </div>

      <p data-resumen className="text-sm text-neutral-500">
        {rep.atendidas} cuenta{rep.atendidas === 1 ? "" : "s"} atendida{rep.atendidas === 1 ? "" : "s"} en el rango.
        {rep.liberadasSinConsumo > 0 && ` ${rep.liberadasSinConsumo} liberada${rep.liberadasSinConsumo === 1 ? "" : "s"} sin consumo (no entran en las métricas).`}
        {rep.abiertasSinCerrar > 0 && ` ${rep.abiertasSinCerrar} todavía abierta${rep.abiertasSinCerrar === 1 ? "" : "s"}.`}
        {rep.cuentasSinComensales > 0 && ` ${rep.cuentasSinComensales} sin dato de comensales (de antes de este registro).`}
      </p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Comensales por cuenta</p>
          <p data-metrica="comensales-promedio" className="text-lg font-semibold">
            {rep.comensalesPromedio !== null ? UNO.format(rep.comensalesPromedio) : "—"}
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Duración de mesa</p>
          <p data-metrica="duracion-promedio" className="text-lg font-semibold">
            {rep.duracionPromedioMin !== null ? `${MINUTOS.format(rep.duracionPromedioMin)} min` : "—"}
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Cuentas atendidas</p>
          <p data-metrica="atendidas" className="text-lg font-semibold">
            {rep.atendidas}
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Con dato de comensales</p>
          <p data-metrica="con-comensales" className="text-lg font-semibold">
            {rep.cuentasConComensales}/{rep.atendidas}
          </p>
        </div>
      </div>

      <section aria-labelledby="franja-titulo">
        <h2 id="franja-titulo" className="mb-2 text-base font-semibold">
          Por franja horaria
        </h2>
        {rep.porFranjaHoraria.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin cuentas atendidas en este rango.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-2">Hora (Argentina)</th>
                <th>Cuentas</th>
                <th>Comensales prom.</th>
                <th>Duración prom.</th>
              </tr>
            </thead>
            <tbody>
              {rep.porFranjaHoraria.map((f) => (
                <tr key={f.hora} data-franja={f.hora} className="border-b">
                  <td className="py-2">{String(f.hora).padStart(2, "0")}:00</td>
                  <td>{f.cantidad}</td>
                  <td>{f.comensalesPromedio !== null ? UNO.format(f.comensalesPromedio) : "—"}</td>
                  <td>{f.duracionPromedioMin !== null ? `${MINUTOS.format(f.duracionPromedioMin)} min` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="grupo-titulo">
        <h2 id="grupo-titulo" className="mb-2 text-base font-semibold">
          Por tamaño de grupo
        </h2>
        {rep.porTamanoGrupo.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin datos de comensales en este rango.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-2">Comensales</th>
                <th>Cuentas</th>
                <th>Duración prom.</th>
              </tr>
            </thead>
            <tbody>
              {rep.porTamanoGrupo.map((g) => (
                <tr key={g.grupo} data-grupo={g.grupo} className="border-b">
                  <td className="py-2">{g.grupo}</td>
                  <td>{g.cantidad}</td>
                  <td>{g.duracionPromedioMin !== null ? `${MINUTOS.format(g.duracionPromedioMin)} min` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
