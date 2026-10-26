import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { EnlaceInterno } from "@/components/enlace-interno";
import { leerFiltroTickets, serializarFiltroTickets } from "@/core/reportes/public";
import { listarTicketsEmitidos, obtenerNumeroDeMesa } from "@/server/consultas/reportes/tickets-emitidos";
import { formatearMonto, nombreDeMesa, formatearNumeroTicket } from "@/core/pos/public";
import { formatearFechaHora } from "@/core/tiempo/zona-horaria";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { Enlace } from "@/ui/primitivas/enlace";

/**
 * Tickets emitidos (Task #17 del backlog): antes de esta pantalla, «Cuentas cerradas» (al pie de una mesa) mostraba como mucho
 * las 3 últimas tickets (`TICKETS_RECIENTES_POR_MESA`, ticket.ts) y las más viejas quedaban totalmente inaccesibles — sin ninguna
 * pantalla desde donde verlas, reimprimirlas o corregirlas (probable causa real del pendiente #21: el ticket en cuestión
 * simplemente ya no estaba entre las 3 recientes). Este reporte lista TODAS, una fila por EJEMPLAR — la A, la B y sus
 * correcciones por separado — de solo lectura: reimprimir o emitir una corregida sigue haciéndose desde la mesa (`ImpresionProvider`
 * vive en la carpeta de rutas del POS); acá el camino es el link a Trazabilidad de cada línea.
 *
 * Una cuenta cerrada ANTES de la numeración de tickets (sin ningún `EjemplarTicket`) no aparece: es de esperar, no una falla del
 * filtro — esas cuentas no tienen ejemplar que listar.
 *
 * Filtro de fecha en la zona horaria de la EMPRESA, la misma zona con la que cortan los demás reportes (P1) (el servicio de la noche cruza la medianoche UTC):
 * sin fechas en la URL, el default es «hoy» en esa zona; vaciar los dos campos y filtrar de nuevo saca el límite de fecha del
 * todo (el cursor de paginación lo aguanta).
 */
export default async function TicketsEmitidosPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "mesaId" | "cursor">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_tickets", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const { desde, hasta, mesaId, filtro } = leerFiltroTickets(sp, ctx.empresaZonaHoraria, new Date());

  const [{ items, nextCursor }, mesaNumero] = await Promise.all([
    listarTicketsEmitidos(ctx.sucursalId, filtro, ctx.db),
    mesaId ? obtenerNumeroDeMesa(ctx.sucursalId, mesaId, ctx.db) : Promise.resolve(null),
  ]);

  const paramsSiguiente = serializarFiltroTickets({ desde, hasta, mesaId, cursor: nextCursor });
  const paramsSinMesa = serializarFiltroTickets({ desde, hasta });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Tickets emitidos</h1>
        <p className="text-sm text-tinta-tenue">
          Una fila por ejemplar impreso (la A, y cada corrección B, C… por separado), más recientes primero. Para reimprimir o
          emitir una corregida, entrá a la mesa: acá es de solo lectura, con link a Trazabilidad. Una cuenta cerrada antes de la
          numeración de tickets no tiene ejemplar y no aparece.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <CampoFecha etiqueta="Desde (hora de la empresa)" name="desde" defaultValue={desde} />
        <CampoFecha etiqueta="Hasta (hora de la empresa)" name="hasta" defaultValue={hasta} />
        {mesaId && <input type="hidden" name="mesaId" value={mesaId} />}
        <BotonDeServidor type="submit">Filtrar</BotonDeServidor>
        <Enlace href="/reportes/tickets" className="self-center">
          Limpiar
        </Enlace>
      </form>

      {mesaId && (
        <p className="text-xs text-tinta-tenue">
          Filtrando por {mesaNumero !== null ? nombreDeMesa(mesaNumero) : "una mesa"} ·{" "}
          <Link href={`/reportes/tickets?${paramsSinMesa.toString()}`} className="underline">
            Quitar filtro de mesa
          </Link>
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-tinta-tenue">No hay tickets emitidos con estos filtros.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((b) => (
            <FilaTicket key={b.ejemplarId} ticket={b} zonaHoraria={ctx.empresaZonaHoraria} />
          ))}
        </div>
      )}

      {nextCursor && (
        <Link href={`/reportes/tickets?${paramsSiguiente.toString()}`} className="text-sm underline">
          Página siguiente →
        </Link>
      )}
    </div>
  );
}

