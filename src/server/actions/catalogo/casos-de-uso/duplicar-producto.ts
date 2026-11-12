import "server-only";
import {
  AVISO_PASOS_PARA_REVISAR,
  describirPrecioDelDuplicado,
  describirProductoDuplicado,
  describirRecetaDuplicada,
  hayPasosParaRevisar,
  hayRecetaCircular,
  ingredientesDadosDeBaja,
  textoDeIngredientesDadosDeBaja,
} from "@/core/catalogo/duplicar-producto";
import { validarCabecera, validarIngredientes, validarPasos, validarUnidadDeIngredientes } from "@/core/catalogo/public";
import { esErrorDeUnicidad, mapCabeceraAInput, mapIngredientesAInput, mapPasosAInput } from "@/core/catalogo/public-servidor";
import { mismosCentavos } from "@/core/datos/importe";
import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";
import { MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES } from "@/core/features/catalogo/productos.guard";
import { rechazoDeReferenciaDeProducto } from "@/core/features/catalogo/referencias-de-producto";
import type { OpcionAdmitidaEnComando } from "@/core/features/catalogo/opciones-de-venta.schema";
import type { ComandoDuplicarProducto, OpcionesDuplicadas, PrecioDelDuplicado, RecetaDuplicada, ResultadoDuplicarProducto } from "@/core/features/catalogo/duplicar-producto.schema";
import { esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { MODO_DE_VENTA, esBaseConfigurable, rechazoDeAdmisionesDeBase, type DiferenciaDePrecio, type ModoDePrecioDeMedida } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { conEscrituraEnLaEmpresa } from "@/server/acceso/alcance";
import { leerOrigenDeCopia } from "@/server/acceso/origen-de-copia";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarDatosParaValidarReceta } from "@/server/persistencia/catalogo/cargar-datos-para-validar-receta";
import {
  cargarAdmitidoDelOrigen,
  cargarOrigenAuditadoDelDuplicado,
  cargarOrigenDelDuplicado,
  cargarProductoDelDuplicadoId,
  cargarRecetaVigenteDelOrigen,
  crearProductoDuplicado,
  existeProductoConElNombre,
  fijarModoDeVentaDelDuplicado,
} from "@/server/persistencia/catalogo/duplicar-producto";
import { cargarUnidadesDeStockDeIngredientes, escribirVersionDeReceta } from "@/server/persistencia/catalogo/guardar-version-de-receta";
import { sembrarDisponibilidadDeProductoNuevo } from "@/server/persistencia/catalogo/productos";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { admisionesParaSerBase } from "./opciones-de-venta-en-tx";
import { fijarAdmisionDeGrupoEnTx } from "./fijar-admision-de-grupo-en-producto";

