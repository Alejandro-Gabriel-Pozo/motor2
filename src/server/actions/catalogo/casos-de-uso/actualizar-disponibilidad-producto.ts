import "server-only";
import type { Prisma } from "@prisma/client";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import type { ComandoActualizarDisponibilidadProducto, ResultadoActualizarDisponibilidadProducto } from "@/core/features/catalogo/productos.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { dependenciasParaDesactivar } from "@/server/lecturas/catalogo/dependencias-para-desactivar";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { fijarDisponibilidadEnSucursal, tomarFilaDeProducto } from "@/server/persistencia/catalogo/productos";

/** «A, B y C» / «A, B y 2 más»: para que un mensaje de error no crezca sin límite con un catálogo grande. */
function enumerar(items: string[], tope = 4): string {
  const vistos = items.slice(0, tope);
  const resto = items.length - vistos.length;
  const cola = resto > 0 ? ` y ${resto} más` : "";
  return vistos.length > 1 && resto === 0 ? `${vistos.slice(0, -1).join(", ")} y ${vistos[vistos.length - 1]}` : `${vistos.join(", ")}${cola}`;
}

/**
 * Caso de uso «disponibilidad de un producto EN LA SUCURSAL ACTIVA» (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §6.1; Hito 4 de la pureza, bloque 4.3,
 * paso H4C-11 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `actualizarDisponibilidadProducto`
 * (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL: desactivarlo acá lo saca de los selectores de movimiento, de Stock consolidado y de la Valuación
 * DE ESTA SUCURSAL; y si es una MP de la receta vigente de un plato disponible acá, ese plato deja de poder venderse acá. Por eso al DESACTIVAR se BLOQUEA mientras
 * algo dependa de él EN ESTA SUCURSAL (recetas vigentes de platos disponibles acá, saldo en alguna sección de esta sucursal) y el mensaje dice qué es. Reactivar
 * nunca se bloquea (ver `dependenciasParaDesactivar`). La Server Action quedó como adaptador (`conPermiso("producto_disponibilidad")` → este caso de uso →
 * `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * D4 (decisión del dueño, 2026-10-11): ACTIVAR un producto de venta sin precio definido (hoy: `precioVenta` en 0) exige `producto_campos_sensibles`; quien solo tiene `producto_disponibilidad` prende y apaga los que YA tienen precio. El candado de M.2
 * hace que un PV creado sin esa clave nazca a $0 y apagado, pero nadie miraba el precio al prenderlo. La Server Action calcula `comando.puedeEditarCamposSensibles` con el gate y acá, sin ella, activar un PV a $0 es
 * `SIN_PERMISO_CAMPOS_SENSIBLES`. Todo va en UNA transacción que toma primero la fila del producto (`tomarFilaDeProducto`, `FOR UPDATE`): un cambio de precio concurrente espera a que ésta termine (o ésta espera a que aquél confirme y ve el
 * precio nuevo), así que no hay un «leí $4500, me cambiaron a $0, lo prendí» que deje el producto vendible a $0 sin la clave. Apagar nunca exige la clave.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Escribe siempre en `actor.sucursalId`.
 *
 * @contract Deja el producto disponible o no en la sucursal activa (al desactivar, solo si nada depende de él acá; al activar un producto de venta a $0, solo con la clave fina), con su fila de auditoría si cambió: todo o nada.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado (sin fila de auditoría nueva: no cambió).
 * @transaction `actor.transaccion` (READ COMMITTED): la fila del producto tomada (`FOR UPDATE`), su lectura, las dependencias, el valor anterior, la escritura y su auditoría, todo junto.
 * @sideEffects registrarCambioAuditado (DisponibilidadProducto.disponible, `entidadId` sucursal:producto), en la misma transacción. La revalidación
 *   de la carta pública la hace la Server Action.
 * @ficha permiso=producto_disponibilidad transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarDisponibilidadProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoActualizarDisponibilidadProducto,
): Promise<ResultadoActualizarDisponibilidadProducto> {
  const { productoId, disponible } = comando;
  return actor.transaccion(async (tx): Promise<ResultadoActualizarDisponibilidadProducto> => {
    // D4: la fila se toma ANTES de leer el precio (ver arriba). Una id inexistente no toma nada y cae en el «no se encontró» de abajo.
    await tomarFilaDeProducto(tx, productoId);
    const validado = await validarCambioDeDisponibilidadEnTx(tx, actor, comando);
    if (!validado.ok) return validado;
    await escribirCambioDeDisponibilidadEnTx(tx, actor, validado.datos, disponible);
    return exito(`Producto "${validado.datos.nombre}" ${disponible ? "activado" : "desactivado"} en "${actor.sucursalNombre}".`, null);
  });
}

/** Lo que `validarCambioDeDisponibilidadEnTx` deja listo para escribir: el producto y su disponibilidad ANTERIOR en la sucursal (leída con la fila del producto ya tomada). */
export interface CambioDeDisponibilidadValidado {
  productoId: string;
  nombre: string;
  anterior: boolean;
}

