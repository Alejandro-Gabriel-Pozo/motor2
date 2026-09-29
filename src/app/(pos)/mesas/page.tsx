import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/core/permisos/gate";
import { esEstadoMesa, filtrarMesas, obtenerMapaDeMesas, type EstadoMesa } from "@/core/pos/mesas";
import { MesaCard } from "@/components/mesas/mesa-card";
import { NuevaMesa } from "./nueva-mesa";
import { LimiteMesasAbiertas } from "./limite-mesas";
import { obtenerLimiteMesasAbiertas } from "@/server/consultas/pos/mesas";

const HORA = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });

/** Pestañas de filtro: `null` = todas. El punto de color usa el color de estado (no es texto); el texto va en la tinta del filtro. */
const FILTROS: { estado: EstadoMesa | null; label: string; punto?: string }[] = [
  { estado: null, label: "Todas" },
  { estado: "libre", label: "Libres", punto: "var(--mesa-libre)" },
  { estado: "en_pedido", label: "En pedido", punto: "var(--mesa-draft)" },
  { estado: "ocupada", label: "Ocupadas", punto: "var(--mesa-ocupada)" },
];

function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** `/mesas` con los filtros dados, sin parámetros vacíos (así «Todas» sin búsqueda es `/mesas` a secas). */
function hrefMapa(estado: EstadoMesa | null, q: string): string {
  const params = new URLSearchParams();
  if (estado) params.set("estado", estado);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/mesas?${query}` : "/mesas";
}

/**
 * Mapa de mesas del salón (módulo POS, docs/plan-mapa-de-mesas-2026-09-24.md, paso 4). Server Component: lee el mapa directo del
 * núcleo (`obtenerMapaDeMesas`) después de la guarda de Ver, sin Server Action de lectura. Filtros y búsqueda viajan por la URL
 * (`?estado=…&q=…`); la única pieza de cliente es «Nueva mesa».
 *
 * «Tomar pedido», «Continuar pedido», «Ver pedidos» y «Facturar» llevan a la pantalla de la mesa (`/mesas/<id>`, pendiente «tomar
 * pedido», docs/plan-tomar-pedido-2026-09-25.md): ahí se abre la cuenta, se cargan y envían ítems a cocina, se anulan y se cierra la
 * cuenta, cada cosa con su permiso. «Opciones de mesa» (mover/unir mesas) sigue deshabilitado: fuera de alcance. Sin actualización
 * en vivo (ni polling ni realtime): el mapa se refresca al navegar, al filtrar o después de «Nueva mesa».
 */
export default async function MapaDeMesasPage({ searchParams }: { searchParams: Promise<{ estado?: string | string[]; q?: string | string[] }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "pos_mesas", ctx.db);
  if (!gate.ok) return <p className="text-red-700">{gate.mensaje}</p>;

  const params = await searchParams;
  const estadoPedido = primero(params.estado);
  const estado = esEstadoMesa(estadoPedido) ? estadoPedido : null;
  const q = (primero(params.q) ?? "").trim();

  const [nivel, mapa, sucursal] = await Promise.all([
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pos_mesas", ctx.db),
    obtenerMapaDeMesas(ctx.sucursalId, ctx.db),
    obtenerLimiteMesasAbiertas(ctx.sucursalId, ctx.db),
  ]);
  const { metricas } = mapa;
  const visibles = filtrarMesas(mapa.mesas, { estado: estado ?? undefined, q });
  const conteoDe = (e: EstadoMesa | null) => (e === "libre" ? metricas.libres : e === "en_pedido" ? metricas.enPedido : e === "ocupada" ? metricas.ocupadas : metricas.total);

  return (
    <div>
      <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="mb-1.5 text-[26px] font-extrabold leading-none tracking-tight md:text-[28px]">Mapa de mesas</h1>
          <p className="text-[13.5px] text-[var(--ink-soft)]">
            {ctx.sucursalNombre} · actualizado a las {HORA.format(new Date())}
          </p>
          <p className="mt-1">
            <LimiteMesasAbiertas abiertas={metricas.enPedido + metricas.ocupadas} limite={sucursal.maxMesasAbiertas} puedeEditar={nivel.editar} />
          </p>
        </div>
        <NuevaMesa siguienteNumero={mapa.siguienteNumero} puedeCrear={nivel.editar} />
      </header>

      <section aria-label="Resumen de mesas" className="mb-6 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <Metrica label="Total de mesas" valor={metricas.total} />
        <Metrica label="Libres" valor={metricas.libres} color="var(--mesa-libre)" />
        <Metrica label="En pedido" valor={metricas.enPedido} color="var(--mesa-draft)" />
        <Metrica label="Ocupadas" valor={metricas.ocupadas} color="var(--mesa-ocupada)" />
      </section>

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <nav aria-label="Filtrar por estado" className="-mb-1 overflow-x-auto pb-1">
          <ul className="flex items-center gap-1.5">
            {FILTROS.map((f) => {
              const activo = f.estado === estado;
              return (
                <li key={f.label}>
                  <Link
                    href={hrefMapa(f.estado, q)}
                    aria-current={activo ? "true" : undefined}
                    className={`flex items-center gap-[7px] whitespace-nowrap rounded-full border border-transparent px-[13px] py-[7px] text-[13px] font-semibold transition-colors ${
                      activo ? "bg-[var(--ink)] text-white" : "text-[var(--ink-soft)] hover:bg-[#F1EFEA]"
                    }`}
                  >
                    {f.punto && <span className="size-1.5 flex-none rounded-full" style={{ background: f.punto }} aria-hidden />}
                    {f.label} · {conteoDe(f.estado)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <form method="get" action="/mesas" role="search" className="flex items-center gap-2 self-start rounded-full border border-[var(--border)] bg-white px-3.5 py-2 md:self-auto">
          {estado && <input type="hidden" name="estado" value={estado} />}
          <label htmlFor="buscar-mesa" className="sr-only">
            Buscar mesa
          </label>
          <input
            id="buscar-mesa"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Buscar mesa"
            className="w-32 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
          />
          <button type="submit" aria-label="Buscar" className="rounded-full text-[var(--ink-soft)] hover:text-[var(--ink)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
        </form>
      </div>

      {mapa.mesas.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-white px-6 py-10 text-center">
          <p className="font-semibold">Todavía no hay mesas en esta sucursal.</p>
          <p className="mt-1 text-[13px] text-[var(--ink-soft)]">
            {nivel.editar ? "Cargá la primera con «Nueva mesa»." : "Pedile a un admin que las cargue."}
          </p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-white px-6 py-10 text-center">
          <p className="font-semibold">Ninguna mesa coincide con el filtro.</p>
          <Link href="/mesas" className="mt-1 inline-block text-[13px] text-[var(--ink-soft)] underline hover:text-[var(--ink)]">
            Ver todas las mesas
          </Link>
        </div>
      ) : (
        <ul aria-label="Mesas" className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {visibles.map((m) => (
            <li key={m.id} data-mesa={m.numero} className="grid">
              <MesaCard
                numero={String(m.numero).padStart(2, "0")}
                estado={m.estado}
                productosSinEnviar={m.productosSinEnviar}
                total={m.estado === "libre" ? undefined : m.total}
                mesero={m.mesero ?? undefined}
                tiempoAbierta={m.tiempoAbierta ?? undefined}
                pedidosEnviados={m.pedidosEnviados}
                hrefPedido={`/mesas/${m.id}`}
                hrefVerPedidos={`/mesas/${m.id}`}
                hrefFacturar={`/mesas/${m.id}`}
              />
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}

function Metrica({ label, valor, color }: { label: string; valor: number; color?: string }) {
  return (
    <div data-metrica={label} className="rounded-[14px] border border-[var(--border)] bg-white px-4 py-3.5">
      <div className="mb-1 flex items-center gap-1.5">
        {color && <span className="size-1.5 flex-none rounded-full" style={{ background: color }} aria-hidden />}
        <span className="text-[11px] font-medium text-[var(--ink-faint)]">{label}</span>
      </div>
      <div className="text-2xl font-extrabold tabular-nums" style={color ? { color } : undefined}>
        {valor}
      </div>
    </div>
  );
}
