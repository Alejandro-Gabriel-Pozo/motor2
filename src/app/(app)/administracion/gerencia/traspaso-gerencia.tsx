"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { transferirGerencia } from "@/server/actions/auth/usuarios";
import type { ResultadoAccion } from "@/server/actions/tipos";

interface Candidato {
  id: string;
  email: string;
  nombre: string | null;
}

export function TraspasoGerencia({ candidatos }: { candidatos: Candidato[] }) {
  const idDestino = useId();
  const idEmail = useId();
  const [destinoId, setDestinoId] = useState(candidatos[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pendiente, startTransition] = useTransition();

  if (resultado?.ok) {
    return (
      <div className="flex max-w-lg flex-col gap-2">
        <p role="status" className="text-sm text-green-700">
          {resultado.mensaje}
        </p>
        <p className="text-sm">
          Ya no sos el gerente de la empresa: la nueva gerencia es la única que puede volver a traspasarla.{" "}
          <Link href="/inicio" className="underline">
            Ir al inicio
          </Link>
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
      <div className="flex flex-col gap-1">
        <label htmlFor={idDestino} className="text-sm font-medium">
          Nuevo gerente
        </label>
        <select id={idDestino} value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className="rounded border px-3 py-2">
          {candidatos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre ? `${c.nombre} — ${c.email}` : c.email}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={idEmail} className="text-sm font-medium">
          Para confirmar, escribí el email de esa persona
        </label>
        <input id={idEmail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required className="rounded border px-3 py-2" />
      </div>
      <button type="submit" disabled={pendiente} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60">
        Traspasar la gerencia
      </button>
      {pendiente && (
        <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
          Traspasando…
        </p>
      )}
      {resultado && !resultado.ok && (
        <p role="alert" className="text-sm text-red-600">
          {resultado.mensaje}
        </p>
      )}
    </form>
  );
}
