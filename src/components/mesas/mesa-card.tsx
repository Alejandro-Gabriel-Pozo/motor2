// Tarjeta de mesa para el mapa de salón. Tres estados: libre / en_pedido / ocupada.
// Requiere las variables CSS del bloque `.pos-shell` de src/app/globals.css (las aplica PosShell, nunca `:root`).
//
// Insumo de diseño provisto (mesa-card.tsx + mesas-tokens.css), con los ajustes del plan
// docs/plan-mapa-de-mesas-2026-09-24.md §A.4: botones sin callback deshabilitados, colores de texto con el contraste aprobado
// por el dueño (§A.3) y `EstadoMesa` importado del núcleo. El número llega ya formateado por quien llama («01»).

import type { ReactNode } from "react";
import type { EstadoMesa } from "@/core/pos/mesas";

export interface MesaCardProps {
  numero: number | string;
  estado: EstadoMesa;
  /** Solo para en_pedido: cantidad de productos aún no enviados a cocina */
  productosSinEnviar?: number;
  /** Total acumulado (en_pedido u ocupada), ya formateado o número crudo */
  total?: number;
  /** Solo para ocupada */
  mesero?: string;
  tiempoAbierta?: string; // ej. "hace 42 min"
  pedidosEnviados?: number;
  /** Un botón sin callback se dibuja deshabilitado: nunca un botón habilitado que no hace nada. */
  onTomarPedido?: () => void;
  onVerPedidos?: () => void;
  onFacturar?: () => void;
  onMenu?: () => void;
}

/**
 * `varColor`/`varTint`: barra lateral, puntos, fondo de la etiqueta y del botón — exactamente los del diseño.
 * `varTexto`/`varTextoBoton`: colores de TEXTO con contraste AA (ajuste aprobado por el dueño, plan §A.3): la etiqueta «Libre»
 * y «En pedido» usan una tinta más oscura que su color de estado (5,59:1 y 5,76:1 sobre su fondo, antes 4,48:1 y 2,94:1), y
 * el texto de «Continuar pedido» va en `--ink` sobre el ámbar (5,29:1; en blanco daba 3,25:1).
 */
const ESTADO_CONFIG: Record<EstadoMesa, { label: string; varColor: string; varTint: string; varTexto: string; varTextoBoton: string }> = {
  libre: { label: "Libre", varColor: "var(--mesa-libre)", varTint: "var(--mesa-libre-tint)", varTexto: "var(--mesa-libre-ink)", varTextoBoton: "#fff" },
  en_pedido: { label: "En pedido", varColor: "var(--mesa-draft)", varTint: "var(--mesa-draft-tint)", varTexto: "var(--mesa-draft-ink)", varTextoBoton: "var(--ink)" },
  ocupada: { label: "Ocupada", varColor: "var(--mesa-ocupada)", varTint: "var(--mesa-ocupada-tint)", varTexto: "var(--mesa-ocupada)", varTextoBoton: "#fff" },
};

function formatMonto(n?: number) {
  if (n == null) return null;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

export function MesaCard(props: MesaCardProps) {
  const { numero, estado, productosSinEnviar, total, mesero, tiempoAbierta, pedidosEnviados, onTomarPedido, onVerPedidos, onFacturar, onMenu } = props;
  const cfg = ESTADO_CONFIG[estado];

  return (
    <div className="relative overflow-hidden rounded-[10px] border border-[var(--border)] bg-white p-4 transition-colors hover:border-[var(--ink-faint)]">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: cfg.varColor }} aria-hidden />

      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-[10.5px] font-semibold tracking-wide text-[var(--ink-faint)]">MESA</div>
          <div className="text-xl font-extrabold leading-none tabular-nums">{numero}</div>
        </div>

        {estado === "ocupada" ? (
          <button
            type="button"
            onClick={onMenu}
            disabled={!onMenu}
            aria-label="Opciones de mesa"
            className="-mr-1 rounded-md p-1 text-[var(--ink-faint)] enabled:hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconDots />
          </button>
        ) : (
          <span className="rounded-md px-2 py-1 text-[11px] font-semibold" style={{ color: cfg.varTexto, background: cfg.varTint }}>
            {cfg.label}
          </span>
        )}
      </div>

      {estado === "libre" && <p className="mb-4 text-[13px] text-[var(--ink-soft)]">Disponible para comensales</p>}

      {estado === "en_pedido" && (
        <>
          <p className="mb-1 text-[13px] text-[var(--ink-soft)]">
            {productosSinEnviar ?? 0} producto{productosSinEnviar === 1 ? "" : "s"} sin enviar
          </p>
          <p className="mb-4 text-[15px] font-bold tabular-nums">{formatMonto(total) ?? "—"}</p>
        </>
      )}

      {estado === "ocupada" && (
        <>
          <div className="mb-1 flex items-center gap-1.5 text-[12.5px] text-[var(--ink-soft)]">
            <IconUser />
            <span>
              {mesero ?? "Mesero asignado"}
              {tiempoAbierta ? ` · ${tiempoAbierta}` : ""}
            </span>
          </div>
          <p className="mb-3 text-[12.5px] text-[var(--ink-soft)]">
            {pedidosEnviados ?? 0} pedido{pedidosEnviados === 1 ? "" : "s"} enviado{pedidosEnviados === 1 ? "" : "s"}
          </p>
          <p className="mb-3 text-[15px] font-bold tabular-nums">{formatMonto(total) ?? "—"}</p>
        </>
      )}

      {estado === "libre" && (
        <ActionButton color={cfg.varColor} textColor={cfg.varTextoBoton} onClick={onTomarPedido} icon={<IconCart />}>
          Tomar pedido
        </ActionButton>
      )}

      {estado === "en_pedido" && (
        <ActionButton color={cfg.varColor} textColor={cfg.varTextoBoton} onClick={onTomarPedido} icon={<IconEdit />}>
          Continuar pedido
        </ActionButton>
      )}

      {estado === "ocupada" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onVerPedidos}
            disabled={!onVerPedidos}
            className="w-full rounded-lg border border-[var(--border)] py-[9px] text-[13px] font-semibold enabled:hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ver pedidos
          </button>
          <ActionButton color={cfg.varColor} textColor={cfg.varTextoBoton} onClick={onFacturar}>
            Facturar
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function ActionButton({ color, textColor, onClick, icon, children }: { color: string; textColor: string; onClick?: () => void; icon?: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg py-[9px] text-[13px] font-semibold transition-opacity enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: color, color: textColor }}
    >
      {icon}
      {children}
    </button>
  );
}

function IconDots() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a7 7 0 0 1 14 0v1" />
    </svg>
  );
}
function IconCart() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
