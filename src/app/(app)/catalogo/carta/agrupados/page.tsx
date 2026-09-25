import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/core/permisos/gate";
import { cargarAdminItemsAgrupados, type ItemAgrupadoAdmin } from "@/core/carta/admin-consulta";
import {
  actualizarActivoItemAgrupadoCarta,
  actualizarOrdenOpcionItemAgrupadoCarta,
  agregarOpcionItemAgrupadoCarta,
  guardarItemAgrupadoCarta,
  quitarOpcionItemAgrupadoCarta,
} from "@/server/actions/carta/items-agrupados";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { FormConResultado } from "@/components/form-con-resultado";
import { EnlaceInterno } from "@/components/enlace-interno";
import { SeccionYOrden } from "@/components/carta/seccion-y-orden";
import { AvisoSoloLectura, Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";

/**
 * Ítems agrupados de la carta (docs/plan-agrupacion-items-carta-2026-09-24.md, M7): un renglón visible ("Gaseosa 500 CC") que
 * agrupa varios productos de venta reales y distintos (Coca-Cola, Sprite, Fanta 500cc), con su propia descripción, tags y ★.
 * Se ubica DIRECTO en su sección de carta, sin imagen propia (docs/plan-carta-seccion-directa-2026-09-25.md). Globales (Catálogo
 * Central); lo que se ve acá de cada opción (disponible o no, y su precio) es de la sucursal ACTIVA.
 *
 * Mismo estilo que /catalogo/carta: las mutaciones pasan por las Server Actions de src/server/actions/carta/items-agrupados.ts
 * (conPermiso("carta")) y el refresco lo piden los closures de acá. Los closures capturan solo ids (texto): lo que captura un
 * closure "use server" viaja al cliente. Si agregar una opción se rechaza por precio (D5), el error de la acción se muestra tal
 * cual en el resultado del formulario.
 *
 * Ver ≠ editar, igual que /catalogo/carta: sin «Editar» de "carta" no se dibujan formularios, altas ni botones (agregar, quitar,
 * reordenar, apagar/prender); cada ítem muestra sus datos y sus opciones como texto.
 */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};
const pesos = (n: number) => `$${n.toLocaleString("es-AR")}`;

const CLASE_INPUT = "rounded border px-2 py-1";
const CLASE_BOTON = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white";
const CLASE_AVISO = "rounded border border-amber-300 p-3 text-sm dark:border-amber-700";

type ProductoSinGrupo = { id: string; nombre: string; precioAca: number };
/** Para el select de sección + orden sugerido (DA6): las secciones, y cuántos ítems ya tiene cada una. */
type UbicacionEnCarta = { secciones: { id: string; nombre: string; activa: boolean }[]; cantidadPorSeccion: Record<string, number> };

