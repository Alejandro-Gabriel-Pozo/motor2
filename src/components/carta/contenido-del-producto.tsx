import { BotonDeServidor } from "@/components/boton-de-servidor";
import { EnlaceInterno } from "@/components/enlace-interno";
import { FormConResultado } from "@/components/form-con-resultado";
import { SeccionYOrden } from "@/components/carta/seccion-y-orden";
import { Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import type { ProductoCartaAdmin } from "@/core/carta/public";
import { guardarContenidoCartaProducto } from "@/server/actions/carta/contenido-producto";
import { guardarDescuentoProducto } from "@/server/actions/carta/descuento-producto";
import { quitarProductoDeLaCarta } from "@/server/actions/carta/mantenimiento";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";
import { Selector } from "@/ui/primitivas/selector";

/**
 * El CONTENIDO DE CARTA de UN producto de venta (Fase 6, paso 6.17a; antes `ContenidoProducto` de `carta/parametrizacion/formularios.tsx`): su ficha plegable con descripción, tags, ★, género,
 * sección y orden, el descuento por sucursal y «Quitar de la carta». Lo dibujan dos pantallas con los MISMOS formularios, las mismas Server Actions y los mismos permisos: Parametrización ›
 * Secciones (una ficha por producto de la carta) y el paso «En la carta» del espacio del producto (una sola, abierta). Dibuja con las primitivas del sistema (`Casilla`, `Campo`, `AreaDeTexto`,
 * `Selector`, `BotonDeServidor`); los textos de las etiquetas y de los botones son los de siempre (los fotografía la línea de base de navegador y los buscan los e2e).
 *
 * Los closures "use server" capturan solo ids (texto): lo que captura un closure viaja al cliente. Los ayudantes `campo` y `refrescarSiOk` son locales a propósito: `use-server-solo-donde-corresponde`
 * solo los acepta definidos en el mismo archivo.
 */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

type OpcionSeccion = { id: string; nombre: string; activa: boolean };
type OpcionGenero = { id: string; nombre: string; activo: boolean };
/** Para el select de sección + orden sugerido (DA6): las secciones, y cuántos ítems ya tiene cada una. */
export type UbicacionEnCarta = { secciones: OpcionSeccion[]; cantidadPorSeccion: Record<string, number>; generos: OpcionGenero[] };

/** El select "Género (opcional)" del contenido de un PV (docs/plan-genero-carta-2026-09-26.md). */
function SelectGenero({ generos, guardado }: { generos: OpcionGenero[]; guardado: string | null }) {
  return (
    <Selector etiqueta="Género (opcional)" name="generoCartaId" defaultValue={guardado ?? ""}>
      <option value="">— sin género (sale suelto) —</option>
      {generos.map((g) => (
        <option key={g.id} value={g.id} disabled={!g.activo}>
          {g.nombre}
          {g.activo ? "" : " (apagado)"}
        </option>
      ))}
    </Selector>
  );
}

export function ContenidoDelProducto({
  producto: p,
  ubicacion,
  puedeEditar,
  puedeDescuento,
  precioLocalActivo,
  sucursalId,
  mostrarNombreArriba,
  abierto = false,
}: {
  producto: ProductoCartaAdmin;
  ubicacion: UbicacionEnCarta;
  puedeEditar: boolean;
  puedeDescuento: boolean;
  precioLocalActivo: boolean;
  /** La sucursal que vio la pantalla (el eco de «Quitar de la carta»). */
  sucursalId: string;
  /**
   * Fase 5 (DEC-11): SOLO en un producto base con un solo eje en la carta (`basesDeUnEjeEnLaCarta`), el valor guardado de «Mostrar el nombre del producto arriba»; `undefined` en los demás: el
   * formulario no lo muestra ni lo manda (queda como estaba).
   */
  mostrarNombreArriba?: boolean;
  /** La ficha llega desplegada (el paso «En la carta» del producto muestra una sola y no tiene sentido plegarla). */
  abierto?: boolean;
}) {
  const productoId = p.id;
  // CARTA-MANT: lo que se pierde al «Quitar de la carta» (si hay algo, se pide confirmarlo).
  const cargado = p.contenido ? [p.contenido.descripcion ? "la descripción" : null, p.contenido.tags.length ? "los tags" : null, p.contenido.especial ? "el ★" : null, p.contenido.generoCartaId ? "el género" : null].filter(Boolean) : [];
  // Un PV agrupado sale solo dentro de su ítem agrupado (docs/plan-agrupacion-items-carta-2026-09-24.md, D3/M6): su contenido propio se ignora mientras tanto.
  const estado = p.agrupadoEn
    ? `en «${p.agrupadoEn}»`
    : !p.contenido
      ? "sin contenido"
      : p.contenido.visibleEnCarta
        ? (p.seccionCarta ? "se muestra" : "visible, sin sección")
        : "oculto";
  return (
    <li className="rounded border p-3" data-contenido-carta={p.nombre}>
      <details open={abierto || undefined}>
        <summary className="cursor-pointer text-sm max-md:min-h-11 max-md:py-2">
          <span className="font-medium">{p.nombre}</span> · {p.seccionCarta ?? "sin sección de carta"} · ${p.precio.toLocaleString("es-AR")} ·{" "}
          {estado}
          {p.contenido?.especial ? " · ★" : ""}
          {p.generoCarta ? ` · ${p.generoCarta}` : ""}
          {p.descuento !== null ? ` · −${p.descuento} %${precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : ""}
        </summary>
        {p.agrupadoEn && (
          <p className="mt-2 text-sm text-tinta-suave">
            Sale en la carta dentro de «{p.agrupadoEn}» (
            <EnlaceInterno href="/carta/agrupados" className="underline">
              Ítems agrupados de la carta
            </EnlaceInterno>
            ): mientras esté agrupado, el contenido de acá no se usa.
          </p>
        )}
        {!puedeEditar ? (
          <ContenidoSoloLectura producto={p} ubicacion={ubicacion} mostrarNombreArriba={mostrarNombreArriba} />
        ) : (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarContenidoCartaProducto(productoId, {
                  visibleEnCarta: fd.get("visibleEnCarta") === "on",
                  seccionCartaId: campo(fd, "seccionCartaId") || null,
                  descripcion: campo(fd, "descripcion"),
                  tags: campo(fd, "tags"),
                  especial: fd.get("especial") === "on",
                  orden: campo(fd, "orden"),
                  generoCartaId: campo(fd, "generoCartaId") || null,
                  // Fase 5 (DEC-11): solo si el formulario lo mostró (una base de un eje); si no, no viaja y queda como estaba.
                  ...(fd.get("mostrarNombreArriba") === null ? {} : { mostrarNombreArriba: fd.get("mostrarNombreArriba") === "si" }),
                })
              );
            }}
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <Casilla name="visibleEnCarta" defaultChecked={p.contenido?.visibleEnCarta ?? true} etiqueta="Se muestra en la carta" />
            <Casilla name="especial" defaultChecked={p.contenido?.especial ?? false} etiqueta="Especial (★)" />
            <SeccionYOrden
              secciones={ubicacion.secciones}
              cantidadPorSeccion={ubicacion.cantidadPorSeccion}
              guardado={p.contenido && { seccionCartaId: p.contenido.seccionCartaId, orden: p.contenido.orden }}
              etiquetaSeccion="Sección de carta (obligatoria si se muestra)"
            />
            <SelectGenero generos={ubicacion.generos} guardado={p.contenido?.generoCartaId ?? null} />
            {mostrarNombreArriba !== undefined && (
              <div className="sm:col-span-2" data-mostrar-nombre-arriba={p.nombre}>
                {/* Dos opciones excluyentes: el valor viaja como «si» o «no» y la acción solo lo lee si el formulario lo mostró. */}
                <OpcionesExcluyentes
                  leyenda="Mostrar el nombre del producto arriba"
                  nombre="mostrarNombreArriba"
                  valorInicial={mostrarNombreArriba ? "si" : "no"}
                  opciones={[
                    { valor: "no", etiqueta: "No: cada opción sale sola en la carta, con su nombre completo" },
                    { valor: "si", etiqueta: `Sí: «${p.nombre}» arriba y las opciones debajo` },
                  ]}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <AreaDeTexto etiqueta="Descripción (opcional)" name="descripcion" rows={2} defaultValue={p.contenido?.descripcion ?? ""} />
            </div>
            <div className="sm:col-span-2">
              <Campo etiqueta="Tags (separados por coma)" name="tags" defaultValue={p.contenido?.tags.join(", ") ?? ""} placeholder="Regional, Sin TACC" />
            </div>
            <div className="sm:col-span-2">
              <BotonDeServidor type="submit">Guardar contenido de «{p.nombre}»</BotonDeServidor>
            </div>
          </FormConResultado>
        )}

        {/* Producto con descuento (% por sucursal; no es una promo). Un producto agrupado no lo admite: el renglón agrupado muestra un solo precio. */}
        {!p.agrupadoEn &&
          (puedeDescuento ? (
            <FormConResultado
              accion={async (fd: FormData) => {
                "use server";
                const texto = campo(fd, "descuento").trim();
                return refrescarSiOk(await guardarDescuentoProducto(productoId, texto === "" ? null : texto));
              }}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <Campo etiqueta="Descuento en esta sucursal, % (vacío = sin descuento)" name="descuento" type="number" min={0} max={99.99} step="0.01" defaultValue={p.descuento ?? ""} />
              <BotonDeServidor type="submit">Guardar descuento de «{p.nombre}»</BotonDeServidor>
              {!precioLocalActivo && p.descuento !== null && <p className="w-full text-sm text-tinta-suave">No rige: el precio local está apagado en esta sucursal (se cobra el precio de lista).</p>}
            </FormConResultado>
          ) : (
            <DatosSoloLectura className="mt-3">
              <Dato etiqueta="Descuento en esta sucursal">{p.descuento !== null ? `${p.descuento} %${precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : "Sin descuento"}</Dato>
            </DatosSoloLectura>
          ))}

        {/* CARTA-MANT (decisión del dueño): «Quitar de la carta» lo devuelve a «Fuera de carta» (POS y menú del día). Si tiene algo cargado a mano, se confirma que se pierde. */}
        {puedeEditar && p.contenido && (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(await quitarProductoDeLaCarta({ sucursalId, productoId, confirmado: fd.get("confirmado") === "on" }));
            }}
            className="mt-3 flex flex-col gap-2 border-t pt-3"
          >
            {cargado.length > 0 && <Casilla name="confirmado" required etiqueta={`Entiendo que se pierde ${cargado.join(", ")}`} />}
            <div>
              <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                Quitar «{p.nombre}» de la carta (vuelve a «Fuera de carta»)
              </BotonDeServidor>
            </div>
          </FormConResultado>
        )}
      </details>
    </li>
  );
}

