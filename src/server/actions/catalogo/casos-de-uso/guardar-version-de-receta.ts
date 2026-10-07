import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { describirCambioVersionReceta, describirCopiaDeRecetaPropia, describirDescarteArrastre, describirRecetaPropiaGuardada } from "@/core/catalogo/public";
import { validarCabecera, validarIngredientes, validarPasos } from "@/core/catalogo/public";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { cargarDatosParaValidarReceta } from "@/server/persistencia/catalogo/cargar-datos-para-validar-receta";
import { MENSAJE_PRODUCTO_NO_ENCONTRADO } from "@/core/features/catalogo/receta-version.guard";
import type { ComandoGuardarVersionDeReceta, ResultadoGuardarVersionDeReceta } from "@/core/features/catalogo/receta-version.schema";
import { conReintento, conTransaccionSerializable, esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import {
  cargarIdDeVersionCentralVigente,
  cargarNombresDeSucursales,
  cargarProductoParaReceta,
  cargarUltimaVersionDeReceta,
  copiarCalibracionesLocales,
  escribirVersionDeReceta,
  habilitarRecetaPropia,
} from "@/server/persistencia/catalogo/guardar-version-de-receta";

/**
 * Caso de uso «guardar una versión nueva de la receta» (Task #41, P1 — docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación
 * que antes vivía en línea en la Server Action `guardarReceta` (src/server/actions/catalogo/recetas.ts), en el MISMO orden y con los MISMOS
 * textos; la Server Action quedó como adaptador fino (permiso → guard → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso`) ni el formato del
 * `productoId` (eso lo hizo `guardComandoGuardarVersionDeReceta`). Sin idempotencia I3: `guardarReceta` nunca la tuvo (cada guardado es,
 * a propósito, una versión nueva append-only).
 *
 * Pasos, en el orden de siempre:
 *  1. carga del producto (FUERA de la transacción) → «no encontrado»; elegibilidad (PV, o MP con "Se produce");
 *  2. `validarIngredientes` → `validarPasos` → `validarCabecera` (el primero que falla da el mensaje);
 *  3. reintento (`conReintento`, hasta 5 intentos, ante un choque del UNIQUE (productoId, version) o un conflicto de escritura), cada intento en UNA transacción SERIALIZABLE:
 *     a. relee la versión vigente COMPLETA (con sus calibraciones locales) DENTRO de la transacción, la compara con `versionEsperada` y calcula `version` = MAX + 1;
 *     b. dentro de esa misma transacción (desde D3, docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 6: el arrastre
 *        lee/escribe `RendimientoLocalIngrediente`, que una calibración concurrente también puede estar tocando):
 *        - crea la versión con ingredientes, pasos, cabecera y la tabla puente paso↔ingrediente (persistencia);
 *        - D3, arrastre de calibraciones locales por `insumoProductoId`: se COPIAN si el ingrediente sigue y con la misma unidad; si cambió
 *          la unidad o salió de la receta se DESCARTAN (nunca se arrastran "resucitadas" con otra unidad) y cada descarte se audita
 *          (cantidad y merma, en la sucursal de la calibración). Un cambio de cantidad/merma CENTRAL no descarta nada;
 *        - auditoría de la versión nueva (D6(b), paso 2): `RecetaVersion`/`version`, `sucursalId` siempre `null` (Catálogo Central);
 *     (si la serie ya va por una versión distinta de `comando.versionEsperada`, se corta acá con `VERSION_DESACTUALIZADA` y no se escribe nada);
 *  4. el mensaje de éxito, con el aviso de las calibraciones descartadas si hubo.
 *
 * RECETA PROPIA (ADR-009, receta propia por sucursal): con `destino.sucursalId` el caso de uso guarda en la serie PROPIA de esa sucursal en vez de la central —
 * la versión se numera sobre SU historial, la receta propia queda habilitada, la versión declara en qué versión central se basó (`basadaEnVersionId`:
 * la central vigente de hoy, o la que pase quien llama, p. ej. al copiar de otra sucursal) y la auditoría lleva la sucursal. No arrastra ni descarta
 * calibraciones: no las hay sobre una receta propia (cuelgan de las líneas de la central y no rigen mientras la propia está habilitada).
 *
 * @contract Crea una versión NUEVA de la receta (append-only) y arrastra las calibraciones locales compatibles, auditando las que se descartan.
 * @idempotency Optimista — `versionEsperada` (la versión sobre la que se armó el reemplazo) se compara con la vigente en cada intento: si otra persona guardó en el medio, se rechaza (`VERSION_DESACTUALIZADA`) en vez de pisarla. Sin ella (seeds, scripts) es un reemplazo a ciegas: cada guardado crea una versión nueva, append-only.
 * @transaction conTransaccionSerializable (SERIALIZABLE), reabierta hasta 5 veces vía conReintento si choca el UNIQUE(productoId, version) o hay conflicto de escritura.
 * @sideEffects registrarCambioAuditado (la versión nueva, y cada calibración local descartada por cambio de unidad o salida de la receta).
 * @ficha permiso=guardar_receta transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO
 */
/** Dónde se guarda la versión: la serie CENTRAL (`sucursalId` null) o la PROPIA de una sucursal. */
export type DestinoDeVersionDeReceta = { sucursalId: null } | { sucursalId: string; basadaEnVersionId?: string | null; copiadaDeSucursal?: string };

export async function guardarVersionDeRecetaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalNombre" | "db" | "transaccion">,
  comando: ComandoGuardarVersionDeReceta,
  destino: DestinoDeVersionDeReceta = { sucursalId: null }
): Promise<ResultadoGuardarVersionDeReceta> {
  const { productoId, items, pasos, cabecera, versionEsperada } = comando;
  const sucursalId = destino.sucursalId;

  const producto = await cargarProductoParaReceta(actor.db, productoId);
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", MENSAJE_PRODUCTO_NO_ENCONTRADO);

  const elegible = producto.tipo === "PV" || (producto.tipo === "MP" && producto.seProduce);
  if (!elegible) {
    return fracaso("PRODUCTO_NO_ELEGIBLE", `"${producto.nombre}" no es elegible para tener receta — tiene que ser PV, o MP con "Se produce" activado.`);
  }

  // Lo del catálogo que la validación necesita, en lote (cuatro consultas); la validación en sí es pura.
  const datosDeValidacion = await cargarDatosParaValidarReceta(actor.db, items, cabecera);
  const invalidoIngredientes = validarIngredientes(items, producto, datosDeValidacion);
  if (invalidoIngredientes) return fracaso("INGREDIENTES_INVALIDOS", invalidoIngredientes);

  const invalidoPasos = validarPasos(pasos, items);
  if (invalidoPasos) return fracaso("PASOS_INVALIDOS", invalidoPasos);

  const invalidoCabecera = validarCabecera(cabecera, datosDeValidacion);
  if (invalidoCabecera) return fracaso("CABECERA_INVALIDA", invalidoCabecera);

  // Reintento con backoff y jitter (mismo ciclo de siempre, core/movimientos/reintentar.ts): dos ediciones simultáneas de la
  // MISMA receta calculan la misma `version` y una choca con el UNIQUE (productoId, version) — se relee el máximo y se
  // reintenta. Desde D3 (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 6) la transacción pasa a
  // SERIALIZABLE (el arrastre de calibraciones locales lee/escribe `RendimientoLocalIngrediente`, que una calibración
  // concurrente también puede estar tocando): se reintenta tanto el choque de UNIQUE como un conflicto de escritura
  // (esErrorDeUnicidad(e) || esConflictoDeEscritura(e)).
  let version = 0;
  let recetaVersionId = "";
  let descartes: string[] = [];
  const rechazo: { resultado: ResultadoGuardarVersionDeReceta | null } = { resultado: null };
  await conReintento(
    async () => {
      descartes = [];
      rechazo.resultado = null;
      await conTransaccionSerializable(actor.transaccion, async (tx) => {
        // La versión anterior COMPLETA (con sus overrides locales) — D3: se arrastra a la versión nueva, salvo que el ingrediente haya cambiado de unidad o haya salido de la receta.
        // Se lee DENTRO de la transacción SERIALIZABLE (Pureza Fase 4, H7): si una calibración local (`fijarRendimientoLocal`) se confirmaba entre esta lectura y la escritura, la versión
        // nueva se llevaba la foto vieja y la calibración quedaba colgada de la versión anterior, sin que nadie lo notara. Leyendo acá, el motor ve el cruce (esta transacción lee
        // `RendimientoLocalIngrediente` y `RecetaVersion`, la calibración escribe lo primero y lee lo segundo) y aborta a una de las dos con 40001, que el reintento repite.
        const ultima = await cargarUltimaVersionDeReceta(tx, productoId, sucursalId);
        // H7 (lectura-modificación-escritura): si quien llama armó este reemplazo sobre la versión N y la serie ya va por otra, alguien guardó en el medio y este guardado pisaría su cambio.
        // Se RECHAZA con un mensaje (decisión del dueño, 2026-10-06) en vez de pisar en silencio. Se chequea en cada intento: si el choque de UNIQUE (dos guardados simultáneos) obliga a
        // repetir, la relectura ve la versión del ganador y el perdedor termina acá. Un rechazo confirma la transacción sin haber escrito nada.
        const versionActual = ultima?.version ?? 0;
        if (versionEsperada !== null && versionEsperada !== versionActual) {
          rechazo.resultado = fracaso(
            "VERSION_DESACTUALIZADA",
            versionEsperada === 0
              ? `La receta de "${producto.nombre}" cambió mientras la editabas (cuando abriste la pantalla todavía no tenía receta y ahora va por la versión ${versionActual}). Recargá la pantalla y volvé a hacer el cambio.`
              : `La receta de "${producto.nombre}" cambió mientras la editabas (ahora va por la versión ${versionActual}, y partiste de la ${versionEsperada}). Recargá la pantalla y volvé a hacer el cambio.`
          );
          return;
        }
        version = versionActual + 1;
        const basadaEnVersionId = sucursalId === null ? null : destino.basadaEnVersionId !== undefined ? destino.basadaEnVersionId : await cargarIdDeVersionCentralVigente(tx, productoId);
        const creada = await escribirVersionDeReceta(tx, { productoId, version, items, pasos, cabecera, sucursalId, basadaEnVersionId });
        recetaVersionId = creada.id;

        // D3 — arrastre de calibraciones locales (RendimientoLocalIngrediente) de la versión vieja a la nueva, por
        // insumoProductoId. Si cambió la unidad, o el ingrediente salió de la receta, la calibración se DESCARTA
        // (nunca se arrastra "resucitada" con otra unidad) y se audita. Un cambio de cantidad/merma CENTRAL no
        // descarta nada — la calibración es de la sucursal, no del valor central.
        if (ultima && sucursalId === null) {
          const sucursalIds = new Set<string>();
          for (const viejoIng of ultima.ingredientes) for (const r of viejoIng.rendimientosLocales) sucursalIds.add(r.sucursalId);
          const sucursales = await cargarNombresDeSucursales(tx, Array.from(sucursalIds));
          const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));

          for (const viejoIng of ultima.ingredientes) {
            if (!viejoIng.rendimientosLocales.length) continue; // nada calibrado en ninguna sucursal: nada que arrastrar ni descartar.
            const nuevoIng = creada.ingredientes.find((i) => i.insumoProductoId === viejoIng.insumoProductoId);

            if (nuevoIng && nuevoIng.unidadId === viejoIng.unidadId) {
              await copiarCalibracionesLocales(tx, nuevoIng.id, viejoIng.rendimientosLocales);
              continue;
            }

            const motivo = !nuevoIng ? "se quitó de la receta" : `cambió la unidad de ${viejoIng.unidad.nombre} a ${nuevoIng.unidad.nombre}`;
            for (const r of viejoIng.rendimientosLocales) {
              const sucNombre = nombreSucursal.get(r.sucursalId) ?? r.sucursalId;
              const entidadId = `${r.sucursalId}:${productoId}:${viejoIng.insumoProductoId}`;
              const descripcion = describirDescarteArrastre({ insumoNombre: viejoIng.insumoProducto.nombre, sucursalNombre: sucNombre, version, motivo });
              await registrarCambioAuditado(tx, {
                entidad: "RendimientoLocalIngrediente", entidadId, campo: "cantidad", descripcion,
                valorAnterior: r.cantidad !== null ? Number(r.cantidad) : null, valorNuevo: null,
                actorId: actor.usuarioId, sucursalId: r.sucursalId,
              });
              await registrarCambioAuditado(tx, {
                entidad: "RendimientoLocalIngrediente", entidadId, campo: "mermaPorcentaje", descripcion,
                valorAnterior: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null, valorNuevo: null,
                actorId: actor.usuarioId, sucursalId: r.sucursalId,
              });
              descartes.push(`«${sucNombre}» para "${viejoIng.insumoProducto.nombre}" (${motivo})`);
            }
          }
        }

        // Auditoría (D6(b), docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 2): un registro por versión
        // nueva de la receta CENTRAL — sucursalId siempre null (Catálogo Central, no un dato por sucursal). El origen
        // es siempre manual: guardarReceta no recibe ningún parámetro `origen`.
        await registrarCambioAuditado(tx, {
          entidad: "RecetaVersion",
          entidadId: creada.id,
          campo: "version",
          descripcion:
            sucursalId === null
              ? describirCambioVersionReceta(producto.nombre, actor.sucursalNombre)
              : destino.copiadaDeSucursal
                ? describirCopiaDeRecetaPropia(producto.nombre, actor.sucursalNombre, destino.copiadaDeSucursal, version)
                : describirRecetaPropiaGuardada(producto.nombre, actor.sucursalNombre, version),
          valorAnterior: ultima ? ultima.version : null,
          valorNuevo: version,
          actorId: actor.usuarioId,
          sucursalId,
        });

        // Guardar en la serie propia la deja habilitada (si estaba deshabilitada, o es la primera vez): se audita ese cambio de «rige la central» a «rige la propia».
        if (sucursalId !== null) {
          const estabaHabilitada = await habilitarRecetaPropia(tx, sucursalId, productoId);
          await registrarCambioAuditado(tx, {
            entidad: "RecetaSucursal",
            entidadId: `${sucursalId}:${productoId}`,
            campo: "habilitada",
            descripcion: `Receta de "${producto.nombre}" en "${actor.sucursalNombre}": pasa a usar la receta propia de la sucursal.`,
            valorAnterior: estabaHabilitada,
            valorNuevo: true,
            actorId: actor.usuarioId,
            sucursalId,
          });
        }
      });
    },
    // `aleatorio`: el jitter de la espera con la fuente de azar del borde (la de la transacción); sin ella, todos los que chocan a la vez esperarían lo mismo y volverían a chocar en bloque.
    { maxIntentos: 5, esReintentable: (e) => esErrorDeUnicidad(e) || esConflictoDeEscritura(e), aleatorio: actor.transaccion.aleatorio }
  );

  if (rechazo.resultado) return rechazo.resultado;

  const avisoDescartes = descartes.length ? ` Se descartó la calibración local de ${descartes.join(", ")}.` : "";
  return exito(`Receta de "${producto.nombre}" guardada como versión ${version}.${avisoDescartes}`, {
    recetaVersionId,
    version,
    calibracionesDescartadas: descartes,
  });
}