export default async function ItemsAgrupadosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const { editar: puedeEditarCarta } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta");

  const datos = await cargarAdminItemsAgrupados(ctx.sucursalId);
  const ubicacion: UbicacionEnCarta = {
    secciones: datos.secciones.map((s) => ({ id: s.id, nombre: s.nombre, activa: s.activa })),
    cantidadPorSeccion: Object.fromEntries(datos.secciones.map((s) => [s.id, s.cantidadItems])),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Ítems agrupados de la carta</h1>
        <p className="text-sm text-neutral-500">
          Un ítem agrupado es un solo renglón de la carta («Gaseosa 500 CC») que agrupa varios productos de venta reales («Coca-Cola 500cc», «Sprite
          500cc»…), con su propia descripción, tags y ★. Se ubica directo en su sección de carta, igual que un producto suelto. Un producto agrupado sale solo
          dentro de su ítem, nunca suelto. Lo que se ve de cada opción (si está disponible y su precio) es de esta sucursal, {ctx.sucursalNombre}. Volver a{" "}
          <Link href="/catalogo/carta" className="underline">
            Carta pública
          </Link>
          .
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          Solo se pueden agrupar productos del mismo precio (acá). Si el precio de uno cambia después en Catálogo, la carta lo va a mostrar por el mayor, con
          aviso, hasta que se corrija.
        </p>
        {!puedeEditarCarta && <AvisoSoloLectura />}
      </div>

      <ul className="flex flex-col gap-3">
        {datos.items.map((it) => (
          <ItemAgrupado key={it.id} item={it} ubicacion={ubicacion} productosSinGrupo={datos.productosSinGrupo} puedeEditar={puedeEditarCarta} />
        ))}
        {!datos.items.length && <li className="text-sm text-neutral-500">Todavía no hay ítems agrupados.</li>}
      </ul>

      {!puedeEditarCarta ? null : datos.secciones.length > 0 ? (
        <FormConResultado
          accion={async (fd: FormData) => {
            "use server";
            // DA7: los productos elegidos en el alta entran con la misma validación que "Agregar producto".
            return refrescarSiOk(await guardarItemAgrupadoCarta({ ...datosDelFormulario(fd), productoIds: fd.getAll("productoIds").map(String) }));
          }}
          className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
        >
          <h2 className="text-sm font-medium sm:col-span-2">Nuevo ítem agrupado</h2>
          <CamposItem ubicacion={ubicacion} />
          {datos.productosSinGrupo.length > 0 && (
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Productos del ítem (opcional; Ctrl o ⌘ + clic para elegir varios)
              <select name="productoIds" multiple size={Math.min(8, datos.productosSinGrupo.length)} className={CLASE_INPUT}>
                {datos.productosSinGrupo.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} ({pesos(p.precioAca)} acá)
                  </option>
                ))}
              </select>
              <span className="text-neutral-500">Solo entran los del mismo precio; después se pueden sumar más con «Agregar producto».</span>
            </label>
          )}
          <div className="sm:col-span-2">
            <button type="submit" className={CLASE_BOTON}>
              Crear ítem agrupado
            </button>
          </div>
        </FormConResultado>
      ) : (
        <p className="text-sm text-neutral-500">
          Para crear un ítem agrupado hace falta al menos una sección de carta (
          <Link href="/catalogo/carta" className="underline">
            Carta pública
          </Link>
          ).
        </p>
      )}
    </div>
  );
}

function datosDelFormulario(fd: FormData) {
  return {
    nombre: campo(fd, "nombre"),
    seccionCartaId: campo(fd, "seccionCartaId"),
    descripcion: campo(fd, "descripcion"),
    tags: campo(fd, "tags"),
    especial: fd.get("especial") === "on",
    orden: campo(fd, "orden"),
  };
}

function resumenPrecio(it: ItemAgrupadoAdmin): string {
  if (!it.precio) return "sin precio acá";
  return it.precio.minimo === it.precio.maximo ? pesos(it.precio.minimo) : `${pesos(it.precio.minimo)}–${pesos(it.precio.maximo)}`;
}