/**
 * Caso de uso «duplicar un producto» (etapa E4 de `docs/diseno-duplicar-producto-2026-11-12.md`; decisión del dueño, 2026-11-12: «como lo tiene Pedernal»). Crea un producto NUEVO con nombre propio a partir de otro y copia, en UNA
 * sola transacción SERIALIZABLE (todo o nada, ni siquiera queda el producto vacío): la ficha del producto, el precio de lista como punto de partida, lo que el producto admite (los MISMOS grupos y opciones de la biblioteca, con sus
 * precios) y la receta vigente con su ficha técnica como versión 1. La copia es independiente: cambiar el original después no toca al duplicado. Lo que se copia y lo que no está en `COLUMNAS_DEL_DUPLICADO` (`core/catalogo/duplicar-producto.ts`).
 *
 * El alta de siempre (`dar-de-alta-producto.ts`) crea sin transacción a propósito, para que el reintento del código autogenerado no aborte nada; acá el producto y la copia van JUNTOS, así que el código se resuelve reintentando
 * TODA la transacción (`conTransaccionSerializable` con `tambienChoqueDeUnico`, como el guardado de la receta): cada intento genera otro código con la fuente de azar que recibe.
 *
 * Idempotencia (`duplicadoId`, el id del producto nuevo, que manda la aplicación): repetir el MISMO pedido (mismo original y mismo nombre) devuelve el producto que ya está (`yaExistia`) sin copiar ni auditar de nuevo; el mismo id
 * con otro original u otro nombre es `ID_REUTILIZADO`. El nombre se verifica contra todos los productos de la empresa, sin distinguir mayúsculas (el índice único de la base lo cuenta igual): dos duplicados a la vez con el mismo nombre
 * dejan pasar a uno y el otro, al repetirse, recibe «ya existe».
 *
 * Quién puede (lo resuelve la Server Action; este caso de uso NO chequea permisos): `alta_producto` para crear, `guardar_receta` si se copia la receta y `producto_opciones_admitidas` si se copian las opciones — si falta alguno, se
 * rechaza el pedido ENTERO antes de leer nada (no se copia «lo que se pueda»). El precio lo decide `puedeEditarCamposSensibles` (`producto_campos_sensibles`): sin la clave el producto nace con precio 0, factor 1, sin unidad de compra y,
 * si es de venta, SIN disponibilidad (regla M.2-A4 del alta); un original que se vende por opción exige la clave (el modo de venta es un campo sensible) y que se copien también sus opciones. La receta de otra sucursal exige lo de S-07
 * (`leerOrigenDeCopia`: membresía y «Ver» de `receta_sucursal_copiar` allá).
 *
 * La receta pasa por la validación de siempre (`validarIngredientes`, `validarPasos`, `validarCabecera`, la unidad de stock): un ingrediente dado de baja hace fallar todo y se NOMBRAN todos; la guardia de unidad no corre (es una copia
 * de lo ya aceptado, como las demás copias). Las opciones pasan por el mismo cuerpo que la pantalla de opciones (`fijarAdmisionDeGrupoEnTx`), con sus reglas y su auditoría. Los grupos y las opciones archivados en la biblioteca no se
 * copian y se cuentan en el resultado. Si algún paso de la receta nombra un ingrediente, el mensaje avisa «hay pasos para revisar».
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No lee el azar por su cuenta (lo recibe) ni la hora (la trae `actor.ahora`).
 *
 * @contract Crea un producto nuevo con el nombre pedido y le copia (según lo pedido y los permisos) la ficha, el precio, lo que admite y la receta vigente del original, todo o nada; devuelve su id, qué se copió y los avisos.
 * @idempotency Por estado — el `duplicadoId` es el id del producto nuevo: repetir el mismo pedido devuelve el producto ya creado (`yaExistia`) y repetirlo con otro original u otro nombre se rechaza (`ID_REUTILIZADO`); el índice único del nombre frena a dos duplicados a la vez.
 * @transaction conTransaccionSerializable (SERIALIZABLE), reabierta (hasta 8 veces) ante un conflicto de escritura o un choque de único (el código autogenerado, o el nombre de otro duplicado simultáneo): el cuerpo se repite entero y no deja nada a medias.
 * @sideEffects registrarCambioAuditado (Producto.duplicadoDe con el original, Producto.precioVenta y .modoDeVenta cuando se copian, RecetaVersion.version de la receta nueva y una fila por columna de cada grupo y opción vinculados), en la misma transacción.
 * @ficha permiso=alta_producto+guardar_receta+producto_opciones_admitidas transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */

/** Un rechazo que se descubre DESPUÉS de haber escrito algo: se lanza para que la transacción se revierta entera (devolver un resultado la confirmaría) y se traduce afuera. */
class RechazoDeLaDuplicacion extends Error {
  constructor(readonly rechazo: Extract<ResultadoDuplicarProducto, { ok: false }>) {
    super(rechazo.mensaje);
  }
}

const aDiferencia = (tipo: string | null, monto: number | null, porcentaje: number | null): DiferenciaDePrecio | null => {
  if (tipo === "MONTO") return { tipo: "MONTO", monto: monto ?? 0 };
  if (tipo === "PORCENTAJE") return { tipo: "PORCENTAJE", porcentaje: porcentaje ?? 0 };
  return null;
};

