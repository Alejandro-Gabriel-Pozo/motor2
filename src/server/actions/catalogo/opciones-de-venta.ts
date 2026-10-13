"use server";

import {
  guardComandoCrearGrupoDeOpciones,
  guardComandoEditarGrupoDeOpciones,
} from "@/core/features/catalogo/opciones-de-venta.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, type ResultadoAccion } from "../tipos";
import { crearGrupoDeOpcionesCasoDeUso } from "./casos-de-uso/crear-grupo-de-opciones";
import { editarGrupoDeOpcionesCasoDeUso } from "./casos-de-uso/editar-grupo-de-opciones";

/**
 * Server Actions del CATÁLOGO DE OPCIONES DE VENTA (GO-2a; ADR-030). Cada una es un adaptador fino: permiso (la PRIMERA línea: `conPermisoDeEmpresa` con su clave) → formato y rango
 * (`guardComando…`, dentro del permiso) → caso de uso (reglas, transacción SERIALIZABLE, auditoría) → `aResultadoAccion` (a la pantalla solo llegan `ok` y `mensaje`; ni ids ni códigos).
 *
 * - `opciones_definir` (empresa, piso administrador): los grupos, sus opciones y las versiones de cada opción.
 * - `producto_opciones_admitidas` (empresa, piso administrador): lo que admite cada producto.
 *
 * Todavía no hay pantallas (GO-2b): ningún cliente las importa, y Next no publica una Server Action que nadie importa (la saca del bundle), así que hoy no tienen punto de entrada.
 * Igual cada una lleva su guarda: el día que una pantalla la importe ya está protegida. Los argumentos se tipan como `unknown` a propósito: llegan de una puerta HTTP y los valida el guard.
 */

export async function crearGrupoDeOpciones(entrada: { nombre: unknown; tipo: unknown; cantidadMinima: unknown; cantidadMaxima: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("opciones_definir", async (ctx) => {
    const comando = guardComandoCrearGrupoDeOpciones(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await crearGrupoDeOpcionesCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

export async function editarGrupoDeOpciones(entrada: {
  grupoId: unknown;
  versionEsperada: unknown;
  nombre: unknown;
  cantidadMinima: unknown;
  cantidadMaxima: unknown;
  activo: unknown;
}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("opciones_definir", async (ctx) => {
    const comando = guardComandoEditarGrupoDeOpciones(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await editarGrupoDeOpcionesCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}




