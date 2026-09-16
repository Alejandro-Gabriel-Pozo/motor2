"use client";

import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { SelectorProducto } from "@/components/selector-producto";

/**
 * "+ Nueva receta" — abre el editor de un producto puntual (grounded
 * contra Dolibarr: `bom_list.php` es una lista de BOMs ya creados, con un
 * botón "New" que manda a `bom_card.php?action=create`, una pantalla
 * aparte — acá lo mismo, elegís el producto y navegás directo a su editor
 * en vez de mezclarlo con la lista).
 */
export function NuevaReceta({ triggerLabel = "+ Nueva receta" }: { triggerLabel?: string }) {
  const router = useRouter();

  return (
    <Modal triggerLabel={triggerLabel} title="Nueva receta">
      {(cerrar) => (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-500">
            Elegí el Producto de venta o la Materia prima &quot;Se produce&quot; para la que vas a armar la receta.
          </p>
          <SelectorProducto
            value=""
            onChange={(id) => {
              if (!id) return;
              cerrar();
              router.push(`/catalogo/recetas/${id}`);
            }}
            filtro={{ soloActivos: true, elegibleParaReceta: true }}
          />
        </div>
      )}
    </Modal>
  );
}
