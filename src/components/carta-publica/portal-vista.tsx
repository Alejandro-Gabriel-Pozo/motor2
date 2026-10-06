import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { decidirLayoutPortal, type EstiloPortal } from "@/core/carta/public";
import type { EntradaPortalCarta } from "@/core/carta/public";

/**
 * Portal de sucursales de una empresa (ADR-006). Dos modos, decididos por `decidirLayoutPortal`:
 *  - MAPA: hay imagen de fondo Y al menos una sucursal con `posX/posY/posW` — cada tarjeta se dibuja en su lugar sobre la
 *    imagen (centro en %, ancho en %, alto `posH` o el por defecto). Las sucursales sin posición van en una grilla DEBAJO
 *    del mapa (no desaparecen).
 *  - GRILLA: cualquier otro caso — una lista de tarjetas.
 *
 * La misma vista sirve la carta pública (`modo="publico"`, links internos) y la vista previa del admin
 * (`modo="vista-previa"`, links externos a otra pestaña: la vista previa vive dentro del admin y el destino es otro host).
 * Todos los colores/tamaños llegan como variables CSS `--portal-*` (`estilo.variablesCss`, ya validadas) y se aplican en
 * `.portal-card` de `globals.css`; nada de la config se interpola como CSS libre.
 */

export type ModoPortal = "publico" | "vista-previa";

interface Props {
  sucursales: readonly EntradaPortalCarta[];
  empresaNombre: string;
  estilo: EstiloPortal;
  /** URL de la carta de una sucursal. */
  hrefDe: (slugSucursal: string) => string;
  modo: ModoPortal;
}

function Flecha() {
  return (
    <svg className="portal-card-flecha shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function Tarjeta({ s, href, modo, className }: { s: EntradaPortalCarta; href: string; modo: ModoPortal; className: string }) {
  const contenido = (
    <>
      <span className="min-w-0">
        <span className="portal-card-nombre block truncate carta-titulo font-medium">{s.etiqueta}</span>
        {s.subtitulo && <span className="portal-card-notas mt-0.5 block truncate">{s.subtitulo}</span>}
      </span>
      <Flecha />
    </>
  );
  if (modo === "vista-previa") {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" draggable={false} className={className}>
        {contenido}
        <span className="sr-only"> (se abre en una pestaña nueva)</span>
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {contenido}
    </Link>
  );
}

function Grilla({ sucursales, hrefDe, modo }: { sucursales: readonly EntradaPortalCarta[]; hrefDe: Props["hrefDe"]; modo: ModoPortal }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-3" role="list">
      {sucursales.map((s) => (
        <li key={s.slug}>
          <Tarjeta s={s} href={hrefDe(s.slug)} modo={modo} className="portal-card portal-card-grilla flex items-center justify-between gap-3 rounded-xl p-4 transition-transform active:scale-[0.98]" />
        </li>
      ))}
    </ul>
  );
}

function Encabezado({ estilo, empresaNombre, publico }: { estilo: EstiloPortal; empresaNombre: string; publico: boolean }): ReactNode {
  const { empresa_logo_url: logo, portal_etiqueta: etiqueta, portal_titulo: titulo } = estilo.valores;
  if (!logo && !etiqueta && !titulo) return null;
  // Incrustado en el admin (vista previa) el título no puede ser un h1: la página ya tiene el suyo y la vista previa cuelga de un h2.
  const Titulo = publico ? "h1" : "h3";
  return (
    <header className="portal-header px-6 py-6 text-center">
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={empresaNombre} className="mx-auto mb-3 max-h-16 w-auto" />
      )}
      {etiqueta && <p className="portal-etiqueta text-xs uppercase tracking-widest">{etiqueta}</p>}
      {titulo && <Titulo className="portal-titulo carta-titulo text-2xl font-medium">{titulo}</Titulo>}
    </header>
  );
}

export function PortalVista({ sucursales, empresaNombre, estilo, hrefDe, modo }: Props) {
  const layout = decidirLayoutPortal(sucursales, estilo.imagenFondo);
  const derechos = estilo.valores.footer_texto_derechos;
  const hayTitulo = Boolean(estilo.valores.portal_titulo);
  const publico = modo === "publico";
  const Cuerpo = publico ? "main" : "div";

  return (
    <div className={`portal ${publico ? "min-h-screen" : ""}`} style={estilo.variablesCss as CSSProperties}>
      <Encabezado estilo={estilo} empresaNombre={empresaNombre} publico={publico} />
      <Cuerpo className="mx-auto px-6 pb-10 pt-4" style={{ maxWidth: layout.modo === "mapa" ? 648 : 576 }}>
        {publico && !hayTitulo && <h1 className="sr-only">Sucursales</h1>}
        {sucursales.length === 0 ? (
          <p className="text-center text-sm opacity-60">Todavía no hay cartas publicadas.</p>
        ) : (
          <>
            {layout.modo === "mapa" && estilo.imagenFondo && (
              <div className="portal-mapa relative mx-auto w-full overflow-hidden rounded-xl" style={{ maxWidth: 600, aspectRatio: estilo.proporcion }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={estilo.imagenFondo} alt="" className="absolute inset-0 h-full w-full object-cover" />
                {estilo.overlay > 0 && <div className="absolute inset-0" style={{ background: `oklch(0 0 0 / ${estilo.overlay})` }} aria-hidden />}
                <ul className="absolute inset-0 m-0 list-none p-0" role="list">
                  {layout.enMapa.map((s) => {
                    const p = s.posicion;
                    if (!p) return null;
                    return (
                      <li
                        key={s.slug}
                        data-portal-slug={publico ? undefined : s.slug}
                        className="absolute"
                        style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h ?? estilo.altoTarjetaPct}%`, transform: "translate(-50%, -50%)" }}
                      >
                        <Tarjeta s={s} href={hrefDe(s.slug)} modo={modo} className="portal-card portal-card-mapa flex h-full w-full items-center justify-between gap-1 rounded-md" />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {layout.enGrilla.length > 0 && (
              <div className={layout.modo === "mapa" ? "mt-6" : undefined}>
                <Grilla sucursales={layout.enGrilla} hrefDe={hrefDe} modo={modo} />
              </div>
            )}
          </>
        )}
      </Cuerpo>
      {derechos && (
        <footer className="portal-footer px-6 pb-8 text-center text-xs">
          © {new Date().getFullYear()} {derechos}
        </footer>
      )}
    </div>
  );
}
