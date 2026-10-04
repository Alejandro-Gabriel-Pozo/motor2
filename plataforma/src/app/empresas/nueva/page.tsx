import { redirect } from "next/navigation";
import { administradorEnSesion } from "../../../servidor/sesion";
import { FormularioDeAlta } from "./formulario";

export default async function PaginaDeAlta() {
  if (!(await administradorEnSesion())) redirect("/login");
  return <FormularioDeAlta />;
}
