import { BotonDeServidor } from "@/components/boton-de-servidor";
import { MAXIMO_DE_DIAS_DE_UN_RANGO, type OpcionRango } from "@/core/reportes/public";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { Aviso } from "@/ui/primitivas/aviso";
import { Selector } from "@/ui/primitivas/selector";

/**
 * Selector de rango de fechas de los reportes — reemplaza el `<form>` con dos `<input type="date">` que había, copiado y pegado
 * en cinco pantallas (Resumen operativo, Período, Categorías, Promociones, Rendimiento de recetas). Decisión del usuario
 * (2026-09-21, docs/planes-demo-y-claridad-reportes-2026-09-21.md §1): el default pasa de "mes en curso" a "Últimos 30 días",
 * con "Mes en curso" y "Fechas personalizadas" como alternativas.
 *
 * Los `<input type="date" name="desde"/"hasta">` SOLO se renderizan cuando `opcion === "personalizado"`. Si se mostraran
 * siempre (aunque sea de forma oculta o deshabilitada), un value obsoleto de una carga anterior viajaría igual en el próximo
 * submit y pisaría en el server una elección fresca de "rango" — no hay JS acá para mantenerlos sincronizados, es un server
 * component. Mientras la opción no es "personalizado" se muestra el rango vigente como texto de solo lectura.
 *
 * El `<label>` del `<select>` va AL LADO del control (`htmlFor`), no envolviéndolo: un label que envuelve un `<select>` suma a
 * su nombre accesible el texto de la opción vigente (ej. "Rango Últimos 30 días" en vez de "Rango"), lo que rompe
 * `getByLabel("Rango")` — mismo motivo documentado en `FormularioCorregirCompra`.
 */
export function SelectorRango({
  opcion,
  desdeISO,
  hastaISO,
  camposOcultos,
  recortadoDesde,
}: {
  opcion: OpcionRango;
  desdeISO: string;
  hastaISO: string;
  camposOcultos?: Record<string, string>;
  /** `RangoDeReporte.recortadoDesde`: el «desde» pedido, si el rango abarcaba más de `MAXIMO_DE_DIAS_DE_UN_RANGO` días y se recortó (M-21). Con él se muestra el aviso. */
  recortadoDesde?: string;
}) {
  return (
    <>
      {recortadoDesde && (
        // Mismo estilo que el aviso de la rotación de mesas cuando trunca (`data-aviso-truncado`): el reporte NO es el pedido, y la pantalla lo dice.
        <div className="mb-2">
          <Aviso variante="advertencia" data-aviso-rango-recortado="">
            Pediste desde el {recortadoDesde}, pero un reporte abarca como mucho {MAXIMO_DE_DIAS_DE_UN_RANGO} días: se muestra del {desdeISO} al {hastaISO}. Pedí el resto por tramos.
          </Aviso>
        </div>
      )}
      <FormularioDeRango opcion={opcion} desdeISO={desdeISO} hastaISO={hastaISO} camposOcultos={camposOcultos} />
    </>
  );
}

function FormularioDeRango({ opcion, desdeISO, hastaISO, camposOcultos }: { opcion: OpcionRango; desdeISO: string; hastaISO: string; camposOcultos?: Record<string, string> }) {
  return (
    <form className="flex flex-wrap items-end gap-3 text-sm">
      {camposOcultos &&
        Object.entries(camposOcultos).map(([nombre, valor]) => <input key={nombre} type="hidden" name={nombre} value={valor} />)}
      <Selector id="rango" name="rango" etiqueta="Rango" defaultValue={opcion}>
        <option value="30d">Últimos 30 días</option>
        <option value="mes">Mes en curso</option>
        <option value="personalizado">Fechas personalizadas</option>
      </Selector>
      {opcion === "personalizado" ? (
        <>
          <CampoFecha etiqueta="Desde" name="desde" defaultValue={desdeISO} />
          <CampoFecha etiqueta="Hasta" name="hasta" defaultValue={hastaISO} />
        </>
      ) : (
        <p className="pb-2 text-xs text-tinta-suave">
          Del {desdeISO} al {hastaISO}
        </p>
      )}
      <BotonDeServidor type="submit">Actualizar</BotonDeServidor>
    </form>
  );
}
