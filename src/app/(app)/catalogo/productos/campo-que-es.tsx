"use client";

import { AyudaDeFicha } from "@/components/catalogo/ayuda-de-ficha";
import { CLASES_DE_ALTA, CLAVES_DE_CLASE_DE_ALTA, type ClaveDeClaseDeAlta } from "@/core/catalogo/public";
import { Selector } from "@/ui/primitivas/selector";

/**
 * «¿Qué es?» del alta de un producto, como Pedernal (diseño `docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md`; pedido del dueño, 2026-11-17). SOLO PANTALLA: reemplaza a los dos botones MP/PV y a la
 * casilla «Se produce…»; cada clase se guarda con el tipo y «se produce» de siempre (`CLASES_DE_ALTA`). En el alta es un desplegable con la descripción literal de la elegida; en la edición solo se ve
 * (la clase no se cambia: un producto de clase equivocada se corrige creando el correcto y desactivando el otro). La descripción es parte de la pantalla, no una ayuda que apague el interruptor de las ayudas.
 */
export function CampoQueEs({ editando, clase, alCambiar }: { editando: boolean; clase: ClaveDeClaseDeAlta; alCambiar: (clase: ClaveDeClaseDeAlta) => void }) {
  const descripcion = (
    <p className="text-sm text-tinta-tenue" data-que-es-descripcion>
      {CLASES_DE_ALTA[clase].descripcion}
    </p>
  );
  if (editando) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm">{CLASES_DE_ALTA[clase].nombre}</p>
        {descripcion}
        <AyudaDeFicha>Esto no se puede cambiar una vez creado el producto: si te equivocaste, creá uno nuevo y desactivá este.</AyudaDeFicha>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Selector etiqueta="¿Qué es?" name="queEs" value={clase} onChange={(e) => alCambiar(CLAVES_DE_CLASE_DE_ALTA.find((c) => c === e.target.value) ?? "MATERIA_PRIMA")}>
        {CLAVES_DE_CLASE_DE_ALTA.map((c) => (
          <option key={c} value={c}>
            {CLASES_DE_ALTA[c].nombre}
          </option>
        ))}
      </Selector>
      {descripcion}
    </div>
  );
}
