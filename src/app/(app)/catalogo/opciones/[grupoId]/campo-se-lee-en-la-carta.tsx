"use client";

import { useState } from "react";
import { LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA, leerOpcionEnCarta } from "@/core/opciones/public";
import { Campo } from "@/ui/primitivas/campo";

/**
 * «Se lee en la carta como» (Fase 4 de la ola «precio y carta», ADR-035, DEC-34): el prefijo OPCIONAL con que la carta lee cada opción del grupo, con su LECTURA EN VIVO («En la carta se verá: De
 * carne · De pollo»), anunciada con `aria-live="polite"`. Solo para grupos de variantes y de tamaños (la página no lo dibuja en los demás). Vacío = cada opción se lee con su nombre. El servidor
 * vuelve a validar todo (hasta 20 caracteres, sin espacios a los costados); acá solo se ayuda a escribirlo. Solo la carta lo lee: ni el precio, ni el POS, ni el ticket.
 */
export function CampoSeLeeEnLaCarta({ prefijoInicial, opciones }: { prefijoInicial: string | null; opciones: readonly { nombre: string; esNinguna: boolean }[] }) {
  const [prefijo, setPrefijo] = useState(prefijoInicial ?? "");
  const largo = Array.from(prefijo).length;
  const limpio = prefijo.trim();
  const lectura = opciones.filter((o) => !o.esNinguna).map((o) => leerOpcionEnCarta(limpio === "" ? null : limpio, o));
  return (
    <div className="flex flex-col gap-1">
      <Campo
        etiqueta="Se lee en la carta como"
        name="prefijoEnCarta"
        maxLength={LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA}
        value={prefijo}
        onChange={(e) => setPrefijo(e.target.value)}
        placeholder="Por ejemplo: De"
        ayuda={`Opcional, hasta ${LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA} caracteres (${largo}/${LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA}). Solo lo usa la carta: el POS y el ticket muestran el grupo y la opción tal cual.`}
      />
      <p aria-live="polite" className="text-sm" data-lectura-en-carta="">
        {limpio === ""
          ? "Sin prefijo: cada opción se lee con su nombre."
          : lectura.length > 0
            ? `En la carta se verá: ${lectura.join(" · ")}`
            : `En la carta se verá: ${limpio} … (todavía no hay opciones en uso)`}
      </p>
    </div>
  );
}