/** El contenido de carta de un PV como texto, para quien puede ver la carta pero no editarla. */
function ContenidoSoloLectura({ producto: p, ubicacion, mostrarNombreArriba }: { producto: ProductoCartaAdmin; ubicacion: UbicacionEnCarta; mostrarNombreArriba?: boolean }) {
  const c = p.contenido;
  if (!c) return <p className="mt-3 text-sm text-tinta-suave">Todavía no tiene contenido de carta.</p>;
  const seccion = ubicacion.secciones.find((s) => s.id === c.seccionCartaId);
  const genero = ubicacion.generos.find((g) => g.id === c.generoCartaId);
  return (
    <DatosSoloLectura className="mt-3">
      <Dato etiqueta="Se muestra en la carta">{c.visibleEnCarta ? "Sí" : "No"}</Dato>
      <Dato etiqueta="Especial (★)">{c.especial ? "Sí" : "No"}</Dato>
      <Dato etiqueta="Sección de carta">{seccion && `${seccion.nombre}${seccion.activa ? "" : " (apagada)"}`}</Dato>
      <Dato etiqueta="Género">{genero && `${genero.nombre}${genero.activo ? "" : " (apagado)"}`}</Dato>
      <Dato etiqueta="Orden">{c.orden}</Dato>
      {mostrarNombreArriba !== undefined && <Dato etiqueta="Nombre del producto arriba">{mostrarNombreArriba ? "Sí" : "No: cada opción sale sola"}</Dato>}
      <Dato etiqueta="Descripción" ancho>
        {c.descripcion}
      </Dato>
      <Dato etiqueta="Tags" ancho>
        {c.tags.join(", ")}
      </Dato>
    </DatosSoloLectura>
  );
}
