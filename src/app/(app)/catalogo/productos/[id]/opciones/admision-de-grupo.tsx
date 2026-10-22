"use client";

import { useState } from "react";
import { LecturaDePrecio } from "@/components/catalogo/lectura-de-precio";
import { CampoNumero } from "@/components/campo-numero";
import { FormConResultado } from "@/components/form-con-resultado";
import { interpretarNumero } from "@/core/datos/numero-tecleado";
import {
  leerPrecioDeFilaDeAdmision,
  nombreDelTipoDeGrupo,
  textoDeDiferencia,
  textoDeLimites,
  type DiferenciaDePrecio,
  type ModoDePrecioDeMedida,
  type ReferenciaDePrecio,
  type TipoDeGrupoDeOpciones,
} from "@/core/opciones/public";
import { formatearMonto } from "@/core/pos/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { LecturaEnVivo } from "@/ui/componentes/datos/lectura-en-vivo";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";
import { Selector } from "@/ui/primitivas/selector";

export interface OpcionDeLaAdmision {
  opcionId: string;
  nombre: string;
  activaEnEmpresa: boolean;
  esNinguna: boolean;
  diferenciaDeLaOpcion: DiferenciaDePrecio | null;
  fila: { version: number; cantidadMaxima: number; precioAbsoluto: number | null; diferencia: DiferenciaDePrecio | null; activo: boolean } | null;
}

export interface GrupoDeLaAdmision {
  grupoId: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  activoEnEmpresa: boolean;
  cantidadMinimaDelGrupo: number;
  cantidadMaximaDelGrupo: number;
  fila: { version: number; orden: number; cantidadMinima: number | null; cantidadMaxima: number | null; modoPrecio: ModoDePrecioDeMedida | null; activo: boolean };
  opciones: OpcionDeLaAdmision[];
}

/** Cómo se cobra cada opción en ESTE producto: la diferencia de la opción, una propia (monto o porcentaje) o, en un tamaño con precio propio, su precio. */
type Precio = "DE_LA_OPCION" | "MONTO" | "PORCENTAJE";

interface Fila {
  opcionId: string;
  versionEsperada: number;
  admitida: boolean;
  tope: string;
  precioAbsoluto: string;
  precio: Precio;
  valor: string;
}

/**
 * Lo que admite un producto de UN grupo EN USO (GO-2d; quitarlo es «Quitar de este producto», OPCIONES-LIMPIEZA): en qué orden, sus límites propios (vacío = los del grupo), el modo de precio de un tamaño («Precio propio por tamaño» o
 * «Diferencia sobre el precio base», obligatorio) y, por opción, si la admite, su tope, su precio propio (en un tamaño con precio propio) o una diferencia propia (vacía = la de la
 * opción, que se muestra). Cada grupo guarda por separado, con la versión de sus filas que vio la pantalla: si otra persona cambió algo, el servidor lo rechaza y aparece «Recargar»
 * (lo tipeado no se pierde hasta recargar). Las reglas las valida el servidor (`validarAdmisionDeGrupo` y el control de precio de lista).
 *
 * Fase 6 (6.15a): con las primitivas del sistema (`OpcionesExcluyentes`, `Campo`, `Selector`, `Casilla`, `Boton`) y, debajo del importe de cada opción, la LECTURA del precio («Napolitana con Trucha =
 * $ 25.000 + $ 3.000 = $ 28.000»; `leerPrecioDeFilaDeAdmision`, que compone con el mismo compositor que la venta). `referencia` es lo más barato GUARDADO del grupo que fija el precio del producto y
 * `precioDeLista` el precio que se cobra si no hay referencia (`null`: un producto que se vende por opción y todavía no tiene precio final: ahí no se lee lo que suma). El formulario sigue mandando los
 * mismos campos que lee `admision-del-formulario.ts` (`orden`, `cantidadMinima`, `cantidadMaxima`, `modoPrecio`, `activo` y `opciones`); los dos últimos se agregan al enviar, sin `<input type="hidden">`.
 */
