import type { CSSProperties } from "react";
import { resolverEstiloCarta, textoDeLaAclaracion, type AclaracionCartaV1, type PresentacionCartaV1, type VistaPreviaDeLaCarta } from "@/core/carta/public";
import { ItemFila } from "@/components/carta-publica/seccion";
import { Aviso } from "@/ui/primitivas/aviso";

/**
 * La VISTA PREVIA de un producto en la carta (Fase 6, bloque 3, 6.18): cómo lo va a leer la carta pública, dentro del espacio del producto (pasos 2 y 4). Es un componente de SERVIDOR que SOLO DIBUJA lo que
 * recibe: el servidor ya calculó la forma y los precios con la regla de la venta (`cargarVistaPreviaDeLaCarta`). Acá no se compone ni se redondea ningún precio, no se aplica ningún descuento ni se
 * arma un resumen: el archivo no puede importar `core/pos` (regla de dependency-cruiser `vista-previa-sin-calculo-de-precio`), así que no tiene con qué. Es de solo lectura, sin formularios.
 *
 * Las formas son las de la carta: el producto con su precio (`simple`, en un renglón de texto: acá no hay un precio de «desde» para mostrar) o la tabla, que se dibuja con el MISMO componente que la carta
 * pública (`ItemFila`, con la escala de letra y los colores de la carta sin tema). Una celda sin precio dice «–» y, para el lector de pantalla, «no se ofrece».
 */
const ESTILO = resolverEstiloCarta({});

function Aclaraciones({ lista }: { lista: AclaracionCartaV1[] }) {
  if (lista.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm text-tinta-suave">
      {lista.map((a) => (
        <li key={a.rotulo}>
          <span className="font-medium text-tinta">{a.rotulo}:</span> {textoDeLaAclaracion(a)}
        </li>
      ))}
    </ul>
  );
}

function Forma({ nombre, presentacion }: { nombre: string; presentacion: PresentacionCartaV1 }) {
  if (presentacion.forma === "simple") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          <span className="font-medium">{nombre}</span> con su precio.
        </p>
        <Aclaraciones lista={presentacion.aclaraciones} />
      </div>
    );
  }
  // La tabla (o la base oculta) es el dibujo de la carta: el servidor ya puso el precio de cada celda.
  const item = { nombre, categoria: "", descripcion: null, precio: 0, tags: [], especial: false, imagenUrl: null, presentacion };
  return (
    <div className="carta-shell rounded px-4" style={ESTILO.variablesCss as CSSProperties}>
      <ul>
        <ItemFila item={item} estilo={ESTILO} />
      </ul>
    </div>
  );
}

export function VistaPreviaDeLaCarta({ nombre, sucursalNombre, vista }: { nombre: string; sucursalNombre: string; vista: VistaPreviaDeLaCarta }) {
  return (
    <section aria-labelledby="titulo-vista-previa-de-la-carta" className="flex flex-col gap-2 rounded border border-borde p-4" data-vista-previa-de-la-carta="">
      <h3 id="titulo-vista-previa-de-la-carta" className="text-base font-medium">
        Cómo se va a ver en la carta
      </h3>
      <p className="text-xs text-tinta-suave">Con el precio de lista de «{sucursalNombre}», sin descuentos. Es la forma que le da la carta pública; si cambia algo arriba, se actualiza al guardar.</p>
      {vista.tipo === "sin-opciones" ? (
        <p className="text-sm">
          <span className="font-medium">{nombre}</span> sin opciones: sale con su nombre y su precio.
        </p>
      ) : vista.tipo === "no-se-puede-pedir" ? (
        <Aviso variante="advertencia">Hoy no se puede pedir: le falta una opción obligatoria disponible o con precio. No sale en la carta hasta que la tenga.</Aviso>
      ) : vista.tipo === "texto" ? (
        <p className="text-sm">{vista.texto}</p>
      ) : (
        <Forma nombre={nombre} presentacion={vista.presentacion} />
      )}
    </section>
  );
}
