"use client";

import { useState } from "react";
import { AyudaCampo } from "@/components/ayuda-campo";
import { ValorSoloLectura } from "@/components/catalogo/campos-sensibles-solo-lectura";
import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";
import { ALICUOTAS_IVA, type AlicuotaIva } from "@/core/fiscal/public";
import { Selector } from "@/ui/primitivas/selector";
import type { DatosProducto } from "@/server/actions/catalogo/productos";

/**
 * Paso 13 (alícuota de IVA del producto, docs/diseno-alicuota-iva-del-producto-2026-11-12.md): cómo se llama cada alícuota en la pantalla. `Record<AlicuotaIva, …>` es exhaustivo a propósito: una alícuota nueva
 * en `ALICUOTAS_IVA` no compila hasta que se la nombra acá. El orden del selector es el de `ALICUOTAS_IVA`.
 */
const ETIQUETA_DE_ALICUOTA: Record<AlicuotaIva, string> = {
  IVA_0: "IVA 0 %",
  IVA_2_5: "IVA 2,5 %",
  IVA_5: "IVA 5 %",
  IVA_10_5: "IVA 10,5 %",
  IVA_21: "IVA 21 %",
  IVA_27: "IVA 27 %",
  EXENTO: "Exento",
  NO_GRAVADO: "No gravado",
};

type AlicuotasGuardadas = Pick<DatosProducto, "alicuotaIvaVenta" | "alicuotaIvaCompra">;

/** La alícuota que tiene guardada el producto para su tipo (la de venta en un PV, la de compra en una MP); `null` = «sin declarar» (también en el alta). */
function alicuotaGuardadaDe(tipo: TipoProducto, existente: AlicuotasGuardadas | undefined): AlicuotaIva | null {
  return (tipo === "PV" ? existente?.alicuotaIvaVenta : existente?.alicuotaIvaCompra) ?? null;
}

/** La alícuota elegida en el selector puesta en su tipo: una de la lista, o `null` («sin declarar») si está vacío o no es de la lista. */
const alicuotaElegida = (valor: string): AlicuotaIva | null => ((ALICUOTAS_IVA as readonly string[]).includes(valor) ? (valor as AlicuotaIva) : null);

/**
 * Lo que la alícuota agrega al pedido de guardado. Solo viaja con la clave fina (como el precio de venta): sin ella no se manda nada («no viene = queda como estaba»). En el alta, solo si se eligió una; en la
 * edición, SIEMPRE la del tipo (aunque esté vacía = «sin declarar») junto con la que mostraba el formulario (`alicuotaVista`), para que el servidor detecte que otra persona la cambió mientras se editaba.
 */
export function alicuotasDelFormulario(
  form: FormData,
  tipo: TipoProducto,
  existente: AlicuotasGuardadas | undefined,
  puedeEditarCamposSensibles: boolean,
): { delAlta: Partial<DatosProducto>; deLaEdicion: Partial<DatosProducto> & { alicuotaVista?: AlicuotaIva | null } } {
  if (!puedeEditarCamposSensibles) return { delAlta: {}, deLaEdicion: {} };
  const elegida = alicuotaElegida(String(form.get("alicuotaIva") ?? ""));
  const delTipo = tipo === "PV" ? { alicuotaIvaVenta: elegida } : { alicuotaIvaCompra: elegida };
  return { delAlta: elegida === null ? {} : delTipo, deLaEdicion: { ...delTipo, alicuotaVista: alicuotaGuardadaDe(tipo, existente) } };
}

/**
 * «IVA de venta» (PV) o «IVA de compra» (MP). Nada preelegido; vacío = «sin declarar» y la pantalla lo dice («Pendiente de completar»). Sin la clave fina, solo lectura. El formulario lo monta con `key={tipo}`:
 * al cambiar de tipo en el alta no se arrastra la alícuota elegida (la de venta y la de compra son datos distintos).
 */
export function CampoAlicuotaIva({ tipo, existente, puedeEditar }: { tipo: TipoProducto; existente: AlicuotasGuardadas | undefined; puedeEditar: boolean }) {
  const guardada = alicuotaGuardadaDe(tipo, existente);
  const [alicuota, setAlicuota] = useState<string>(guardada ?? "");
  const etiqueta = tipo === "PV" ? "IVA de venta" : "IVA de compra";
  return (
    <div className="flex flex-col gap-1" data-alicuota-iva={tipo === "PV" ? "venta" : "compra"}>
      {puedeEditar ? (
        <Selector etiqueta={etiqueta} name="alicuotaIva" value={alicuota} onChange={(e) => setAlicuota(e.target.value)}>
          <option value="">Sin declarar</option>
          {ALICUOTAS_IVA.map((a) => (
            <option key={a} value={a}>
              {ETIQUETA_DE_ALICUOTA[a]}
            </option>
          ))}
        </Selector>
      ) : (
        <>
          <ValorSoloLectura campo="alicuotaIva" etiqueta={etiqueta}>
            {guardada ? ETIQUETA_DE_ALICUOTA[guardada] : "Pendiente de completar"}
          </ValorSoloLectura>
          <AyudaCampo>Para cambiarla hace falta el mismo permiso que para el precio de venta.</AyudaCampo>
        </>
      )}
      {puedeEditar && alicuota === "" && (
        <p className="text-xs text-tinta-tenue" data-alicuota-pendiente>
          Pendiente de completar
        </p>
      )}
    </div>
  );
}
