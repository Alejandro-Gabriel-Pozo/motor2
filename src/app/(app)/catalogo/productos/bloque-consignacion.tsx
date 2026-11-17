"use client";

import { AyudaCampo } from "@/components/ayuda-campo";
import { AyudaDeFicha } from "@/components/catalogo/ayuda-de-ficha";
import { QuickCrear } from "@/components/catalogo/quick-crear";
import { CampoNumero } from "@/components/campo-numero";
import { altaProveedor } from "@/server/actions/catalogo/proveedores";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";

interface Opcion {
  id: string;
  nombre: string;
}

/**
 * «Es consignación», proveedor de consignación (con «+ Nuevo proveedor») y precio de consignación. Se dibuja en la EDICIÓN y con el interruptor del alta como Pedernal apagado; el alta como Pedernal no lo pide
 * (decisión del dueño, 2026-11-17). Sin la clave `pagar_consignante` (`puedeGestionar` false) solo se ve, en la edición, qué es. Movido tal cual de `producto-form.tsx` (sin cambio de comportamiento).
 */
export function BloqueConsignacion({
  editando,
  puedeGestionar,
  esConsignacion,
  alCambiarEsConsignacion,
  proveedores,
  proveedorId,
  alElegirProveedor,
  alCrearProveedor,
  puedeCrearProveedor,
  precioConsignacion,
}: {
  editando: boolean;
  puedeGestionar: boolean;
  esConsignacion: boolean;
  alCambiarEsConsignacion: (valor: boolean) => void;
  proveedores: Opcion[];
  proveedorId: string;
  alElegirProveedor: (id: string) => void;
  alCrearProveedor: (item: Opcion) => void;
  puedeCrearProveedor: boolean;
  precioConsignacion: number | undefined;
}) {
  return (
    <>
      {puedeGestionar ? (
        <div className="flex flex-col gap-1">
          <Casilla checked={esConsignacion} onChange={(e) => alCambiarEsConsignacion(e.target.checked)} etiqueta="Es consignación" />
          <AyudaDeFicha>
            El producto queda en tu depósito pero sigue siendo propiedad del proveedor hasta que se vende — recién ahí se liquida (se le paga por
            lo vendido, no por lo entregado).
          </AyudaDeFicha>
        </div>
      ) : (
        editando && (
          <div className="flex flex-col gap-1">
            <p className="text-sm">{esConsignacion ? "Es consignación" : "No es consignación"}</p>
            <AyudaCampo>El proveedor y el precio de consignación los gestiona quien tiene permiso para pagar a consignantes.</AyudaCampo>
          </div>
        )
      )}

      {puedeGestionar && esConsignacion && (
        <>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Selector etiqueta="Proveedor de consignación" etiquetaOculta value={proveedorId} onChange={(e) => alElegirProveedor(e.target.value)}>
                <option value="">Proveedor de consignación</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </Selector>
            </div>
            {puedeCrearProveedor && (
              <QuickCrear triggerLabel="+ Nuevo proveedor" title="Nuevo proveedor" campoLabel="Nombre" accion={(nombre) => altaProveedor({ nombre })} onCreado={alCrearProveedor} />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <CampoNumero name="precioConsignacion" prefijo="$" placeholder="Precio de consignación" ariaLabel="Precio de consignación" defaultValue={String(precioConsignacion ?? 0)} tipo="importe" etiqueta="El precio de consignación" />
            <AyudaDeFicha>Lo que le pagás al proveedor por cada unidad vendida — no tiene por qué ser igual al precio al que vos la vendés.</AyudaDeFicha>
          </div>
        </>
      )}
    </>
  );
}
