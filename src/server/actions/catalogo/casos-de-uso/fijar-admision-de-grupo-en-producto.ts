import "server-only";
import type { Prisma } from "@prisma/client";
import { ALCANCE_CENTRAL } from "@/core/catalogo/public";
import { MENSAJE_GRUPO_NO_ENCONTRADO } from "@/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoFijarAdmisionDeGrupo, ResultadoFijarAdmisionDeGrupo } from "@/core/features/catalogo/opciones-de-venta.schema";
import { cambiosPorColumna, controlarPrecioDeLista, validarAdmisionDeGrupo, type AdmisionDeOpcion, type DiferenciaDePrecio } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";
import { actualizarAdmisionDeGrupo, actualizarAdmisionDeOpcion, crearAdmisionDeGrupo, crearAdmisionDeOpcion } from "@/server/persistencia/catalogo/opciones-de-venta";
import { cargarGrupoEnTx, versionVigenteEnTx } from "./opciones-de-venta-en-tx";

const desactualizada = (producto: string, grupo: string) =>
  fracaso("VERSION_DESACTUALIZADA", `Lo que admite «${producto}» de «${grupo}» cambió mientras lo editabas. Recargá la pantalla y volvé a hacer el cambio.`);

const aNumero = (d: unknown): number | null => (d === null || d === undefined ? null : Number(d));

/** Las tres columnas de una diferencia por producto, como las guarda la base. */
function columnasDeDiferencia(d: DiferenciaDePrecio | null) {
  if (d === null) return { tipoDeDiferencia: null, diferenciaPrecio: null, porcentaje: null };
  return d.tipo === "MONTO" ? { tipoDeDiferencia: "MONTO", diferenciaPrecio: d.monto, porcentaje: null } : { tipoDeDiferencia: "PORCENTAJE", diferenciaPrecio: null, porcentaje: d.porcentaje };
}

function diferenciaDeLaFila(f: { tipoDeDiferencia: string | null; diferenciaPrecio: unknown; porcentaje: unknown }): DiferenciaDePrecio | null {
  if (f.tipoDeDiferencia === "MONTO") return { tipo: "MONTO", monto: Number(f.diferenciaPrecio) };
  if (f.tipoDeDiferencia === "PORCENTAJE") return { tipo: "PORCENTAJE", porcentaje: Number(f.porcentaje) };
  return null;
}

/**
 * Caso de uso «fijar lo que un producto admite de un grupo de opciones» (GO-2a; ADR-030 §4: lista de permitidos, fila ausente = no). Para el par (producto, grupo) deja la fila
 * de `ProductoAdmiteGrupo` y las de `ProductoAdmiteOpcion` de las opciones que trae el comando, cada una con la VERSIÓN que vio la pantalla (0 = todavía no existe). Nunca borra:
 * quitar es `activo = false`. Las filas de opciones del grupo que el comando no trae quedan como están (y cuentan para las reglas).
 *
 * Todo dentro de UNA transacción SERIALIZABLE, con lo leído ahí:
 *  1. el producto existe, es de VENTA y no es el ancla de un adicional (un ancla no admite opciones);
 *  2. el grupo existe; cada versión esperada coincide con la de la base (si no, `VERSION_DESACTUALIZADA` y no se escribe nada);
 *  3. las reglas puras de la admisión sobre el estado RESULTANTE (`validarAdmisionDeGrupo`: cantidades efectivas, modo de precio, precio absoluto, mínimo alcanzable);
 *  4. al admitir (o reactivar) el grupo o una opción, tienen que estar activos para la empresa (`GRUPO_INACTIVO`, `OPCION_INACTIVA`);
 *  5. el control de precio de lista (`controlarPrecioDeLista`, la misma cuenta que la venta) opción por opción sobre el precio de venta del producto, si lo tiene (un producto en 0
 *     se cobra con el precio de cada sucursal; la venta igual falla cerrado si allá no da);
 *  6. aviso, sin bloqueo: un REEMPLAZA de una opción cuyo insumo no está en la receta central vigente del producto (S3: no reemplaza nada); sin receta central todavía, no se avisa.
 * Una admisión simultánea del mismo par compite por las mismas filas (una gana, la otra `VERSION_DESACTUALIZADA` o 23505 y reintento); bajar el máximo del grupo a la vez que acá se fija
 * un mínimo incompatible es un cruce de lectura y escritura entre las dos transacciones (cada una lee lo que la otra escribe): SERIALIZABLE aborta a una (40001) y su reintento rechaza.
 *
 * @contract Deja lo que el producto admite de ese grupo como pide el comando (o igual si no cambió nada) y devuelve la fila del grupo y su versión.
 * @idempotency Optimista — la versión de cada fila se compara dentro de la transacción y en el `where` del UPDATE; repetir sin cambios no escribe ni audita, y repetir con la versión vieja da `VERSION_DESACTUALIZADA`.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: dos altas del mismo par chocan con el único `(productoId, grupoId)` u `(productoId, opcionId)` y el reintento da el resultado de negocio.
 * @sideEffects registrarCambioAuditado (una fila por columna cambiada de cada fila, con el antes y el después), con el mismo `tx`.
 * @ficha permiso=producto_opciones_admitidas transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function fijarAdmisionDeGrupoEnProductoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">,
  comando: ComandoFijarAdmisionDeGrupo
): Promise<ResultadoFijarAdmisionDeGrupo> {
  return conTransaccionSerializable(actor.transaccion, (tx) => fijarAdmisionDeGrupoEnTx(tx, actor, comando), undefined, undefined, true);
}

/**
 * El cuerpo de la admisión, DENTRO de una transacción SERIALIZABLE que abre quien llama: este caso de uso y, OPCIONES-LIMPIEZA, «volver a vincular» un grupo a un producto
 * (`vincular-grupo-en-producto.ts`), que relee la fila y la vuelve a activar con las mismas reglas y la misma auditoría, en su misma transacción.
 */