export async function duplicarProductoCasoDeUso(
  actor: Pick<ContextoDeAccion, "db" | "transaccion" | "usuarioId" | "ahora" | "empresaId" | "alcance">,
  comando: ComandoDuplicarProducto,
  azar: FuenteDeAzar,
  /** M.2: si quien duplica tiene `producto_campos_sensibles` EDITAR (lo calcula la Server Action con el gate; este caso de uso no chequea permisos). */
  puedeEditarCamposSensibles: boolean
): Promise<ResultadoDuplicarProducto> {
  // Sin la clave, lo único que el alta acepta es precio 0: un precio escrito (un NaN, un texto, ya no llega: lo filtró el guard) es fijar justo lo que protege `producto_campos_sensibles`. Fallo cerrado, antes de leer nada.
  if (!puedeEditarCamposSensibles && comando.precioVenta !== null && comando.precioVenta !== 0) return fracaso("SIN_PERMISO_CAMPOS_SENSIBLES", MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES);

  // S-07 (O.56): la receta de una sucursal se lee SOLO con membresía y «Ver» de `receta_sucursal_copiar` en ella (la Central no es una sucursal: no hay nada que chequear). Antes de leer el original.
  let sucursalDeLaReceta: { id: string; nombre: string } | null = null;
  if (comando.copiarReceta && comando.sucursalDeLaRecetaId !== null) {
    const lectura = await leerOrigenDeCopia(actor, comando.sucursalDeLaRecetaId, "receta_sucursal_copiar");
    if (!lectura.ok) return fracaso(lectura.codigo === "SIN_ACCESO" ? "ORIGEN_SUCURSAL_SIN_ACCESO" : "ORIGEN_SUCURSAL_NO_ENCONTRADO", lectura.mensaje);
    sucursalDeLaReceta = { id: comando.sucursalDeLaRecetaId, nombre: lectura.nombre };
  }

  // Duplicar es una escritura de EMPRESA ENTERA (`EMPRESA_ENTERA`): siembra la disponibilidad en cada sucursal, escribe la receta central y lee la receta propia de la sucursal elegida, que puede no ser la activa.
  const base = await conEscrituraEnLaEmpresa(actor);

  try {
    return await conTransaccionSerializable(
      base.transaccion,
      async (tx): Promise<ResultadoDuplicarProducto> => {
        // 1. Idempotencia: ¿ya hay un producto con el id que mandó la aplicación?
        const existente = await cargarProductoDelDuplicadoId(tx, comando.duplicadoId);
        if (existente) {
          const salioDeEste = (await cargarOrigenAuditadoDelDuplicado(tx, existente.id)) === comando.origenId && existente.nombre === comando.nombre;
          if (!salioDeEste) return fracaso("ID_REUTILIZADO", "Ese identificador de duplicado ya se usó para otro pedido. Recargá la pantalla y volvé a intentar.");
          return exito(`«${existente.nombre}» ya estaba creado: no se copió nada de nuevo.`, { productoId: existente.id, nombre: existente.nombre, yaExistia: true, receta: null, opciones: null, precio: null });
        }

        // 2. El original: de esta empresa, y no el producto de respaldo de un adicional (lo maneja el sistema).
        const origen = await cargarOrigenDelDuplicado(tx, comando.origenId);
        if (!origen) return fracaso("ORIGEN_NO_ENCONTRADO", "No se encontró el producto.");
        if (origen.opcionQueRespalda !== null) {
          return fracaso("PRODUCTO_NO_ELEGIBLE", `«${origen.nombre}» es el producto de respaldo de un adicional: lo maneja el sistema y no se duplica.`);
        }
        const esBase = esBaseConfigurable(origen.modoDeVenta);
        if (esBase) {
          if (!puedeEditarCamposSensibles) {
            return fracaso("SIN_PERMISO_CAMPOS_SENSIBLES", `«${origen.nombre}» se vende por opción, y cómo se vende un producto lo cambia solo quien tiene el permiso «campos sensibles del producto» (producto_campos_sensibles). ${MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES}`);
          }
          if (comando.precioVenta !== null) {
            return fracaso("PRECIO_BLOQUEADO_EN_BASE", `«${origen.nombre}» se vende por opción: su precio guardado no se cobra ni se cambia (el precio final está en cada opción). Duplicalo sin escribir un precio.`);
          }
          if (!comando.copiarOpciones) {
            return fracaso("BASE_INVALIDA", `«${origen.nombre}» se vende por opción: el precio de cada opción es lo que se cobra, así que para duplicarlo hay que copiar también sus opciones.`);
          }
        }

        // 3. El nombre propio, contra TODOS los productos (el índice único de la base los cuenta a todos).
        if (await existeProductoConElNombre(tx, comando.nombre)) return fracaso("NOMBRE_REPETIDO", `Ya existe un producto llamado "${comando.nombre}". Elegí otro nombre.`);

        // 4. La receta del original, leída y validada ANTES de escribir nada.
        let aCopiar: { ingredientes: ReturnType<typeof mapIngredientesAInput>; pasos: ReturnType<typeof mapPasosAInput>; cabecera: ReturnType<typeof mapCabeceraAInput>; versionDeOrigen: number; dondeRegia: string } | null = null;
        if (comando.copiarReceta) {
          const elegible = origen.tipo === "PV" || (origen.tipo === "MP" && origen.seProduce);
          if (!elegible) return fracaso("PRODUCTO_NO_ELEGIBLE", `«${origen.nombre}» no es elegible para tener receta — tiene que ser PV, o MP con "Se produce" activado.`);
          const receta = await cargarRecetaVigenteDelOrigen(tx, origen.id, sucursalDeLaReceta?.id ?? null);
          if (!receta) return fracaso("ORIGEN_SIN_RECETA", `«${origen.nombre}» no tiene receta: no hay nada que copiar.`);
          const ingredientes = mapIngredientesAInput(receta);
          const pasos = mapPasosAInput(receta);
          const cabecera = mapCabeceraAInput(receta);
          // Un producto no puede ser ingrediente de sí mismo: el destino es el producto nuevo, cuyo id manda el pedido.
          if (hayRecetaCircular(comando.duplicadoId, ingredientes)) return fracaso("RECETA_CIRCULAR", "El producto nuevo no puede ser ingrediente de su propia receta.");
          const datos = await cargarDatosParaValidarReceta(tx, ingredientes, cabecera);
          const dadosDeBaja = ingredientesDadosDeBaja(ingredientes, datos.disponiblesEnAlguna, datos.productos);
          if (dadosDeBaja.length > 0) return fracaso("INGREDIENTES_INVALIDOS", textoDeIngredientesDadosDeBaja(dadosDeBaja));
          const invalidoIngredientes = validarIngredientes(ingredientes, { seProduce: origen.seProduce }, datos);
          if (invalidoIngredientes) return fracaso("INGREDIENTES_INVALIDOS", invalidoIngredientes);
          const invalidoPasos = validarPasos(pasos, ingredientes);
          if (invalidoPasos) return fracaso("PASOS_INVALIDOS", invalidoPasos);
          const invalidoCabecera = validarCabecera(cabecera, datos);
          if (invalidoCabecera) return fracaso("CABECERA_INVALIDA", invalidoCabecera);
          const unidades = await cargarUnidadesDeStockDeIngredientes(tx, ingredientes);
          const invalidoUnidad = validarUnidadDeIngredientes(ingredientes, unidades.productos, unidades.nombresDeUnidad);
          if (invalidoUnidad) return fracaso("INGREDIENTES_INVALIDOS", invalidoUnidad);
          const dondeRegia = receta.sucursalId !== null && sucursalDeLaReceta ? `la receta propia de «${sucursalDeLaReceta.nombre}»` : "la receta central";
          aCopiar = { ingredientes, pasos, cabecera, versionDeOrigen: receta.version, dondeRegia };
        }

        // 5. Lo que el original admite, leído ANTES de escribir nada.
        const admitidoLeido = comando.copiarOpciones ? await cargarAdmitidoDelOrigen(tx, origen.id) : [];
        if (comando.copiarOpciones && admitidoLeido.length === 0) return fracaso("ORIGEN_SIN_OPCIONES", `«${origen.nombre}» no tiene opciones vinculadas: no hay nada que copiar.`);

        // 6. El precio y la ficha: con la clave se copian el precio, el factor y la unidad de compra; sin ella, los valores neutros del alta (M.2). Un original por opción se crea «Directo» y pasa a base al final, cuando sus
        // opciones ya están (así el control del precio de lista de cada grupo no se hace contra un precio guardado que en una base no se cobra).
        const esDeVenta = origen.tipo === "PV";
        // Un original por opción (su precio guardado no se cobra: rige el de cada opción) nace con precio guardado 0: así el control del precio de lista de cada grupo, que se hace contra el precio guardado, no juzga una
        // opción contra un número que en una base nunca se cobra.
        const precioFinal = esBase ? 0 : puedeEditarCamposSensibles ? (comando.precioVenta ?? Number(origen.precioVenta)) : 0;
        const precio: PrecioDelDuplicado = esBase
          ? "POR_OPCION"
          : !puedeEditarCamposSensibles
            ? esDeVenta
              ? "EN_CERO_Y_APAGADO"
              : "EN_CERO"
            : comando.precioVenta !== null && !mismosCentavos(comando.precioVenta, Number(origen.precioVenta))
              ? "EDITADO"
              : "COPIADO";
        const codigo = `${origen.tipo}_${azar.uuid().slice(0, 6)}`;
        await crearProductoDuplicado(tx, {
          id: comando.duplicadoId,
          codigo,
          nombre: comando.nombre,
          tipo: origen.tipo as TipoProducto,
          categoriaId: origen.categoriaId,
          unidadCompraId: puedeEditarCamposSensibles ? origen.unidadCompraId : null,
          unidadStockId: origen.unidadStockId,
          factorConversion: puedeEditarCamposSensibles ? origen.factorConversion : 1,
          observaciones: origen.observaciones,
          precioVenta: precioFinal,
          modoDeVenta: MODO_DE_VENTA.DIRECTO,
          alicuotaIvaVenta: origen.alicuotaIvaVenta,
          alicuotaIvaCompra: origen.alicuotaIvaCompra,
          pasoVenta: origen.pasoVenta,
          seProduce: origen.seProduce,
        });
        // Un producto de venta sin la clave nace APAGADO en todas las sucursales (M.2-A4); con ella (o una materia prima), disponible en todas, como el alta con el tilde por defecto.
        await sembrarDisponibilidadDeProductoNuevo(tx, { productoId: comando.duplicadoId, sucursalIds: base.sucursalIdsDeLaEmpresa, disponible: !(esDeVenta && !puedeEditarCamposSensibles) });

        // 7. La receta como versión 1 de la serie central del producto nuevo (los pasos y su tabla paso↔ingrediente se reconstruyen contra los ingredientes nuevos).
        let receta: RecetaDuplicada | null = null;
        if (aCopiar) {
          const creada = await escribirVersionDeReceta(tx, {
            productoId: comando.duplicadoId,
            version: 1,
            items: aCopiar.ingredientes,
            pasos: aCopiar.pasos,
            cabecera: aCopiar.cabecera,
            sucursalId: null,
            basadaEnVersionId: null,
          });
          await registrarCambioAuditado(tx, {
            entidad: "RecetaVersion",
            entidadId: creada.id,
            campo: "version",
            descripcion: describirRecetaDuplicada(comando.nombre, origen.nombre, aCopiar.versionDeOrigen, aCopiar.dondeRegia),
            valorAnterior: null,
            valorNuevo: 1,
            actorId: actor.usuarioId,
            sucursalId: null,
          });
          receta = { ingredientes: aCopiar.ingredientes.length, pasos: aCopiar.pasos.length, pasosParaRevisar: hayPasosParaRevisar(aCopiar.pasos), versionDeOrigen: aCopiar.versionDeOrigen, dondeRegia: aCopiar.dondeRegia };
        }

        // 8. Lo que el original admite: los mismos grupos y opciones de la biblioteca, con el cuerpo de la pantalla de opciones (sus reglas y su auditoría). Solo lo activo; lo archivado se cuenta.
        let opciones: OpcionesDuplicadas | null = null;
        if (comando.copiarOpciones) {
          let grupos = 0;
          let cantidad = 0;
          let conPrecio = 0;
          let gruposArchivados = 0;
          let opcionesArchivadas = 0;
          for (const g of admitidoLeido) {
            if (!g.activoEnLaBiblioteca) {
              gruposArchivados += 1;
              continue;
            }
            const copiables = g.opciones.filter((o) => o.activaEnLaBiblioteca);
            opcionesArchivadas += g.opciones.length - copiables.length;
            const opcionesDelComando: OpcionAdmitidaEnComando[] = copiables.map((o) => ({
              opcionId: o.opcionId,
              versionEsperada: 0,
              cantidadMaxima: o.cantidadMaxima,
              precioAbsoluto: o.precioAbsoluto,
              diferencia: aDiferencia(o.tipoDeDiferencia, o.diferenciaPrecio, o.porcentaje),
              activo: true,
            }));
            const resultado = await fijarAdmisionDeGrupoEnTx(tx, actor, {
              productoId: comando.duplicadoId,
              grupoId: g.grupoId,
              versionEsperada: 0,
              orden: g.orden,
              cantidadMinima: g.cantidadMinima,
              cantidadMaxima: g.cantidadMaxima,
              modoPrecio: g.modoPrecio as ModoDePrecioDeMedida | null,
              seMuestraEnCarta: g.seMuestraEnCarta,
              opciones: opcionesDelComando,
            });
            if (!resultado.ok) throw new RechazoDeLaDuplicacion(fracaso("OPCIONES_INVALIDAS", `No se pudieron copiar las opciones de «${origen.nombre}»: ${resultado.mensaje}`));
            grupos += 1;
            cantidad += opcionesDelComando.length;
            conPrecio += opcionesDelComando.filter((o) => o.precioAbsoluto !== null || o.diferencia !== null).length;
          }
          opciones = { grupos, opciones: cantidad, conPrecio, gruposArchivadosNoCopiados: gruposArchivados, opcionesArchivadasNoCopiadas: opcionesArchivadas };
        }

        // 9. Un original por opción pasa a base AHORA, con la regla de la base cumplida sobre lo que acaba de copiarse (la misma que pide la edición) y su precio guardado, que se conserva.
        if (esBase) {
          const rechazo = rechazoDeAdmisionesDeBase(await admisionesParaSerBase(tx, comando.duplicadoId));
          if (rechazo) throw new RechazoDeLaDuplicacion(fracaso("BASE_INVALIDA", `«${comando.nombre}» se vendería por opción. ${rechazo}`));
          await fijarModoDeVentaDelDuplicado(tx, { id: comando.duplicadoId, modoDeVenta: MODO_DE_VENTA.BASE_CONFIGURABLE });
        }

        // 10. Auditoría: quién duplicó, a partir de cuál y cuándo (la fecha es la de la fila), más el dinero y el modo de venta con los que nació.
        await registrarCambioAuditado(tx, {
          entidad: "Producto",
          entidadId: comando.duplicadoId,
          campo: "duplicadoDe",
          descripcion: describirProductoDuplicado(comando.nombre, origen.nombre),
          valorAnterior: null,
          valorNuevo: origen.id,
          actorId: actor.usuarioId,
          sucursalId: null,
        });
        await registrarCambioAuditado(tx, {
          entidad: "Producto",
          entidadId: comando.duplicadoId,
          campo: "precioVenta",
          descripcion: describirPrecioDelDuplicado(comando.nombre, origen.nombre, precio === "EDITADO"),
          valorAnterior: null,
          valorNuevo: precioFinal > 0 ? precioFinal : null,
          actorId: actor.usuarioId,
          sucursalId: null,
        });
        if (esBase) {
          await registrarCambioAuditado(tx, {
            entidad: "Producto",
            entidadId: comando.duplicadoId,
            campo: "modoDeVenta",
            descripcion: `Producto "${comando.nombre}": se vende por opción, como "${origen.nombre}".`,
            valorAnterior: null,
            valorNuevo: MODO_DE_VENTA.BASE_CONFIGURABLE,
            actorId: actor.usuarioId,
            sucursalId: null,
          });
        }

        return exito(mensajeDeExito({ codigo, nombre: comando.nombre, origenNombre: origen.nombre, receta, opciones, precio }), { productoId: comando.duplicadoId, nombre: comando.nombre, yaExistia: false, receta, opciones, precio });
      },
      undefined,
      undefined,
      true
    );
  } catch (e) {
    if (e instanceof RechazoDeLaDuplicacion) return e.rechazo;
    // O.175: un id de OTRA empresa (o inexistente) en lo que apunta el original lo rechaza la clave foránea compuesta de la base.
    const referencia = rechazoDeReferenciaDeProducto(e);
    if (referencia) return fracaso("REFERENCIA_NO_ENCONTRADA", referencia);
    // Agotados los reintentos, un choque de único que ya no se resuelve es un id que no es de esta empresa (el nombre y el código se resuelven al repetir): se dice como el id reutilizado, sin revelar de quién es.
    if (esErrorDeUnicidad(e)) return fracaso("ID_REUTILIZADO", "Ese identificador de duplicado ya se usó para otro pedido. Recargá la pantalla y volvé a intentar.");
    if (esConflictoDeEscritura(e)) return fracaso("CONFLICTO", "Otra persona estaba cambiando lo mismo mientras duplicabas. Volvé a intentar.");
    throw e;
  }
}

