import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { leerFiltroTickets } from "@/core/reportes/public";
import { listarTicketsEmitidos } from "@/server/consultas/reportes/tickets-emitidos";
import { formatearMonto, rotuloDePuesto, formatearNumeroTicket } from "@/core/pos/public";
import { formatearFechaHora } from "@/core/tiempo/zona-horaria";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";
import { Enlace } from "@/ui/primitivas/enlace";

/**
 * MAQUETA (rama temporal, no se mergea): «Corregir un ticket», PASO 1 de 2 — buscar el ticket. Filtros arriba en una sola fila (fecha, letra, número), resultados abajo; elegir uno lleva a OTRA página
 * (`/reportes/tickets/corregir/<cuenta>`, paso 2). Lee los mismos tickets reales que «Tickets emitidos»; el número y la letra se filtran sobre la página leída (alcanza para la maqueta).
 */
export default async function CorregirTicketBuscar({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "numero" | "letra">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_tickets", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const { desde, hasta, filtro } = leerFiltroTickets({ desde: sp.desde, hasta: sp.hasta }, ctx.empresaZonaHoraria, new Date());
  const numeroPedido = (sp.numero ?? "").trim();
  const letraPedida = (sp.letra ?? "").trim().toUpperCase();

  const { items } = await listarTicketsEmitidos(ctx.sucursalId, filtro, ctx.db);
  const resultados = items.filter((t) => (!numeroPedido || String(t.numero.numero) === numeroPedido) && (!letraPedida || formatearNumeroTicket(t.numero).endsWith(`-${letraPedida}`)));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Corregir un ticket</h1>
        <ol className="flex gap-4 text-sm" aria-label="Pasos">
          <li className="font-semibold">1. Buscar el ticket</li>
          <li className="text-tinta-tenue">2. Corregirlo</li>
        </ol>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded border p-3 text-sm" aria-label="Buscar ticket">
        <CampoFecha etiqueta="Desde" name="desde" defaultValue={desde} />
        <CampoFecha etiqueta="Hasta" name="hasta" defaultValue={hasta} />
        <Selector etiqueta="Letra" name="letra" defaultValue={letraPedida}>
          <option value="">Todas</option>
          <option value="A">A (original)</option>
          <option value="B">B (corregido)</option>
          <option value="C">C</option>
        </Selector>
        <Campo etiqueta="N.º de ticket" name="numero" inputMode="numeric" defaultValue={numeroPedido} placeholder="por ejemplo 3" />
        <BotonDeServidor type="submit">Buscar</BotonDeServidor>
        <Enlace href="/reportes/tickets/corregir" className="self-center">
          Limpiar
        </Enlace>
      </form>

      <section aria-label="Resultados" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{resultados.length} ticket(s) encontrados</h2>
        {resultados.length === 0 ? (
          <p className="text-sm text-tinta-tenue">No hay tickets con esos datos. Probá ampliar las fechas o dejar la letra en «Todas».</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-tinta-tenue">
                  <th className="px-2 py-1 font-normal">N.º</th>
                  <th className="px-2 py-1 font-normal">Fecha y hora</th>
                  <th className="px-2 py-1 font-normal">Puesto</th>
                  <th className="px-2 py-1 font-normal">Atendió</th>
                  <th className="px-2 py-1 font-normal">Estado</th>
                  <th className="px-2 py-1 text-right font-normal">Total</th>
                  <th className="px-2 py-1 font-normal">
                    <span className="sr-only">Elegir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((t) => (
                  <tr key={t.ejemplarId} className="border-b last:border-0" data-ticket-resultado={formatearNumeroTicket(t.numero)}>
                    <td className="px-2 py-2 font-medium">{formatearNumeroTicket(t.numero)}</td>
                    <td className="px-2 py-2 tabular-nums text-tinta-tenue">{formatearFechaHora(t.emitidoEn, ctx.empresaZonaHoraria)}</td>
                    <td className="px-2 py-2 text-tinta-tenue">{rotuloDePuesto(t.mesaNumero)}</td>
                    <td className="px-2 py-2 text-tinta-tenue">{t.emitidoPor}</td>
                    <td className="px-2 py-2 text-tinta-tenue">
                      {t.reemplazadaPor ? `Reemplazado por ${formatearNumeroTicket(t.reemplazadaPor)}` : t.correccionDe ? `Corrección de ${formatearNumeroTicket(t.correccionDe)}` : t.estado === "desactualizada" ? "Falta emitir el corregido" : t.estado === "anulada" ? "Venta anulada" : "Al día"}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatearMonto(t.importe)}</td>
                    <td className="px-2 py-2 text-right">
                      <Link href={`/reportes/tickets/corregir/${t.cuentaId}`} className="whitespace-nowrap underline">
                        {t.esUltimoEjemplar ? "Corregir →" : "Ver →"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
