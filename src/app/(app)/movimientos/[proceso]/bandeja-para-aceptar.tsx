"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { aceptarPropuestaDeFactura, confirmarRecepcionDeFactura, registrarControlDeRecepcion } from "@/server/actions/movimientos/facturas-proveedor";
import { ZONA_ARGENTINA, mediodiaDelDia } from "@/core/tiempo/zona-horaria";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { formatearCantidad } from "@/core/formato-de-numero";
import {
  ETIQUETA_DE_CONDICION_DE_CONTROL,
  LARGO_MAXIMO_DE_LA_OBSERVACION,
  bloqueoPorFaltaDeDeposito,
  ordenarSeccionesPorNombre,
  seccionPropuestaParaUso,
  usoPropuestoPorElControl,
  type CondicionDeControl,
  type UsoDeSeccion,
} from "@/core/compras/public";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";

/**
 * E3a (ADR-041): «Para aceptar», las partes de facturas de proveedor que otra sucursal compró para ESTA sucursal. Muestra solo productos y cantidades (decisión del dueño, 2026-10-28: nada de importes ni de
 * partes de otras sucursales). Al aceptar se elige la sección y la fecha de stock (por defecto la de la factura; entre esa fecha y hoy): recién ahí entran el stock, el costo y el gasto de esta sucursal.
 */
export interface PropuestaVista {
  id: string;
  proveedorNombre: string;
  nroFactura: string | null;
  /** Día de la factura (AAAA-MM-DD, hora argentina). */
  diaFactura: string;
  origenNombre: string;
  /** Días desde que la propusieron. */
  antiguedadDias: number;
  renglones: { productoNombre: string; unidadNombre: string; cantidadStock: number }[];
}

