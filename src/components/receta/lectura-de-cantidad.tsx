"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { leerCantidadTecleada, type DescripcionDeLectura, type UnidadDeLectura } from "@/core/catalogo/public";
import { leerNumeroCanonico, textoParaEscribir } from "@/core/datos/numero-tecleado";

/** Lo que ya estaba guardado (canónico, con punto decimal) como se escribe: con la coma, para leerlo con la misma regla que lo tecleado. Lo que no es canónico queda como está. */
function textoParaEscribirDeLoGuardado(valor: string): string {
  const r = leerNumeroCanonico(valor);
  return r.ok && r.valor !== null ? textoParaEscribir(r.valor) : valor;
}

/**
 * Lectura en vivo de la cantidad de un ingrediente (pedido del dueño, 2026-10-14): debajo del campo dice qué entendió el sistema de lo que se
 * tipeó («= 3 kg», «= 300 g»). Lo que no se puede leer («3.000» es ambiguo: ¿3,000 o 3000?) lo dice el propio campo, junto a él, con el mismo parser: acá no se repite. Solo PRESENTA lo que arma
 * `leerCantidadTecleada` (core/catalogo): no cambia lo que se guarda ni bloquea el envío.
 *
 * Envuelve los campos tal como están (el CampoNumero de la cantidad, con su `id` = `campoId`, sin tocarlo) con una caja `display: contents`
 * (no altera el layout del formulario) y escucha el `onChange` que sube de ellos: el texto CRUDO del campo de cantidad (el que emite
 * CampoNumero ya es canónico, «3.000» → «3», y la advertencia necesita lo tecleado). La unidad es SIEMPRE la de stock de la materia prima (la receta se carga en ella: U7 / D3) y la pasa
 * quien lo usa en `unidad`: al editar, la del ingrediente; en el alta, la de la materia prima que se eligió en el buscador (`MateriaPrimaYCantidad`; `null` mientras no hay ninguna).
 *
 * Lo que ya venía cargado (al editar) se lee sin advertencia: avisa recién cuando la persona tipea.
 */
export function LecturaDeCantidad({
  campoId,
  valorInicial = "",
  unidad = null,
  descripcion,
  children,
}: {
  campoId: string;
  valorInicial?: string;
  /** La unidad en la que se lee la cantidad: la de stock de la materia prima (la del ingrediente al editar; la de la materia prima elegida en el alta, `null` si todavía no hay). */
  unidad?: UnidadDeLectura | null;
  /** De qué ingrediente y de qué plato es la cantidad: con eso se agrega la frase llana («Lleva 0,22 kg de Bife de nalga por cada unidad vendida de Milanesa»). Sin esto, solo la lectura de siempre. */
  descripcion?: DescripcionDeLectura;
  children: ReactNode;
}) {
  // null = la persona todavía no tipeó (se lee `valorInicial`, el valor guardado: dígitos y punto decimal).
  const [tecleado, setTecleado] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  // Al guardar bien, FormConResultado resetea el formulario: el campo de cantidad vuelve a vacío sin disparar `change`. Se relee del DOM
  // después del reset (el evento llega ANTES de que el navegador restablezca los campos).
  useEffect(() => {
    const formulario = caja.current?.closest("form");
    if (!formulario) return;
    const esperas: ReturnType<typeof setTimeout>[] = [];
    const alResetear = () => {
      esperas.push(setTimeout(() => {
        const campo = formulario.ownerDocument.getElementById(campoId);
        if (campo instanceof HTMLInputElement) setTecleado(campo.value);
      }));
    };
    formulario.addEventListener("reset", alResetear);
    return () => {
      formulario.removeEventListener("reset", alResetear);
      esperas.forEach((espera) => clearTimeout(espera));
    };
  }, [campoId]);

  // Lo guardado llega como canónico («1.205» = 1,205); lo tecleado, tal cual se escribió. Se lee cada uno con su regla.
  const lectura = leerCantidadTecleada(tecleado ?? textoParaEscribirDeLoGuardado(valorInicial), unidad, descripcion);

  return (
    <div
      ref={caja}
      className="contents"
      onChange={(e) => {
        const origen: EventTarget = e.target;
        // Un instante después: si el campo rechaza el cambio (un pegado con «.»), vuelve a su texto anterior recién al terminar este evento, y la lectura tiene que seguir a lo que QUEDÓ en el campo.
        if (origen instanceof HTMLInputElement && origen.id === campoId) setTimeout(() => setTecleado(origen.value), 0);
      }}
    >
      {children}
      <div aria-live="polite" data-lectura-de={campoId} className="w-full text-sm">
        {lectura.tipo === "valor" && (
          <p className="text-tinta-suave">
            <span className="sr-only">El sistema lee: </span>
            <span className="font-medium">{lectura.lectura}</span>
          </p>
        )}
        {lectura.tipo === "valor" && lectura.frase && (
          <p data-frase-de-cantidad className="text-tinta-suave">
            {lectura.frase}
          </p>
        )}
      </div>
    </div>
  );
}
