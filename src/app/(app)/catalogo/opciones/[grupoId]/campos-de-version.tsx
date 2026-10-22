"use client";

import { useId, useState } from "react";
import { CampoNumero } from "@/components/campo-numero";
import { leerNumeroCanonico } from "@/core/datos/numero-tecleado";
import { espejoDeDiferencia, textoDePorcentaje, type DiferenciaDePrecio, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import { formatearMonto } from "@/core/pos/public";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";
import { Insignia } from "@/ui/primitivas/insignia";
import { EditorDeConsumos, type ConsumoEnEdicion, type InsumoParaConsumo } from "./editor-de-consumos";
import { LecturaDelFactor, type RecetaDeReferencia } from "./lectura-del-factor";

/** El precio de referencia del espejo: el precio base del primer producto que usa el grupo, en la sucursal activa (lo calcula el servidor). */
export interface ReferenciaDePrecio {
  productoNombre: string;
  sucursalNombre: string;
  precio: number;
}

/**
 * Los campos de PRECIO de una opción (GO-2d), los mismos en el alta y en «Cambiar precio o consumo»: cómo cambia el precio y, en un tamaño, cuánto consume. Lo que se ofrece
 * depende del tipo del grupo (las mismas reglas que valida el servidor, `validarVersion`):
 * - TAMAÑO: diferencia sobre el precio base, en monto o en porcentaje, y el factor de consumo (cuánto más o menos lleva respecto del base). Si un producto lo cobra con precio
 *   propio por tamaño, ese precio se carga en el producto, no acá.
 * - VARIANTE: diferencia en monto o en porcentaje (puede ser 0 o negativa).
 * - INCLUIDA y la opción «ninguna»: sin campos; va dentro del precio, sin recargo.
 * - ADICIONAL: el recargo, siempre en monto (0,01 o más).
 * Al lado de la diferencia va el ESPEJO de solo lectura, con el rótulo «referencia»: el monto también como porcentaje (o al revés) sobre el precio de referencia, con la misma
 * cuenta exacta del núcleo (`espejoDeDiferencia`). Es una ayuda: el precio de cada venta lo compone el servidor.
 *
 * Lo elegido viaja en campos ocultos (`tipoDiferencia`, `valorDiferencia`, `factorEscala`) que el closure de la página arma en el comando; el servidor lo vuelve a validar todo.
 *
 * OPCIONES-FACTOR: debajo del factor de un tamaño, en vivo, qué quiere decir el número («Factor 1,3 = lleva 30% más que el tamaño base») y, con la receta de referencia, cómo cambia lo
 * que descuenta (`LecturaDelFactor`). Es solo lectura: no cambia lo que se guarda.
 */
export function CamposDeVersion({
  tipo,
  sinPrecio,
  referencia,
  receta,
  inicial,
  consumos,
}: {
  tipo: TipoDeGrupoDeOpciones;
  /** La opción «ninguna» o una INCLUIDA: no lleva precio. */
  sinPrecio: boolean;
  referencia: ReferenciaDePrecio | null;
  /** Solo un tamaño: la receta del mismo producto de referencia, para leer el factor (`null` sin el «Ver» de las recetas o sin el módulo Recetas: solo la frase). */
  receta: RecetaDeReferencia | null;
  inicial?: { diferencia: DiferenciaDePrecio; factorEscala: number | null };
  /** Lo que consume (con el módulo Recetas activo); `null` = la empresa no tiene Recetas: se guarda sin consumos y se avisa. La «ninguna» nunca consume. */
  consumos: { insumos: InsumoParaConsumo[]; inicial: ConsumoEnEdicion[] } | null;
}) {
  const id = useId();
  const soloMonto = tipo === "ADICIONAL";
  const [modo, setModo] = useState<"MONTO" | "PORCENTAJE">(inicial?.diferencia.tipo === "PORCENTAJE" && !soloMonto ? "PORCENTAJE" : "MONTO");
  const [monto, setMonto] = useState(inicial?.diferencia.tipo === "MONTO" ? String(inicial.diferencia.monto) : "");
  const [porcentaje, setPorcentaje] = useState(inicial?.diferencia.tipo === "PORCENTAJE" ? String(inicial.diferencia.porcentaje) : "");
  const [factor, setFactor] = useState(inicial?.factorEscala != null ? String(inicial.factorEscala) : tipo === "MEDIDA" ? "1" : "");

  const editorDeConsumos = sinPrecio ? null : consumos ? (
    <EditorDeConsumos tipo={tipo} insumos={consumos.insumos} inicial={consumos.inicial} />
  ) : (
    <p className="text-xs text-tinta-suave">Lo que consume una opción usa el módulo Recetas, que tu empresa no tiene activo: se guarda sin consumos.</p>
  );

  if (sinPrecio || tipo === "INCLUIDA") {
    return (
      <div className="flex flex-col gap-3">
        <input type="hidden" name="tipoDiferencia" value="MONTO" />
        <input type="hidden" name="valorDiferencia" value="0" />
        <p className="text-sm text-tinta-suave">{sinPrecio ? "La opción «ninguna» no lleva precio ni consumo." : "Va incluida en el precio del producto: no lleva recargo."}</p>
        {editorDeConsumos}
      </div>
    );
  }

  const texto = modo === "MONTO" ? monto : porcentaje;
  const numero = leerNumeroCanonico(texto);
  const diferencia: DiferenciaDePrecio | null = numero.ok && numero.valor !== null ? (modo === "MONTO" ? { tipo: "MONTO", monto: numero.valor } : { tipo: "PORCENTAJE", porcentaje: numero.valor }) : null;
  const espejo = diferencia && referencia ? espejoDeDiferencia(diferencia, referencia.precio) : null;
  const idEspejo = `${id}-espejo`;
  // El factor tal cual lo interpreta el campo (vacío → null; un texto que no es número → NaN), para leerlo en vivo.
  const factorLeido = leerNumeroCanonico(factor);
  const valorDelFactor = factorLeido.ok ? factorLeido.valor : Number.NaN;

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="tipoDiferencia" value={modo} />
      {soloMonto ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-valor`} className="text-sm font-medium">
            Recargo (se cobra aparte, en su propia línea)
          </label>
          <CampoNumero id={`${id}-valor`} name="valorDiferencia" value={monto} onChange={setMonto} prefijo="$" tipo="importe" etiqueta="El recargo" required className="w-40" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <OpcionesExcluyentes
            presentacion="fila"
            leyenda={tipo === "MEDIDA" ? "Diferencia sobre el precio base" : "Cuánto cambia el precio"}
            nombre={`${id}-modo`}
            valorInicial={modo}
            alCambiar={(valor) => setModo(valor === "PORCENTAJE" ? "PORCENTAJE" : "MONTO")}
            opciones={[
              { valor: "MONTO", etiqueta: "Monto en pesos" },
              { valor: "PORCENTAJE", etiqueta: "Porcentaje" },
            ]}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor={`${id}-valor`} className="sr-only">
              {modo === "MONTO" ? "Diferencia en pesos" : "Diferencia en porcentaje"}
            </label>
            {modo === "MONTO" ? (
              <CampoNumero key="monto" id={`${id}-valor`} name="valorDiferencia" value={monto} onChange={setMonto} prefijo="$" tipo="importe" permitirNegativo etiqueta="La diferencia" required className="w-40" />
            ) : (
              <CampoNumero key="porcentaje" id={`${id}-valor`} name="valorDiferencia" value={porcentaje} onChange={setPorcentaje} etiqueta="El porcentaje" required className="w-28" />
            )}
            {modo === "PORCENTAJE" && <span className="text-sm">%</span>}
          </div>
          <p className="text-xs text-tinta-suave">En negativo, resta (por ejemplo, un tamaño más chico). Con 0 no cambia el precio.</p>
        </div>
      )}
      {referencia && !soloMonto && (
        <p id={idEspejo} aria-live="polite" className="text-sm text-tinta-suave" data-espejo>
          {espejo
            ? espejo.tipo === "PORCENTAJE"
              ? `≈ ${espejo.porcentaje >= 0 ? "" : "−"}${textoDePorcentaje(Math.abs(espejo.porcentaje))} % del precio base de «${referencia.productoNombre}» en «${referencia.sucursalNombre}» (${formatearMonto(referencia.precio)})`
              : `≈ ${espejo.monto >= 0 ? "+" : "−"} ${formatearMonto(Math.abs(espejo.monto))} sobre el precio base de «${referencia.productoNombre}» en «${referencia.sucursalNombre}» (${formatearMonto(referencia.precio)})`
            : `Precio base de «${referencia.productoNombre}» en «${referencia.sucursalNombre}»: ${formatearMonto(referencia.precio)}`}{" "}
          <Insignia>referencia</Insignia>
        </p>
      )}
      {tipo === "MEDIDA" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-factor`} className="text-sm font-medium">
            Cuánto consume respecto del tamaño base
          </label>
          <CampoNumero id={`${id}-factor`} name="factorEscala" value={factor} onChange={setFactor} etiqueta="El factor" required className="w-28" />
          <p className="text-xs text-tinta-suave">Cuánto consume este tamaño respecto del base: 1 = igual, 1,5 = 50% más, 0,7 = 30% menos (máximo 10).</p>
          <LecturaDelFactor valor={valorDelFactor} receta={receta} />
        </div>
      )}
      {editorDeConsumos}
    </div>
  );
}
