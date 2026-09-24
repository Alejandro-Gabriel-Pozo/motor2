import type { Metadata } from "next";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { PosShell } from "@/components/pos-shell";

export const metadata: Metadata = { title: "Salón · Motor2" };

/**
 * Layout del salón (módulo POS): clon de `(app)/layout.tsx` con otro shell. Sin sesión (o sin ninguna sucursal activa) lleva al
 * login recordando la pantalla, igual que la administración; el permiso de cada pantalla lo sigue decidiendo su página.
 * Tipado a mano (`{ children: React.ReactNode }`), no con `LayoutProps`, igual que `(app)/layout.tsx`.
 */
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin(); // lanza: redirige al login recordando la pantalla

  return <PosShell ctx={ctx}>{children}</PosShell>;
}
