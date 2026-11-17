import { TEXTO_SOBRE_FOTO, VELO_FONDO_SOBRE_FOTO, VELO_SOMBRA_SOBRE_FOTO, type EstiloCarta } from "@/core/carta/public";

/**
 * ADR-006, Fase 3: portada de la carta — un solo árbol de markup (el original dibujaba una portada de escritorio y otra de
 * mobile, dos veces el mismo contenido con `hidden sm:block`/`sm:hidden`; acá las diferencias de tamaño/posición se
 * resuelven con clases responsive de Tailwind sobre los MISMOS nodos). Simplificado a propósito respecto del original: sin
 * el logo con fallback por `onError` (la URL ya se valida `https://` al guardarla) y sin el degradé/blur decorativo detrás
 * del texto en mobile — mismo contenido, presentación más simple (nivel (a) del diagnóstico de UI: desenredar sin cambiar
 * el concepto, el rediseño de layout es nivel (b), Fase 5, con aprobación del dueño).
 */
export function Portada({ estilo, restauranteNombre, estiloLibro = false }: { estilo: EstiloCarta; restauranteNombre: string; estiloLibro?: boolean }) {
  const v = estilo.valores;
  const logoUrl = v.restaurante_logo_url;
  const bgUrl = v.hero_imagen_fondo_url;
  // Sin color de texto cargado, la imagen conserva sus colores y el texto cae a --carta-ink; sin imagen, el fondo es
  // --carta-primary sólido (un ámbar oscuro) y el blanco da mejor contraste. `estilo.portada.colorTexto` ya prioriza
  // color_portada_textos > hero_ink > derivado del fondo cargado.
  const p = estilo.portada;
  // CON foto el texto es blanco sobre el velo negro y NO toma el color de marca (regla de Pedernal; `core/carta/portada-velo.ts`): solo manda un color de texto que la empresa haya cargado a propósito.
  const colorTexto = bgUrl ? (v.color_portada_textos || estilo.heroInk || TEXTO_SOBRE_FOTO) : (p.colorTexto ?? "#fff");
  const colorCta = p.colorCta;
  // Estilo de la maqueta (`LIBRO_ESTILO_MAQUETA`): sin imagen de fondo ni color de portada cargado, la portada es oscura con un degradé suave, un arco decorativo con el color de marca y el sello con la marca; lo cargado en el Tema manda.
  const conAire = estiloLibro && !bgUrl && !p.fondo;

  return (
    <div
      className="carta-pagina relative isolate flex flex-col items-center justify-center gap-4 overflow-hidden px-8 text-center"
      style={{
        backgroundColor: bgUrl ? undefined : conAire ? "var(--carta-bg)" : (p.fondo ?? "var(--carta-primary)"),
        backgroundImage: conAire ? "radial-gradient(120% 70% at 50% 40%, color-mix(in srgb, var(--carta-ink) 6%, var(--carta-bg)), var(--carta-bg))" : undefined,
        color: conAire ? "var(--carta-ink)" : colorTexto,
      }}
    >
      {conAire && (
        <div data-portada-arco aria-hidden className="pointer-events-none absolute -z-10 aspect-square rounded-full" style={{ left: "-25%", top: "calc(7% + 2.75rem)", width: "160%", border: "4.5rem solid var(--carta-primary)", opacity: 0.5 }} />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- fondo full-bleed de tamaño desconocido, no candidato de next/image */}
      {bgUrl && <img src={bgUrl} alt="" aria-hidden loading="eager" className="absolute inset-0 -z-10 h-full w-full object-cover" />}

      {/* Bloque y CTA: en mobile van posicionados por % (`carta_pos_bloque` / `carta_pos_cta`, ver `.portada-bloque`/`.portada-cta` en
          globals.css); desde `sm` vuelven al flujo centrado de siempre. */}
      <div
        data-portada-bloque
        className="portada-bloque flex flex-col items-center gap-4"
        style={{ "--portada-pos-bloque": p.posBloquePct } as React.CSSProperties}
      >
      <div className="relative flex flex-col items-center gap-4">
      {/* Velo SIN foto (aire de la maqueta): centrado en el bloque, se desvanece hacia los bordes. Sin ajuste en el Tema. */}
      {conAire && (
        <div
          data-portada-velo
          aria-hidden
          className="pointer-events-none absolute -inset-x-12 -inset-y-40 -z-10"
          style={{ backgroundImage: "radial-gradient(closest-side, oklch(0 0 0 / 0.5), oklch(0 0 0 / 0.3) 45%, transparent)" }}
        />
      )}
      {/* Velo CON foto: caja pareja detrás de TODO el bloque (logo y textos), con borde difuminado hacia afuera; deja cada texto a 7:1 sobre cualquier foto (valor fijo y su cálculo en `core/carta/portada-velo.ts`). */}
      {bgUrl && (
        <div
          data-portada-velo
          data-portada-velo-foto
          aria-hidden
          className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl"
          style={{ backgroundColor: VELO_FONDO_SOBRE_FOTO, boxShadow: VELO_SOMBRA_SOBRE_FOTO }}
        />
      )}
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={restauranteNombre} className="h-16 w-16 object-contain" />
      ) : restauranteNombre ? (
        <div className="carta-rol-titulo flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: conAire ? "var(--carta-primary)" : "var(--carta-ink)", color: "var(--carta-bg)" }}>
          {restauranteNombre.charAt(0)}
        </div>
      ) : null}

      {v.hero_etiqueta_superior && (
        <p className="font-light uppercase tracking-[0.5em] opacity-70" style={{ fontSize: v.carta_fuente_portada_etiqueta }}>
          {v.hero_etiqueta_superior}
        </p>
      )}

      {restauranteNombre && (
        <h1 className="text-balance carta-titulo font-medium leading-tight" style={{ fontSize: v.carta_fuente_portada_nombre }}>
          {restauranteNombre}
        </h1>
      )}

      {v.restaurante_subtitulo && (
        <p className="font-light uppercase tracking-[0.3em] opacity-60" style={{ fontSize: v.carta_fuente_portada_subtitulo }}>
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
          <span className="carta-rol-etiqueta opacity-40">{v.carta_texto_portada_separador}</span>
          <span className="block h-px w-10 opacity-30" style={{ backgroundColor: "currentColor" }} />
        </div>
      )}
      </div>
      </div>

      {v.carta_texto_portada_cta && (
        <p
          data-portada-cta
          className={`portada-cta font-light uppercase tracking-[0.4em]${colorCta ? "" : " opacity-50"}`}
          style={{ fontSize: v.carta_fuente_portada_cta, color: colorCta ?? undefined, "--portada-pos-cta": p.posCtaPct } as React.CSSProperties}
        >
          {v.carta_texto_portada_cta}
        </p>
      )}
    </div>
  );
}
