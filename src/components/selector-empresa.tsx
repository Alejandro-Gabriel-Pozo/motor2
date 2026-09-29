"use client";

import { useTransition } from "react";
import type { EmpresaDelUsuario } from "@/core/auth/contexto";
import { cambiarEmpresaActiva } from "@/server/actions/auth/empresa-activa";

export function SelectorEmpresa({ empresas, actual }: { empresas: EmpresaDelUsuario[]; actual: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="Empresa activa"
      value={actual}
      disabled={pending}
      onChange={(e) => startTransition(() => cambiarEmpresaActiva(e.target.value))}
      className="rounded border px-2 py-1 text-sm disabled:opacity-50"
    >
      {empresas.map((e) => (
        <option key={e.empresaId} value={e.empresaId}>
          {e.empresaNombre}
        </option>
      ))}
    </select>
  );
}