export function AdmisionDeGrupo({
  grupo,
  accion,
  referencia,
  precioDeLista,
}: {
  grupo: GrupoDeLaAdmision;
  accion: (formData: FormData) => Promise<ResultadoAccion>;
  referencia: ReferenciaDePrecio | null;
  precioDeLista: number | null;
}) {
  const esTamano = grupo.tipo === "MEDIDA";
  const conDiferencia = grupo.tipo === "MEDIDA" || grupo.tipo === "VARIANTE" || grupo.tipo === "ADICIONAL";
  const conTope = grupo.tipo === "ADICIONAL" || (!esTamano && grupo.cantidadMaximaDelGrupo > 1);
  const [modo, setModo] = useState<ModoDePrecioDeMedida | "">(grupo.fila.modoPrecio ?? "");
  const [filas, setFilas] = useState<Fila[]>(() =>
    grupo.opciones.map((o) => ({
      opcionId: o.opcionId,
      versionEsperada: o.fila?.version ?? 0,
      admitida: o.fila?.activo ?? false,
      tope: String(o.fila?.cantidadMaxima ?? 1),
      precioAbsoluto: o.fila?.precioAbsoluto != null ? String(o.fila.precioAbsoluto) : "",
      precio: o.fila?.diferencia ? o.fila.diferencia.tipo : "DE_LA_OPCION",
      valor: o.fila?.diferencia ? String(o.fila.diferencia.tipo === "MONTO" ? o.fila.diferencia.monto : o.fila.diferencia.porcentaje) : "",
    }))
  );
  const cambiar = (opcionId: string, parcial: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.opcionId === opcionId ? { ...f, ...parcial } : f)));
  const numero = (t: string) => {
    const r = interpretarNumero(t);
    return r.ok ? r.valor : Number.NaN;
  };
  const absoluto = esTamano && modo === "ABSOLUTO";
  // Solo viajan las opciones que el producto ya tiene (activas o no) o que se acaban de marcar: una opción que nunca se admitió y sigue sin marcar no crea fila.
  const opciones = filas
    .filter((f) => f.versionEsperada > 0 || f.admitida)
    .map((f) => ({
      opcionId: f.opcionId,
      versionEsperada: f.versionEsperada,
      cantidadMaxima: esTamano ? 1 : numero(f.tope),
      precioAbsoluto: absoluto && f.precioAbsoluto.trim() !== "" ? numero(f.precioAbsoluto) : null,
      diferencia: absoluto || !conDiferencia || f.precio === "DE_LA_OPCION" ? null : f.precio === "MONTO" ? { tipo: "MONTO", monto: numero(f.valor) } : { tipo: "PORCENTAJE", porcentaje: numero(f.valor) },
      activo: f.admitida,
    }));

  // OPCIONES-LIMPIEZA: el formulario es el de un grupo EN USO (`activo` = «on»; sacarlo es «Quitar de este producto», con «Deshacer», al pie de la tarjeta). Las opciones viajan como JSON.
  const enviar = (formData: FormData) => {
    formData.set("opciones", JSON.stringify(opciones));
    formData.set("activo", "on");
    return accion(formData);
  };

  return (
    <FormConResultado ofrecerRecargar accion={enviar} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-medium">{grupo.nombre}</h3>
        <span className="text-sm text-tinta-suave">
          {nombreDelTipoDeGrupo(grupo.tipo)} · del grupo: {textoDeLimites(grupo.cantidadMinimaDelGrupo, grupo.cantidadMaximaDelGrupo)}
          {grupo.activoEnEmpresa ? "" : " · archivado: no se ofrece"}
        </span>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="w-44">
          <Campo etiqueta="Orden en el producto" name="orden" inputMode="numeric" defaultValue={grupo.fila.orden} />
        </div>
        {!esTamano && (
          <>
            <div className="w-44">
              <Campo etiqueta="Mínimo en este producto" name="cantidadMinima" inputMode="numeric" defaultValue={grupo.fila.cantidadMinima ?? ""} placeholder={`del grupo: ${grupo.cantidadMinimaDelGrupo}`} />
            </div>
            <div className="w-44">
              <Campo etiqueta="Máximo en este producto" name="cantidadMaxima" inputMode="numeric" defaultValue={grupo.fila.cantidadMaxima ?? ""} placeholder={`del grupo: ${grupo.cantidadMaximaDelGrupo}`} />
            </div>
          </>
        )}
      </div>
      {esTamano && (
        <OpcionesExcluyentes
          leyenda="Cómo se cobra el tamaño en este producto"
          nombre="modoPrecio"
          valorInicial={modo}
          alCambiar={(valor) => setModo(valor === "ABSOLUTO" ? "ABSOLUTO" : "DIFERENCIA")}
          opciones={[
            { valor: "ABSOLUTO", etiqueta: "Precio propio por tamaño" },
            { valor: "DIFERENCIA", etiqueta: "Diferencia sobre el precio base" },
          ]}
        />
      )}
      <table className="w-full text-sm">
        <caption className="sr-only">Opciones de {grupo.nombre} en este producto</caption>
        <thead>
          <tr className="border-b text-left text-tinta-suave">
            <th scope="col" className="py-2 pr-2 font-medium">
              Opción
            </th>
            {conTope && (
              <th scope="col" className="pr-2 font-medium">
                Tope
              </th>
            )}
            {(absoluto || conDiferencia) && (
              <th scope="col" className="font-medium">
                Precio en este producto
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {grupo.opciones.map((o) => {
            const f = filas.find((x) => x.opcionId === o.opcionId)!;
            const base = `${grupo.grupoId}-${o.opcionId}`;
            // La lectura del precio de ESTA fila (null = no hay nada que leer): su región queda siempre en el árbol para que el lector de pantalla anuncie el cambio al tipear.
            const lectura = leerPrecioDeFilaDeAdmision({
              tipoDeGrupo: grupo.tipo,
              modoPrecio: modo === "" ? null : modo,
              opcion: { nombre: o.nombre, esNinguna: o.esNinguna, diferenciaDeLaOpcion: o.diferenciaDeLaOpcion },
              admitida: f.admitida,
              precio: f.precio,
              precioAbsoluto: f.precioAbsoluto,
              valor: f.valor,
              precioDeLista,
              referencia,
            });
            const leida = lectura ? <LecturaDePrecio lectura={lectura} /> : <LecturaEnVivo />;
            return (
              <tr key={o.opcionId} className="border-b align-top last:border-0" data-admision-opcion={o.nombre}>
                <td className="py-2 pr-2">
                  <Casilla
                    checked={f.admitida}
                    onChange={(e) => cambiar(o.opcionId, { admitida: e.target.checked })}
                    etiqueta={
                      <span>
                        {o.nombre}
                        {o.esNinguna && " (ninguna)"}
                        {!o.activaEnEmpresa && " (archivada)"}
                      </span>
                    }
                  />
                </td>
                {conTope && (
                  <td className="py-2 pr-2">
                    <div className="w-20">
                      <Campo etiqueta={`Tope de ${o.nombre}`} etiquetaOculta tamano="compacto" inputMode="numeric" value={f.tope} onChange={(e) => cambiar(o.opcionId, { tope: e.target.value })} />
                    </div>
                  </td>
                )}
                {absoluto ? (
                  <td className="py-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${base}-precio`} className="sr-only">
                        Precio de {o.nombre} en este producto
                      </label>
                      <CampoNumero id={`${base}-precio`} value={f.precioAbsoluto} onChange={(v) => cambiar(o.opcionId, { precioAbsoluto: v })} prefijo="$" tipo="importe" etiqueta={`El precio de ${o.nombre}`} tamano="compacto" className="w-36" />
                      {leida}
                    </div>
                  </td>
                ) : conDiferencia && !o.esNinguna ? (
                  <td className="py-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Selector etiqueta={`Cómo se cobra ${o.nombre} en este producto`} etiquetaOculta tamano="compacto" value={f.precio} onChange={(e) => cambiar(o.opcionId, { precio: e.target.value as Precio })}>
                          <option value="DE_LA_OPCION">La de la opción ({textoDeDiferencia(o.diferenciaDeLaOpcion, formatearMonto)})</option>
                          <option value="MONTO">Otro monto</option>
                          {grupo.tipo !== "ADICIONAL" && <option value="PORCENTAJE">Otro porcentaje</option>}
                        </Selector>
                        {f.precio !== "DE_LA_OPCION" && (
                          <>
                            <label htmlFor={`${base}-valor`} className="sr-only">
                              {f.precio === "MONTO" ? `Diferencia en pesos de ${o.nombre}` : `Diferencia en porcentaje de ${o.nombre}`}
                            </label>
                            <CampoNumero
                              id={`${base}-valor`}
                              value={f.valor}
                              onChange={(v) => cambiar(o.opcionId, { valor: v })}
                              prefijo={f.precio === "MONTO" ? "$" : undefined}
                              tipo={f.precio === "MONTO" ? "importe" : undefined}
                              permitirNegativo={grupo.tipo !== "ADICIONAL"}
                              etiqueta="La diferencia"
                              tamano="compacto"
                              className="w-28"
                            />
                            {f.precio === "PORCENTAJE" && <span>%</span>}
                          </>
                        )}
                      </div>
                      {leida}
                    </div>
                  </td>
                ) : (absoluto || conDiferencia) ? (
                  <td className="py-2 text-tinta-suave">Sin recargo</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <Boton type="submit" className="self-start">
        Guardar «{grupo.nombre}»
      </Boton>
    </FormConResultado>
  );
}
