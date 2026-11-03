// Tarjeta de mesa para el mapa de salón. Tres estados: libre / en_pedido / ocupada.
// Colores: los tokens del sistema visual (`var(--color-*)` en los `style`, src/app/globals.css); desde 6.30 no lee los alias del salón (`.pos-shell`).
//
// Insumo de diseño provisto (mesa-card.tsx + mesas-tokens.css), con los ajustes del plan
// docs/plan-mapa-de-mesas-2026-09-24.md §A.4: colores de texto con el contraste aprobado por el dueño (§A.3) y `EstadoMesa`
// importado del núcleo. Desde «tomar pedido» (docs/plan-tomar-pedido-2026-09-25.md, paso 7) las acciones son ENLACES a la pantalla
// de la mesa (`href`). El número llega ya formateado por quien llama («01»).
// El total se formatea con `formatearMonto` (el mismo del ticket y de la pantalla de la mesa, centavos incluidos; P19, decisión del dueño 2026-10-11).

import Link from "next/link";
import { IndicadorDeEnlace } from "@/components/indicador-de-enlace";
import type { ReactNode } from "react";
import { formatearMonto, type EstadoMesa } from "@/core/pos/public";

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
  /** Destino de las acciones de la tarjeta («Tomar pedido» / «Continuar pedido», «Ver pedidos» y «Facturar»): la pantalla de la mesa, `/mesas/<id>`. */
  href: string;
}

/**
 * `varColor`/`varTint`: barra lateral, puntos, fondo de la etiqueta y del botón — exactamente los del diseño.
 * `varTexto`/`varTextoBoton`: colores de TEXTO con contraste AA (ajuste aprobado por el dueño, plan §A.3): la etiqueta «Libre»
 * y «En pedido» usan una tinta más oscura que su color de estado (5,59:1 y 5,76:1 sobre su fondo, antes 4,48:1 y 2,94:1), y
 * el texto de «Continuar pedido» va en `--ink` sobre el ámbar (5,29:1; en blanco daba 3,25:1).
 */
const ESTADO_CONFIG: Record<EstadoMesa, { label: string; varColor: string; varTint: string; varTexto: string; varTextoBoton: string }> = {
  libre: { label: "Libre", varColor: "var(--color-ok)", varTint: "var(--color-ok-tinte)", varTexto: "var(--color-ok-tinta)", varTextoBoton: "var(--color-superficie)" },
  en_pedido: { label: "En pedido", varColor: "var(--color-aviso)", varTint: "var(--color-aviso-tinte)", varTexto: "var(--color-aviso-tinta)", varTextoBoton: "var(--color-tinta)" },
  ocupada: { label: "Ocupada", varColor: "var(--color-error)", varTint: "var(--color-error-tinte)", varTexto: "var(--color-error)", varTextoBoton: "var(--color-superficie)" },
};

export function MesaCard(props: MesaCardProps) {
  const { numero, estado, productosSinEnviar, total, mesero, tiempoAbierta, pedidosEnviados, href } = props;
  const cfg = ESTADO_CONFIG[estado];

  return (
    <div className="relative overflow-hidden rounded-[10px] border border-borde bg-superficie p-4 transition-colors hover:border-tinta-tenue">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: cfg.varColor }} aria-hidden />

      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold tracking-wide text-tinta-tenue">MESA</div>
          <div className="text-xl font-extrabold leading-none tabular-nums">{numero}</div>
        </div>

        <span className="rounded-md px-2 py-1 text-xs font-semibold" style={{ color: cfg.varTexto, background: cfg.varTint }}>
          {cfg.label}
        </span>
      </div>

      {estado === "libre" && <p className="mb-4 text-sm text-tinta-suave">Disponible para comensales</p>}

      {estado === "en_pedido" && (
        <>
          <p className="mb-1 text-[13px] text-tinta-suave">
            {productosSinEnviar ?? 0} producto{productosSinEnviar === 1 ? "" : "s"} sin enviar
          </p>
          <p className="mb-4 text-base font-bold tabular-nums">{total == null ? "—" : formatearMonto(total)}</p>
        </>
      )}

      {estado === "ocupada" && (
        <>
          <div className="mb-1 flex items-center gap-1.5 text-sm text-tinta-suave">
            <IconUser />
            <span>
              {mesero ?? "Mesero asignado"}
              {tiempoAbierta ? ` · ${tiempoAbierta}` : ""}
            </span>
          </div>
          <p className="mb-3 text-sm text-tinta-suave">
            {pedidosEnviados ?? 0} pedido{pedidosEnviados === 1 ? "" : "s"} enviado{pedidosEnviados === 1 ? "" : "s"}
          </p>
          <p className="mb-3 text-base font-bold tabular-nums">{total == null ? "—" : formatearMonto(total)}</p>
        </>
      )}

      {estado === "libre" && (
        <ActionButton color={cfg.varColor} textColor={cfg.varTextoBoton} href={href} icon={<IconCart />}>
          Tomar pedido
        </ActionButton>
      )}

      {estado === "en_pedido" && (
        <ActionButton color={cfg.varColor} textColor={cfg.varTextoBoton} href={href} icon={<IconEdit />}>
          Continuar pedido
        </ActionButton>
      )}

      {estado === "ocupada" && (
        // Contenedor propio: en la tarjeta angosta (2 columnas en celular) los dos botones no entran lado a lado sin cortar «Facturar»; se apilan y, con lugar, van en fila.
        <div className="@container">
          <div className="flex flex-col gap-2 @[14rem]:flex-row">
            <Link
              href={href}
              className="flex w-full min-w-0 items-center justify-center rounded-lg border border-borde py-[9px] text-sm font-semibold hover:bg-black/[0.03] max-md:min-h-11"
            >
              Ver pedidos
              <IndicadorDeEnlace />
            </Link>
            <ActionButton color={cfg.varColor} textColor={cfg.varTextoBoton} href={href} grande>
              Facturar
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

/** Enlace con aspecto de botón; el color es el del ESTADO de la mesa (dato: libre, en pedido, ocupada), va en `style`. */
function ActionButton({ color, textColor, href, icon, grande = false, children }: { color: string; textColor: string; href: string; icon?: ReactNode; grande?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg py-[9px] ${grande ? "text-sm" : "text-[13px]"} font-semibold transition-opacity hover:opacity-90 max-md:min-h-11`}
      style={{ background: color, color: textColor }}
    >
      {icon}
      {children}
      <IndicadorDeEnlace />
    </Link>
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
