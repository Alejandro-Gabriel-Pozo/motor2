"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { crearEnvioDirectoTransferencia } from "@/server/actions/traspasos/traspasos";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";

interface Opcion {
  id: string;
  nombre: string;
}

export function EnviarForm({
  sucursales,
  secciones,
  seccionesDesactivadas = [],
}: {
  sucursales: Opcion[];
  secciones: Opcion[];
  /** P17: secciones dadas de baja, que solo admiten sacar mercadería; enviar saca, así que se ofrecen como origen, al final y con la etiqueta «(desactivada)». */
  seccionesDesactivadas?: Opcion[];
}) {
  const router = useRouter();
  const [destinoSucursalId, setDestinoSucursalId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [seccionOrigenId, setSeccionOrigenId] = useState("");
  const [detalle, setDetalle] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const resultado = await crearEnvioDirectoTransferencia({
        destinoSucursalId,
        productoId,
        cantidad: numeroDelCampo(cantidad) ?? NaN,
        seccionOrigenId,
        detalle: detalle || undefined,
      });
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) {
        setProductoId("");
        setCantidad("");
        setDetalle("");
        setResetCount((n) => n + 1);
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Selector etiqueta="Sucursal a la que se lo mandás" value={destinoSucursalId} onChange={(e) => setDestinoSucursalId(e.target.value)} required>
        <option value="">Elegí una sucursal</option>
        {sucursales.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </Selector>

      <label className="flex flex-col gap-1 text-sm">
        Producto
        <SelectorProducto value={productoId} onChange={setProductoId} filtro={{ soloDisponibles: true }} limpiarSenal={resetCount} required />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Cantidad
        <CampoNumero tipo="cantidad" value={cantidad} onChange={setCantidad} required />
      </label>

      <Selector etiqueta="Sección propia de la que sale (se descuenta YA, al enviar)" value={seccionOrigenId} onChange={(e) => setSeccionOrigenId(e.target.value)} required>
        <option value="">Elegí una sección</option>
        {secciones.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
        {seccionesDesactivadas.map((s) => (
          <option key={s.id} value={s.id}>
            {`${s.nombre} (desactivada)`}
          </option>
        ))}
      </Selector>

      <Campo etiqueta="Detalle (opcional)" value={detalle} onChange={(e) => setDetalle(e.target.value)} />

      {mensaje && (
        <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}

      <Boton type="submit" disabled={pending} className="self-start">
        {pending ? "Enviando..." : "Enviar"}
      </Boton>
    </form>
  );
}