function TarjetaDePropuesta({ propuesta, secciones }: { propuesta: PropuestaVista; secciones: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [seccionId, setSeccionId] = useState(secciones[0]?.id ?? "");
  const [dia, setDia] = useState(propuesta.diaFactura);
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const aceptar = () =>
    startTransition(async () => {
      const r = await aceptarPropuestaDeFactura(propuesta.id, seccionId, mediodiaDelDia(dia, ZONA_ARGENTINA), clave);
      setMensaje({ ok: r.ok, texto: r.mensaje });
      if (r.ok) {
        setClave(crypto.randomUUID());
        router.refresh();
      }
    });

  return (
    <li className="flex flex-col gap-2 rounded border p-3" data-testid="propuesta-para-aceptar">
      <p className="text-sm">
        <strong>{propuesta.proveedorNombre}</strong>
        {propuesta.nroFactura ? ` · Factura ${propuesta.nroFactura}` : ""} · del {propuesta.diaFactura} · la compró «{propuesta.origenNombre}»
        {propuesta.antiguedadDias > 0 ? ` · hace ${propuesta.antiguedadDias} día(s)` : " · hoy"}
      </p>
      <ul className="list-disc pl-5 text-sm">
        {propuesta.renglones.map((r, i) => (
          <li key={i}>
            {r.productoNombre}: {formatearCantidad(r.cantidadStock)} {r.unidadNombre}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-52">
          <Selector etiqueta="Depósito" tamano="compacto" value={seccionId} onChange={(e) => setSeccionId(e.target.value)}>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Selector>
        </div>
        <div className="w-44">
          <CampoFecha etiqueta="Fecha de stock" tamano="compacto" value={dia} onChange={(e) => setDia(e.target.value)} />
        </div>
        <Boton tamano="compacto" onClick={aceptar} disabled={pending || !seccionId}>
          {pending ? "Aceptando..." : "Aceptar"}
        </Boton>
      </div>
      {mensaje && (
        <Aviso variante={mensaje.ok ? "exito" : "error"} forma="en-linea">
          {mensaje.texto}
        </Aviso>
      )}
    </li>
  );
}

export function BandejaParaAceptar({ propuestas, secciones }: { propuestas: PropuestaVista[]; secciones: { id: string; nombre: string }[] }) {
  if (!propuestas.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="titulo-para-aceptar">
      <h2 id="titulo-para-aceptar" className="text-lg font-semibold">
        Para aceptar ({propuestas.length})
      </h2>
      <p className="text-xs text-tinta-tenue">Mercadería que otra sucursal compró para esta. Hasta que la aceptes no cuenta en el stock ni en el gasto de esta sucursal.</p>
      <ul className="flex flex-col gap-2">
        {propuestas.map((p) => (
          <TarjetaDePropuesta key={p.id} propuesta={p} secciones={secciones} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Compras, recepción separada (N3-a y N3-b): una compra cargada «pendiente de recibir» (módulo `recepcion_de_compras` encendido): todavía no entró al stock. Sin importes. Cada renglón de mercadería muestra su producto y su cantidad y tiene dos cosas:
 *  - el CONTROL (Conforme / Con observaciones / Rechazada, con su observación y, si se quiere, la cantidad según remito): lo ve y lo guarda quien tiene `compra_controlar_recepcion` (quien recibe, el operador también). Una línea sin control queda
 *    «No se constató»; un control guardado no se cambia. NO cambia cuánto stock entra: una línea rechazada entra igual.
 *  - la SECCIÓN (depósito) donde entra ENTERO el renglón (un solo destino por renglón): la ve quien tiene `compra_recibir` (gerente o administrador), junto con el botón de confirmar: recién ahí entran el stock, el costo y el gasto, con la
 *    fecha de la confirmación (no se elige). Si la compra ya estaba recibida (otra persona la confirmó antes), se avisa como información y no se carga stock de nuevo.
 */
export interface RenglonPorRecibirVista {
  renglonId: string;
  productoNombre: string;
  unidadNombre: string;
  cantidadStock: number;
  /** El control ya registrado (`null` = «no se constató»). */
  control: { condicion: string; observacion: string | null; cantidadSegunRemito: number | null } | null;
}

export interface CompraPorRecibirVista {
  facturaId: string;
  proveedorNombre: string;
  nroFactura: string | null;
  /** Día de la factura (AAAA-MM-DD, hora argentina). */
  diaFactura: string;
  cantidadDeRenglones: number;
  /** Días desde que se cargó. */
  antiguedadDias: number;
  renglones: RenglonPorRecibirVista[];
}

/** Una sección ACTIVA de la sucursal con su uso (la lista de la pantalla trae solo las activas). */
type Seccion = { id: string; nombre: string; uso: UsoDeSeccion };
const comoActivas = (secciones: readonly Seccion[]) => secciones.map((s) => ({ ...s, activa: true }));
type ControlEditable = { condicion: string; observacion: string; cantidadSegunRemito: string };

const OPCIONES_DE_CONTROL = [
  { valor: "", texto: "No se constató" },
  { valor: "CONFORME", texto: ETIQUETA_DE_CONDICION_DE_CONTROL.CONFORME },
  { valor: "CON_OBSERVACIONES", texto: ETIQUETA_DE_CONDICION_DE_CONTROL.CON_OBSERVACIONES },
  { valor: "RECHAZADA", texto: ETIQUETA_DE_CONDICION_DE_CONTROL.RECHAZADA },
] as const;

const textoDeCantidad = (n: number) => String(n).replace(".", ",");
const numeroDeCantidad = (t: string): number => {
  const r = numeroDelCampo(t.trim().replace(",", "."));
  return r === undefined ? Number.NaN : r;
};

function textoDelControl(c: NonNullable<RenglonPorRecibirVista["control"]>): string {
  const etiqueta = ETIQUETA_DE_CONDICION_DE_CONTROL[c.condicion as keyof typeof ETIQUETA_DE_CONDICION_DE_CONTROL] ?? c.condicion;
  return `${etiqueta}${c.observacion ? `: ${c.observacion}` : ""}${c.cantidadSegunRemito !== null ? ` · según remito: ${textoDeCantidad(c.cantidadSegunRemito)}` : ""}`;
}

/** El control GUARDADO de un renglón como condición (`null` = «no se constató»): es el que usa el servidor para proponer el destino; lo que se está tipeando y todavía no se guardó no cuenta. */
const condicionGuardada = (r: RenglonPorRecibirVista): CondicionDeControl | null =>
  r.control && r.control.condicion in ETIQUETA_DE_CONDICION_DE_CONTROL ? (r.control.condicion as CondicionDeControl) : null;

function TarjetaDeCompraPorRecibir({ compra, secciones, puedeControlar, puedeConfirmar }: { compra: CompraPorRecibirVista; secciones: Seccion[]; puedeControlar: boolean; puedeConfirmar: boolean }) {
  const router = useRouter();
  const primeraSeccion = ordenarSeccionesPorNombre(secciones)[0]?.id ?? "";
  // Solo lo que la persona cambió a mano: lo demás sigue a la sección propuesta por el control (que cambia al guardar un control nuevo).
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const propuestaDe = (r: RenglonPorRecibirVista): string | null => seccionPropuestaParaUso(usoPropuestoPorElControl(condicionGuardada(r)), comoActivas(secciones))?.id ?? null;
  const destinoDe = (r: RenglonPorRecibirVista): string => elegidos[r.renglonId] ?? propuestaDe(r) ?? primeraSeccion;
  const bloqueo = bloqueoPorFaltaDeDeposito(compra.renglones.map(condicionGuardada), comoActivas(secciones));
  const [controles, setControles] = useState<Record<string, ControlEditable>>({});
  const [mensaje, setMensaje] = useState<{ variante: "exito" | "error" | "informacion"; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const cambiarControl = (renglonId: string, cambio: Partial<ControlEditable>) =>
    setControles((c) => ({ ...c, [renglonId]: { ...(c[renglonId] ?? { condicion: "", observacion: "", cantidadSegunRemito: "" }), ...cambio } }));

  const entradasParaEnviar = compra.renglones.map((r) => ({ renglonId: r.renglonId, seccionId: destinoDe(r) }));
  const controlesParaGuardar = compra.renglones
    .filter((r) => r.control === null && (controles[r.renglonId]?.condicion ?? "") !== "")
    .map((r) => {
      const c = controles[r.renglonId]!;
      return {
        renglonId: r.renglonId,
        condicion: c.condicion as CondicionDeControl,
        observacion: c.observacion.trim() === "" ? null : c.observacion,
        cantidadSegunRemito: c.cantidadSegunRemito.trim() === "" ? null : numeroDeCantidad(c.cantidadSegunRemito),
      };
    });

  const guardarControl = () =>
    startTransition(async () => {
      const r = await registrarControlDeRecepcion(compra.facturaId, controlesParaGuardar);
      setMensaje({ variante: r.ok ? "exito" : "error", texto: r.mensaje });
      router.refresh();
    });
  const confirmar = () =>
    startTransition(async () => {
      const r = await confirmarRecepcionDeFactura(compra.facturaId, entradasParaEnviar);
      // «Ya estaba recibida» (otra persona la confirmó antes) es información, no un error ni una recepción nueva.
      setMensaje({ variante: !r.ok ? "error" : r.yaExistia ? "informacion" : "exito", texto: r.mensaje });
      // Con éxito la compra sale de la lista (ya no está pendiente); si ya estaba recibida o anulada, también: se refresca para verlo.
      router.refresh();
    });

  return (
    <li className="flex flex-col gap-2 rounded border p-3" data-testid="compra-por-recibir">
      <p className="text-sm">
        <strong>{compra.proveedorNombre}</strong>
        {compra.nroFactura ? ` · Factura ${compra.nroFactura}` : ""} · del {compra.diaFactura} · {compra.cantidadDeRenglones} renglón(es)
        {compra.antiguedadDias > 0 ? ` · cargada hace ${compra.antiguedadDias} día(s)` : " · cargada hoy"}
      </p>
      <ul className="flex flex-col gap-2">
        {compra.renglones.map((r) => {
          const control = controles[r.renglonId] ?? { condicion: "", observacion: "", cantidadSegunRemito: "" };
          return (
            <li key={r.renglonId} className="flex flex-col gap-2 rounded border p-2" data-testid="renglon-por-recibir">
              <p className="text-sm">
                <strong>{r.productoNombre}</strong> · {formatearCantidad(r.cantidadStock)} {r.unidadNombre}
              </p>
              {puedeControlar && r.control !== null && (
                <p className="text-xs text-tinta-tenue" data-testid="control-registrado">
                  Control: {textoDelControl(r.control)}
                </p>
              )}
              {puedeControlar && r.control === null && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-48">
                    <Selector etiqueta="Control" tamano="compacto" value={control.condicion} onChange={(e) => cambiarControl(r.renglonId, { condicion: e.target.value })}>
                      {OPCIONES_DE_CONTROL.map((o) => (
                        <option key={o.valor} value={o.valor}>
                          {o.texto}
                        </option>
                      ))}
                    </Selector>
                  </div>
                  {control.condicion !== "" && (
                    <>
                      <div className="w-64">
                        <Campo
                          etiqueta="Observación"
                          tamano="compacto"
                          value={control.observacion}
                          maxLength={LARGO_MAXIMO_DE_LA_OBSERVACION}
                          required={control.condicion !== "CONFORME"}
                          onChange={(e) => cambiarControl(r.renglonId, { observacion: e.target.value })}
                        />
                      </div>
                      <div className="w-44">
                        <Campo
                          etiqueta="Cantidad según remito (opcional)"
                          tamano="compacto"
                         
                          value={control.cantidadSegunRemito}
                          onChange={(e) => cambiarControl(r.renglonId, { cantidadSegunRemito: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
              {puedeConfirmar && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-52">
                    <Selector etiqueta="Depósito" tamano="compacto" value={destinoDe(r)} onChange={(e) => setElegidos((d) => ({ ...d, [r.renglonId]: e.target.value }))}>
                      {secciones.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nombre}
                        </option>
                      ))}
                    </Selector>
                  </div>
                  <p className="pb-2 text-xs text-tinta-tenue" data-testid="destino-propuesto">
                    {propuestaDe(r) ? `Propuesto por el control: ${secciones.find((s) => s.id === propuestaDe(r))?.nombre ?? ""}` : ""}
                    {destinoDe(r) !== propuestaDe(r) && (
                      <strong data-testid="destino-cambiado">
                        {propuestaDe(r) ? " · " : ""}cambiado
                      </strong>
                    )}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {puedeControlar && (
        <div>
          <Boton tamano="compacto" variante="secundario" onClick={guardarControl} disabled={pending || controlesParaGuardar.length === 0}>
            {pending ? "Guardando..." : "Guardar control"}
          </Boton>
        </div>
      )}
      {puedeConfirmar && (
        <div>
          <Boton tamano="compacto" onClick={confirmar} disabled={pending || bloqueo !== null || entradasParaEnviar.some((e) => !e.seccionId)}>
            {pending ? "Confirmando..." : "Confirmar recepción"}
          </Boton>
        </div>
      )}
      {puedeConfirmar && bloqueo && (
        <Aviso variante="error" forma="en-linea" data-testid="bloqueo-por-falta-de-deposito">
          {bloqueo.mensaje}
        </Aviso>
      )}
      {mensaje && (
        <Aviso variante={mensaje.variante} forma="en-linea">
          {mensaje.texto}
        </Aviso>
      )}
    </li>
  );
}

export function BandejaPorRecibir({
  compras,
  secciones,
  puedeControlar,
  puedeConfirmar,
}: {
  compras: CompraPorRecibirVista[];
  secciones: Seccion[];
  puedeControlar: boolean;
  puedeConfirmar: boolean;
}) {
  if (!compras.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="titulo-por-recibir">
      <h2 id="titulo-por-recibir" className="text-lg font-semibold">
        Por recibir ({compras.length})
      </h2>
      <p className="text-xs text-tinta-tenue">
        Compras cargadas que todavía no entraron al stock.
        {puedeControlar ? " Controlá cómo llegó cada línea y guardá el control." : ""}
        {puedeConfirmar ? " Confirmá la recepción cuando llegue la mercadería: ahí entra al depósito que elijas (el control propone uno: la mercadería rechazada va al depósito de rechazo y la que tiene observaciones, al de cuarentena)." : ""}
      </p>
      <ul className="flex flex-col gap-2">
        {compras.map((c) => (
          <TarjetaDeCompraPorRecibir key={c.facturaId} compra={c} secciones={secciones} puedeControlar={puedeControlar} puedeConfirmar={puedeConfirmar} />
        ))}
      </ul>
    </section>
  );
}
