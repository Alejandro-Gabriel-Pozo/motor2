import "server-only";
import { prisma } from "@/lib/db";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { describirCambioVersionReceta, describirDescarteArrastre } from "@/core/catalogo/public";
import { esErrorDeUnicidad, validarCabecera, validarIngredientes, validarPasos } from "@/core/catalogo/public-servidor";
import { MENSAJE_PRODUCTO_NO_ENCONTRADO } from "@/core/features/catalogo/receta-version.guard";
import type { ComandoGuardarVersionDeReceta, ResultadoGuardarVersionDeReceta } from "@/core/features/catalogo/receta-version.schema";
import { conReintento, conTransaccionSerializable, esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import {
  cargarNombresDeSucursales,
  cargarProductoParaReceta,
  cargarUltimaVersionDeReceta,
  copiarCalibracionesLocales,
  escribirVersionDeReceta,
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
 *  3. reintento (`conReintento`, hasta 5 intentos, ante un choque del UNIQUE (productoId, version) o un conflicto de escritura):
 *     a. relee la versión vigente COMPLETA (FUERA de la transacción) y calcula `version` = MAX + 1, de forma optimista;
 *     b. dentro de UNA transacción SERIALIZABLE (desde D3, docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 6: el arrastre
 *        lee/escribe `RendimientoLocalIngrediente`, que una calibración concurrente también puede estar tocando):
 *        - crea la versión con ingredientes, pasos, cabecera y la tabla puente paso↔ingrediente (persistencia);
 *        - D3, arrastre de calibraciones locales por `insumoProductoId`: se COPIAN si el ingrediente sigue y con la misma unidad; si cambió
 *          la unidad o salió de la receta se DESCARTAN (nunca se arrastran "resucitadas" con otra unidad) y cada descarte se audita
 *          (cantidad y merma, en la sucursal de la calibración). Un cambio de cantidad/merma CENTRAL no descarta nada;
 *        - auditoría de la versión nueva (D6(b), paso 2): `RecetaVersion`/`version`, `sucursalId` siempre `null` (Catálogo Central);
 *  4. el mensaje de éxito, con el aviso de las calibraciones descartadas si hubo.
 *
 * @contract Crea una versión NUEVA de la receta (append-only) y arrastra las calibraciones locales compatibles, auditando las que se descartan.
 * @idempotency No aplica — append-only, cada guardado crea una versión nueva; no hay un "duplicado" que detectar.
 * @transaction conTransaccionSerializable (SERIALIZABLE), reabierta hasta 5 veces vía conReintento si choca el UNIQUE(productoId, version) o hay conflicto de escritura.
 * @sideEffects registrarCambioAuditado (la versión nueva, y cada calibración local descartada por cambio de unidad o salida de la receta).
 */
export async function guardarVersionDeRecetaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalNombre" | "transaccion">,
  comando: ComandoGuardarVersionDeReceta
): Promise<ResultadoGuardarVersionDeReceta> {
  const { productoId, items, pasos, cabecera } = comando;

  const producto = await cargarProductoParaReceta(prisma, productoId);
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", MENSAJE_PRODUCTO_NO_ENCONTRADO);

  const elegible = producto.tipo === "PV" || (producto.tipo === "MP" && producto.seProduce);
  if (!elegible) {
    return fracaso("PRODUCTO_NO_ELEGIBLE", `"${producto.nombre}" no es elegible para tener receta — tiene que ser PV, o MP con "Se produce" activado.`);
  }

  const invalidoIngredientes = await validarIngredientes(items, producto);
  if (invalidoIngredientes) return fracaso("INGREDIENTES_INVALIDOS", invalidoIngredientes);

  const invalidoPasos = validarPasos(pasos, items);
  if (invalidoPasos) return fracaso("PASOS_INVALIDOS", invalidoPasos);

  const invalidoCabecera = await validarCabecera(cabecera);
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
  await conReintento(
    async () => {
      descartes = [];
      // La versión anterior COMPLETA (con sus overrides locales) — D3: se arrastra a la versión nueva, salvo que el
      // ingrediente haya cambiado de unidad o haya salido de la receta. Fuera de la transacción, igual que antes.
      const ultima = await cargarUltimaVersionDeReceta(prisma, productoId);
      version = (ultima?.version ?? 0) + 1;
      await conTransaccionSerializable(actor.transaccion, async (tx) => {
        const creada = await escribirVersionDeReceta(tx, { productoId, version, items, pasos, cabecera });
        recetaVersionId = creada.id;

        // D3 — arrastre de calibraciones locales (RendimientoLocalIngrediente) de la versión vieja a la nueva, por
        // insumoProductoId. Si cambió la unidad, o el ingrediente salió de la receta, la calibración se DESCARTA
        // (nunca se arrastra "resucitada" con otra unidad) y se audita. Un cambio de cantidad/merma CENTRAL no
        // descarta nada — la calibración es de la sucursal, no del valor central.
        if (ultima) {
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
          descripcion: describirCambioVersionReceta(producto.nombre, actor.sucursalNombre),
          valorAnterior: ultima ? ultima.version : null,
          valorNuevo: version,
          actorId: actor.usuarioId,
          sucursalId: null,
        });
      });
    },
    { maxIntentos: 5, esReintentable: (e) => esErrorDeUnicidad(e) || esConflictoDeEscritura(e) }
  );

  const avisoDescartes = descartes.length ? ` Se descartó la calibración local de ${descartes.join(", ")}.` : "";
  return exito(`Receta de "${producto.nombre}" guardada como versión ${version}.${avisoDescartes}`, {
    recetaVersionId,
    version,
    calibracionesDescartadas: descartes,
  });
}
