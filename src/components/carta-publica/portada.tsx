import type { EstiloCarta } from "@/core/carta/public";

/**
 * ADR-006, Fase 3: portada de la carta — un solo árbol de markup (el original dibujaba una portada de escritorio y otra de
 * mobile, dos veces el mismo contenido con `hidden sm:block`/`sm:hidden`; acá las diferencias de tamaño/posición se
 * resuelven con clases responsive de Tailwind sobre los MISMOS nodos). Simplificado a propósito respecto del original: sin
 * el logo con fallback por `onError` (la URL ya se valida `https://` al guardarla) y sin el degradé/blur decorativo detrás
 * del texto en mobile — mismo contenido, presentación más simple (nivel (a) del diagnóstico de UI: desenredar sin cambiar
 * el concepto, el rediseño de layout es nivel (b), Fase 5, con aprobación del dueño).
 */
export function Portada({ estilo, restauranteNombre }: { estilo: EstiloCarta; restauranteNombre: string }) {
  const v = estilo.valores;
  const logoUrl = v.restaurante_logo_url;
  const bgUrl = v.hero_imagen_fondo_url;
  // Sin `hero_ink` cargado: con imagen de fondo, el overlay aclara hacia --carta-bg (texto oscuro contrasta bien); sin
  // imagen, el fondo es --carta-primary sólido (un ámbar oscuro) y el --carta-ink por defecto (casi negro) no alcanza
  // 3:1 — blanco sí. Puesto una sola vez acá y heredado por todo el contenido (currentColor en los separadores).
  // `color_portada_textos` (explícito) gana sobre `hero_ink`.
  const colorTexto = estilo.portada.colorTexto ?? estilo.heroInk ?? (bgUrl ? "var(--carta-ink)" : "#fff");
  const colorCta = estilo.portada.colorCta;

  return (
    <div
      className="carta-pagina relative isolate flex flex-col items-center justify-center gap-4 overflow-hidden px-8 text-center"
      style={{ backgroundColor: bgUrl ? undefined : "var(--carta-primary)", color: colorTexto }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- fondo full-bleed de tamaño desconocido, no candidato de next/image */}
      {bgUrl && <img src={bgUrl} alt="" aria-hidden loading="eager" className="absolute inset-0 -z-10 h-full w-full object-cover" />}
      {bgUrl && <div className="absolute inset-0 -z-10" style={{ backgroundColor: "color-mix(in oklch, var(--carta-bg) 75%, transparent)" }} aria-hidden />}

      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={restauranteNombre} className="h-16 w-16 object-contain" />
      ) : restauranteNombre ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold" style={{ backgroundColor: "var(--carta-ink)", color: "var(--carta-bg)" }}>
          {restauranteNombre.charAt(0)}
        </div>
      ) : null}

      {v.hero_etiqueta_superior && (
        <p className="text-xs font-light uppercase tracking-[0.5em] opacity-70" style={{ fontSize: v.carta_fuente_portada_etiqueta }}>
          {v.hero_etiqueta_superior}
        </p>
      )}

      {restauranteNombre && (
        <h1 className="text-balance font-serif font-medium leading-tight" style={{ fontSize: v.carta_fuente_portada_nombre }}>
          {restauranteNombre}
        </h1>
      )}

      {v.restaurante_subtitulo && (
        <p className="text-xs font-light uppercase tracking-[0.3em] opacity-60" style={{ fontSize: v.carta_fuente_portada_subtitulo }}>
          {v.restaurante_subtitulo}
        </p>
      )}

      {v.restaurante_descripcion && (
        <p className="max-w-xs text-pretty leading-relaxed opacity-75" style={{ fontSize: v.carta_fuente_portada_descripcion }}>
          {v.restaurante_descripcion}
        </p>
      )}

      {v.carta_texto_portada_separador && (
        <div className="flex items-center gap-3">
          <span className="block h-px w-10 opacity-30" style={{ backgroundColor: "currentColor" }} />
          <span className="text-[11px] opacity-40">{v.carta_texto_portada_separador}</span>
          <span className="block h-px w-10 opacity-30" style={{ backgroundColor: "currentColor" }} />
        </div>
      )}

      {v.carta_texto_portada_cta && (
        <p className={`font-light uppercase tracking-[0.4em]${colorCta ? "" : " opacity-50"}`} style={{ fontSize: v.carta_fuente_portada_cta, color: colorCta ?? undefined }}>
          {v.carta_texto_portada_cta}
        </p>
      )}
    </div>
  );
}
