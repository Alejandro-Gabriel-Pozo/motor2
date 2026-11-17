"use client";

import { QuickCrear } from "@/components/catalogo/quick-crear";
import { crearCategoriaProducto } from "@/server/actions/catalogo/categorias-producto";
import { Selector } from "@/ui/primitivas/selector";

interface Opcion {
  id: string;
  nombre: string;
}

/**
 * Categoría del producto con su alta rápida «+ Nueva categoría». Se dibuja en la EDICIÓN y con el interruptor del alta como Pedernal apagado; el alta como Pedernal no la pide (decisión del dueño, 2026-11-17: lo que
 * Pedernal ya resolvió se hace como Pedernal). Movido tal cual de `producto-form.tsx` (sin cambio de comportamiento) para que ese archivo no crezca.
 */
export function CampoCategoria({ categorias, categoriaId, alElegir, alCrear, puedeCrear }: { categorias: Opcion[]; categoriaId: string; alElegir: (id: string) => void; alCrear: (item: Opcion) => void; puedeCrear: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <Selector etiqueta="Categoría" etiquetaOculta value={categoriaId} onChange={(e) => alElegir(e.target.value)}>
          <option value="">Sin categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </Selector>
      </div>
      {puedeCrear && <QuickCrear triggerLabel="+ Nueva categoría" title="Nueva categoría" campoLabel="Nombre" accion={crearCategoriaProducto} onCreado={alCrear} />}
    </div>
  );
}