function FilaTicket({ ticket: b, zonaHoraria }: { ticket: Awaited<ReturnType<typeof listarTicketsEmitidos>>["items"][number]; zonaHoraria: string }) {
  const numero = formatearNumeroTicket(b.numero);
  return (
    <details className="rounded border" data-ticket={b.ejemplarId}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
        <span className="font-medium">N.º {numero}</span>
        <span className="w-36 tabular-nums text-tinta-tenue">{formatearFechaHora(b.emitidoEn, zonaHoraria)}</span>
        <span className="text-tinta-tenue">{nombreDeMesa(b.mesaNumero)}</span>
        <span className="text-tinta-tenue">Emitió {b.emitidoPor}</span>
        {b.correccionDe && <Marca texto={`Corrección de N.º ${formatearNumeroTicket(b.correccionDe)}`} tono="neutral" />}
        {b.reemplazadaPor && <Marca texto={`Reemplazada por N.º ${formatearNumeroTicket(b.reemplazadaPor)}`} tono="neutral" />}
        {b.estado === "anulada" && <Marca texto="Venta anulada" tono="rojo" />}
        {b.estado === "desactualizada" && <Marca texto="Desactualizada" tono="ambar" />}
        <span className={`ml-auto font-semibold tabular-nums ${b.estado === "anulada" ? "line-through" : ""}`}>{formatearMonto(b.importe)}</span>
      </summary>
      <div className="border-t px-3 py-2">
        <p className="mb-2 text-xs text-tinta-tenue">
          Atendió {b.detalle.mesero} · Abierta {formatearFechaHora(b.detalle.abiertaEn, zonaHoraria)} · Cerrada {formatearFechaHora(b.detalle.cerradaEn, zonaHoraria)}
          {b.detalle.cliente && (
            <>
              {" "}
              · Cliente {b.detalle.cliente.nombre} (−{b.detalle.cliente.descuentoPorcentaje}%)
            </>
          )}
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="px-2 py-1 font-normal">Producto</th>
              <th className="px-2 py-1 text-right font-normal">Cantidad</th>
              <th className="px-2 py-1 text-right font-normal">Precio unitario</th>
              <th className="px-2 py-1 text-right font-normal">Subtotal</th>
              <th className="px-2 py-1 font-normal">
                <span className="sr-only">Trazabilidad</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {b.detalle.lineas.map((l, i) => (
              <tr key={`${l.producto}|${l.precioUnitario}|${i}`} className="border-b last:border-0">
                <td className="px-2 py-1">{l.producto}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.cantidad.toLocaleString("es-AR")}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {l.precioListaUnitario !== undefined && <span className="mr-1 text-tinta-tenue line-through">{formatearMonto(l.precioListaUnitario)}</span>}
                  {formatearMonto(l.precioUnitario)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{formatearMonto(l.subtotal)}</td>
                <td className="px-2 py-1 text-right">
                  {l.operacionId ? (
                    <EnlaceInterno href={`/reportes/trazabilidad?idOperacion=${encodeURIComponent(l.operacionId)}`} className="underline">
                      Trazabilidad
                    </EnlaceInterno>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Marca({ texto, tono }: { texto: string; tono: "neutral" | "ambar" | "rojo" }) {
  const clases =
    tono === "rojo"
      ? "border-error text-error"
      : tono === "ambar"
        ? "border-aviso text-aviso-tinta"
        : "border-borde-control text-tinta-tenue";
  return <span className={`rounded border px-1.5 text-xs ${clases}`}>{texto}</span>;
}