function ItemAgrupado({
  item: it,
  ubicacion,
  productosSinGrupo,
  puedeEditar,
}: {
  item: ItemAgrupadoAdmin;
  ubicacion: UbicacionEnCarta;
  productosSinGrupo: ProductoSinGrupo[];
  puedeEditar: boolean;
}) {
  const id = it.id;
  const activo = it.activo;
  const preciosDistintos = it.avisos.preciosDistintos;
  return (
    <li className="rounded border p-3" data-item-agrupado={it.nombre}>
      <details>
        <summary className="cursor-pointer text-sm">
          <span className="font-medium">{it.nombre}</span> · {it.seccionCarta ?? "sección de carta apagada"} · {it.disponiblesAca} de{" "}
          {it.opciones.length} opciones disponibles acá · {resumenPrecio(it)} · {it.activo ? "activo" : "apagado"}
          {it.especial ? " · ★" : ""}
        </summary>

        {!puedeEditar ? (
          <ItemSoloLectura item={it} ubicacion={ubicacion} />
        ) : (
          <>
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(await guardarItemAgrupadoCarta({ id, ...datosDelFormulario(fd) }));
            }}
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <CamposItem ubicacion={ubicacion} valores={it} />
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Guardar «{it.nombre}»
              </button>
            </div>
          </FormConResultado>

          <h2 className="mt-4 text-sm font-medium">Opciones de «{it.nombre}»</h2>
          <ul className="mt-1 flex flex-col gap-2">
            {it.opciones.map((o) => {
              const opcionId = o.id;
              return (
                <li key={o.id} className="flex flex-col gap-1 rounded border p-2 text-sm" data-opcion-agrupada={o.nombre}>
                  <div className="flex flex-wrap items-end gap-2">
                    <span className="min-w-40 py-1">
                      <EnlaceInterno href={`/catalogo/productos/${o.productoId}/editar`} className="font-medium underline">
                        {o.nombre}
                      </EnlaceInterno>{" "}
                      · {o.disponibleAca ? `${pesos(o.precioAca)} acá` : "no disponible en esta sucursal"}
                    </span>
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        return refrescarSiOk(await actualizarOrdenOpcionItemAgrupadoCarta(opcionId, campo(fd, "orden")));
                      }}
                      className="flex items-end gap-2"
                    >
                      <label className="flex flex-col gap-1">
                        Orden de «{o.nombre}»
                        <input name="orden" type="number" step={1} defaultValue={o.orden} className={`${CLASE_INPUT} w-20`} />
                      </label>
                      <button type="submit" className={CLASE_BOTON}>
                        Guardar orden
                      </button>
                    </FormConResultado>
                    <FormConResultado
                      accion={async () => {
                        "use server";
                        return refrescarSiOk(await quitarOpcionItemAgrupadoCarta(opcionId));
                      }}
                    >
                      <button type="submit" className="py-1 underline">
                        Quitar «{o.nombre}»
                      </button>
                    </FormConResultado>
                  </div>
                </li>
              );
            })}
            {!it.opciones.length && <li className="text-sm text-neutral-500">Todavía no tiene opciones.</li>}
          </ul>

          {productosSinGrupo.length > 0 ? (
            <FormConResultado
              accion={async (fd: FormData) => {
                "use server";
                return refrescarSiOk(await agregarOpcionItemAgrupadoCarta(id, campo(fd, "productoId")));
              }}
              className="mt-3 flex flex-wrap items-end gap-2 text-sm"
            >
              <label className="flex flex-col gap-1">
                Agregar producto a «{it.nombre}»
                <select name="productoId" required defaultValue="" className={CLASE_INPUT}>
                  <option value="">— elegí un producto —</option>
                  {productosSinGrupo.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({pesos(p.precioAca)} acá)
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={CLASE_BOTON}>
                Agregar
              </button>
            </FormConResultado>
          ) : (
            <p className="mt-3 text-sm text-neutral-500">No quedan productos de venta disponibles acá fuera de un ítem agrupado.</p>
          )}
          </>
        )}
      </details>

      {preciosDistintos && (
        <div className={`mt-2 ${CLASE_AVISO}`}>
          <p className="font-medium text-amber-700 dark:text-amber-600">
            En esta sucursal las opciones no cuestan lo mismo ({pesos(preciosDistintos.minimo)} a {pesos(preciosDistintos.maximo)}): la carta muestra{" "}
            {pesos(preciosDistintos.mostrado)}. Igualalas en Catálogo o en el precio local.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {it.opciones
              .filter((o) => o.disponibleAca)
              .map((o) => (
                <li key={o.id}>
                  <EnlaceInterno href={`/catalogo/productos/${o.productoId}/editar`} className="underline">
                    {o.nombre}
                  </EnlaceInterno>
                  : {pesos(o.precioAca)}
                </li>
              ))}
          </ul>
        </div>
      )}
      {it.avisos.sinOpcionesAca && (
        <div className={`mt-2 ${CLASE_AVISO}`}>
          <p className="text-amber-700 dark:text-amber-600">Sin opciones disponibles acá: «{it.nombre}» no sale en la carta de esta sucursal.</p>
        </div>
      )}
      {it.avisos.sinSeccion && (
        <div className={`mt-2 ${CLASE_AVISO}`}>
          <p className="text-amber-700 dark:text-amber-600">
            Su sección de carta está apagada, así que «{it.nombre}» no sale en la carta.
          </p>
        </div>
      )}

      {puedeEditar && (
        <FormConResultado
          accion={async () => {
            "use server";
            return refrescarSiOk(await actualizarActivoItemAgrupadoCarta(id, !activo));
          }}
          className="mt-2"
        >
          <button type="submit" className="text-sm underline">
            {it.activo ? `Apagar «${it.nombre}»` : `Prender «${it.nombre}»`}
          </button>
        </FormConResultado>
      )}
    </li>
  );
}

