import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { Aviso } from "@/ui/primitivas/aviso";
import { requierePermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { ProductoForm } from "../../producto-form";
import { cargarEdicionDelProducto } from "../../datos-de-edicion";

/**
 * Paso 1 del espacio del producto (Fase 6, 6.13; DEC-12): los datos del producto, para TODOS los tipos (ADDENDUM del 2026-10-21: un solo espacio y una sola URL; en un producto de venta el paso se llama «Qué se vende» y
 * en una materia prima «Datos»). Es el formulario de siempre (`ProductoForm`, el mismo que servía `/editar`, que ahora redirige acá). Al guardar, vuelve a la ficha, que muestra el aviso de que se guardó.
 */
export default async function DatosDelProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <Aviso variante="error" forma="en-linea">{MENSAJE_DEMASIADAS_LECTURAS}</Aviso>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <Aviso variante="error" forma="en-linea">{gate.mensaje}</Aviso>;
  // Además de Ver (que ubica la pantalla en su familia), EDITAR: quien solo ve productos no tiene por qué recibir el formulario completo para descubrir
  // recién al guardar que no puede. La barrera es esta, en el servidor; esconder el enlace en la lista y la ficha es solo cortesía de la interfaz.
  const gateEditar = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_editar", ctx.db);
  if (!gateEditar.ok) return <Aviso variante="error" forma="en-linea">{gateEditar.mensaje}</Aviso>;

  const { id } = await params;
  const formulario = await cargarEdicionDelProducto(ctx, id);
  if (!formulario) notFound();

  return (
    <div className="max-w-xl">
      <Link href={`/catalogo/productos/${id}`} className="mb-3 inline-block text-sm underline">
        ← Volver a la ficha
      </Link>
      {/* La pantalla de alta ya tiene su h1; esta no lo tenía (solo el h2 del formulario) y axe marca «la página debe tener un encabezado de nivel 1». */}
      <h1 className="mb-4 text-xl font-semibold">Editar producto</h1>
      <ProductoForm key={id} {...formulario} />
    </div>
  );
}
