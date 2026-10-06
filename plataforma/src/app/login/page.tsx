import { redirect } from "next/navigation";
import { administradorEnSesion } from "../../servidor/sesion";
import { FormularioDeIngreso } from "./formulario";

export default async function PaginaDeIngreso() {
  if (await administradorEnSesion()) redirect("/");
  return <FormularioDeIngreso />;
}
