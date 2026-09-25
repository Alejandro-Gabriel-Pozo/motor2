import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { cargarAdminCarta, type ProductoCartaAdmin, type SeccionCartaAdmin } from "@/core/carta/admin-consulta";
import { actualizarActivaSeccionCarta, guardarSeccionCarta } from "@/server/actions/carta/secciones";
import { guardarContenidoCartaProducto } from "@/server/actions/carta/contenido-producto";
import { actualizarActivaPromoCarta, guardarPromoCarta } from "@/server/actions/carta/promos";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { FormConResultado } from "@/components/form-con-resultado";

/**
 * Admin de la carta pública (docs/plan-carta-catalogo-2026-09-24.md, M10): lo que restaurant-menu-design lee de motor2 por
 * GET /api/carta/[sucursal]. Tres bloques: secciones de carta, el contenido de carta de cada PV disponible en esta sucursal (con
 * su sección de carta, elegida DIRECTO — docs/plan-carta-seccion-directa-2026-09-25.md —, y el aviso de los que todavía no tienen
 * contenido: sin contenido no salen, decisión D3) y las promos de la sucursal activa. El nombre, el precio y la disponibilidad de
 * cada producto se siguen editando en Catálogo; la Categoría de producto no ubica nada en la carta.
 *
 * Todas las mutaciones pasan por las Server Actions de src/server/actions/carta (conPermiso("carta")); el refresco lo piden los
 * closures de acá (ver refrescar.ts). Los closures capturan solo ids (texto): lo que captura un closure "use server" viaja al
 * cliente.
 */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

const CLASE_INPUT = "rounded border px-2 py-1";
const CLASE_BOTON = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white";

export default async function CartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const datos = await cargarAdminCarta(ctx.sucursalId);
  const seccionesActivas = datos.secciones.filter((s) => s.activa);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Carta pública</h1>
        <p className="text-sm text-neutral-500">
          Lo que la carta pública de la sucursal muestra: secciones, contenido de cada producto de venta y promos. El nombre, el precio y la disponibilidad
          se editan en Catálogo.
        </p>
      </div>

      {/* 1. Secciones de carta */}
      <section aria-labelledby="titulo-secciones" className="flex flex-col gap-3">
        <h2 id="titulo-secciones" className="text-lg font-medium">
          Secciones de carta
        </h2>
        <ul className="flex flex-col gap-2">
          {datos.secciones.map((s) => {
            const id = s.id;
            const activa = s.activa;
            return (
              <li key={s.id} className="rounded border p-3" data-seccion-carta={s.nombre}>
                <details>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{s.nombre}</span>
                    {s.titulo ? ` — «${s.titulo}»` : ""} · orden {s.orden} · {s.cantidadItems} ítem(s) · {s.activa ? "activa" : "apagada"}
                  </summary>
                  <FormConResultado
                    accion={async (fd: FormData) => {
                      "use server";
                      return refrescarSiOk(
                        await guardarSeccionCarta({ id, nombre: campo(fd, "nombre"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), imagenUrl: campo(fd, "imagenUrl"), orden: campo(fd, "orden") })
                      );
                    }}
                    className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                  >
                    <CamposSeccion valores={s} />
                    <div className="sm:col-span-2">
                      <button type="submit" className={CLASE_BOTON}>
                        Guardar sección
                      </button>
                    </div>
                  </FormConResultado>
                </details>
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return refrescarSiOk(await actualizarActivaSeccionCarta(id, !activa));
                  }}
                  className="mt-2"
                >
                  <button type="submit" className="text-sm underline">
                    {s.activa ? `Apagar «${s.nombre}»` : `Prender «${s.nombre}»`}
                  </button>
                </FormConResultado>
              </li>
            );
          })}
          {!datos.secciones.length && <li className="text-sm text-neutral-500">Todavía no hay secciones de carta.</li>}
        </ul>

        <FormConResultado
          accion={async (fd: FormData) => {
            "use server";
            return refrescarSiOk(
              await guardarSeccionCarta({ nombre: campo(fd, "nombre"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), imagenUrl: campo(fd, "imagenUrl"), orden: campo(fd, "orden") })
            );
          }}
          className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
        >
          <h3 className="text-sm font-medium sm:col-span-2">Nueva sección de carta</h3>
          <CamposSeccion />
          <div className="sm:col-span-2">
            <button type="submit" className={CLASE_BOTON}>
              Crear sección
            </button>
          </div>
        </FormConResultado>
      </section>

      {/* 2. Contenido de carta por PV */}
      <section aria-labelledby="titulo-contenido" className="flex flex-col gap-3">
        <h2 id="titulo-contenido" className="text-lg font-medium">
          Contenido de carta de cada producto de venta
        </h2>
        <p className="text-sm text-neutral-500">
          Solo los productos de venta disponibles en esta sucursal. Un producto sale en la carta cuando tiene contenido cargado, está marcado como visible y
          está en una sección de carta activa.
        </p>

        {datos.sinContenido.length > 0 && (
          <div className="rounded border border-amber-300 p-3 dark:border-amber-700">
            <h3 className="text-sm font-medium text-amber-700 dark:text-amber-600">PV disponibles acá sin contenido de carta (no salen en la carta)</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {datos.sinContenido.map((p) => (
                <li key={p.id}>{p.nombre}</li>
              ))}
            </ul>
          </div>
        )}
        {datos.visiblesSinSeccion.length > 0 && (
          <div className="rounded border border-amber-300 p-3 dark:border-amber-700">
            <h3 className="text-sm font-medium text-amber-700 dark:text-amber-600">Visibles pero sin sección de carta activa (no salen en la carta)</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {datos.visiblesSinSeccion.map((p) => (
                <li key={p.productoId}>{p.nombre}</li>
              ))}
            </ul>
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {datos.productos.map((p) => (
            <ContenidoProducto key={p.id} producto={p} secciones={datos.secciones} />
          ))}
          {!datos.productos.length && <li className="text-sm text-neutral-500">No hay productos de venta disponibles en esta sucursal.</li>}
        </ul>
      </section>

      {/* 3. Promos de la sucursal */}
      <section aria-labelledby="titulo-promos" className="flex flex-col gap-3">
        <h2 id="titulo-promos" className="text-lg font-medium">
          Promos de esta sucursal
        </h2>
        <p className="text-sm text-neutral-500">Informativas: título, descripción y precio dentro de una sección de carta. No descuentan stock.</p>
        <ul className="flex flex-col gap-2">
          {datos.promos.map((pr) => {
            const id = pr.id;
            const activa = pr.activa;
            return (
              <li key={pr.id} className="rounded border p-3" data-promo-carta={pr.titulo}>
                <details>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{pr.titulo}</span> · ${pr.precio.toLocaleString("es-AR")} · {pr.seccionCarta} · {pr.activa ? "activa" : "apagada"}
                  </summary>
                  <FormConResultado
                    accion={async (fd: FormData) => {
                      "use server";
                      return refrescarSiOk(
                        await guardarPromoCarta({ id, seccionCartaId: campo(fd, "seccionCartaId"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), precio: campo(fd, "precio"), orden: campo(fd, "orden") })
                      );
                    }}
                    className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                  >
                    <CamposPromo secciones={datos.secciones} valores={pr} />
                    <div className="sm:col-span-2">
                      <button type="submit" className={CLASE_BOTON}>
                        Guardar promo
                      </button>
                    </div>
                  </FormConResultado>
                </details>
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return refrescarSiOk(await actualizarActivaPromoCarta(id, !activa));
                  }}
                  className="mt-2"
                >
                  <button type="submit" className="text-sm underline">
                    {pr.activa ? `Apagar «${pr.titulo}»` : `Prender «${pr.titulo}»`}
                  </button>
                </FormConResultado>
              </li>
            );
          })}
          {!datos.promos.length && <li className="text-sm text-neutral-500">Esta sucursal no tiene promos en la carta.</li>}
        </ul>

        {seccionesActivas.length > 0 ? (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarPromoCarta({ seccionCartaId: campo(fd, "seccionCartaId"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), precio: campo(fd, "precio"), orden: campo(fd, "orden") })
              );
            }}
            className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
          >
            <h3 className="text-sm font-medium sm:col-span-2">Nueva promo</h3>
            <CamposPromo secciones={seccionesActivas} />
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Crear promo
              </button>
            </div>
          </FormConResultado>
        ) : (
          <p className="text-sm text-neutral-500">Para cargar una promo hace falta al menos una sección de carta activa.</p>
        )}
      </section>
    </div>
  );
}

