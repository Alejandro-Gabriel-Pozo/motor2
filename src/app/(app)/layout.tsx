import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin(); // lanza: redirige al login recordando la pantalla

  return <AppShell ctx={ctx}>{children}</AppShell>;
}
