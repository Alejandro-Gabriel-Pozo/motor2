import { Fragment } from "react";
import type { EstiloCarta, ItemCartaPublico, PromoCartaPublica, SeccionCartaPublica } from "@/core/carta/public";
import { formatearPrecioCarta } from "@/core/carta/public";
import { TagIcon } from "./iconos";

/**
 * ADR-006, Fase 3: banda + ítems + promos de UNA sección de la carta — desenredado de `carta-view.tsx` (el `BandaContenido`
 * del original vivía DEFINIDO DENTRO del render de todo el componente, remontándose en cada render; acá es su propia
 * función a nivel de módulo). Sin la duplicación banda mobile/banda desktop del original: un solo bloque, con Tailwind
 * responsive. La imagen de sección es siempre el fondo de la banda: un `<img>` de fondo con `object-fit`, sin la lógica de
 * posicionamiento fino del original (nivel (a) del diagnóstico: correcto y accesible, no pixel-a-pixel idéntico).
 */
export function Seccion({ seccion, indice, total, estilo }: { seccion: SeccionCartaPublica; indice: number; total: number; estilo: EstiloCarta }) {
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
        {/* S-25: las `key` son la posición, no el id de la fila: React serializa la `key` de cada elemento en el payload RSC que baja al navegador. */}
        {seccion.items.map((item, i) => (
          <ItemFila key={`item-${i}`} item={item} estilo={estilo} />
        ))}
        {seccion.promos.map((promo, i) => (
          <PromoFila key={`promo-${i}`} promo={promo} estilo={estilo} />
        ))}
      </ul>
    </div>
  );
}

/** CARTA-B: los pisos de legibilidad de un ítem con opciones (nombre y precio 19 px, aclaraciones 14 px). El tema manda si pide más; nunca baja de ahí. */
const PISO_NOMBRE_Y_PRECIO = "1.1875rem";
const PISO_ACLARACION = "0.875rem";
const conPiso = (valor: string, piso: string, aplica: boolean) => (aplica ? `max(${piso}, ${valor})` : valor);

