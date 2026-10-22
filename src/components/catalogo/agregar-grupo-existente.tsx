"use client";

import { useEffect, useRef, useState } from "react";
import { FormConResultado } from "@/components/form-con-resultado";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Selector } from "@/ui/primitivas/selector";

/** Un grupo de la biblioteca que el producto todavía no tiene: lo que la ventana ofrece en su selector (la etiqueta ya viene con el tipo, «Tamaño ficha (Tamaño)»). */
export interface GrupoParaAgregar {
  grupoId: string;
  etiqueta: string;
}

/**
 * «Agregar un grupo existente» del paso 2 del espacio del producto (Fase 6, paso 6.15b; DEC-12): sumar al producto un grupo que ya está en la biblioteca de «Opciones de venta», en una ventana
 * (`Dialogo` ancho) y sin salir del producto. Es lo que hacía la sección «Agregar grupo» de la página, con la MISMA lógica: `accion` es el cierre `"use server"` de la página (que conoce el producto, el orden
 * que sigue y las opciones que se admiten al agregar un grupo, y llama a `fijarAdmisionDeGrupoEnProducto`); acá solo se elige el grupo y se manda. Después se ajusta lo que admite el producto de cada opción en la
 * tarjeta del grupo.
 *
 * Si sale bien, la ventana se cierra y el mensaje del servidor queda al lado del botón (la página se refresca sola: la acción revalida la ruta); si el servidor lo rechaza, el mensaje queda DENTRO de la
 * ventana, que sigue abierta. «Agregar» mide 44 px en cualquier ancho (`tamano="tactil"`, como el botón de antes).
 */
export function AgregarGrupoExistente({ grupos, accion }: { grupos: readonly GrupoParaAgregar[]; accion: (formData: FormData) => Promise<ResultadoAccion> }) {
  const [abierto, setAbierto] = useState(false);
  const [exito, setExito] = useState<string | null>(null);
  const selector = useRef<HTMLSelectElement>(null);

  // Al abrir, el foco va al selector (el diálogo nativo lo pondría en «Cerrar»). Este efecto corre después del de `Dialogo` (el que llama a `showModal`), con el diálogo ya abierto.
  useEffect(() => {
    if (abierto) selector.current?.focus();
  }, [abierto]);

  async function agregar(formData: FormData): Promise<ResultadoAccion> {
    const resultado = await accion(formData);
    if (resultado.ok) {
      setAbierto(false);
      setExito(resultado.mensaje);
    }
    return resultado;
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Boton
          variante="secundario"
          onClick={() => {
            setExito(null);
            setAbierto(true);
          }}
        >
          Agregar un grupo existente
        </Boton>
      </div>
      {exito ? <Aviso variante="exito">{exito}</Aviso> : null}
      <Dialogo abierto={abierto} titulo="Agregar un grupo existente" ancho="ancho" onCerrar={() => setAbierto(false)}>
        <FormConResultado accion={agregar} className="flex flex-col gap-4">
          <Selector ref={selector} etiqueta="Grupo" name="grupoId" required defaultValue="" ayuda="Al agregarlo, marcá en su tarjeta qué opciones de ese grupo admite este producto.">
            <option value="" disabled>
              Elegí un grupo
            </option>
            {grupos.map((g) => (
              <option key={g.grupoId} value={g.grupoId}>
                {g.etiqueta}
              </option>
            ))}
          </Selector>
          <div className="flex flex-wrap justify-end gap-2">
            <Boton variante="secundario" tamano="tactil" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="tactil">
              Agregar
            </Boton>
          </div>
        </FormConResultado>
      </Dialogo>
    </div>
  );
}
