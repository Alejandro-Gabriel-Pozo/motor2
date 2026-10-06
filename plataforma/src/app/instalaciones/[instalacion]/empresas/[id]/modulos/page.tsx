import Link from "next/link";
import { notFound } from "next/navigation";
import { modulosDisponiblesParaActivar, nombreDeModulo, type FilaDeModulo } from "@/core/modulos/vista-de-modulos";
import { rutaDeEmpresa } from "../../../../../../rutas";
import { contextoDePagina } from "../../../../../../servidor/contexto";
import { leerModulosDeEmpresa } from "../../../../../../servidor/modulos";
import { textoDeModuloCambiado } from "../../textos";
import { ActivarTodos, CambiarModulo } from "./botones";

const lista = (ids: readonly string[]) => ids.map((id) => nombreDeModulo(id)).join(", ");

function estadoDe(f: FilaDeModulo): string {
  if (f.tipo === "fijo") return "Siempre";
  if (f.estado === "en_desarrollo") return "Próximamente";
  if (f.enRegistro) return "Activo";
  if (f.efectivo) return f.incluidoPor.length ? `Incluido por ${lista(f.incluidoPor)}` : "Incluido";
  return "Inactivo";
}

function porQue(f: FilaDeModulo): string {
  if (f.tipo !== "vendible" || f.estado !== "disponible") return "";
  if (f.enRegistro && f.bloqueadoPor.length) return `No se puede desactivar mientras esté activo: ${lista(f.bloqueadoPor)}.`;
  if (f.enRegistro && f.alDesactivarSePierden.length) return `Trae: ${lista(f.alDesactivarSePierden)}.`;
  if (!f.enRegistro && f.efectivo) return "Activarlo lo mantiene aunque se desactive el que hoy lo incluye.";
  if (!f.enRegistro && f.alActivarSeSuman.length) return `Se suma: ${lista(f.alActivarSeSuman)}.`;
  return "";
}

function avisoDeActivar(f: FilaDeModulo): string {
  return `¿Activar ${f.nombre}?${f.alActivarSeSuman.length ? ` Se incluyen además: ${lista(f.alActivarSeSuman)}.` : ""}`;
}

function avisoDeDesactivar(f: FilaDeModulo): string {
  return `¿Desactivar ${f.nombre}?${f.alDesactivarSePierden.length ? ` La empresa deja de contar con: ${lista(f.alDesactivarSePierden)}.` : ""} Sus usuarios dejan de ver las pantallas internas en su próximo pedido; los datos quedan.`;
}

export default async function PaginaDeModulos({ params, searchParams }: { params: Promise<{ instalacion: string; id: string }>; searchParams: Promise<{ hecho?: string | string[]; modulo?: string | string[] }> }) {
  const { instalacion: instalacionId, id } = await params;
  const { instalacion, db } = await contextoDePagina(instalacionId);
  const { hecho, modulo } = await searchParams;
  const datos = await leerModulosDeEmpresa(db, id);
  if (!datos) notFound();
  const { empresa, vista, activos } = datos;
  const aviso = textoDeModuloCambiado(Array.isArray(hecho) ? hecho[0] : hecho, Array.isArray(modulo) ? modulo[0] : modulo);
  const editable = empresa.estado !== "DELETING";
  const faltan = modulosDisponiblesParaActivar(activos);
  return (
    <section className="tarjeta ancha">
      <h1>Módulos de {empresa.nombre}</h1>
      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}
      <p className="ayuda">Los cambios rigen en el próximo pedido de los usuarios, sin cerrar sesiones. Desactivar un módulo no borra sus datos.</p>
      <table>
        <caption>Módulos de la empresa</caption>
        <thead>
          <tr>
            <th scope="col">Módulo</th>
            <th scope="col">Estado</th>
            <th scope="col">Detalle</th>
            <th scope="col">Acción</th>
          </tr>
        </thead>
        <tbody>
          {vista.map((f) => (
            <tr key={f.id}>
              <th scope="row">{f.nombre}</th>
              <td>{estadoDe(f)}</td>
              <td>{porQue(f)}</td>
              <td>
                {editable && f.puedeActivar && <CambiarModulo instalacion={instalacion.id} empresaId={empresa.id} modulo={f.id} operacion="activar" etiqueta={`Activar ${f.nombre}`} aviso={avisoDeActivar(f)} />}
                {editable && f.puedeDesactivar && <CambiarModulo instalacion={instalacion.id} empresaId={empresa.id} modulo={f.id} operacion="desactivar" etiqueta={`Desactivar ${f.nombre}`} aviso={avisoDeDesactivar(f)} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && faltan.length > 0 && <ActivarTodos instalacion={instalacion.id} empresaId={empresa.id} aviso={`¿Activar todos los módulos disponibles? Se suman: ${lista(faltan)}.`} />}
      <p className="ayuda">
        <Link href={rutaDeEmpresa(instalacion.id, empresa.id)}>Volver a la empresa</Link>
      </p>
    </section>
  );
}