export async function fijarAdmisionDeGrupoEnTx(
  tx: Prisma.TransactionClient,
  actor: Pick<ContextoDeAccion, "usuarioId" | "ahora">,
  comando: ComandoFijarAdmisionDeGrupo
): Promise<ResultadoFijarAdmisionDeGrupo> {
  const producto = await tx.producto.findFirst({ where: { id: comando.productoId }, select: { id: true, nombre: true, tipo: true, precioVenta: true } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("PRODUCTO_NO_ELEGIBLE", `«${producto.nombre}» no es un producto de venta: solo un producto de venta admite opciones.`);
  if (await tx.opcionDeGrupo.findFirst({ where: { productoId: producto.id }, select: { id: true } })) {
    return fracaso("PRODUCTO_NO_ELEGIBLE", `«${producto.nombre}» es el producto de respaldo de un adicional: no admite opciones.`);
  }
  const grupo = await cargarGrupoEnTx(tx, comando.grupoId);
  if (!grupo) return fracaso("GRUPO_NO_ENCONTRADO", MENSAJE_GRUPO_NO_ENCONTRADO);

  const opcionesDelGrupo = await tx.opcionDeGrupo.findMany({ where: { grupoId: grupo.id }, select: { id: true, nombre: true, activa: true, esNinguna: true } });
  const delGrupo = new Map(opcionesDelGrupo.map((o) => [o.id, o]));
  const filaGrupo = await tx.productoAdmiteGrupo.findUnique({
    where: { productoId_grupoId: { productoId: producto.id, grupoId: grupo.id } },
    select: { id: true, orden: true, cantidadMinima: true, cantidadMaxima: true, modoPrecio: true, activo: true, version: true },
  });
  const filasOpciones = await tx.productoAdmiteOpcion.findMany({
    where: { productoId: producto.id, opcionId: { in: opcionesDelGrupo.map((o) => o.id) } },
    select: { id: true, opcionId: true, cantidadMaxima: true, precioAbsoluto: true, tipoDeDiferencia: true, diferenciaPrecio: true, porcentaje: true, activo: true, version: true },
  });
  const filaDe = new Map(filasOpciones.map((f) => [f.opcionId, f]));

  // Lo que cambiaría, columna por columna (el antes y el después de la auditoría). Si NADA cambia, el estado ya es el pedido (un doble clic que llegó después de que el primero
  // confirmó): éxito sin escribir, aunque la versión que vio la pantalla ya no sea la de la base. Si algo cambia, cada versión esperada tiene que ser la de la base.
  const fila = { orden: comando.orden, cantidadMinima: comando.cantidadMinima, cantidadMaxima: comando.cantidadMaxima, modoPrecio: comando.modoPrecio, activo: comando.activo };
  const cambiosDelGrupo = cambiosPorColumna([
    { campo: "orden", antes: filaGrupo?.orden ?? null, despues: fila.orden },
    { campo: "cantidadMinima", antes: filaGrupo?.cantidadMinima ?? null, despues: fila.cantidadMinima },
    { campo: "cantidadMaxima", antes: filaGrupo?.cantidadMaxima ?? null, despues: fila.cantidadMaxima },
    { campo: "modoPrecio", antes: filaGrupo?.modoPrecio ?? null, despues: fila.modoPrecio },
    { campo: "activo", antes: filaGrupo?.activo ?? null, despues: fila.activo },
  ]);
  const cambiosDeOpciones = comando.opciones.map((o) => {
    const anterior = filaDe.get(o.opcionId);
    const despues = columnasDeDiferencia(o.diferencia);
    return {
      o,
      anterior,
      cambios: cambiosPorColumna([
        { campo: "cantidadMaxima", antes: anterior?.cantidadMaxima ?? null, despues: o.cantidadMaxima },
        { campo: "precioAbsoluto", antes: aNumero(anterior?.precioAbsoluto), despues: o.precioAbsoluto },
        { campo: "tipoDeDiferencia", antes: anterior?.tipoDeDiferencia ?? null, despues: despues.tipoDeDiferencia },
        { campo: "diferenciaPrecio", antes: aNumero(anterior?.diferenciaPrecio), despues: despues.diferenciaPrecio },
        { campo: "porcentaje", antes: aNumero(anterior?.porcentaje), despues: despues.porcentaje },
        { campo: "activo", antes: anterior?.activo ?? null, despues: o.activo },
      ]),
    };
  });
  if (filaGrupo && cambiosDelGrupo.length === 0 && cambiosDeOpciones.every((c) => c.cambios.length === 0)) {
    return exito(`Lo que «${producto.nombre}» admite de «${grupo.nombre}» no tenía cambios.`, { admisionId: filaGrupo.id, version: filaGrupo.version, huboCambio: false, avisos: [] });
  }
  if ((filaGrupo?.version ?? 0) !== comando.versionEsperada) return desactualizada(producto.nombre, grupo.nombre);
  for (const o of comando.opciones) {
    if (delGrupo.has(o.opcionId) && (filaDe.get(o.opcionId)?.version ?? 0) !== o.versionEsperada) return desactualizada(producto.nombre, grupo.nombre);
  }

  // El estado RESULTANTE de las opciones: las filas que ya estaban, pisadas por las del comando.
  const resultantes = new Map<string, AdmisionDeOpcion>(
    filasOpciones.map((f) => [
      f.opcionId,
      { opcionId: f.opcionId, cantidadMaxima: f.cantidadMaxima, precioAbsoluto: f.precioAbsoluto === null ? null : Number(f.precioAbsoluto), diferencia: diferenciaDeLaFila(f), activo: f.activo },
    ])
  );
  const vistas = new Set<string>();
  for (const o of comando.opciones) {
    // Una opción repetida en el comando o de otro grupo la rechaza `validarAdmisionDeGrupo` (se le pasa la lista tal cual llegó, más las filas que el comando no toca).
    if (vistas.has(o.opcionId) || !delGrupo.has(o.opcionId)) continue;
    vistas.add(o.opcionId);
    resultantes.set(o.opcionId, { opcionId: o.opcionId, cantidadMaxima: o.cantidadMaxima, precioAbsoluto: o.precioAbsoluto, diferencia: o.diferencia, activo: o.activo });
  }
  const noTocadas = [...resultantes.values()].filter((r) => !comando.opciones.some((o) => o.opcionId === r.opcionId));
  const admision = { cantidadMinima: comando.cantidadMinima, cantidadMaxima: comando.cantidadMaxima, modoPrecio: comando.modoPrecio, activo: comando.activo };
  const regla = validarAdmisionDeGrupo({
    grupo,
    opcionesDelGrupo: opcionesDelGrupo.map((o) => ({ opcionId: o.id, nombre: o.nombre, activa: o.activa, esNinguna: o.esNinguna })),
    admision,
    opciones: [...comando.opciones.map((o) => ({ opcionId: o.opcionId, cantidadMaxima: o.cantidadMaxima, precioAbsoluto: o.precioAbsoluto, diferencia: o.diferencia, activo: o.activo })), ...noTocadas],
  });
  if (!regla.ok) return fracaso("CONFIGURACION_INVALIDA", regla.mensaje);

  if (comando.activo && !(filaGrupo?.activo ?? false) && !grupo.activo) {
    return fracaso("GRUPO_INACTIVO", `«${grupo.nombre}» está archivado: restauralo (en Opciones de venta → Archivados) antes de que un producto lo use.`);
  }
  for (const o of comando.opciones) {
    const opcion = delGrupo.get(o.opcionId)!;
    if (o.activo && !(filaDe.get(o.opcionId)?.activo ?? false) && !opcion.activa) {
      return fracaso("OPCION_INACTIVA", `«${opcion.nombre}» está archivada: restaurala (en la pantalla de su grupo) antes de que un producto la use.`);
    }
  }

  // Control de precio de lista, con la diferencia de cada opción resuelta (la del producto si la sobrescribe, si no la de su versión vigente).
  const activasAdmitidas = comando.activo ? [...resultantes.values()].filter((r) => r.activo && delGrupo.get(r.opcionId)!.activa) : [];
  const vigentes = new Map(await Promise.all(activasAdmitidas.map(async (r) => [r.opcionId, await versionVigenteEnTx(tx, r.opcionId)] as const)));
  const precioDeVenta = Number(producto.precioVenta);
  if (precioDeVenta > 0) {
    const control = controlarPrecioDeLista(
      grupo.tipo,
      comando.modoPrecio,
      precioDeVenta,
      activasAdmitidas.map((r) => {
        const vigente = vigentes.get(r.opcionId) ?? null;
        return {
          opcionId: r.opcionId,
          nombre: delGrupo.get(r.opcionId)!.nombre,
          versionDeOpcionId: vigente?.id ?? "",
          factorEscala: vigente?.factorEscala ?? null,
          precioAbsoluto: r.precioAbsoluto,
          diferencia: r.diferencia ?? vigente?.diferencia ?? null,
        };
      })
    );
    if (!control.ok) return fracaso("CONFIGURACION_INVALIDA", control.mensaje);
  }

  // S3: un REEMPLAZA que no encuentra su insumo en la receta central del producto no reemplaza nada. No bloquea, y solo se avisa si el producto YA tiene receta central: sin
  // receta todavía no hay con qué comparar (el aviso sería ruido mientras se carga el catálogo).
  const avisos: string[] = [];
  const reemplazos = [...vigentes.entries()].flatMap(([opcionId, v]) => (v?.consumos ?? []).filter((c) => c.efecto === "REEMPLAZA").map((c) => ({ opcionId, reemplazado: c.reemplazaAProductoId! })));
  if (reemplazos.length > 0) {
    const receta = await cargarRecetaVigente(tx, ALCANCE_CENTRAL, producto.id, { select: { ingredientes: { select: { insumoProductoId: true } } } });
    const enLaReceta = new Set((receta?.ingredientes ?? []).map((i) => i.insumoProductoId));
    for (const r of reemplazos) {
      if (receta && !enLaReceta.has(r.reemplazado)) avisos.push(`«${delGrupo.get(r.opcionId)!.nombre}» reemplaza un insumo que la receta de «${producto.nombre}» no tiene: en este producto no reemplaza nada.`);
    }
  }

  // Escrituras: la fila del grupo y las de las opciones que cambian, cada una con su versión esperada en el `where`, y su auditoría por columna.
  let admisionId = filaGrupo?.id ?? "";
  let version = filaGrupo?.version ?? 0;
  if (!filaGrupo) {
    admisionId = (await crearAdmisionDeGrupo(tx, { productoId: producto.id, grupoId: grupo.id, fila, ahora: actor.ahora })).id;
    version = 1;
  } else if (cambiosDelGrupo.length > 0) {
    if ((await actualizarAdmisionDeGrupo(tx, { id: filaGrupo.id, versionEsperada: filaGrupo.version, fila, ahora: actor.ahora })) === 0) return desactualizada(producto.nombre, grupo.nombre);
    version = filaGrupo.version + 1;
  }
  const descripcionDelGrupo = `«${producto.nombre}» admite «${grupo.nombre}»${comando.activo ? "" : " (apagado en el producto)"}.`;
  for (const c of cambiosDelGrupo) {
    await registrarCambioAuditado(tx, { entidad: "ProductoAdmiteGrupo", entidadId: admisionId, campo: c.campo, descripcion: descripcionDelGrupo, valorAnterior: c.antes, valorNuevo: c.despues, actorId: actor.usuarioId, sucursalId: null });
  }

  for (const { o, anterior, cambios } of cambiosDeOpciones) {
    if (cambios.length === 0) continue;
    const nueva = { cantidadMaxima: o.cantidadMaxima, precioAbsoluto: o.precioAbsoluto, diferencia: o.diferencia, activo: o.activo };
    let filaId = anterior?.id ?? "";
    if (!anterior) filaId = (await crearAdmisionDeOpcion(tx, { productoId: producto.id, opcionId: o.opcionId, fila: nueva, ahora: actor.ahora })).id;
    else if ((await actualizarAdmisionDeOpcion(tx, { id: anterior.id, versionEsperada: anterior.version, fila: nueva, ahora: actor.ahora })) === 0) return desactualizada(producto.nombre, grupo.nombre);
    const descripcion = `«${producto.nombre}» admite «${delGrupo.get(o.opcionId)!.nombre}» de «${grupo.nombre}»${o.activo ? "" : " (apagada en el producto)"}.`;
    for (const c of cambios) {
      await registrarCambioAuditado(tx, { entidad: "ProductoAdmiteOpcion", entidadId: filaId, campo: c.campo, descripcion, valorAnterior: c.antes, valorNuevo: c.despues, actorId: actor.usuarioId, sucursalId: null });
    }
  }

  const aviso = avisos.length ? ` ${avisos.join(" ")}` : "";
  return exito(
    `Listo: «${producto.nombre}» admite «${grupo.nombre}» como pediste.${aviso}`,
    { admisionId, version, huboCambio: true, avisos }
  );
}
