import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { listarBoletasEmitidas, leerFiltroBoletas, obtenerNumeroDeMesa, serializarFiltroBoletas } from "@/core/reportes/boletas-emitidas";
import { formatearFechaHora, formatearMonto, nombreDeMesa } from "@/core/pos/formato";
import { formatearNumeroBoleta } from "@/core/pos/numeracion-boleta";

/**
 * Boletas emitidas (Task #17 del backlog): antes de esta pantalla, «Cuentas cerradas» (al pie de una mesa) mostraba como mucho
 * las 3 últimas boletas (`BOLETAS_RECIENTES_POR_MESA`, boleta.ts) y las más viejas quedaban totalmente inaccesibles — sin ninguna
 * pantalla desde donde verlas, reimprimirlas o corregirlas (probable causa real del pendiente #21: la boleta en cuestión
 * simplemente ya no estaba entre las 3 recientes). Este reporte lista TODAS, una fila por EJEMPLAR — la A, la B y sus
 * correcciones por separado — de solo lectura: reimprimir o emitir una corregida sigue haciéndose desde la mesa (`ImpresionProvider`
 * vive en la carpeta de rutas del POS); acá el camino es el link a Trazabilidad de cada línea.
 *
 * Una cuenta cerrada ANTES de la numeración de boletas (sin ningún `EjemplarBoleta`) no aparece: es de esperar, no una falla del
 * filtro — esas cuentas no tienen ejemplar que listar.
 *
 * Filtro de fecha en hora de ARGENTINA, no UTC como el resto de los reportes (ver el docstring de `rango-dia-argentina.ts`):
 * sin fechas en la URL, el default es «hoy» en Argentina; vaciar los dos campos y filtrar de nuevo saca el límite de fecha del
 * todo (el cursor de paginación lo aguanta).
 */
export default async function BoletasEmitidasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; mesaId?: string; cursor?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const { desde, hasta, mesaId, filtro } = leerFiltroBoletas(sp);

  const [{ items, nextCursor }, mesaNumero] = await Promise.all([
    listarBoletasEmitidas(ctx.sucursalId, filtro, ctx.db),
    mesaId ? obtenerNumeroDeMesa(ctx.sucursalId, mesaId, ctx.db) : Promise.resolve(null),
  ]);

  const paramsSiguiente = serializarFiltroBoletas({ desde, hasta, mesaId, cursor: nextCursor });
  const paramsSinMesa = serializarFiltroBoletas({ desde, hasta });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Boletas emitidas</h1>
        <p className="text-sm text-neutral-500">
          Una fila por ejemplar impreso (la A, y cada corrección B, C… por separado), más recientes primero. Para reimprimir o
          emitir una corregida, entrá a la mesa: acá es de solo lectura, con link a Trazabilidad. Una cuenta cerrada antes de la
          numeración de boletas no tiene ejemplar y no aparece.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Desde (hora Argentina)
          <input type="date" name="desde" defaultValue={desde} className="rounded border px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          Hasta (hora Argentina)
          <input type="date" name="hasta" defaultValue={hasta} className="rounded border px-2 py-1.5" />
        </label>
        {mesaId && <input type="hidden" name="mesaId" value={mesaId} />}
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Filtrar
        </button>
        <Link href="/reportes/boletas" className="self-center text-sm underline">
          Limpiar
        </Link>
      </form>

      {mesaId && (
        <p className="text-xs text-neutral-500">
          Filtrando por {mesaNumero !== null ? nombreDeMesa(mesaNumero) : "una mesa"} ·{" "}
          <Link href={`/reportes/boletas?${paramsSinMesa.toString()}`} className="underline">
            Quitar filtro de mesa
          </Link>
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">No hay boletas emitidas con estos filtros.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((b) => (
            <FilaBoleta key={b.ejemplarId} boleta={b} />
          ))}
        </div>
      )}

      {nextCursor && (
        <Link href={`/reportes/boletas?${paramsSiguiente.toString()}`} className="text-sm underline">
          Página siguiente →
        </Link>
      )}
    </div>
  );
}

function FilaBoleta({ boleta: b }: { boleta: Awaited<ReturnType<typeof listarBoletasEmitidas>>["items"][number] }) {
  const numero = formatearNumeroBoleta(b.numero);
  return (
    <details className="rounded border" data-boleta={b.ejemplarId}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
        <span className="font-medium">N.º {numero}</span>
        <span className="w-36 tabular-nums text-neutral-500">{formatearFechaHora(b.emitidoEn)}</span>
        <span className="text-neutral-500">{nombreDeMesa(b.mesaNumero)}</span>
        <span className="text-neutral-500">Emitió {b.emitidoPor}</span>
        {b.correccionDe && <Marca texto={`Corrección de N.º ${formatearNumeroBoleta(b.correccionDe)}`} tono="neutral" />}
        {b.reemplazadaPor && <Marca texto={`Reemplazada por N.º ${formatearNumeroBoleta(b.reemplazadaPor)}`} tono="neutral" />}
        {b.estado === "anulada" && <Marca texto="Venta anulada" tono="rojo" />}
        {b.estado === "desactualizada" && <Marca texto="Desactualizada" tono="ambar" />}
        <span className={`ml-auto font-semibold tabular-nums ${b.estado === "anulada" ? "line-through" : ""}`}>{formatearMonto(b.importe)}</span>
      </summary>
      <div className="border-t px-3 py-2">
        <p className="mb-2 text-xs text-neutral-500">
          Atendió {b.detalle.mesero} · Abierta {formatearFechaHora(b.detalle.abiertaEn)} · Cerrada {formatearFechaHora(b.detalle.cerradaEn)}
          {b.detalle.cliente && (
            <>
              {" "}
              · Cliente {b.detalle.cliente.nombre} (−{b.detalle.cliente.descuentoPorcentaje}%)
            </>
          )}
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
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
                  {l.precioListaUnitario !== undefined && <span className="mr-1 text-neutral-500 line-through dark:text-neutral-400">{formatearMonto(l.precioListaUnitario)}</span>}
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
      ? "border-red-600 text-red-600"
      : tono === "ambar"
        ? "border-amber-700 text-amber-700 dark:border-amber-600 dark:text-amber-600"
        : "border-neutral-400 text-neutral-500";
  return <span className={`rounded border px-1.5 text-xs ${clases}`}>{texto}</span>;
}
