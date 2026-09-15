import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/core/auth/session";

export default async function Home() {
  const usuario = await getUsuarioActual();
  redirect(usuario ? "/administracion/usuarios" : "/login");
}
