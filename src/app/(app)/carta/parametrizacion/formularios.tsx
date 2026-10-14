import { EnlaceInterno } from "@/components/enlace-interno";
import { FormConResultado } from "@/components/form-con-resultado";
import { SeccionYOrden } from "@/components/carta/seccion-y-orden";
import { Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import type { LugarDeCombo, ProductoCartaAdmin, ProductoParaMantener, VigenciaDePromoAdmin } from "@/core/carta/public";
import { guardarContenidoCartaProducto } from "@/server/actions/carta/contenido-producto";
import { guardarDescuentoProducto } from "@/server/actions/carta/descuento-producto";
import { quitarProductoDeLaCarta } from "@/server/actions/carta/mantenimiento";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";

/**
 * CARTA-MANT (prototipo aprobado): los formularios de PARAMETRIZACIÓN de la carta —lo que se cambia pocas veces— que antes iban apilados en `/carta` y ahora viven detrás de cada tarjeta del hub
 * (`/carta/parametrizacion/{secciones,generos,promociones}`). Son los MISMOS formularios, con las mismas Server Actions y los mismos permisos (movidos tal cual); se suma «Quitar de la carta» en la
 * ficha de cada producto. Los closures "use server" capturan solo ids (texto): lo que captura un closure viaja al cliente.
 */
export const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
export const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

// MOVIL (O.461): en celular (< 768 px) los campos y botones miden 44 px de alto como mínimo (se tocan con el dedo) y el texto de los campos 16 px (iOS hace zoom con menos); en escritorio, igual que siempre.
export const CLASE_INPUT = "rounded border px-2 py-1 max-md:min-h-11 max-md:text-base";
export const CLASE_BOTON = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white max-md:min-h-11";
/** Un número corto (mín./máx., orden…): a todo el ancho de su columna en celular, de 4 rem desde `sm`. */
const CLASE_NUMERO = `${CLASE_INPUT} w-full sm:w-16`;
/** Un botón con aspecto de enlace («Apagar «X» en esta sucursal»): en celular, una fila de 44 px de alto. */
export const CLASE_ENLACE_DE_ACCION = "text-sm underline max-md:inline-flex max-md:min-h-11 max-md:items-center";
/** Una casilla con su texto: en celular, la fila entera (la etiqueta es el objetivo táctil) mide 44 px de alto. */
const CLASE_CASILLA = "max-md:min-h-11";
/**
 * Una fila del bloque «Cupos» (una sección o un lugar de entradas). En celular es una tarjetita: el nombre con su casilla arriba, a todo el ancho, y «mín.» y «máx.» abajo, lado a lado
 * (antes los cinco campos se rompían de a uno por renglón y no se sabía de quién era cada uno); desde `sm`, la fila de siempre.
 */
const CLASE_FILA_DE_CUPO = "grid grid-cols-2 gap-2 rounded border p-2 text-sm sm:flex sm:flex-wrap sm:items-center sm:rounded-none sm:border-0 sm:p-0";
const CLASE_NOMBRE_DE_CUPO = `col-span-2 flex items-center gap-2 sm:min-w-[10rem] ${CLASE_CASILLA} [overflow-wrap:anywhere]`;
const CLASE_CANTIDAD_DE_CUPO = "flex flex-col gap-1 sm:flex-row sm:items-center";

type OpcionSeccion = { id: string; nombre: string; activa: boolean };
type OpcionGenero = { id: string; nombre: string; activo: boolean };
/** Para el select de sección + orden sugerido (DA6): las secciones, y cuántos ítems ya tiene cada una. */
export type UbicacionEnCarta = { secciones: OpcionSeccion[]; cantidadPorSeccion: Record<string, number>; generos: OpcionGenero[] };

/**
 * CARTA-MANT: un grupo plegado de la carta (una sección, los ocultos sin sección o los que están dentro de un agrupado): el nombre con cuántos productos tiene (y cuántos ocultos) en el resumen,
 * y adentro el renglón de cada uno. Plegado por defecto, como en el prototipo («tocá una sección para ver sus productos»).
 */
export function GrupoDeLaCarta({
  nombre,
  detalle,
  productos,
  vacio,
  fila,
}: {
  nombre: string;
  detalle: string | null;
  productos: ProductoParaMantener[];
  vacio: string;
  fila: (p: ProductoParaMantener) => React.ReactNode;
}) {
  const ocultos = productos.filter((p) => p.contenido && !p.contenido.visibleEnCarta).length;
  return (
    <details className="rounded border" data-grupo-de-la-carta={nombre}>
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-baseline gap-x-2 px-3 py-2">
        <span className="font-medium [overflow-wrap:anywhere]">{nombre}</span>
        <span className="text-sm text-neutral-600 dark:text-neutral-400">
          {productos.length} producto{productos.length === 1 ? "" : "s"}
          {ocultos ? ` · ${ocultos} oculto${ocultos === 1 ? "" : "s"}` : ""}
          {detalle ? ` · ${detalle}` : ""}
        </span>
      </summary>
      <ul className="flex flex-col gap-2 border-t p-3">
        {productos.map(fila)}
        {!productos.length && vacio && <li className="text-sm text-neutral-500">{vacio}</li>}
      </ul>
    </details>
  );
}

export function CamposSeccion({
  valores,
  ordenSugerido = 0,
}: {
  valores?: { nombre: string; titulo: string | null; descripcion: string | null; imagenUrl: string | null; orden: number };
  /** Alta (DA5): el orden inicial; al editar se muestra el guardado. */
  ordenSugerido?: number;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Nombre
        <input name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Platos Principales" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Título (opcional, si no se usa el nombre)
        <input name="titulo" defaultValue={valores?.titulo ?? ""} placeholder="Del fuego" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Descripción (opcional)
        <textarea name="descripcion" rows={2} defaultValue={valores?.descripcion ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Imagen (URL https, opcional)
        <input name="imagenUrl" type="url" defaultValue={valores?.imagenUrl ?? ""} placeholder="https://…" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? ordenSugerido} className={CLASE_INPUT} />
      </label>
    </>
  );
}

export function CamposGenero({
  valores,
  ordenSugerido = 0,
}: {
  valores?: { nombre: string; orden: number };
  /** Alta: el orden inicial; al editar se muestra el guardado. */
  ordenSugerido?: number;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Nombre
        <input name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Cerveza" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? ordenSugerido} className={CLASE_INPUT} />
      </label>
    </>
  );
}

/** El select "Género (opcional)" del contenido de un PV o de un ítem agrupado (docs/plan-genero-carta-2026-09-26.md). */
function SelectGenero({ generos, guardado }: { generos: OpcionGenero[]; guardado: string | null }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      Género (opcional)
      <select name="generoCartaId" defaultValue={guardado ?? ""} className={CLASE_INPUT}>
        <option value="">— sin género (sale suelto) —</option>
        {generos.map((g) => (
          <option key={g.id} value={g.id} disabled={!g.activo}>
            {g.nombre}
            {g.activo ? "" : " (apagado)"}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CamposPromo({
  secciones,
  valores,
}: {
  secciones: { id: string; nombre: string; activa: boolean }[];
  valores?: { seccionCartaId: string; titulo: string; descripcion: string | null; precio: number; orden: number };
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Título
        <input name="titulo" required defaultValue={valores?.titulo ?? ""} placeholder="1 pizza + coca 1,5 L" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Sección de carta
        <select name="seccionCartaId" required defaultValue={valores?.seccionCartaId ?? ""} className={CLASE_INPUT}>
          {!valores && <option value="">— elegí una —</option>}
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
              {s.activa ? "" : " (apagada)"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Descripción (opcional)
        <textarea name="descripcion" rows={2} defaultValue={valores?.descripcion ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Precio
        <input name="precio" type="number" min={0} step="0.01" required defaultValue={valores?.precio ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? 0} className={CLASE_INPUT} />
      </label>
    </>
  );
}

/**
 * Cupos de una promo ARMABLE (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): una fila por CADA sección de carta, con un
 * checkbox "incluir" + mínimo/máximo — full-replace al guardar (`guardarCuposPromoCarta`): la sección tildada con sus
 * cantidades entra, la que no queda tildada se borra si ya era un cupo. Sin cliente propio: los checkboxes e inputs son HTML
 * nativo, `FormConResultado` ya resetea el form entero cuando la acción sale bien (vuelve a los `defaultValue`/`defaultChecked`
 * de lo recién guardado, en el próximo render del servidor).
 */
/** GO-3b: ¿un lugar LISTA viene FIJO? (una sola entrada activa y mínimo = máximo, de 1 o más: lo completa el servidor). */
export function esFijo(l: LugarDeCombo): boolean {
  return l.tipo === "LISTA" && l.entradas.filter((e) => e.activa).length === 1 && l.cantidadMinima >= 1 && l.cantidadMinima === l.cantidadMaxima;
}

const NOMBRES_DE_DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** GO-3b: «Vale siempre», «Del 2026-10-01 al 2026-10-31, lunes a viernes»… */
export function textoDeVigencia(v: VigenciaDePromoAdmin): string {
  const partes: string[] = [];
  if (v.vigenteDesde) partes.push(`desde el ${v.vigenteDesde}`);
  if (v.vigenteHasta) partes.push(`hasta el ${v.vigenteHasta}`);
  if (v.diasDeSemana !== null) partes.push(`los ${NOMBRES_DE_DIAS.filter((_d, i) => (v.diasDeSemana! & (1 << i)) !== 0).map((d) => d.toLowerCase()).join(", ")}`);
  return partes.length ? `Vale ${partes.join(", ")}.` : "Vale siempre.";
}

/** GO-3b: los campos de la vigencia (las fechas son opcionales; los días, tildados todos = todos los días). */
export function CamposVigencia({ vigencia }: { vigencia: VigenciaDePromoAdmin }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <label className="flex flex-col gap-1">
          Desde (opcional)
          <input type="date" name="vigenteDesde" defaultValue={vigencia.vigenteDesde ?? ""} className={CLASE_INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          Hasta (opcional)
          <input type="date" name="vigenteHasta" defaultValue={vigencia.vigenteHasta ?? ""} className={CLASE_INPUT} />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1">Días en que vale</legend>
        {NOMBRES_DE_DIAS.map((d, i) => (
          <label key={d} className={`flex items-center gap-1 ${CLASE_CASILLA}`}>
            <input type="checkbox" name={`dia_${i}`} defaultChecked={vigencia.diasDeSemana === null || (vigencia.diasDeSemana & (1 << i)) !== 0} />
            {d}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-neutral-500">{textoDeVigencia(vigencia)} Se mira al agregar la promo a una mesa: lo que ya está en una mesa no cambia.</p>
    </div>
  );
}

/**
 * GO-3b (U1): los lugares de ENTRADAS de la promo en el formulario de cupos: cada uno con «incluir» (destildado, se da de baja: sus entradas quedan guardadas por si vuelve) y su mínimo y máximo;
 * el nombre es su identidad (cambiarlo es otro lugar). Abajo, una fila para sumar un lugar nuevo: una LISTA («Bebida») o uno DEL DÍA («Plato del día»).
 */
export function CamposLugares({ lugares }: { lugares: LugarDeCombo[] }) {
  return (
    <div className="flex flex-col gap-1">
      {lugares.map((l) => (
        <div key={l.id} data-cupo-lugar={l.nombre} className={CLASE_FILA_DE_CUPO}>
          <input type="hidden" name="lugar_id" value={l.id} />
          <input type="hidden" name={`lugar_tipo_${l.id}`} value={l.tipo} />
          <input type="hidden" name={`lugar_nombre_${l.id}`} value={l.nombre} />
          <label className={CLASE_NOMBRE_DE_CUPO}>
            <input type="checkbox" name={`lugar_incluir_${l.id}`} defaultChecked />
            {l.nombre} ({l.tipo === "DEL_DIA" ? "del día" : "lista"})
          </label>
          <label className={CLASE_CANTIDAD_DE_CUPO}>
            mín.
            <input type="number" name={`lugar_min_${l.id}`} min={0} step={1} defaultValue={l.cantidadMinima} className={CLASE_NUMERO} />
          </label>
          <label className={CLASE_CANTIDAD_DE_CUPO}>
            máx.
            <input type="number" name={`lugar_max_${l.id}`} min={1} step={1} defaultValue={l.cantidadMaxima} className={CLASE_NUMERO} />
          </label>
        </div>
      ))}
      <fieldset className="mt-1 grid min-w-0 grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap sm:items-end">
        <legend className="mb-1 text-sm">Sumar un lugar (opcional)</legend>
        <label className="col-span-2 flex flex-col gap-1">
          Tipo
          <select name="nuevo_lugar_tipo" defaultValue="LISTA" className={CLASE_INPUT}>
            <option value="LISTA">Lista de productos</option>
            <option value="DEL_DIA">Plato del día</option>
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          Nombre
          <input name="nuevo_lugar_nombre" maxLength={80} placeholder="Ej.: Bebida" className={CLASE_INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          mín.
          <input type="number" name="nuevo_lugar_min" min={0} step={1} defaultValue={1} className={CLASE_NUMERO} />
        </label>
        <label className="flex flex-col gap-1">
          máx.
          <input type="number" name="nuevo_lugar_max" min={1} step={1} defaultValue={1} className={CLASE_NUMERO} />
        </label>
      </fieldset>
    </div>
  );
}

export function CamposCupos({
  secciones,
  guardados,
}: {
  secciones: { id: string; nombre: string; activa: boolean }[];
  guardados: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[];
}) {
  const porSeccion = new Map(guardados.map((c) => [c.seccionCartaId, c]));
  return (
    <div className="flex flex-col gap-1">
      {secciones.map((s) => {
        const g = porSeccion.get(s.id);
        return (
          <div key={s.id} data-cupo-seccion={s.nombre} className={CLASE_FILA_DE_CUPO}>
            <label className={CLASE_NOMBRE_DE_CUPO}>
              <input type="checkbox" name={`incluir_${s.id}`} defaultChecked={!!g} />
              {s.nombre}
              {s.activa ? "" : " (apagada)"}
            </label>
            <label className={CLASE_CANTIDAD_DE_CUPO}>
              mín.
              <input type="number" name={`min_${s.id}`} min={0} step={1} defaultValue={g?.cantidadMinima ?? 0} className={CLASE_NUMERO} />
            </label>
            <label className={CLASE_CANTIDAD_DE_CUPO}>
              máx.
              <input type="number" name={`max_${s.id}`} min={1} step={1} defaultValue={g?.cantidadMaxima ?? 1} className={CLASE_NUMERO} />
            </label>
          </div>
        );
      })}
    </div>
  );
}

export function ContenidoProducto({
  producto: p,
  ubicacion,
  puedeEditar,
  puedeDescuento,
  precioLocalActivo,
  sucursalId,
}: {
  producto: ProductoCartaAdmin;
  ubicacion: UbicacionEnCarta;
  puedeEditar: boolean;
  puedeDescuento: boolean;
  precioLocalActivo: boolean;
  /** La sucursal que vio la pantalla (el eco de «Quitar de la carta»). */
  sucursalId: string;
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
      <details>
        <summary className="cursor-pointer text-sm max-md:min-h-11 max-md:py-2">
          <span className="font-medium">{p.nombre}</span> · {p.seccionCarta ?? "sin sección de carta"} · ${p.precio.toLocaleString("es-AR")} ·{" "}
          {estado}
          {p.contenido?.especial ? " · ★" : ""}
          {p.generoCarta ? ` · ${p.generoCarta}` : ""}
          {p.descuento !== null ? ` · −${p.descuento} %${precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : ""}
        </summary>
        {p.agrupadoEn && (
          <p className="mt-2 text-sm text-neutral-500">
            Sale en la carta dentro de «{p.agrupadoEn}» (
            <EnlaceInterno href="/carta/agrupados" className="underline">
              Ítems agrupados de la carta
            </EnlaceInterno>
            ): mientras esté agrupado, el contenido de acá no se usa.
          </p>
        )}
        {!puedeEditar ? (
          <ContenidoSoloLectura producto={p} ubicacion={ubicacion} />
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
                })
              );
            }}
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <label className={`flex items-center gap-2 text-sm ${CLASE_CASILLA}`}>
              <input name="visibleEnCarta" type="checkbox" defaultChecked={p.contenido?.visibleEnCarta ?? true} /> Se muestra en la carta
            </label>
            <label className={`flex items-center gap-2 text-sm ${CLASE_CASILLA}`}>
              <input name="especial" type="checkbox" defaultChecked={p.contenido?.especial ?? false} /> Especial (★)
            </label>
            <SeccionYOrden
              secciones={ubicacion.secciones}
              cantidadPorSeccion={ubicacion.cantidadPorSeccion}
              guardado={p.contenido && { seccionCartaId: p.contenido.seccionCartaId, orden: p.contenido.orden }}
              etiquetaSeccion="Sección de carta (obligatoria si se muestra)"
            />
            <SelectGenero generos={ubicacion.generos} guardado={p.contenido?.generoCartaId ?? null} />
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Descripción (opcional)
              <textarea name="descripcion" rows={2} defaultValue={p.contenido?.descripcion ?? ""} className={CLASE_INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Tags (separados por coma)
              <input name="tags" defaultValue={p.contenido?.tags.join(", ") ?? ""} placeholder="Regional, Sin TACC" className={CLASE_INPUT} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Guardar contenido de «{p.nombre}»
              </button>
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
              <label className="flex flex-col gap-1 text-sm">
                Descuento en esta sucursal, % (vacío = sin descuento)
                <input name="descuento" type="number" min={0} max={99.99} step="0.01" defaultValue={p.descuento ?? ""} className={CLASE_INPUT} />
              </label>
              <button type="submit" className={CLASE_BOTON}>
                Guardar descuento de «{p.nombre}»
              </button>
              {!precioLocalActivo && p.descuento !== null && <p className="w-full text-sm text-neutral-500">No rige: el precio local está apagado en esta sucursal (se cobra el precio de lista).</p>}
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
            {cargado.length > 0 && (
              <label className={`flex items-center gap-2 text-sm ${CLASE_CASILLA}`}>
                <input name="confirmado" type="checkbox" required /> Entiendo que se pierde {cargado.join(", ")}
              </label>
            )}
            <div>
              <button type="submit" className={CLASE_ENLACE_DE_ACCION}>
                Quitar «{p.nombre}» de la carta (vuelve a «Fuera de carta»)
              </button>
            </div>
          </FormConResultado>
        )}
      </details>
    </li>
  );
}

/** El contenido de carta de un PV como texto, para quien puede ver la carta pero no editarla. */
function ContenidoSoloLectura({ producto: p, ubicacion }: { producto: ProductoCartaAdmin; ubicacion: UbicacionEnCarta }) {
  const c = p.contenido;
  if (!c) return <p className="mt-3 text-sm text-neutral-500">Todavía no tiene contenido de carta.</p>;
  const seccion = ubicacion.secciones.find((s) => s.id === c.seccionCartaId);
  const genero = ubicacion.generos.find((g) => g.id === c.generoCartaId);
  return (
    <DatosSoloLectura className="mt-3">
      <Dato etiqueta="Se muestra en la carta">{c.visibleEnCarta ? "Sí" : "No"}</Dato>
      <Dato etiqueta="Especial (★)">{c.especial ? "Sí" : "No"}</Dato>
      <Dato etiqueta="Sección de carta">{seccion && `${seccion.nombre}${seccion.activa ? "" : " (apagada)"}`}</Dato>
      <Dato etiqueta="Género">{genero && `${genero.nombre}${genero.activo ? "" : " (apagado)"}`}</Dato>
      <Dato etiqueta="Orden">{c.orden}</Dato>
      <Dato etiqueta="Descripción" ancho>
        {c.descripcion}
      </Dato>
      <Dato etiqueta="Tags" ancho>
        {c.tags.join(", ")}
      </Dato>
    </DatosSoloLectura>
  );
}
