"use client";

import { useRef, useState, useTransition } from "react";
import { ARMADO_DE_PROMO_COMO_PEDERNAL, textosDeLaPantallaDePromos, type ComandoDeFila, type ComponenteDeLaFicha, type FilaDeParte, type ProductoParaEntrada } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Selector } from "@/ui/primitivas/selector";
import { ParteDePromo } from "./parte-de-promo";

/**
 * «Qué lleva» de la ficha de un combo «como la maqueta» (`combos.html` de Pedernal): una TARJETA por componente (lo que lleva en negrita, su tipo en gris, lo que el cliente puede elegir y «Quitar»), el botón «Agregar componente» y su hoja.
 * «Quitar» da de baja la parte con el MISMO comando de siempre (`guardarParteDePromo`, modo «No entra»: baja lógica, nunca se borra). Sin permiso de definir promos (`puedeEditar` falso) no hay «Quitar» ni «Agregar». En un combo todavía sin guardar
 * (`sinGuardar`) el botón está, pero apagado: los componentes se guardan sobre un combo que ya existe.
 */
function TarjetaDeComponente({ c, puedeEditar, guardar }: { c: ComponenteDeLaFicha; puedeEditar: boolean; guardar: (comando: ComandoDeFila) => Promise<ResultadoAccion> }) {
  const t = textosDeLaPantallaDePromos(ARMADO_DE_PROMO_COMO_PEDERNAL);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);
  const quitar = () => {
    if (enviando.current) return;
    enviando.current = true;
    startTransition(async () => {
      try {
        const r = await guardar({ lugar: c.fila.lugar, modo: "NO_ENTRA" });
        setError(r.ok ? null : r.mensaje);
      } finally {
        enviando.current = false;
      }
    });
  };
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-borde p-4" data-componente-del-combo={c.nombre} data-cupo-seccion={c.fila.nombre}>
      <div className="flex items-start justify-between gap-3">
        <span className="font-semibold">{c.nombre}</span>
        {puedeEditar && (
          <Boton variante="enlace" tamano="en-fila" cargando={pendiente} onClick={quitar} aria-label={`${t.quitar} ${c.nombre}`}>
            {t.quitar}
          </Boton>
        )}
      </div>
      <span className="text-sm text-tinta-suave">{c.tipo === "fijo" ? t.tipoProductoFijo : t.tipoSeccion}</span>
      {c.elegibles.length > 0 && (
        <span className="text-sm text-tinta-suave">
          {t.loQueElClientePuedeElegir}: {c.elegibles.join(", ")}
        </span>
      )}
      {error !== null && (
        <Aviso variante="error" forma="en-linea">
          {error}
        </Aviso>
      )}
    </li>
  );
}

/** La hoja «Agregar componente»: elegir la sección (o «No está en la carta») y, en ella, qué entra y cuántos (`ParteDePromo`). Al abrirla no queda nada elegido (todo nace cerrado). */
export function HojaDeComponente({
  abierta,
  paraAgregar,
  productos,
  guardar,
  alCerrar,
}: {
  abierta: boolean;
  paraAgregar: FilaDeParte[];
  productos: ProductoParaEntrada[];
  guardar: (comando: ComandoDeFila) => Promise<ResultadoAccion>;
  alCerrar: () => void;
}) {
  const t = textosDeLaPantallaDePromos(ARMADO_DE_PROMO_COMO_PEDERNAL);
  const [clave, setClave] = useState("");
  const fila = paraAgregar.find((f) => f.clave === clave) ?? null;
  // Al cerrar se olvida lo elegido: la próxima vez la hoja nace cerrada otra vez.
  const cerrar = () => {
    setClave("");
    alCerrar();
  };
  return (
    <Dialogo abierto={abierta} titulo={t.agregarComponente} onCerrar={cerrar}>
      <div className="flex flex-col gap-4">
        <Selector etiqueta={t.rotuloDeLaSeccionDeLaHoja} value={clave} onChange={(e) => setClave(e.target.value)}>
          <option value="">Elegí…</option>
          {paraAgregar.map((f) => (
            <option key={f.clave} value={f.clave}>
              {f.nombre}
              {f.apagada ? " (apagada)" : ""}
            </option>
          ))}
        </Selector>
        {fila !== null && <ParteDePromo key={fila.clave} fila={fila} productos={productos} guardar={guardar} alGuardar={cerrar} alCancelar={cerrar} />}
        {fila === null && (
          <Boton variante="secundario" tamano="tactil" onClick={cerrar}>
            {t.cancelar}
          </Boton>
        )}
      </div>
    </Dialogo>
  );
}

export function ComponentesDelCombo({
  componentes,
  paraAgregar,
  productos,
  puedeEditar,
  sinGuardar,
  guardar,
}: {
  componentes: ComponenteDeLaFicha[];
  paraAgregar: FilaDeParte[];
  productos: ProductoParaEntrada[];
  puedeEditar: boolean;
  sinGuardar: boolean;
  guardar: (comando: ComandoDeFila) => Promise<ResultadoAccion>;
}) {
  const t = textosDeLaPantallaDePromos(ARMADO_DE_PROMO_COMO_PEDERNAL);
  const [hojaAbierta, setHojaAbierta] = useState(false);
  return (
    <section aria-labelledby="titulo-que-lleva" className="flex flex-col gap-3" data-que-lleva>
      <h2 id="titulo-que-lleva" className="text-base font-semibold">
        {t.tituloDeLoQueLleva}
      </h2>
      {componentes.length === 0 ? (
        <p className="px-4 py-8 text-center">{t.sinComponentes}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {componentes.map((c) => (
            <TarjetaDeComponente key={`${c.clave}|${c.nombre}`} c={c} puedeEditar={puedeEditar} guardar={guardar} />
          ))}
        </ul>
      )}
      {puedeEditar && (
        <>
          <Boton variante="secundario" tamano="tactil" className="w-full" disabled={sinGuardar || paraAgregar.length === 0} onClick={() => setHojaAbierta(true)} data-agregar-componente>
            {t.agregarComponente}
          </Boton>
          <HojaDeComponente abierta={hojaAbierta} paraAgregar={paraAgregar} productos={productos} guardar={guardar} alCerrar={() => setHojaAbierta(false)} />
        </>
      )}
    </section>
  );
}
