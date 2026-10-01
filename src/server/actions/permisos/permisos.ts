"use server";

import { claveEnCatalogo, type AccionClave } from "@/core/permisos/acciones";
import { MENSAJE_GUARDADO_EN_CONFLICTO, mismoEstado, normalizarPermiso, PREFIJO_CONFLICTO_DE_EDICION, SIN_PERMISO, type EstadoPermiso } from "@/core/permisos/matriz";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conTransaccionSerializable, esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerDeEmpresa } from "../con-sesion";

export async function listarMatrizPermisos() {
  const ctx = await requerirVerDeEmpresa("gestion_permisos");
  const [acciones, roles, permisos] = await Promise.all([
    ctx.db.accion.findMany({ orderBy: { clave: "asc" } }),
    ctx.db.rol.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
    ctx.db.permisoRol.findMany(),
  ]);
  return { acciones: acciones.filter((a) => claveEnCatalogo(a.clave)), roles, permisos };
}

export interface CambioPermisoInput {
  rolId: string;
  accionClave: string;
  /** Lo que la persona vio al abrir la edición: si en la base ya es otra cosa, alguien más lo cambió y NO se guarda nada. */
  anterior: EstadoPermiso;
  nuevo: EstadoPermiso;
}

/** Tope de cambios por guardado: la matriz completa hoy tiene 41 acciones × unos pocos roles. */
const MAXIMO_CAMBIOS = 1000;

const esBooleano = (v: unknown): v is boolean => typeof v === "boolean";
const estadoValido = (e: EstadoPermiso | undefined): e is EstadoPermiso => !!e && esBooleano(e.puedeVer) && esBooleano(e.puedeEditar);

/**
 * Guarda TODOS los cambios de la matriz de una vez, o ninguno (modo edición con «Guardar»; decisión 6 de
 * docs/grounding-lista-ver-editar-2026-09-18.md). Reemplaza al guardado instantáneo por clic (`actualizarPermiso`), que dejaba la matriz a
 * medio cambiar si algo fallaba y no avisaba de que otra persona la había modificado.
 *
 * - «Ver ⊇ Editar» y la salvaguarda del admin (`normalizarPermiso`) se aplican acá, al escribir, igual que antes (Core.js:1513-1551).
 * - Concurrencia: cada cambio trae lo que la persona VIO (`anterior`). Si en la base ya es otra cosa, alguien más la cambió mientras tanto:
 *   se rechaza el guardado ENTERO y se dice cuáles. Sin esto ganaba el último que guardaba, pisando en silencio el cambio de la otra persona.
 * - Una sola transacción: las escrituras y su registro de auditoría (A3, Pivote 6) salen juntos o no salen.
 * - Es SERIALIZABLE con reintento (`conTransaccionSerializable`), no READ COMMITTED. La comparación contra `anterior` es un chequeo optimista: en
 *   READ COMMITTED, dos guardados sobre la misma celda podían leer los dos el estado viejo, pasar los dos la comparación y aplicar los dos — ambos
 *   `ok: true`, el cambio de uno pisado en silencio, el aviso de conflicto sin dispararse y la auditoría del segundo con un `valorAnterior` falso.
 *   Bajo SERIALIZABLE el segundo aborta (40001), se reintenta, RELEE el estado nuevo y ahí devuelve «Otra persona cambió…»: el serializable no
 *   reemplaza al aviso, lo vuelve verídico. Como ese aviso se DEVUELVE (no se lanza), corta el reintento en el acto.
 *   Efecto colateral aceptado: `PermisoRol` es una tabla chica, así que dos guardados sobre celdas distintas también pueden chocar; el reintento
 *   lo absorbe (se edita unas pocas veces por semana, el costo es irrelevante).
 */
