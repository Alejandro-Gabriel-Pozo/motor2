import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) redirect("/login");

  return <AppShell ctx={ctx}>{children}</AppShell>;
}
