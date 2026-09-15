"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { QuickCrear } from "@/components/catalogo/quick-crear";
import { darDeAltaProducto, actualizarProducto, type DatosProducto } from "@/server/actions/productos";
import { crearInsumo } from "@/server/actions/insumos";
import { crearCategoriaProducto } from "@/server/actions/categorias-producto";
import { altaProveedor } from "@/server/actions/proveedores";

interface Opcion {
  id: string;
  nombre: string;
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
  productoExistente,
}: {
  unidades: Opcion[];
  insumosIniciales: Opcion[];
  categoriasIniciales: Opcion[];
  proveedoresIniciales: Opcion[];
  productoExistente?: ProductoExistente;
}) {
  const router = useRouter();
  const [insumos, setInsumos] = useState(insumosIniciales);
  const [categorias, setCategorias] = useState(categoriasIniciales);
  const [proveedores, setProveedores] = useState(proveedoresIniciales);

  const [tipo, setTipo] = useState<"MP" | "PV">(productoExistente?.tipo ?? "MP");
  const [insumoId, setInsumoId] = useState(productoExistente?.insumoId ?? "");
  const [categoriaId, setCategoriaId] = useState(productoExistente?.categoriaId ?? "");
  const [esConsignacion, setEsConsignacion] = useState(productoExistente?.esConsignacion ?? false);
  const [proveedorConsignacionId, setProveedorConsignacionId] = useState(productoExistente?.proveedorConsignacionId ?? "");

  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const editando = Boolean(productoExistente);

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
          unidadStockId: texto(form.get("unidadStockId")),
          factorConversion: Number(form.get("factorConversion")),
          insumoId: tipo === "MP" ? insumoId || null : null,
          precioVenta: Number(form.get("precioVenta") || 0),
          seProduce: form.get("seProduce") === "on",
          esConsignacion,
          proveedorConsignacionId: esConsignacion ? proveedorConsignacionId || null : null,
          precioConsignacion: Number(form.get("precioConsignacion") || 0),
          observaciones: texto(form.get("observaciones")) || undefined,
        };

        startTransition(async () => {
          const resultado = editando
            ? await actualizarProducto(productoExistente!.id, datos)
            : await darDeAltaProducto(datos);
          setMensaje(resultado.mensaje);
          if (resultado.ok) {
            router.push("/catalogo/productos");
            router.refresh();
          }
        });
      }}
      className="flex max-w-xl flex-col gap-3"
    >
      <h2 className="font-medium">{editando ? `Editar "${productoExistente!.nombre}"` : "Nuevo producto"}</h2>

      <div className="flex gap-4">
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" name="tipoRadio" checked={tipo === "MP"} onChange={() => setTipo("MP")} /> Materia prima (MP)
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" name="tipoRadio" checked={tipo === "PV"} onChange={() => setTipo("PV")} /> Producto de venta (PV)
        </label>
      </div>

      {!editando && <input name="codigo" placeholder="Código (opcional, se autogenera)" className="rounded border px-3 py-2" />}
      <input name="nombre" placeholder="Nombre" defaultValue={productoExistente?.nombre} required className="rounded border px-3 py-2" />

      <div className="flex items-center gap-2">
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="flex-1 rounded border px-3 py-2">
          <option value="">Sin categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
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
      </div>

      {tipo === "MP" && (
        <div className="flex items-center gap-2">
          <select value={insumoId} onChange={(e) => setInsumoId(e.target.value)} className="flex-1 rounded border px-3 py-2">
            <option value="">Sin insumo</option>
            {insumos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nombre}
              </option>
            ))}
          </select>
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
        </div>
      )}

      <div className="flex gap-2">
        <select name="unidadStockId" defaultValue={productoExistente?.unidadStockId} required className="flex-1 rounded border px-3 py-2">
          <option value="">Unidad de stock</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </select>
        {tipo === "MP" && (
          <select name="unidadCompraId" defaultValue={productoExistente?.unidadCompraId ?? ""} className="flex-1 rounded border px-3 py-2">
            <option value="">Unidad de compra (default)</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      <input
        name="factorConversion"
        type="number"
        step="any"
        min="0"
        placeholder="Factor de conversión (unidades de stock por unidad de compra)"
        defaultValue={productoExistente?.factorConversion ?? 1}
        required
        className="rounded border px-3 py-2"
      />

      {tipo === "PV" && (
        <input
          name="precioVenta"
          type="number"
          step="any"
          min="0"
          placeholder="Precio de venta"
          defaultValue={productoExistente?.precioVenta ?? 0}
          className="rounded border px-3 py-2"
        />
      )}

      {tipo === "MP" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="seProduce" defaultChecked={productoExistente?.seProduce} /> Se produce (tiene receta propia, se fabrica por lote)
        </label>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={esConsignacion} onChange={(e) => setEsConsignacion(e.target.checked)} /> Es consignación
      </label>

      {esConsignacion && (
        <>
          <div className="flex items-center gap-2">
            <select
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
          </div>
          <input
            name="precioConsignacion"
            type="number"
            step="any"
            min="0"
            placeholder="Precio de consignación"
            defaultValue={productoExistente?.precioConsignacion ?? 0}
            className="rounded border px-3 py-2"
          />
        </>
      )}

      <textarea name="observaciones" placeholder="Observaciones" defaultValue={productoExistente?.observaciones ?? ""} className="rounded border px-3 py-2" />

      {mensaje && <p className={mensaje.startsWith("Producto") ? "text-sm text-green-700" : "text-sm text-red-600"}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : editando ? "Guardar cambios" : "Crear producto"}
      </button>
    </form>
  );
}

function texto(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