export async function guardarPermisos(cambios: CambioPermisoInput[]): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("gestion_permisos", async (ctx) => {
    if (!Array.isArray(cambios)) return error("No hay cambios para guardar.");
    if (cambios.length > MAXIMO_CAMBIOS) return error("Son demasiados cambios de una vez.");
    for (const c of cambios) {
      if (typeof c?.rolId !== "string" || typeof c?.accionClave !== "string" || !estadoValido(c.anterior) || !estadoValido(c.nuevo)) {
        return error("Los cambios no tienen el formato esperado.");
      }
    }
    const claves = new Set<string>();
    for (const c of cambios) {
      const clave = `${c.rolId}:${c.accionClave}`;
      if (claves.has(clave)) return error("Hay dos cambios para la misma celda.");
      claves.add(clave);
    }

    const [roles, acciones] = await Promise.all([
      ctx.db.rol.findMany({ where: { activo: true, id: { in: cambios.map((c) => c.rolId) } } }),
      ctx.db.accion.findMany({ where: { clave: { in: cambios.map((c) => c.accionClave) } } }),
    ]);
    const rolPorId = new Map(roles.map((r) => [r.id, r]));
    const accionesConocidas = new Set(acciones.map((a) => a.clave));

    // Lo que efectivamente se va a guardar (con Ver ⊇ Editar y la salvaguarda). Un cambio que no cambia nada, se ignora.
    const efectivos: { rolId: string; rolNombre: string; accionClave: AccionClave; anterior: EstadoPermiso; nuevo: EstadoPermiso }[] = [];
    for (const c of cambios) {
      const rol = rolPorId.get(c.rolId);
      if (!rol) return error("No se encontró uno de los roles (¿está desactivado?). No se guardó nada.");
      if (!claveEnCatalogo(c.accionClave) || !accionesConocidas.has(c.accionClave)) return error(`No se encontró la acción "${c.accionClave}". No se guardó nada.`);
      const nuevo = normalizarPermiso(rol.nombre, c.accionClave, c.nuevo);
      if (mismoEstado(nuevo, c.anterior)) continue;
      efectivos.push({ rolId: rol.id, rolNombre: rol.nombre, accionClave: c.accionClave as AccionClave, anterior: c.anterior, nuevo });
    }
    if (!efectivos.length) return error("No hay cambios para guardar.");

    // Las lecturas de arriba (roles y acciones activos) quedan FUERA de la transacción a propósito: son validación de entrada, no un invariante
    // que haya que sostener atómicamente. Adentro tomarían un bloqueo de predicado sobre `Rol` (activo: true) y activar o desactivar cualquier
    // rol desde otra pantalla chocaría con un guardado de la matriz. Costo: en una carrera exótica se podrían guardar permisos de un rol recién
    // desactivado, inocuo (un rol desactivado no otorga acceso). Reintentar este cuerpo es seguro: `efectivos` sale del input y del nombre del
    // rol, no del estado de `PermisoRol`, y lo de adentro son lecturas y upserts idempotentes. El limitador de mutaciones se evalúa en
    // `conPermiso`, por fuera: un guardado que reintenta cuenta como uno.
    return conTransaccionSerializable(ctx.transaccion, async (tx): Promise<ResultadoAccion> => {
      const actuales = await tx.permisoRol.findMany({
        where: { OR: efectivos.map((e) => ({ rolId: e.rolId, accionClave: e.accionClave })) },
      });
      const actualDe = new Map(actuales.map((a) => [`${a.rolId}:${a.accionClave}`, a]));

      const conflictos = efectivos.filter((e) => {
        const actual = actualDe.get(`${e.rolId}:${e.accionClave}`);
        return !mismoEstado(actual ? { puedeVer: actual.puedeVer, puedeEditar: actual.puedeEditar } : SIN_PERMISO, e.anterior);
      });
      if (conflictos.length) {
        const lista = conflictos.slice(0, 5).map((e) => `«${e.rolNombre}» · ${e.accionClave}`).join(", ");
        return error(
          `${PREFIJO_CONFLICTO_DE_EDICION} mientras editabas (${lista}${conflictos.length > 5 ? ` y ${conflictos.length - 5} más` : ""}). No se guardó nada: recargá la matriz y volvé a aplicar tus cambios.`
        );
      }

      for (const e of efectivos) {
        const existente = actualDe.get(`${e.rolId}:${e.accionClave}`);
        const fila = await tx.permisoRol.upsert({
          where: { rolId_accionClave: { rolId: e.rolId, accionClave: e.accionClave } },
          update: { puedeEditar: e.nuevo.puedeEditar, puedeVer: e.nuevo.puedeVer },
          create: { rolId: e.rolId, accionClave: e.accionClave, puedeEditar: e.nuevo.puedeEditar, puedeVer: e.nuevo.puedeVer },
        });
        await registrarCambioAuditado(tx, {
          entidad: "PermisoRol", entidadId: fila.id, campo: "puedeEditar",
          descripcion: `Permiso "${e.accionClave}" del rol "${e.rolNombre}": editar`,
          valorAnterior: existente?.puedeEditar ?? null, valorNuevo: e.nuevo.puedeEditar, actorId: ctx.usuarioId,
        });
        await registrarCambioAuditado(tx, {
          entidad: "PermisoRol", entidadId: fila.id, campo: "puedeVer",
          descripcion: `Permiso "${e.accionClave}" del rol "${e.rolNombre}": ver`,
          valorAnterior: existente?.puedeVer ?? null, valorNuevo: e.nuevo.puedeVer, actorId: ctx.usuarioId,
        });
      }
      return ok(`${efectivos.length} permiso(s) guardado(s).`);
    }).catch((e) => {
      // La transacción ya hizo rollback cuando llega acá: no se guardó NADA. Agotar los reintentos de SERIALIZABLE no es un error de la persona ni
      // un 500: es «justo ahora había otro guardado en curso». Se devuelve como mensaje de negocio para que NO pierda el borrador — un `throw` acá lo
      // manda al error boundary y se le borran todos los cambios marcados. Cualquier otro error sigue de largo.
      if (esConflictoDeEscritura(e)) return error(MENSAJE_GUARDADO_EN_CONFLICTO);
      throw e;
    });
  });
}
