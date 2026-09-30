import type { EstiloCarta, ItemCartaV1, PromoCartaV1, SeccionCartaV1 } from "@/core/carta/public";
import { formatearPrecioCarta } from "@/core/carta/public";
import { TagIcon } from "./iconos";

/**
 * ADR-006, Fase 3: banda + ítems + promos de UNA sección de la carta — desenredado de `carta-view.tsx` (el `BandaContenido`
 * del original vivía DEFINIDO DENTRO del render de todo el componente, remontándose en cada render; acá es su propia
 * función a nivel de módulo). Sin la duplicación banda mobile/banda desktop del original: un solo bloque, con Tailwind
 * responsive. La imagen de sección es siempre el fondo de la banda: un `<img>` de fondo con `object-fit`, sin la lógica de
 * posicionamiento fino del original (nivel (a) del diagnóstico: correcto y accesible, no pixel-a-pixel idéntico).
 */
export function Seccion({ seccion, indice, total, estilo }: { seccion: SeccionCartaV1; indice: number; total: number; estilo: EstiloCarta }) {
  const img = estilo.imagenSeccion;
  const c = estilo.colores;
  return (
    <div className="carta-pagina flex flex-col">
      <div
        data-carta-banda
        className="relative h-[var(--banda-alto-m)] shrink-0 overflow-hidden border-b sm:h-[var(--banda-alto-d)]"
        style={{ "--banda-alto-m": estilo.banda.altoMobile, "--banda-alto-d": estilo.banda.altoDesktop, borderColor: "var(--carta-border)" } as React.CSSProperties}
      >
        {seccion.imagenUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={seccion.imagenUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" style={{ opacity: img.opacidadPct / 100, objectPosition: `${img.posicionX} ${img.posicionY}` }} />
        )}
        {seccion.imagenUrl && img.overlay && <div className="absolute inset-0" style={{ background: "linear-gradient(to right, var(--carta-bg), transparent 60%)" }} aria-hidden />}

        <div className="absolute inset-0 flex flex-col justify-end gap-0.5 px-6 pb-3 sm:justify-center sm:px-10 sm:pt-12 sm:pb-4">
          <p className="overflow-hidden text-ellipsis whitespace-nowrap font-light uppercase tracking-[0.4em]" style={{ fontSize: estilo.valores.carta_fuente_banda_etiqueta, color: c.bandaEtiqueta ?? "var(--carta-primary)" }}>
            {String(indice + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </p>
          <h2
            className="line-clamp-2 text-[length:var(--banda-titulo-fs)] carta-titulo font-medium leading-tight tracking-tight sm:text-[length:calc(var(--banda-titulo-fs)*1.5)]"
            style={{ "--banda-titulo-fs": estilo.valores.carta_fuente_banda_titulo, color: c.bandaTitulo ?? undefined } as React.CSSProperties}
          >
            {seccion.titulo ?? seccion.nombre}
          </h2>
          {seccion.descripcion && (
            <p className={`line-clamp-1 font-light leading-snug${c.bandaDescripcion ? "" : " opacity-70"}`} style={{ fontSize: estilo.valores.carta_fuente_banda_descripcion, color: c.bandaDescripcion ?? undefined }}>
              {seccion.descripcion}
            </p>
          )}
        </div>
      </div>

      <ul data-carta-scroll className="min-h-0 flex-1 divide-y overflow-y-auto px-6 sm:px-10" style={{ borderColor: "var(--carta-border)" }}>
        {seccion.items.map((item) => (
          <ItemFila key={item.productoId} item={item} estilo={estilo} />
        ))}
        {seccion.promos.map((promo) => (
          <PromoFila key={promo.id} promo={promo} estilo={estilo} />
        ))}
      </ul>
    </div>
  );
}

function ItemFila({ item, estilo }: { item: ItemCartaV1; estilo: EstiloCarta }) {
  const v = estilo.valores;
  const esp = item.especial;
  const colorNombre = esp ? (v.color_especial_item_nombre || "var(--carta-primary)") : v.color_item_nombre || undefined;
  const colorPrecio = esp ? (v.color_especial_item_precio || "var(--carta-primary)") : v.color_item_precio || "var(--carta-primary)";
  const colorDesc = esp ? v.color_especial_item_descripcion || undefined : v.color_item_descripcion || undefined;
  const colorTags = esp ? (v.color_especial_item_tags || "var(--carta-primary)") : v.color_item_tags || "var(--carta-primary)";

  return (
    <li className="py-2.5" style={{ borderColor: "var(--carta-border)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 flex-1 carta-titulo font-semibold leading-tight" style={{ fontSize: v.carta_fuente_item_nombre, color: colorNombre, overflowWrap: "anywhere" }}>
          {item.nombre}
          {esp && (
            <span className="ml-1 text-xs" style={{ color: v.color_especial_item_nombre || "var(--carta-primary)" }} aria-label="Especial">
              {" ★"}
            </span>
          )}
        </h3>
        <span className="shrink-0 carta-titulo font-semibold" style={{ fontSize: v.carta_fuente_item_precio, color: colorPrecio }}>
          {formatearPrecioCarta(item.precio)}
        </span>
      </div>
      {item.descripcion && (
        <p className="mt-0.5 font-light leading-snug opacity-75" style={{ fontSize: v.carta_fuente_item_descripcion, color: colorDesc }}>
          {item.descripcion}
        </p>
      )}
      {item.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-0.5 font-light uppercase tracking-wider" style={{ fontSize: v.carta_fuente_item_tags, color: colorTags }}>
              <TagIcon tag={tag} />
              {tag}
            </span>
          ))}
        </div>
      )}
      {item.opciones && item.opciones.length > 0 && (
        <p className="mt-0.5 text-xs opacity-60">{item.opciones.map((o) => o.nombre).join(" · ")}</p>
      )}
    </li>
  );
}

function PromoFila({ promo, estilo }: { promo: PromoCartaV1; estilo: EstiloCarta }) {
  const v = estilo.valores;
  return (
    <li className="py-2.5" style={{ borderColor: "var(--carta-border)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 flex-1 carta-titulo font-semibold leading-tight" style={{ fontSize: v.carta_fuente_item_nombre }}>
          {promo.titulo}
        </h3>
        <span className="shrink-0 carta-titulo font-semibold" style={{ fontSize: v.carta_fuente_item_precio, color: "var(--carta-primary)" }}>
          {formatearPrecioCarta(promo.precio)}
        </span>
      </div>
      {promo.descripcion && (
        <p className="mt-0.5 font-light leading-snug opacity-75" style={{ fontSize: v.carta_fuente_item_descripcion }}>
          {promo.descripcion}
        </p>
      )}
    </li>
  );
}
