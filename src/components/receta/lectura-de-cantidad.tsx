"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { leerCantidadTecleada, type UnidadDeLectura } from "@/core/catalogo/public";
import { leerNumeroCanonico, textoParaEscribir } from "@/core/datos/numero-tecleado";

/** Lo que ya estaba guardado (canónico, con punto decimal) como se escribe: con la coma, para leerlo con la misma regla que lo tecleado. Lo que no es canónico queda como está. */
function textoParaEscribirDeLoGuardado(valor: string): string {
  const r = leerNumeroCanonico(valor);
  return r.ok && r.valor !== null ? textoParaEscribir(r.valor) : valor;
}

/** El `<select>` de la materia prima en los formularios de alta de un ingrediente (receta central y receta propia). */
const SELECTOR_DE_MATERIA_PRIMA = "insumoProductoId";

/**
 * Lectura en vivo de la cantidad de un ingrediente (pedido del dueño, 2026-10-14): debajo del campo dice qué entendió el sistema de lo que se
 * tipeó («= 3 kg», «= 300 g»). Lo que no se puede leer («3.000» es ambiguo: ¿3,000 o 3000?) lo dice el propio campo, junto a él, con el mismo parser: acá no se repite. Solo PRESENTA lo que arma
 * `leerCantidadTecleada` (core/catalogo): no cambia lo que se guarda ni bloquea el envío.
 *
 * Envuelve los campos tal como están (el CampoNumero de la cantidad, con su `id` = `campoId`, sin tocarlo) con una caja `display: contents`
 * (no altera el layout del formulario) y escucha el `onChange` que sube de ellos: el texto CRUDO del campo de cantidad (el que emite
 * CampoNumero ya es canónico, «3.000» → «3», y la advertencia necesita lo tecleado) y, en el alta, la materia prima elegida en su `<select>`,
 * que decide la unidad. La unidad es SIEMPRE la de stock de la materia prima (la receta se carga en ella: U7 / D3).
 *
 * Lo que ya venía cargado (al editar) se lee sin advertencia: avisa recién cuando la persona tipea.
 */
export function LecturaDeCantidad({
  campoId,
  valorInicial = "",
  unidad = null,
  unidadDeStockPorMp,
  unidades,
  children,
}: {
  campoId: string;
  valorInicial?: string;
  /** Unidad fija (editar un ingrediente que ya está en la receta). */
  unidad?: UnidadDeLectura | null;
  /** Alta: la unidad de stock de cada materia prima del `<select>` (id de MP → id de unidad) y la lectura de cada unidad. */
  unidadDeStockPorMp?: Record<string, string>;
  unidades?: Record<string, UnidadDeLectura>;
  children: ReactNode;
}) {
  // null = la persona todavía no tipeó (se lee `valorInicial`, el valor guardado: dígitos y punto decimal).
  const [tecleado, setTecleado] = useState<string | null>(null);
  const [materiaPrimaId, setMateriaPrimaId] = useState("");
  const caja = useRef<HTMLDivElement>(null);

  // Al guardar bien, FormConResultado resetea el formulario: el `<select>` vuelve a «Materia prima» sin disparar `change`. Se relee del DOM
  // después del reset (el evento llega ANTES de que el navegador restablezca los campos).
  useEffect(() => {
    const formulario = caja.current?.closest("form");
    if (!formulario) return;
    const esperas: ReturnType<typeof setTimeout>[] = [];
    const alResetear = () => {
      esperas.push(setTimeout(() => {
        const selector = formulario.elements.namedItem(SELECTOR_DE_MATERIA_PRIMA);
        setMateriaPrimaId(selector instanceof HTMLSelectElement ? selector.value : "");
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

  const unidadDeLaLectura = unidadDeStockPorMp && unidades ? (unidades[unidadDeStockPorMp[materiaPrimaId] ?? ""] ?? null) : unidad;
  // Lo guardado llega como canónico («1.205» = 1,205); lo tecleado, tal cual se escribió. Se lee cada uno con su regla.
  const lectura = leerCantidadTecleada(tecleado ?? textoParaEscribirDeLoGuardado(valorInicial), unidadDeLaLectura);

  return (
    <div
      ref={caja}
      className="contents"
      onChange={(e) => {
        const origen: EventTarget = e.target;
        if (origen instanceof HTMLInputElement && origen.id === campoId) setTecleado(origen.value);
        else if (origen instanceof HTMLSelectElement && origen.name === SELECTOR_DE_MATERIA_PRIMA) setMateriaPrimaId(origen.value);
      }}
    >
      {children}
      <div aria-live="polite" data-lectura-de={campoId} className="w-full text-sm">
        {lectura.tipo === "valor" && (
          <p className="text-neutral-700 dark:text-neutral-300">
            <span className="sr-only">El sistema lee: </span>
            <span className="font-medium">{lectura.lectura}</span>
          </p>
        )}
      </div>
    </div>
  );
}