/** Los datos del ítem y sus opciones como texto, para quien puede ver la carta pero no editarla. */
function ItemSoloLectura({ item: it, ubicacion }: { item: ItemAgrupadoAdmin; ubicacion: UbicacionEnCarta }) {
  const seccion = ubicacion.secciones.find((s) => s.id === it.seccionCartaId);
  return (
    <>
      <DatosSoloLectura className="mt-3">
        <Dato etiqueta="Nombre">{it.nombre}</Dato>
        <Dato etiqueta="Sección de carta">{seccion && `${seccion.nombre}${seccion.activa ? "" : " (apagada)"}`}</Dato>
        <Dato etiqueta="Orden">{it.orden}</Dato>
        <Dato etiqueta="Especial (★)">{it.especial ? "Sí" : "No"}</Dato>
        <Dato etiqueta="Tags" ancho>
          {it.tags.join(", ")}
        </Dato>
        <Dato etiqueta="Descripción" ancho>
          {it.descripcion}
        </Dato>
      </DatosSoloLectura>

      <h2 className="mt-4 text-sm font-medium">Opciones de «{it.nombre}»</h2>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {it.opciones.map((o) => (
          <li key={o.id} className="rounded border p-2" data-opcion-agrupada={o.nombre}>
            {/* A la ficha (solo lectura), no a /editar: quien solo ve la carta no tiene por qué poder editar el producto. */}
            <EnlaceInterno href={`/catalogo/productos/${o.productoId}`} className="font-medium underline">
              {o.nombre}
            </EnlaceInterno>{" "}
            · {o.disponibleAca ? `${pesos(o.precioAca)} acá` : "no disponible en esta sucursal"} · orden {o.orden}
          </li>
        ))}
        {!it.opciones.length && <li className="text-sm text-neutral-500">Todavía no tiene opciones.</li>}
      </ul>
    </>
  );
}

function CamposItem({
  ubicacion,
  valores,
}: {
  ubicacion: UbicacionEnCarta;
  valores?: { nombre: string; seccionCartaId: string; descripcion: string | null; tags: string[]; especial: boolean; orden: number };
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Nombre
        <input name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Gaseosa 500 CC" className={CLASE_INPUT} />
      </label>
      <SeccionYOrden
        secciones={ubicacion.secciones}
        cantidadPorSeccion={ubicacion.cantidadPorSeccion}
        guardado={valores ? { seccionCartaId: valores.seccionCartaId, orden: valores.orden } : null}
        etiquetaSeccion="Sección de carta"
        requerida
        conOpcionVacia={!valores}
      />
      <label className="flex flex-col gap-1 text-sm">
        Tags (separados por coma)
        <input name="tags" defaultValue={valores?.tags.join(", ") ?? ""} placeholder="Sin alcohol" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Descripción (opcional)
        <textarea name="descripcion" rows={2} defaultValue={valores?.descripcion ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="especial" type="checkbox" defaultChecked={valores?.especial ?? false} /> Especial (★)
      </label>
    </>
  );
}
