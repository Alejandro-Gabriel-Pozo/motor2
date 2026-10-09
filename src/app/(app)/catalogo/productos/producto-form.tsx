"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { QuickCrear } from "@/components/catalogo/quick-crear";
import { AsistenteHermanar } from "@/components/catalogo/asistente-hermanar";
import { GestionPresentaciones } from "@/components/catalogo/gestion-presentaciones";
import { CampoNumero } from "@/components/campo-numero";
import { AyudaCampo } from "@/components/ayuda-campo";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { SincronizarPrecioGrupo } from "@/components/carta/sincronizar-precio-grupo";
import { darDeAltaProducto, actualizarProducto, sincronizarPrecioGrupoCarta, type DatosProducto, type PresentacionOpcion } from "@/server/actions/catalogo/productos";
import type { SincronizablePrecioGrupo } from "@/server/actions/tipos";
import { crearInsumo } from "@/server/actions/catalogo/insumos";
import { crearCategoriaProducto } from "@/server/actions/catalogo/categorias-producto";
import { altaProveedor } from "@/server/actions/catalogo/proveedores";

interface Opcion {
  id: string;
  nombre: string;
}

interface OpcionUnidad extends Opcion {
  /** 0-6: cuántos decimales admite — para validar `factorConversion` con el mismo criterio del servidor (validarCantidad). */
  decimales: number;
}

export interface ProductoExistente extends DatosProducto {
  id: string;
  codigo: string;
}