/** El texto del éxito: el producto nuevo, qué se copió, con qué precio nació y lo que queda pendiente. En lenguaje de proceso; lo no copiado se dice, no se inventa. */
function mensajeDeExito(c: { codigo: string; nombre: string; origenNombre: string; receta: RecetaDuplicada | null; opciones: OpcionesDuplicadas | null; precio: PrecioDelDuplicado }): string {
  const partes = [`Producto "${c.nombre}" (${c.codigo}) creado a partir de "${c.origenNombre}".`];
  if (c.receta) {
    partes.push(`Se copió ${c.receta.dondeRegia} (versión ${c.receta.versionDeOrigen}): ${c.receta.ingredientes} ingrediente${c.receta.ingredientes === 1 ? "" : "s"}, ${c.receta.pasos} paso${c.receta.pasos === 1 ? "" : "s"} y la ficha técnica, como versión 1 de la receta del producto nuevo.`);
  }
  if (c.opciones) {
    const { grupos, opciones, conPrecio, gruposArchivadosNoCopiados: gruposArchivados, opcionesArchivadasNoCopiadas: opcionesArchivadas } = c.opciones;
    const precios = conPrecio > 0 ? `, ${conPrecio} con precio` : "";
    partes.push(`Se vincularon ${grupos} grupo${grupos === 1 ? "" : "s"} con ${opciones} ${opciones === 1 ? "opción" : "opciones"}${precios} (son los mismos de la biblioteca de opciones).`);
    if (gruposArchivados > 0) partes.push(gruposArchivados === 1 ? "1 grupo archivado en la biblioteca no se copió." : `${gruposArchivados} grupos archivados en la biblioteca no se copiaron.`);
    if (opcionesArchivadas > 0) partes.push(opcionesArchivadas === 1 ? "1 opción archivada en la biblioteca no se copió." : `${opcionesArchivadas} opciones archivadas en la biblioteca no se copiaron.`);
  }
  if (c.precio === "EN_CERO_Y_APAGADO") {
    partes.push("Nació con precio $0 y sin disponibilidad: no podés fijar el precio sin el permiso «campos sensibles del producto» (producto_campos_sensibles). Quien lo tenga le carga el precio y lo activa.");
  } else if (c.precio === "POR_OPCION") {
    partes.push("Se vende por opción: su precio guardado no se cobra, el precio final de cada opción es el que se copió con ellas.");
  } else if (c.precio === "EN_CERO") {
    partes.push("Nació con precio $0: no podés fijar el precio sin el permiso «campos sensibles del producto» (producto_campos_sensibles).");
  }
  partes.push("«En la carta» queda pendiente de completar.");
  if (c.receta?.pasosParaRevisar) partes.push(AVISO_PASOS_PARA_REVISAR);
  return partes.join(" ");
}
