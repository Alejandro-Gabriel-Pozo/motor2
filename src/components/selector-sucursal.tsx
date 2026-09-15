"use client";

import { useTransition } from "react";
import type { MembresiaUsuario } from "@/core/auth/contexto";
import { cambiarSucursalActiva } from "@/server/actions/sucursal-activa";

export function SelectorSucursal({ membresias, actual }: { membresias: MembresiaUsuario[]; actual: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={actual}
      disabled={pending}
      onChange={(e) => startTransition(() => cambiarSucursalActiva(e.target.value))}
      className="rounded border px-2 py-1 text-sm disabled:opacity-50"
    >
      {membresias.map((m) => (
        <option key={m.sucursalId} value={m.sucursalId}>
          {m.sucursalNombre}
        </option>
      ))}
    </select>
  );
}
