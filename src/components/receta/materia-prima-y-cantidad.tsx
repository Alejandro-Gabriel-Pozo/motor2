"use client";

import { useEffect, useRef, useState } from "react";
import { CampoNumero } from "@/components/campo-numero";
import { LecturaDeCantidad } from "@/components/receta/lectura-de-cantidad";
import { SelectorProducto } from "@/components/selector-producto";
import type { UnidadDeLectura } from "@/core/catalogo/public";
import type { ProductoOpcionConUnidad } from "@/server/actions/catalogo/productos";
import { Boton } from "@/ui/primitivas/boton";
import { Insignia } from "@/ui/primitivas/insignia";

const NO_ELEGIDA = "Elegí una materia prima de la lista.";

/** El aviso de «no hay nada» del buscador: dice qué se buscó (o que no hay materias primas, si todavía no se escribió nada). */
function textoSinResultados(termino: string): string {
  const buscado = termino.trim();
  return buscado ? `No encontré «${buscado}». Probá con otra palabra.` : "No hay materias primas disponibles.";
}

/**
 * Los campos de «Agregar ingrediente» de una receta (la central y la propia de la sucursal): la materia prima, la cantidad y la merma.
 *
 * La materia prima se elige con el buscador compartido (`SelectorProducto`: se escribe parte del nombre o del código, el servidor devuelve hasta 20 de las materias primas disponibles en alguna
 * sucursal, cada una con su unidad de stock). Al elegir queda una línea con la elegida y «Cambiar», la unidad de stock se pega a la cantidad y la lectura en vivo («= 250 g») la usa. La receta
 * se carga SIEMPRE en esa unidad (U7 / D3): la regla y su validación siguen en el servidor, que al guardar vuelve a compararla con la real.
 *
 * Va DENTRO de un `<form>`: el id de la materia prima viaja en `insumoProductoId` (el `<input>` oculto del buscador) y la cantidad y la merma en `cantidad` y `mermaPorcentaje`, como cuando la
 * materia prima era un `<select>`. Mientras no haya una elegida, el buscador no deja enviar (validez nativa, como el `required` del `<select>`). Al guardar bien, `FormConResultado` resetea el
 * formulario y esto vuelve a empezar.
 */
export function MateriaPrimaYCantidad({
  idCantidad,
  etiquetaMateriaPrima,
  etiquetaCantidad,
  etiquetaMerma,
  lecturaPorUnidad,
  nombreDelProducto,
}: {
  /** El `id` del campo de cantidad (también lo usa `LecturaDeCantidad`). */
  idCantidad: string;
  etiquetaMateriaPrima: string;
  etiquetaCantidad: string;
  etiquetaMerma: string;
  /** La lectura en vivo de la cantidad por id de unidad (`unidadesDeLectura`, la arma la página). */
  lecturaPorUnidad: Record<string, UnidadDeLectura>;
  /** El plato de la receta, para la frase llana de la lectura («… por cada unidad vendida de Milanesa»). */
  nombreDelProducto: string;
}) {
  const [elegida, setElegida] = useState<ProductoOpcionConUnidad | null>(null);
  const [productoId, setProductoId] = useState("");
  // Cambia cada vez que se vuelve a buscar: limpia el texto que el buscador conserva de la elegida anterior.
  const [reinicio, setReinicio] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  const alVolverAlBuscador = useRef(false);
  const idBuscador = `${idCantidad}-buscador`;

  // El buscador queda montado (aunque oculto) mientras hay una elegida: su `<input>` oculto es el que lleva el id al servidor. Sin elegida, el campo no es válido y el navegador frena el envío.
  useEffect(() => {
    caja.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.setCustomValidity(elegida ? "" : NO_ELEGIDA);
    if (!elegida && alVolverAlBuscador.current) {
      alVolverAlBuscador.current = false;
      document.getElementById(idBuscador)?.focus();
    }
  }, [elegida, idBuscador]);

  // Al guardar bien, FormConResultado resetea el formulario: el buscador y la elegida vuelven a vacío.
  useEffect(() => {
    const formulario = caja.current?.closest("form");
    if (!formulario) return;
    const alResetear = () => {
      setElegida(null);
      setProductoId("");
      setReinicio((n) => n + 1);
    };
    formulario.addEventListener("reset", alResetear);
    return () => formulario.removeEventListener("reset", alResetear);
  }, []);

  function cambiar() {
    alVolverAlBuscador.current = true;
    setElegida(null);
    setProductoId("");
    setReinicio((n) => n + 1);
  }

  return (
    <LecturaDeCantidad campoId={idCantidad} unidad={elegida ? (lecturaPorUnidad[elegida.unidadStock.id] ?? null) : null} descripcion={elegida ? { insumo: elegida.nombre, producto: nombreDelProducto } : undefined}>
      <div ref={caja} className="flex flex-col gap-2">
        <SelectorProducto
          id={idBuscador}
          name="insumoProductoId"
          aria-label={etiquetaMateriaPrima}
          value={productoId}
          onChange={setProductoId}
          onElegir={(opcion) => {
            setElegida(opcion);
            // La cantidad es lo que sigue: el foco va ahí (el buscador queda oculto).
            document.getElementById(idCantidad)?.focus();
          }}
          filtro={{ tipo: "MP", soloDisponiblesEnAlguna: true }}
          placeholder="Escribí nombre o código…"
          limpiarSenal={reinicio}
          mostrarUnidad
          textoSinResultados={textoSinResultados}
          className={elegida ? "hidden" : undefined}
        />
        {/* Región viva: al elegir, un lector de pantalla anuncia cuál quedó (el foco pasa a la cantidad). */}
        <div aria-live="polite">
          {elegida && (
            <div className="flex items-center justify-between gap-2 rounded border border-borde-control bg-superficie px-3 py-2 text-sm">
              <span data-materia-prima-elegida>
                <strong className="font-medium">{elegida.nombre}</strong> <span className="text-tinta-suave">{elegida.codigo}</span>
              </span>
              <Boton variante="secundario" tamano="chico" onClick={cambiar}>
                Cambiar<span className="sr-only"> materia prima</span>
              </Boton>
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-tinta-tenue">La cantidad se carga en la unidad de stock de la materia prima (la que se ve junto a la cantidad).</p>
      <div className="flex gap-2">
        <div className="flex flex-1 items-start gap-2">
          <CampoNumero tipo="cantidad" id={idCantidad} name="cantidad" placeholder="Cantidad" ariaLabel={etiquetaCantidad} required className="flex-1" />
          {elegida && (
            <span className="flex min-h-11 items-center md:min-h-9">
              <Insignia data-unidad-de-la-cantidad>{elegida.unidadStock.nombre}</Insignia>
            </span>
          )}
        </div>
        <CampoNumero tipo="porcentaje" name="mermaPorcentaje" placeholder="Merma %" ariaLabel={etiquetaMerma} className="w-28" />
      </div>
    </LecturaDeCantidad>
  );
}