function ItemFila({ item, estilo }: { item: ItemCartaPublico; estilo: EstiloCarta }) {
  const v = estilo.valores;
  const esp = item.especial;
  const colorNombre = esp ? (v.color_especial_item_nombre || "var(--carta-primary)") : v.color_item_nombre || undefined;
  const colorPrecio = esp ? (v.color_especial_item_precio || "var(--carta-primary)") : v.color_item_precio || "var(--carta-primary)";
  const colorDesc = esp ? v.color_especial_item_descripcion || undefined : v.color_item_descripcion || undefined;
  const colorTags = esp ? (v.color_especial_item_tags || "var(--carta-primary)") : v.color_item_tags || "var(--carta-primary)";
  // CARTA-B: lo que llega en `grupos` ya es SOLO lo que cambia el precio (lo decide el servidor): los tamaños con su precio final y lo que suma o resta una variante o un adicional.
  const tamanos = (item.grupos ?? []).map((g) => ({ nombre: g.nombre, filas: g.opciones.flatMap((o) => (o.precio === undefined ? [] : [{ nombre: o.nombre, precio: o.precio }])) })).filter((g) => g.filas.length > 0);
  const recargos = (item.grupos ?? []).flatMap((g) => g.opciones.flatMap((o) => (o.recargo === undefined ? [] : [{ nombre: o.nombre, recargo: o.recargo }])));
  // CARTA-C: lo que NO cambia el precio (preparación, guarnición, punto de cocción) también llega, aparte y solo con nombres, para dibujarlo como pastillas bajo el nombre de su grupo.
  const sinCosto = (item.opcionesSinCosto ?? []).filter((g) => g.opciones.length > 0);
  const conOpciones = tamanos.length > 0 || recargos.length > 0 || sinCosto.length > 0;
  // Con una lista de tamaños el renglón del nombre va SIN precio (cada tamaño lo dice); sin ella, el precio base queda a la derecha como siempre.
  const tamanosEnLista = tamanos.length > 0;
  const fuenteNombre = conPiso(v.carta_fuente_item_nombre, PISO_NOMBRE_Y_PRECIO, conOpciones);
  const fuentePrecio = conPiso(v.carta_fuente_item_precio, PISO_NOMBRE_Y_PRECIO, conOpciones);
  const fuenteDescripcion = conPiso(v.carta_fuente_item_descripcion, PISO_ACLARACION, conOpciones);

  return (
    <li className="py-2.5" style={{ borderColor: "var(--carta-border)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 flex-1 carta-titulo font-semibold leading-tight" style={{ fontSize: fuenteNombre, color: colorNombre, overflowWrap: "anywhere" }}>
          {item.nombre}
          {esp && (
            <span className="ml-1 text-xs" style={{ color: v.color_especial_item_nombre || "var(--carta-primary)" }} aria-label="Especial">
              {" ★"}
            </span>
          )}
        </h3>
        {tamanosEnLista ? (
          item.descuentoPorcentaje !== undefined && (
            // Los tamaños ya traen el descuento en su precio: acá solo se avisa el porcentaje.
            <span className="shrink-0 carta-titulo font-semibold" style={{ fontSize: PISO_ACLARACION, color: colorPrecio }} data-descuento-producto>
              <span className="sr-only">{`${item.descuentoPorcentaje} por ciento de descuento en todos los tamaños`}</span>
              <span aria-hidden="true">{`−${item.descuentoPorcentaje} %`}</span>
            </span>
          )
        ) : item.precioLista !== undefined ? (
          <span className="shrink-0 flex flex-col items-end carta-titulo font-semibold" style={{ fontSize: fuentePrecio, color: colorPrecio }} data-descuento-producto>
            <span className="sr-only">{`Antes ${formatearPrecioCarta(item.precioLista)}, ahora ${formatearPrecioCarta(item.precio)}, ${item.descuentoPorcentaje} por ciento de descuento`}</span>
            <s aria-hidden="true" className="text-xs font-light opacity-75">
              {formatearPrecioCarta(item.precioLista)}
            </s>
            <span aria-hidden="true">
              {formatearPrecioCarta(item.precio)}
              <span className="ml-1 text-xs font-light">{`−${item.descuentoPorcentaje} %`}</span>
            </span>
          </span>
        ) : (
          <span className="shrink-0 carta-titulo font-semibold" style={{ fontSize: fuentePrecio, color: colorPrecio }}>
            {formatearPrecioCarta(item.precio)}
          </span>
        )}
      </div>
      {item.descripcion && (
        <p className="mt-0.5 font-light leading-snug opacity-75" style={{ fontSize: fuenteDescripcion, color: colorDesc }}>
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
      {tamanos.map((g, i) => (
        <TamanosDelItem key={`tamanos-${i}`} nombre={g.nombre} filas={g.filas} colorNombre={colorDesc} colorPrecio={colorPrecio} />
      ))}
      {sinCosto.map((g, i) => (
        <OpcionesSinCostoDelItem key={`sin-costo-${i}`} grupo={g.grupo} opciones={g.opciones} />
      ))}
      {recargos.length > 0 && <RecargosDelItem recargos={recargos} color={colorDesc} />}
    </li>
  );
}

/** «+$400» o «−$300»: lo que una opción suma o resta al precio que se ve. */
function recargoEnPesos(recargo: number): string {
  return `${recargo < 0 ? "−" : "+"}${formatearPrecioCarta(Math.abs(recargo))}`;
}

/**
 * CARTA-B (decisión del dueño, variante B «lista clásica»): los tamaños de un producto como un renglón por tamaño, «Chico ........ $2.500», SIEMPRE a la vista (sin desplegable ni botón),
 * con el precio FINAL de cada uno. Es una lista (`ul`) con el nombre del grupo como etiqueta para el lector de pantalla; los puntitos son decoración (`aria-hidden`) y usan el color de
 * borde del tema. Solo presentación: los precios vienen calculados del servidor. Letra de 17 px, por encima del piso de 16 px de las opciones.
 */
function TamanosDelItem({ nombre, filas, colorNombre, colorPrecio }: { nombre: string; filas: { nombre: string; precio: number }[]; colorNombre: string | undefined; colorPrecio: string }) {
  return (
    <ul aria-label={nombre} data-tamanos-carta={nombre} className="mt-1.5 flex flex-col">
      {filas.map((f, i) => (
        <li key={`tamano-${i}`} className="flex items-baseline gap-1.5 py-0.5 leading-snug" style={{ fontSize: "1.0625rem", color: colorNombre }}>
          <span className="min-w-0" style={{ overflowWrap: "anywhere" }}>
            {f.nombre}
          </span>
          <span aria-hidden="true" className="min-w-3 flex-1 -translate-y-1 border-b-[1.5px] border-dotted" style={{ borderColor: "color-mix(in oklch, var(--carta-ink-soft) 55%, transparent)" }} />
          <span className="shrink-0 carta-titulo font-bold" style={{ color: colorPrecio }}>
            {formatearPrecioCarta(f.precio)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * CARTA-C (decisión del dueño, variante B «pastillas»): las opciones que NO cambian el precio (preparación «Solo» · «Flat white» · «Cortado», guarnición, punto de cocción), siempre a la vista, bajo el
 * nombre de su grupo: una etiqueta en negrita y cada opción en una cajita redondeada. NO son botones (no se eligen acá: las elige el mozo en el POS), así que no llevan `role` ni `tabindex`. Es una lista
 * (`ul`) con el nombre del grupo como etiqueta para el lector de pantalla (la etiqueta visible se oculta del lector para que no lo lea dos veces); las pastillas pasan a la línea siguiente si no entran
 * (sin desborde horizontal). Los nombres son texto del negocio y se escapan como cualquier otro texto de React. Colores del tema de la sucursal (borde y fondo derivados de `--carta-ink-soft`).
 * Letra de 14,5 px la etiqueta y 15 px las pastillas (los pisos de legibilidad).
 */
function OpcionesSinCostoDelItem({ grupo, opciones }: { grupo: string; opciones: string[] }) {
  return (
    <div data-opciones-sin-costo={grupo} className="mt-2.5">
      <p aria-hidden="true" className="font-semibold leading-snug" style={{ fontSize: "0.90625rem", color: "var(--carta-ink)", overflowWrap: "anywhere" }}>
        {grupo}
      </p>
      <ul aria-label={grupo} className="flex flex-wrap gap-x-1.5">
        {opciones.map((nombre, i) => (
          <li
            key={`pastilla-${i}`}
            className="mt-1 max-w-full rounded-full border px-3 py-[3px] leading-snug"
            style={{
              fontSize: "0.9375rem",
              color: "var(--carta-ink)",
              overflowWrap: "anywhere",
              borderColor: "color-mix(in oklch, var(--carta-ink-soft) 40%, transparent)",
              background: "color-mix(in oklch, var(--carta-ink-soft) 7%, transparent)",
            }}
          >
            {nombre}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * CARTA-B: lo que suma (o resta) una variante o un adicional, en UNA línea: «Adicionales: Con leche +$400 · Medialuna +$600 · Shot +$500», siempre visible. Cada opción es un bloque en línea para
 * que su nombre y su monto no queden en renglones distintos. Letra de 16 px (el piso de las opciones).
 */
function RecargosDelItem({ recargos, color }: { recargos: { nombre: string; recargo: number }[]; color: string | undefined }) {
  return (
    <p data-suma-carta className="mt-1.5 leading-snug" style={{ fontSize: "1rem", color: color ?? "var(--carta-ink-soft)" }}>
      <strong className="font-semibold" style={{ color: "var(--carta-ink)" }}>
        Adicionales:
      </strong>{" "}
      {recargos.map((r, i) => (
        <Fragment key={`suma-${i}`}>
          {i > 0 && " · "}
          <span className="inline-block max-w-full" style={{ overflowWrap: "anywhere" }}>{`${r.nombre} ${recargoEnPesos(r.recargo)}`}</span>
        </Fragment>
      ))}
    </p>
  );
}

function PromoFila({ promo, estilo }: { promo: PromoCartaPublica; estilo: EstiloCarta }) {
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