/**
 * Las reglas de «poner a la venta o sacar de la venta un producto en la sucursal activa», SIN escribir nada, dentro de la transacción de quien llama y con la fila del producto YA TOMADA
 * (`tomarFilaDeProducto`, `FOR UPDATE`): que exista, el blindaje del ancla (GO-2a, D-1), D4 (activar un PV a $0 exige la clave fina) y, al desactivar, las dependencias en esta sucursal. Devuelve el
 * valor anterior para la auditoría. CARTA-MANT: la usan este caso de uso (un producto) y `fijar-disponibilidad-de-hoy.ts` (varios, todo o nada: valida todos antes de escribir el primero).
 */
export async function validarCambioDeDisponibilidadEnTx(
  tx: Prisma.TransactionClient,
  actor: Pick<ContextoUsuario, "sucursalId" | "sucursalNombre">,
  comando: ComandoActualizarDisponibilidadProducto,
): Promise<ResultadoCaso<CambioDeDisponibilidadValidado, "PRODUCTO_NO_ENCONTRADO" | "TIENE_DEPENDENCIAS" | "SIN_PERMISO_CAMPOS_SENSIBLES" | "ES_ANCLA_DE_ADICIONAL">> {
  const { productoId, disponible } = comando;
  const existente = await tx.producto.findUnique({ where: { id: productoId }, include: { opcionQueRespalda: { select: { id: true } } } });
  if (!existente) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  // GO-2a (blindaje del ancla, D-1): el producto que respalda un adicional NO tiene disponibilidad a propósito (queda oculto por «sin fila = no disponible», ADR-009 `optin`) y se
  // vende solo como la línea del adicional; ponerlo a la venta lo haría aparecer como un producto suelto. Apagarlo no hace falta ni molesta.
  if (disponible && existente.opcionQueRespalda) {
    return fracaso("ES_ANCLA_DE_ADICIONAL", `"${existente.nombre}" es el producto de respaldo de un adicional: se vende solo como adicional, no se pone a la venta suelto.`);
  }
  if (disponible && existente.tipo === "PV" && Number(existente.precioVenta) === 0 && !comando.puedeEditarCamposSensibles) {
    return fracaso(
      "SIN_PERMISO_CAMPOS_SENSIBLES",
      `No se puede poner a la venta "${existente.nombre}" en "${actor.sucursalNombre}": todavía no tiene precio (está en $0) y ponerlo a la venta así lo decide quien tiene el permiso «campos sensibles del producto» (producto_campos_sensibles). ` +
        `Pedile a un administrador que le cargue el precio, o que lo ponga a la venta.`,
    );
  }
  if (!disponible) {
    const { recetasVigentes, saldos } = await dependenciasParaDesactivar(productoId, actor.sucursalId, tx);
    const motivos: string[] = [];
    if (recetasVigentes.length) motivos.push(`está en la receta vigente de ${enumerar(recetasVigentes.map((r) => r.nombre))}: sacalo de esas recetas`);
    if (saldos.length) {
      const donde = enumerar(saldos.map((s) => `${s.sucursalNombre} / ${s.seccionNombre} (${s.saldo})`));
      motivos.push(`tiene saldo en ${donde}: dejalo en cero con un ajuste`);
    }
    if (motivos.length) {
      return fracaso("TIENE_DEPENDENCIAS", `No se puede desactivar "${existente.nombre}" en "${actor.sucursalNombre}": ${motivos.join("; y ")} antes de desactivarlo.`);
    }
  }
  // El valor anterior se lee ANTES del upsert — registrarCambioAuditado necesita comparar contra el estado previo real, no
  // contra el que se está por escribir (si no, "repetir el mismo estado no deja registro" dejaría de cumplirse).
  const anterior = await productoDisponibleEn(actor.sucursalId, productoId, tx);
  return exito("", { productoId, nombre: existente.nombre, anterior });
}

/** La escritura de un cambio ya validado: la disponibilidad en la sucursal activa y su auditoría (no-op en la auditoría si no cambió), en la transacción de quien llama. */
export async function escribirCambioDeDisponibilidadEnTx(
  tx: Prisma.TransactionClient,
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "sucursalNombre">,
  validado: CambioDeDisponibilidadValidado,
  disponible: boolean,
): Promise<void> {
  await fijarDisponibilidadEnSucursal(tx, { sucursalId: actor.sucursalId, productoId: validado.productoId, disponible });
  // Auditoría administrativa, como el cambio de activo de un rol. No-op si el valor no cambió (registrarCambioAuditado).
  await registrarCambioAuditado(tx, {
    entidad: "DisponibilidadProducto", entidadId: `${actor.sucursalId}:${validado.productoId}`, campo: "disponible",
    descripcion: `Producto "${validado.nombre}" en "${actor.sucursalNombre}": disponible`,
    valorAnterior: validado.anterior, valorNuevo: disponible, actorId: actor.usuarioId,
  });
}
