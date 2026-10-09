import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { whereCartaDeSucursal } from "@/core/carta/public";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import type { AvisosDeItemAgrupado, ComandoGuardarItemAgrupadoCarta, ResultadoGuardarItemAgrupadoCarta } from "@/core/features/carta/items-agrupados.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { cambiarDatosDeItemAgrupadoCarta, crearItemAgrupadoDeCarta } from "@/server/persistencia/carta/items-agrupados";
import { validarGeneroCartaOpcional } from "../generos-compartido";
import { agregarOpcionItemAgrupadoCartaCasoDeUso } from "./agregar-opcion-item-agrupado-carta";

/**
 * Caso de uso «alta o edición de un ítem agrupado de la carta» (docs/plan-agrupacion-items-carta-2026-09-24.md, M5; Hito 5, bloque D, `docs/plan-hito-5-pureza.md`
 * §6.1). Es el cuerpo que antes vivía en línea en la Server Action `guardarItemAgrupadoCarta` (`src/server/actions/carta/items-agrupados.ts`), movido TAL CUAL: las
 * mismas lecturas con la base del contexto (sin transacción), el mismo orden de chequeos, los mismos mensajes y el mismo `catch` de la carrera del índice único. La
 * Server Action quedó como adaptador (`conPermiso("carta_items_agrupados")` → `guardComandoGuardarItemAgrupadoCarta` → este caso de uso → `aResultadoAccion` y el
 * id y el nombre para su `ResultadoConId`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard). Un ítem agrupado es PROPIO de cada sucursal (ADR-009, C3): se
 * crea y se edita siempre en la sucursal activa, y el nombre no se puede repetir en ella (sin distinguir mayúsculas); la sección donde se ubica sí es de la empresa. Sin
 * imagen propia: la carta solo dibuja la de la sección.
 *
 * La carta pública se invalida por el tercer parámetro (`avisos.cartaCambio`): una vez cuando el ítem queda guardado (alta o edición) y, en el alta con productos (DA7),
 * otra por cada producto que entra, justo después de entrar. Un caso de uso no puede importar Next (`casos-de-uso-no-cookies`) y no alcanza con revalidar al final de la
 * acción, que no sabe cuántos productos entraron.
 *
 * Orden, igual que antes: 1. la sección (`No se encontró la sección de carta.`); 2. el género, si hay (que exista en la sucursal y esté activo); 3. otro ítem de la
 * sucursal con ese nombre (en la edición, sin contar el propio) → `Ya existe el ítem agrupado "<el guardado>".`, aunque el id a editar no exista; 4. con `id`: que el ítem
 * exista en la sucursal (`No se encontró el ítem agrupado.`) y se cambian sus campos; sin `id`: se crea. Si el índice único frena el INSERT o el UPDATE (otro pedido tomó el
 * nombre entre el chequeo y la escritura), responde lo mismo que el chequeo previo. 5. Solo en el alta con productos (DA7): de a uno, en el orden recibido y con la misma
 * validación que «Agregar producto» (`agregarOpcionItemAgrupadoCartaCasoDeUso`), cada uno se compara con los que ya entraron; un rechazo no frena a los demás ni deshace el alta:
 * se junta todo en un solo mensaje.
 *
 * @contract Deja el ítem agrupado con los datos pedidos (creado o editado) en la sucursal activa, salvo que otro de ella ya tenga ese nombre; en el alta suma como opciones los productos que cumplen las reglas de «Agregar producto»; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el alta encuentra el ítem ya creado y se rechaza por nombre repetido; repetir la edición vuelve a escribir los mismos valores.
 * @transaction Ninguna: lecturas y escrituras sueltas con `actor.db`, como antes (el ítem queda creado aunque algún producto no entre).
 * @sideEffects Ninguno (un ítem agrupado no es plata: sin auditoría). La carta pública se invalida por `avisos.cartaCambio`, que pasa la Server Action.
 * @ficha permiso=carta_items_agrupados transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarItemAgrupadoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoGuardarItemAgrupadoCarta,
  avisos: AvisosDeItemAgrupado,
): Promise<ResultadoGuardarItemAgrupadoCarta> {
  const seccion = await actor.db.seccionCarta.findUnique({ where: { id: comando.seccionCartaId }, select: { id: true } });
  if (!seccion) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección de carta.");
  const genero = await validarGeneroCartaOpcional(actor.db, actor.sucursalId, comando.generoCartaId);
  if (!genero.ok) return fracaso("GENERO_INVALIDO", genero.mensaje);

  const repetido = await actor.db.itemAgrupadoCarta.findFirst({
    where: { nombre: { equals: comando.nombre, mode: "insensitive" }, ...whereCartaDeSucursal(actor.sucursalId), ...(comando.id ? { NOT: { id: comando.id } } : {}) },
  });
  if (repetido) return fracaso("NOMBRE_REPETIDO", `Ya existe el ítem agrupado "${repetido.nombre}".`);

  const data = {
    nombre: comando.nombre,
    seccionCartaId: seccion.id,
    descripcion: comando.descripcion,
    tags: comando.tags,
    especial: comando.especial,
    orden: comando.orden,
    generoCartaId: genero.valor,
  };
  let it: { id: string; nombre: string };
  try {
    if (comando.id) {
      const existente = await actor.db.itemAgrupadoCarta.findUnique({ where: { id: comando.id, ...whereCartaDeSucursal(actor.sucursalId) } });
      if (!existente) return fracaso("ITEM_NO_ENCONTRADO", "No se encontró el ítem agrupado.");
      const editado = await cambiarDatosDeItemAgrupadoCarta(actor.db, { id: comando.id, datos: data });
      avisos.cartaCambio();
      return exito(`Ítem agrupado "${editado.nombre}" guardado.`, editado);
    }
    it = await crearItemAgrupadoDeCarta(actor.db, { sucursalId: actor.sucursalId, datos: data });
  } catch (e) {
    if (esErrorDeUnicidad(e)) return fracaso("NOMBRE_REPETIDO", `Ya existe el ítem agrupado "${comando.nombre}".`);
    throw e;
  }

  avisos.cartaCambio();
  const productoIds = [...new Set(comando.productoIds.map((id) => id.trim()).filter(Boolean))];
  if (productoIds.length === 0) return exito(`Ítem agrupado "${it.nombre}" creado.`, it);

  // DA7: de a uno, en el orden recibido, con la misma validación que "Agregar producto" (cada uno se compara con los que ya
  // entraron). Un rechazo no frena a los demás ni deshace el alta: se junta todo en un solo mensaje.
  const rechazos: string[] = [];
  for (const productoId of productoIds) {
    const r = await agregarOpcionItemAgrupadoCartaCasoDeUso(actor, { itemAgrupadoCartaId: it.id, productoId, orden: null });
    if (r.ok) avisos.cartaCambio();
    else rechazos.push(r.mensaje);
  }
  const entraron = productoIds.length - rechazos.length;
  const resumen = `Ítem agrupado "${it.nombre}" creado con ${entraron} de ${productoIds.length} producto${productoIds.length === 1 ? "" : "s"}.`;
  const detalle = rechazos.length ? ` ${rechazos.length === 1 ? "No entró" : "No entraron"}: ${rechazos.join(" ")}` : "";
  return exito(`${resumen}${detalle}`, it);
}
