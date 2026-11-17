/**
 * Plantillas de rol y pisos de plataforma (roles propios, EB-1). La lógica vive en `src/server/operaciones-de-plataforma/plantillas-y-pisos.ts` (transaccional, con auditoría, testeada); esto solo lee los argumentos. Es la ÚNICA vía
 * para operar plantillas y pisos: ninguna pantalla de la app ni de la consola lo hace todavía, y el guard no las lee (eso es EB-3).
 *
 * Uso (cada comando necesita --actor, el email de un administrador de plataforma ACTIVO, y el código de 6 dígitos de su app de autenticación: ver `scripts/politica-empresa.ts`):
 *   npx tsx scripts/plantillas-y-pisos.ts publicar --plantilla OPERADOR --numero 2 [--dar-ver a,b] [--dar-editar c] [--quitar d] [--quitar-editar e] --motivo "…" --actor yo@plataforma.com [--clave <uuid>] [--instalacion zuluhub]
 *   npx tsx scripts/plantillas-y-pisos.ts piso      --accion proceso_ajuste --tipo SOLO_GERENTE --version 0 --motivo "…" --actor …
 *   npx tsx scripts/plantillas-y-pisos.ts sincronizar --actor …
 *
 * `--clave` es la clave de reintento (un UUID) de `publicar`: si el comando se corta o se repite, volver a correrlo con la MISMA clave devuelve lo ya hecho y no duplica nada. Sin `--clave` se genera una y se IMPRIME
 * (guardala si querés poder reintentar). `publicar --numero` es el número que esperás para la versión (la última + 1) y `piso --version` la versión del piso que esperás (0 = todavía no tiene piso): si otra persona
 * cambió antes, falla sin pisar nada. `sincronizar` suma al sistema las acciones nuevas del catálogo del código (las agrega a las plantillas que su semilla indica y les da piso); nunca quita ni repone.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { ConexionDePlataformaError, describirConexion } from "./conexion-de-plataforma";
import { abrirContextoDePlataforma, type ContextoDePlataforma } from "./contexto-de-plataforma";
import { PlanesError } from "../src/core/features/empresa/planes";
import { PlantillasError } from "../src/core/permisos/plantillas-y-pisos";
import { ActorDePlataformaError } from "../src/server/operaciones-de-plataforma/requerir-admin-de-plataforma";
import { fijarPisoDePlataforma, publicarVersionDePlantilla, sincronizarAccionesNuevas } from "../src/server/operaciones-de-plataforma/plantillas-y-pisos";

let contexto: ContextoDePlataforma | undefined;

function requerido(valor: string | undefined, opcion: string): string {
  if (!valor) throw new PlantillasError(`Falta --${opcion}.`);
  return valor;
}

function entero(valor: string | undefined, opcion: string, minimo: 0 | 1): number {
  const texto = requerido(valor, opcion);
  if (!/^(0|[1-9][0-9]{0,8})$/.test(texto) || Number(texto) < minimo) throw new PlantillasError(`--${opcion} tiene que ser un entero desde ${minimo} (llegó "${texto}").`);
  return Number(texto);
}

const lista = (valor: string | undefined): string[] => (valor ?? "").split(",").map((c) => c.trim()).filter((c) => c !== "");

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      actor: { type: "string" },
      instalacion: { type: "string" },
      clave: { type: "string" },
      plantilla: { type: "string" },
      numero: { type: "string" },
      "dar-ver": { type: "string" },
      "dar-editar": { type: "string" },
      quitar: { type: "string" },
      "quitar-editar": { type: "string" },
      accion: { type: "string" },
      tipo: { type: "string" },
      version: { type: "string" },
      motivo: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const comando = positionals[0];
  if (!comando || !["publicar", "piso", "sincronizar"].includes(comando)) throw new PlantillasError("Indicá el comando: publicar, piso o sincronizar.");
  if (!values.actor) throw new PlantillasError("Falta --actor (el email del administrador de plataforma que hace el cambio).");
  const clave = values.clave ?? randomUUID();

  contexto = await abrirContextoDePlataforma(process.env, { instalacion: values.instalacion, actor: values.actor });
  console.log(`Instalación: ${describirConexion(contexto.conexion)}. Actor: ${contexto.autor.adminEmail}. Clave de reintento: ${clave}`);

  if (comando === "publicar") {
    const r = await publicarVersionDePlantilla(
      contexto.db,
      {
        clave,
        plantilla: requerido(values.plantilla, "plantilla"),
        numeroEsperado: entero(values.numero, "numero", 1),
        darVer: lista(values["dar-ver"]),
        darEditar: lista(values["dar-editar"]),
        quitar: lista(values.quitar),
        quitarEditar: lista(values["quitar-editar"]),
        motivo: requerido(values.motivo, "motivo"),
      },
      contexto.autor,
    );
    console.log(r.publicada ? `Versión ${r.numero} de la plantilla "${values.plantilla}" publicada. Es inmutable: para cambiarla, publicá una versión nueva.` : `Sin cambios: esa versión (nº ${r.numero}) ya estaba publicada con esa clave.`);
  } else if (comando === "piso") {
    const r = await fijarPisoDePlataforma(
      contexto.db,
      { accion: requerido(values.accion, "accion"), tipo: requerido(values.tipo, "tipo"), versionEsperada: entero(values.version, "version", 0), motivo: requerido(values.motivo, "motivo") },
      contexto.autor,
    );
    console.log(r.cambiado ? `Piso de "${values.accion}" fijado en ${values.tipo} (versión ${r.version}).` : `Sin cambios: el piso de "${values.accion}" ya era ${values.tipo} (versión ${r.version}).`);
    if (r.plantillasQueLaTienen.length > 0) console.log(`Aviso: la última versión de estas plantillas contiene la acción: ${r.plantillasQueLaTienen.join(", ")}. El piso manda, pero no toca sus listas: ajustalas en la próxima publicación.`);
  } else {
    const r = await sincronizarAccionesNuevas(contexto.db, contexto.autor);
    console.log(r.introducidas === 0 ? "Sin cambios: el catálogo no trae acciones nuevas." : `Sincronizadas ${r.introducidas} acción(es) nueva(s): ${r.versiones} versión(es) de plantilla y ${r.pisos} piso(s) creados.`);
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof PlantillasError || error instanceof PlanesError || error instanceof ConexionDePlataformaError || error instanceof ActorDePlataformaError) console.error(`Error: ${error.message}`);
    else console.error(error);
    process.exitCode = 1;
  })
  .finally(() => contexto?.cerrar());
