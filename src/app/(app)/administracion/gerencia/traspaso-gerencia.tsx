"use client";

import { useState, useTransition } from "react";
import { transferirGerencia } from "@/server/actions/auth/usuarios";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Enlace } from "@/ui/primitivas/enlace";
import { Selector } from "@/ui/primitivas/selector";

interface Candidato {
  id: string;
  email: string;
  nombre: string | null;
}

export function TraspasoGerencia({ candidatos }: { candidatos: Candidato[] }) {
  const [destinoId, setDestinoId] = useState(candidatos[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pendiente, startTransition] = useTransition();

  if (resultado?.ok) {
    return (
      <div className="flex max-w-lg flex-col gap-2">
        <Aviso variante="exito" forma="en-linea">
          {resultado.mensaje}
        </Aviso>
        <p className="text-sm">
          Ya no sos el gerente de la empresa: la nueva gerencia es la única que puede volver a traspasarla.{" "}
          <Enlace href="/inicio">Ir al inicio</Enlace>
        </p>
      </div>
    );
  }

  if (candidatos.length === 0) {
    return <p className="text-sm">No hay ningún administrador activo a quien traspasar la gerencia. Primero asigná el rol de administrador a otra persona.</p>;
  }

  return (
    <form
      className="flex max-w-lg flex-col gap-3"
      aria-busy={pendiente || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (pendiente) return;
        setResultado(null);
        startTransition(async () => setResultado(await transferirGerencia(destinoId, email)));
      }}
    >
      <Selector etiqueta="Nuevo gerente" value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
        {candidatos.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre ? `${c.nombre} — ${c.email}` : c.email}
          </option>
        ))}
      </Selector>
      <Campo etiqueta="Para confirmar, escribí el email de esa persona" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
      <Boton type="submit" disabled={pendiente} className="self-start">
        Traspasar la gerencia
      </Boton>
      {pendiente && (
        <Aviso variante="informacion" forma="en-linea">
          Traspasando…
        </Aviso>
      )}
      {resultado && !resultado.ok && (
        <Aviso variante="error" forma="en-linea">
          {resultado.mensaje}
        </Aviso>
      )}
    </form>
  );
}
