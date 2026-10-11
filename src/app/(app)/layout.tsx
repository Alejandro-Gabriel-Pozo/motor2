import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin(); // lanza: redirige al login recordando la pantalla

  return <AppShell ctx={ctx}>{children}</AppShell>;
}