export function ProductoForm({
  unidades,
  insumosIniciales,
  categoriasIniciales,
  proveedoresIniciales,
  puedeCrear,
  puedeGestionarConsignacion,
  productoExistente,
  presentacionesIniciales,
  cantidadSucursales,
  nombreSucursalActual,
}: {
  unidades: OpcionUnidad[];
  insumosIniciales: Opcion[];
  categoriasIniciales: Opcion[];
  proveedoresIniciales: Opcion[];
  /** Qué botones «+ Nuevo …» de alta rápida se dibujan: cada uno exige su propio permiso de Editar en el servidor. */
  puedeCrear: { categoria: boolean; insumo: boolean; proveedor: boolean };
  /**
   * S-12 (D8 del dueño): el costo de consignación (es consignación, proveedor y precio) es de quien tiene `pagar_consignante`. Sin la clave la página ni siquiera le manda el precio ni
   * el consignante a este componente (los props viajan al navegador), el formulario no dibuja esos campos y NO los manda al guardar: «no viene» es «no cambia» en el servidor, que además
   * rechaza un valor distinto del guardado. Cortesía de la pantalla; la barrera es la del servidor.
   */
  puedeGestionarConsignacion: boolean;
  productoExistente?: ProductoExistente;
  presentacionesIniciales?: PresentacionOpcion[];
  /** Solo para el alta (§4.1, docs/plan-disponibilidad-por-sucursal-2026-09-23.md) — sin esto el tilde no dice nada concreto. */
  cantidadSucursales?: number;
  nombreSucursalActual?: string;
}) {
  const router = useRouter();
  const [insumos, setInsumos] = useState(insumosIniciales);
  const [categorias, setCategorias] = useState(categoriasIniciales);
  const [proveedores, setProveedores] = useState(proveedoresIniciales);

  const [tipo, setTipo] = useState<"MP" | "PV">(productoExistente?.tipo ?? "MP");
  const [insumoId, setInsumoId] = useState(productoExistente?.insumoId ?? "");
  const [unidadStockId, setUnidadStockId] = useState(productoExistente?.unidadStockId ?? "");
  const [categoriaId, setCategoriaId] = useState(productoExistente?.categoriaId ?? "");
  const [esConsignacion, setEsConsignacion] = useState(productoExistente?.esConsignacion ?? false);
  const [proveedorConsignacionId, setProveedorConsignacionId] = useState(productoExistente?.proveedorConsignacionId ?? "");
  // Default tildado (decisión 2 del dueño): lo común (insumos/platos compartidos) tiene cero fricción.
  const [activoEnTodas, setActivoEnTodas] = useState(true);

  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D11/M8 (docs/plan-agrupacion-items-carta-2026-09-24.md): si el producto está en un ítem agrupado de la carta y sus hermanos quedaron a
  // otro precio, en vez de volver enseguida a la ficha se ofrece aplicarles el mismo precio (un bloque aparte; el cambio ya está guardado).
  const [sincronizable, setSincronizable] = useState<SincronizablePrecioGrupo | null>(null);

  const editando = Boolean(productoExistente);
  const irALaFicha = (id: string | null) => router.push(id ? `/catalogo/productos/${id}?guardado=${editando ? "cambios" : "alta"}` : "/catalogo/productos");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const datos: DatosProducto = {
          codigo: editando ? undefined : texto(form.get("codigo")) || undefined,
          nombre: texto(form.get("nombre")),
          tipo,
          categoriaId: categoriaId || null,
          unidadCompraId: texto(form.get("unidadCompraId")) || null,
          unidadStockId,
          // numeroDelCampo: vacío → undefined (nunca 0 por un campo required sin tocar), texto inválido → NaN (el servidor lo rechaza).
          factorConversion: numeroDelCampo(String(form.get("factorConversion") ?? "")) ?? Number.NaN,
          insumoId: tipo === "MP" ? insumoId || null : null,
          precioVenta: numeroDelCampo(String(form.get("precioVenta") ?? "")) ?? 0,
          // numeroDelCampo: vacío → undefined (sin paso, comportamiento actual), texto inválido → NaN (el servidor lo rechaza).
          pasoVenta: tipo === "PV" ? (numeroDelCampo(String(form.get("pasoVenta") ?? "")) ?? null) : null,
          seProduce: form.get("seProduce") === "on",
          // Sin la clave el costo de consignación NO se manda (ver `puedeGestionarConsignacion`).
          ...(puedeGestionarConsignacion && {
            esConsignacion,
            proveedorConsignacionId: esConsignacion ? proveedorConsignacionId || null : null,
            precioConsignacion: numeroDelCampo(String(form.get("precioConsignacion") ?? "")) ?? 0,
          }),
          observaciones: texto(form.get("observaciones")) || undefined,
          activoEnTodasLasSucursales: editando ? undefined : activoEnTodas,
        };

        startTransition(async () => {
          const resultado = editando
            ? await actualizarProducto(productoExistente!.id, datos)
            : await darDeAltaProducto(datos);
          setMensaje(resultado.mensaje);
          setSincronizable(null);
          // Al guardar se vuelve a la ficha del producto, que muestra el aviso de que se guardó (antes se volvía a la lista y el cartel se perdía).
          if (resultado.ok) {
            if ("sincronizable" in resultado && resultado.sincronizable) {
              setSincronizable(resultado.sincronizable);
              return;
            }
            const idFicha = editando ? productoExistente!.id : "id" in resultado ? resultado.id : null;
            irALaFicha(idFicha);
          }
        });
      }}
      className="flex max-w-xl flex-col gap-3"
    >
      <h2 className="font-medium">{editando ? `Editar "${productoExistente!.nombre}"` : "Nuevo producto"}</h2>

      {editando ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm">{tipo === "MP" ? "Materia prima (MP)" : "Producto de venta (PV)"}</p>
          <AyudaCampo>
            El tipo no se puede cambiar una vez creado el producto — recetas, ventas y stock ya asumen cuál es. Si te equivocaste de tipo, dá de
            baja este producto y creá uno nuevo con el tipo correcto.
          </AyudaCampo>
        </div>
      ) : (
        <div className="flex gap-4">
          <label className="flex items-center gap-1 text-sm">
            <input type="radio" name="tipoRadio" checked={tipo === "MP"} onChange={() => setTipo("MP")} /> Materia prima (MP)
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="radio" name="tipoRadio" checked={tipo === "PV"} onChange={() => setTipo("PV")} /> Producto de venta (PV)
          </label>
        </div>
      )}

      {!editando && <input name="codigo" placeholder="Código (opcional, se autogenera)" aria-label="Código (opcional, se autogenera)" className="rounded border px-3 py-2" />}
      <input name="nombre" placeholder="Nombre" aria-label="Nombre" defaultValue={productoExistente?.nombre} required className="rounded border px-3 py-2" />

      <div className="flex items-center gap-2">
        <select aria-label="Categoría" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="flex-1 rounded border px-3 py-2">
          <option value="">Sin categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        {puedeCrear.categoria && (
          <QuickCrear
            triggerLabel="+ Nueva categoría"
            title="Nueva categoría"
            campoLabel="Nombre"
            accion={crearCategoriaProducto}
            onCreado={(item) => {
              setCategorias((prev) => [...prev, item]);
              setCategoriaId(item.id);
            }}
          />
        )}
      </div>

      {tipo === "MP" && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <select aria-label="Insumo" value={insumoId} onChange={(e) => setInsumoId(e.target.value)} className="flex-1 rounded border px-3 py-2">
              <option value="">Sin insumo</option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </select>
            {puedeCrear.insumo && (
              <QuickCrear
                triggerLabel="+ Nuevo insumo"
                title="Nuevo insumo"
                campoLabel="Nombre"
                accion={crearInsumo}
                onCreado={(item) => {
                  setInsumos((prev) => [...prev, item]);
                  setInsumoId(item.id);
                }}
              />
            )}
          </div>
          <AsistenteHermanar
            unidadStockId={unidadStockId}
            onResuelto={(id, nombre) => {
              setInsumos((prev) => (prev.some((i) => i.id === id) ? prev : [...prev, { id, nombre }]));
              setInsumoId(id);
            }}
          />
          <AyudaCampo>
            Agrupa esta materia prima con otras que sean, en la práctica, la misma (ej. comprada a proveedores distintos) — comparten stock
            automáticamente si una se queda sin stock, y se comparan sus precios entre sí.
          </AyudaCampo>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <select aria-label="Unidad de stock" value={unidadStockId} onChange={(e) => setUnidadStockId(e.target.value)} required className="flex-1 rounded border px-3 py-2">
            <option value="">Unidad de stock</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
          {tipo === "MP" && (
            <select aria-label="Unidad de compra" name="unidadCompraId" defaultValue={productoExistente?.unidadCompraId ?? ""} className="flex-1 rounded border px-3 py-2">
              <option value="">Unidad de compra (default)</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          )}
        </div>
        <AyudaCampo>
          {tipo === "MP"
            ? "Stock: en qué unidad se mide el inventario (ej. kg). Compra: en qué unidad la facturás (ej. \"bolsa\") — el Factor de conversión de abajo pasa de una a la otra."
            : "En qué unidad se mide el inventario de este producto (ej. unidad, kg)."}
        </AyudaCampo>
      </div>

      <div className="flex flex-col gap-1">
        <CampoNumero
          name="factorConversion"
          placeholder="Factor de conversión (unidades de stock por unidad de compra)"
          ariaLabel="Factor de conversión (unidades de stock por unidad de compra)"
          defaultValue={String(productoExistente?.factorConversion ?? 1)}
          tipo="cantidad"
          etiqueta="El factor de conversión"
          decimales={unidades.find((u) => u.id === unidadStockId)?.decimales}
          required
        />
        <AyudaCampo>
          Cuántas unidades de stock entran en 1 unidad de compra — ej. 25 si comprás bolsas de 25kg y controlás el stock en kg. Si comprás y
          controlás en la misma unidad, dejalo en 1.
        </AyudaCampo>
      </div>

      {tipo === "PV" && (
        <CampoNumero
          name="precioVenta"
          prefijo="$"
          placeholder="Precio de venta"
          ariaLabel="Precio de venta"
          defaultValue={String(productoExistente?.precioVenta ?? 0)}
          tipo="importe"
          etiqueta="El precio de venta"
        />
      )}

      {tipo === "PV" && (
        <div className="flex flex-col gap-1">
          <CampoNumero
            name="pasoVenta"
            placeholder="Paso de venta (opcional)"
            ariaLabel="Paso de venta"
            defaultValue={productoExistente?.pasoVenta != null ? String(productoExistente.pasoVenta) : ""}
          />
          <AyudaCampo>
            Dejalo vacío para vender siempre de a una unidad entera (lo habitual). Con un paso (ej. 0,5), se puede vender esa fracción —
            0,5 vende media unidad al 50% del precio — y cualquier cantidad que no sea múltiplo exacto del paso se rechaza al cargarla.
          </AyudaCampo>
        </div>
      )}

      {editando && tipo === "MP" && (
        <GestionPresentaciones
          productoId={productoExistente!.id}
          unidades={unidades}
          presentacionesIniciales={presentacionesIniciales ?? []}
          unidadStockDecimales={unidades.find((u) => u.id === unidadStockId)?.decimales}
        />
      )}

      {tipo === "MP" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="seProduce" defaultChecked={productoExistente?.seProduce} /> Se produce (tiene receta propia, se fabrica por lote)
        </label>
      )}

      {!editando && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activoEnTodas} onChange={(e) => setActivoEnTodas(e.target.checked)} /> Activo en todas las sucursales
          </label>
          <AyudaCampo>
            {activoEnTodas
              ? `Tildado (lo habitual, para insumos y platos compartidos como harina o sal): queda disponible en las ${cantidadSucursales ?? "?"} sucursales que existen hoy.`
              : `Sin tildar: solo queda disponible en "${nombreSucursalActual ?? "esta sucursal"}" — en las demás no va a aparecer hasta que un admin de esa sucursal lo active ahí.`}
          </AyudaCampo>
        </div>
      )}

      {puedeGestionarConsignacion ? (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={esConsignacion} onChange={(e) => setEsConsignacion(e.target.checked)} /> Es consignación
          </label>
          <AyudaCampo>
            El producto queda en tu depósito pero sigue siendo propiedad del proveedor hasta que se vende — recién ahí se liquida (se le paga por
            lo vendido, no por lo entregado).
          </AyudaCampo>
        </div>
      ) : (
        editando && (
          <div className="flex flex-col gap-1">
            <p className="text-sm">{esConsignacion ? "Es consignación" : "No es consignación"}</p>
            <AyudaCampo>El proveedor y el precio de consignación los gestiona quien tiene permiso para pagar a consignantes.</AyudaCampo>
          </div>
        )
      )}

      {puedeGestionarConsignacion && esConsignacion && (
        <>
          <div className="flex items-center gap-2">
            <select
              aria-label="Proveedor de consignación"
              value={proveedorConsignacionId}
              onChange={(e) => setProveedorConsignacionId(e.target.value)}
              className="flex-1 rounded border px-3 py-2"
            >
              <option value="">Proveedor de consignación</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            {puedeCrear.proveedor && (
              <QuickCrear
                triggerLabel="+ Nuevo proveedor"
                title="Nuevo proveedor"
                campoLabel="Nombre"
                accion={(nombre) => altaProveedor({ nombre })}
                onCreado={(item) => {
                  setProveedores((prev) => [...prev, item]);
                  setProveedorConsignacionId(item.id);
                }}
              />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <CampoNumero
              name="precioConsignacion"
              prefijo="$"
              placeholder="Precio de consignación"
              ariaLabel="Precio de consignación"
              defaultValue={String(productoExistente?.precioConsignacion ?? 0)}
              tipo="importe"
              etiqueta="El precio de consignación"
            />
            <AyudaCampo>Lo que le pagás al proveedor por cada unidad vendida — no tiene por qué ser igual al precio al que vos la vendés.</AyudaCampo>
          </div>
        </>
      )}

      <textarea name="observaciones" placeholder="Observaciones" aria-label="Observaciones" defaultValue={productoExistente?.observaciones ?? ""} className="rounded border px-3 py-2" />

      {mensaje && <p className={mensaje.startsWith("Producto") ? "text-sm text-green-700" : "text-sm text-red-600"}>{mensaje}</p>}

      {sincronizable && productoExistente && (
        <SincronizarPrecioGrupo sincronizable={sincronizable} aplicar={sincronizarPrecioGrupoCarta} alTerminar={() => irALaFicha(productoExistente.id)} />
      )}

      <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : editando ? "Guardar cambios" : "Crear producto"}
      </button>
    </form>
  );
}

function texto(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
