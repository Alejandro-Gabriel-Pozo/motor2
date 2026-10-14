"use client";

import { useId, useState } from "react";
import { CampoNumero } from "@/components/campo-numero";
import { FormConResultado } from "@/components/form-con-resultado";
import { interpretarNumero } from "@/core/datos/numero-tecleado";
import { nombreDelTipoDeGrupo, textoDeDiferencia, textoDeLimites, type DiferenciaDePrecio, type ModoDePrecioDeMedida, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import { formatearMonto } from "@/core/pos/public";
import type { ResultadoAccion } from "@/server/actions/tipos";

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
 * Lo que admite un producto de UN grupo (GO-2d): si lo usa, en qué orden, sus límites propios (vacío = los del grupo), el modo de precio de un tamaño («Precio propio por tamaño» o
 * «Diferencia sobre el precio base», obligatorio) y, por opción, si la admite, su tope, su precio propio (en un tamaño con precio propio) o una diferencia propia (vacía = la de la
 * opción, que se muestra). Cada grupo guarda por separado, con la versión de sus filas que vio la pantalla: si otra persona cambió algo, el servidor lo rechaza y aparece «Recargar»
 * (lo tipeado no se pierde hasta recargar). Las reglas las valida el servidor (`validarAdmisionDeGrupo` y el control de precio de lista).
 */
export function AdmisionDeGrupo({ grupo, accion }: { grupo: GrupoDeLaAdmision; accion: (formData: FormData) => Promise<ResultadoAccion> }) {
  const id = useId();
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

  return (
    <FormConResultado ofrecerRecargar accion={accion} className="flex flex-col gap-3">
      <input type="hidden" name="opciones" value={JSON.stringify(opciones)} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">{grupo.nombre}</h2>
        <span className="text-sm text-neutral-600 dark:text-neutral-400">
          {nombreDelTipoDeGrupo(grupo.tipo)} · del grupo: {textoDeLimites(grupo.cantidadMinimaDelGrupo, grupo.cantidadMaximaDelGrupo)}
          {grupo.activoEnEmpresa ? "" : " · apagado para toda la empresa"}
        </span>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" name="activo" defaultChecked={grupo.fila.activo} />
        Este producto usa este grupo
      </label>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-orden`} className="text-sm font-medium">
            Orden en el producto
          </label>
          <input id={`${id}-orden`} name="orden" inputMode="numeric" defaultValue={grupo.fila.orden} className="w-24 rounded border px-3 py-2" />
        </div>
        {!esTamano && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-minimo`} className="text-sm font-medium">
                Mínimo en este producto
              </label>
              <input id={`${id}-minimo`} name="cantidadMinima" inputMode="numeric" defaultValue={grupo.fila.cantidadMinima ?? ""} placeholder={`del grupo: ${grupo.cantidadMinimaDelGrupo}`} className="w-32 rounded border px-3 py-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-maximo`} className="text-sm font-medium">
                Máximo en este producto
              </label>
              <input id={`${id}-maximo`} name="cantidadMaxima" inputMode="numeric" defaultValue={grupo.fila.cantidadMaxima ?? ""} placeholder={`del grupo: ${grupo.cantidadMaximaDelGrupo}`} className="w-32 rounded border px-3 py-2" />
            </div>
          </>
        )}
      </div>
      {esTamano && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Cómo se cobra el tamaño en este producto</legend>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="radio" name="modoPrecio" value="ABSOLUTO" checked={modo === "ABSOLUTO"} onChange={() => setModo("ABSOLUTO")} required />
            Precio propio por tamaño
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="radio" name="modoPrecio" value="DIFERENCIA" checked={modo === "DIFERENCIA"} onChange={() => setModo("DIFERENCIA")} />
            Diferencia sobre el precio base
          </label>
        </fieldset>
      )}
      <table className="w-full text-sm">
        <caption className="sr-only">Opciones de {grupo.nombre} en este producto</caption>
        <thead>
          <tr className="border-b text-left text-neutral-600 dark:text-neutral-400">
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
            const base = `${id}-${o.opcionId}`;
            return (
              <tr key={o.opcionId} className="border-b align-top last:border-0" data-admision-opcion={o.nombre}>
                <td className="py-2 pr-2">
                  <label className="flex min-h-[44px] items-center gap-2">
                    <input type="checkbox" checked={f.admitida} onChange={(e) => cambiar(o.opcionId, { admitida: e.target.checked })} />
                    <span>
                      {o.nombre}
                      {o.esNinguna && " (ninguna)"}
                      {!o.activaEnEmpresa && " (apagada para la empresa)"}
                    </span>
                  </label>
                </td>
                {conTope && (
                  <td className="py-2 pr-2">
                    <label htmlFor={`${base}-tope`} className="sr-only">
                      Tope de {o.nombre}
                    </label>
                    <input id={`${base}-tope`} inputMode="numeric" value={f.tope} onChange={(e) => cambiar(o.opcionId, { tope: e.target.value })} className="w-16 rounded border px-2 py-1" />
                  </td>
                )}
                {absoluto ? (
                  <td className="py-2">
                    <label htmlFor={`${base}-precio`} className="sr-only">
                      Precio de {o.nombre} en este producto
                    </label>
                    <CampoNumero id={`${base}-precio`} value={f.precioAbsoluto} onChange={(v) => cambiar(o.opcionId, { precioAbsoluto: v })} prefijo="$" tipo="importe" etiqueta={`El precio de ${o.nombre}`} tamano="compacto" className="w-36" />
                  </td>
                ) : conDiferencia && !o.esNinguna ? (
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`${base}-modo`} className="sr-only">
                        Cómo se cobra {o.nombre} en este producto
                      </label>
                      <select id={`${base}-modo`} value={f.precio} onChange={(e) => cambiar(o.opcionId, { precio: e.target.value as Precio })} className="rounded border px-2 py-1">
                        <option value="DE_LA_OPCION">La de la opción ({textoDeDiferencia(o.diferenciaDeLaOpcion, formatearMonto)})</option>
                        <option value="MONTO">Otro monto</option>
                        {grupo.tipo !== "ADICIONAL" && <option value="PORCENTAJE">Otro porcentaje</option>}
                      </select>
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
                  </td>
                ) : (absoluto || conDiferencia) ? (
                  <td className="py-2 text-neutral-600 dark:text-neutral-400">Sin recargo</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="submit" className="self-start rounded bg-neutral-900 px-4 py-2 text-white">
        Guardar «{grupo.nombre}»
      </button>
    </FormConResultado>
  );
}
