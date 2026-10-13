import "server-only";
import { rechazoDeReferenciaNoEncontrada } from "@/core/datos/errores-de-base";
import { MENSAJE_GRUPO_NO_ENCONTRADO } from "@/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoCrearOpcionDeGrupo, ResultadoCrearOpcionDeGrupo } from "@/core/features/catalogo/opciones-de-venta.schema";
import { contenidoDeVersionIgual, validarConsumos, validarOpcionNueva, validarVersion } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { denegacionDeModuloDeAccion } from "@/server/acceso/modulos-de-empresa";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { crearProductoAnclaDeAdicional } from "@/server/persistencia/catalogo/productos";
import { agregarVersionDeOpcion, crearOpcionDeGrupo } from "@/server/persistencia/catalogo/opciones-de-venta";
import { cargarGrupoEnTx, columnasDeVersion, describirConsumos, insumosDeLosConsumos, opcionConElMismoNombre, versionVigenteEnTx } from "./opciones-de-venta-en-tx";

/**
 * Caso de uso «crear una opción de un grupo» (GO-2a; ADR-030 §1, §2 y §7): la opción, su VERSIÓN 1 (diferencia de precio, factor y consumos) y, si es un ADICIONAL, su PRODUCTO ANCLA
 * (D-1, variante A′: lo crea el sistema, sin disponibilidad), todo en UNA transacción SERIALIZABLE con su auditoría: o queda todo o no queda nada.
 *
 * Reglas (dentro de la transacción, con lo leído ahí): el grupo existe; la «ninguna» solo en VARIANTE o INCLUIDA (D-2) y con MONTO 0, sin factor ni consumos; el ancla solo y siempre
 * en el ADICIONAL; la versión y los consumos según el tipo (`validarVersion`, `validarConsumos`); cada insumo es una materia prima de la empresa y el consumo va en su unidad de stock
 * (U7); los consumos exigen el módulo Recetas (D-3). El nombre es único en el grupo sin distinguir mayúsculas: si ya hay una opción idéntica (misma «ninguna» y una versión 1 con el
 * mismo contenido) se devuelve esa («ya existía»: un doble clic no crea otra); si difiere, `NOMBRE_REPETIDO`. El ancla lleva el nombre de la opción: si ya hay un producto con ese
 * nombre, `NOMBRE_DE_ANCLA_REPETIDO` (se lee antes de insertar). Dos altas simultáneas chocan con un único (el nombre de la opción, la «ninguna» del grupo, el nombre o el código del
 * ancla): se reintenta (`tambienChoqueDeUnico`) y la relectura da el resultado de negocio.
 *
 * @contract Deja la opción con su versión 1 (y su producto ancla si es adicional) y devuelve sus ids.
 * @idempotency Por estado — el nombre de la opción en el grupo (único sin distinguir mayúsculas) arbitra: repetir el alta devuelve la opción ya creada, sin otra versión ni otra auditoría.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: el choque de un único es la carrera perdida y el reintento da el resultado de negocio.
 * @sideEffects registrarCambioAuditado (el alta de la opción, la de su versión 1 con el resumen de los consumos y la del producto ancla), con el mismo `tx`.
 * @ficha permiso=opciones_definir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearOpcionDeGrupoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "db" | "transaccion" | "ahora">,
  comando: ComandoCrearOpcionDeGrupo,
  azar: FuenteDeAzar
): Promise<ResultadoCrearOpcionDeGrupo> {
  if (comando.version.consumos.length > 0) {
    const sinRecetas = await denegacionDeModuloDeAccion("guardar_receta", actor.empresaId, actor.db);
    if (sinRecetas) return fracaso("MODULO_RECETAS_INACTIVO", "Los consumos de una opción usan el módulo Recetas, que tu empresa no tiene activo: guardala sin consumos.");
  }

  try {
    return await conTransaccionSerializable(
      actor.transaccion,
      async (tx): Promise<ResultadoCrearOpcionDeGrupo> => {
        const grupo = await cargarGrupoEnTx(tx, comando.grupoId);
        if (!grupo) return fracaso("GRUPO_NO_ENCONTRADO", MENSAJE_GRUPO_NO_ENCONTRADO);

        const existente = await opcionConElMismoNombre(tx, grupo.id, comando.nombre, null);
        if (existente) {
          const vigente = await versionVigenteEnTx(tx, existente.id);
          const identica = existente.esNinguna === comando.esNinguna && vigente !== null && vigente.numero === 1 && contenidoDeVersionIgual(vigente, comando.version);
          return identica
            ? exito(`Ya existía la opción «${existente.nombre}» en «${grupo.nombre}»: no se creó otra.`, { opcionId: existente.id, versionDeOpcionId: vigente.id, productoAnclaId: existente.productoId, yaExistia: true })
            : fracaso("NOMBRE_REPETIDO", `Ya hay una opción llamada «${existente.nombre}» en «${grupo.nombre}». Elegí otro nombre.`);
        }

        for (const regla of [
          validarOpcionNueva({ tipoDeGrupo: grupo.tipo, esNinguna: comando.esNinguna, conAncla: comando.ancla !== null }),
          validarVersion(grupo.tipo, comando.esNinguna, comando.version),
          validarConsumos(grupo.tipo, comando.esNinguna, comando.version.consumos),
        ]) {
          if (!regla.ok) return fracaso("CONFIGURACION_INVALIDA", regla.mensaje);
        }
        if (comando.esNinguna && (await tx.opcionDeGrupo.findFirst({ where: { grupoId: grupo.id, esNinguna: true }, select: { id: true } }))) {
          return fracaso("CONFIGURACION_INVALIDA", `«${grupo.nombre}» ya tiene su opción «ninguna»: un grupo tiene a lo sumo una.`);
        }
        const insumos = await insumosDeLosConsumos(tx, comando.version.consumos);
        if (!insumos.ok) return fracaso("REFERENCIA_NO_ENCONTRADA", insumos.mensaje);

        let ancla: { id: string; codigo: string; nombre: string } | null = null;
        if (comando.ancla) {
          const unidad = await tx.unidad.findFirst({ where: { id: comando.ancla.unidadStockId }, select: { id: true, nombre: true } });
          if (!unidad) return fracaso("REFERENCIA_NO_ENCONTRADA", "No se encontró la unidad elegida para el producto de respaldo.");
          const mismoNombre = await tx.producto.findFirst({ where: { nombre: { equals: comando.nombre, mode: "insensitive" } }, select: { nombre: true } });
          if (mismoNombre) {
            return fracaso("NOMBRE_DE_ANCLA_REPETIDO", `Ya hay un producto llamado «${mismoNombre.nombre}»: el adicional se respalda con un producto propio del mismo nombre. Elegí otro nombre para el adicional.`);
          }
          ancla = await crearProductoAnclaDeAdicional(tx, { codigo: `PV_${azar.uuid().slice(0, 6)}`, nombre: comando.nombre, unidadStockId: unidad.id, ahora: actor.ahora });
          const descripcionDelAncla = `Producto «${ancla.nombre}» (${ancla.codigo}): alta como producto de respaldo del adicional «${comando.nombre}» de «${grupo.nombre}», sin disponibilidad en ninguna sucursal.`;
          const cambiosDelAncla = [
            { campo: "alta", valorNuevo: ancla.codigo },
            { campo: "unidadStockId", valorNuevo: unidad.id },
            { campo: "factorConversion", valorNuevo: 1 },
          ];
          for (const c of cambiosDelAncla) {
            await registrarCambioAuditado(tx, { entidad: "Producto", entidadId: ancla.id, campo: c.campo, descripcion: descripcionDelAncla, valorAnterior: null, valorNuevo: c.valorNuevo, actorId: actor.usuarioId, sucursalId: null });
          }
        }

        const opcion = await crearOpcionDeGrupo(tx, { grupoId: grupo.id, nombre: comando.nombre, orden: comando.orden, esNinguna: comando.esNinguna, productoAnclaId: ancla?.id ?? null, ahora: actor.ahora });
        const version = await agregarVersionDeOpcion(tx, {
          opcionId: opcion.id,
          numero: 1,
          diferencia: comando.version.diferencia,
          factorEscala: comando.version.factorEscala,
          consumos: insumos.consumos,
          creadoPorId: actor.usuarioId,
          ahora: actor.ahora,
        });

        const descripcionDeLaOpcion = `Opción «${comando.nombre}» de «${grupo.nombre}»: alta.`;
        const cambiosDeLaOpcion = [
          { campo: "nombre", valorNuevo: comando.nombre },
          { campo: "orden", valorNuevo: comando.orden },
          { campo: "esNinguna", valorNuevo: comando.esNinguna },
          { campo: "productoId", valorNuevo: ancla?.id ?? null },
        ];
        for (const c of cambiosDeLaOpcion) {
          await registrarCambioAuditado(tx, { entidad: "OpcionDeGrupo", entidadId: opcion.id, campo: c.campo, descripcion: descripcionDeLaOpcion, valorAnterior: null, valorNuevo: c.valorNuevo, actorId: actor.usuarioId, sucursalId: null });
        }
        const columnas = columnasDeVersion(comando.version);
        const descripcionDeLaVersion = `Opción «${comando.nombre}» de «${grupo.nombre}»: versión 1 (${describirConsumos(insumos.consumos, insumos.nombres)}).`;
        const cambiosDeLaVersion = [
          { campo: "numero", valorNuevo: 1 },
          { campo: "tipoDeDiferencia", valorNuevo: columnas.tipoDeDiferencia },
          { campo: "diferenciaPrecio", valorNuevo: columnas.diferenciaPrecio },
          { campo: "porcentaje", valorNuevo: columnas.porcentaje },
          { campo: "factorEscala", valorNuevo: columnas.factorEscala },
        ];
        for (const c of cambiosDeLaVersion) {
          await registrarCambioAuditado(tx, { entidad: "VersionDeOpcion", entidadId: version.id, campo: c.campo, descripcion: descripcionDeLaVersion, valorAnterior: null, valorNuevo: c.valorNuevo, actorId: actor.usuarioId, sucursalId: null });
        }

        return exito(
          ancla
            ? `Adicional «${comando.nombre}» creado en «${grupo.nombre}», con su producto de respaldo ${ancla.codigo}.`
            : `Opción «${comando.nombre}» creada en «${grupo.nombre}».`,
          { opcionId: opcion.id, versionDeOpcionId: version.id, productoAnclaId: ancla?.id ?? null, yaExistia: false }
        );
      },
      undefined,
      undefined,
      true
    );
  } catch (e) {
    // Defensa: las referencias se leen antes de escribir (un id ajeno no se ve), pero si una clave foránea igual se viola, sale como rechazo de pertenencia y no como excepción cruda.
    const rechazo = rechazoDeReferenciaNoEncontrada(e, { insumoProductoId: "el insumo elegido", reemplazaAProductoId: "el insumo reemplazado", unidadId: "la unidad", unidadStockId: "la unidad elegida", grupoId: "el grupo de opciones" }, "No se encontró una de las referencias elegidas.");
    if (rechazo) return fracaso("REFERENCIA_NO_ENCONTRADA", rechazo);
    throw e;
  }
}