function CamposSeccion({ valores }: { valores?: { nombre: string; titulo: string | null; descripcion: string | null; imagenUrl: string | null; orden: number } }) {
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
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? 0} className={CLASE_INPUT} />
      </label>
    </>
  );
}

function CamposPromo({
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

function ContenidoProducto({ producto: p, secciones }: { producto: ProductoCartaAdmin; secciones: SeccionCartaAdmin[] }) {
  const productoId = p.id;
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
        <summary className="cursor-pointer text-sm">
          <span className="font-medium">{p.nombre}</span> · {p.seccionCarta ?? "sin sección de carta"} · ${p.precio.toLocaleString("es-AR")} ·{" "}
          {estado}
          {p.contenido?.especial ? " · ★" : ""}
        </summary>
        {p.agrupadoEn && (
          <p className="mt-2 text-sm text-neutral-500">
            Sale en la carta dentro de «{p.agrupadoEn}» (
            <Link href="/catalogo/carta/agrupados" className="underline">
              Ítems agrupados de la carta
            </Link>
            ): mientras esté agrupado, el contenido de acá no se usa.
          </p>
        )}
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
              })
            );
          }}
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <label className="flex items-center gap-2 text-sm">
            <input name="visibleEnCarta" type="checkbox" defaultChecked={p.contenido?.visibleEnCarta ?? true} /> Se muestra en la carta
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="especial" type="checkbox" defaultChecked={p.contenido?.especial ?? false} /> Especial (★)
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Sección de carta (obligatoria si se muestra)
            <select name="seccionCartaId" defaultValue={p.contenido?.seccionCartaId ?? ""} className={CLASE_INPUT}>
              <option value="">— elegí una —</option>
              {secciones.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                  {s.activa ? "" : " (apagada)"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Orden dentro de su sección
            <input name="orden" type="number" step={1} defaultValue={p.contenido?.orden ?? 0} className={CLASE_INPUT} />
          </label>
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
      </details>
    </li>
  );
}
