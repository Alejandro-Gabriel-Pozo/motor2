import { useId } from "react";
import { LETRAS_DE_COMPROBANTE, MAXIMO_DE_DIGITOS_DEL_NUMERO, MAXIMO_DE_DIGITOS_DEL_PUNTO_DE_VENTA, estadoDelNumeroTecleado, soloDigitos, type PartesDeNumeroDeComprobante } from "@/core/datos/numero-comprobante";
import { Aviso } from "@/ui/primitivas/aviso";
import { CampoCodigo } from "@/components/campo-codigo";
import { Selector } from "@/ui/primitivas/selector";

/**
 * El número de una factura de proveedor en TRES campos —letra, punto de venta (hasta 5 dígitos) y número (hasta 8)— y, debajo, cómo se va a guardar, con ceros («A-00023-00237728»). Etapa 1 de Compras, paso 6.
 * Es el mismo armado que hace el servidor (`armarNumeroDeComprobante`): acá solo se muestra el resultado y el error en línea; el servidor revalida. Los errores se muestran con `mostrarErrores` (después de
 * intentar avanzar): antes, mientras se teclea, un campo vacío todavía no es un error.
 */
export function CampoNumeroDeComprobante({
  etiqueta = "N° de factura",
  partes,
  onCambio,
  mostrarErrores,
}: {
  etiqueta?: string;
  partes: PartesDeNumeroDeComprobante;
  onCambio: (partes: PartesDeNumeroDeComprobante) => void;
  mostrarErrores: boolean;
}) {
  const id = useId();
  const estado = estadoDelNumeroTecleado(partes);
  const error = mostrarErrores ? (estado.tipo === "error" ? estado.mensaje : estado.tipo === "vacio" ? "Falta el número de la factura: letra, punto de venta y número." : undefined) : undefined;
  return (
    <fieldset className="flex flex-col gap-1" data-testid="numero-de-comprobante">
      <legend className="mb-1 text-sm font-medium">{etiqueta}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-24">
          <Selector id={`${id}-letra`} etiqueta="Letra" value={partes.letra} onChange={(e) => onCambio({ ...partes, letra: e.target.value })}>
            <option value="">Letra</option>
            {LETRAS_DE_COMPROBANTE.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Selector>
        </div>
        <div className="w-32">
          <CampoCodigo
            id={`${id}-pv`}
            etiqueta="Punto de venta"
            autoComplete="off"
            longitudMaxima={MAXIMO_DE_DIGITOS_DEL_PUNTO_DE_VENTA}
            placeholder="00023"
            value={partes.puntoDeVenta}
            onChange={(e) => onCambio({ ...partes, puntoDeVenta: soloDigitos(e.target.value, MAXIMO_DE_DIGITOS_DEL_PUNTO_DE_VENTA) })}
          />
        </div>
        <div className="w-40">
          <CampoCodigo
            id={`${id}-numero`}
            etiqueta="Número"
            autoComplete="off"
            longitudMaxima={MAXIMO_DE_DIGITOS_DEL_NUMERO}
            placeholder="00237728"
            value={partes.numero}
            onChange={(e) => onCambio({ ...partes, numero: soloDigitos(e.target.value, MAXIMO_DE_DIGITOS_DEL_NUMERO) })}
          />
        </div>
      </div>
      {estado.tipo === "valido" && (
        <p className="text-xs text-tinta-tenue" aria-live="polite">
          Se guarda como <strong>{estado.numero}</strong>
        </p>
      )}
      {error && (
        <Aviso variante="error" forma="en-linea">
          {error}
        </Aviso>
      )}
    </fieldset>
  );
}
