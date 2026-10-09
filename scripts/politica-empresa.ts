/**
 * Cambia la política de plataforma de una empresa (add-on, ADR-008/ADR-010). La lógica vive en `src/server/operaciones-de-plataforma/cambiar-politica-de-empresa.ts`
 * (transaccional, con auditoría, testeada); esto solo lee los argumentos. Es la ÚNICA vía para cambiarla: ninguna pantalla de la app lo hace.
 *
 * Uso: npm run politica-empresa -- --slug norte --actor operador@plataforma.com [--instalacion zuluhub] [--perfil lite|completo] \
 *        [--permisos-editables si|no] [--dos-paneles si|no]
 *
 * `--perfil` (perfil de política, no un plan de módulos) fija las dos perillas de una vez (`lite`: sin edición de permisos y menú único; `completo`: todo activo); las perillas sueltas se
 * aplican después y lo pisan.
 *
 * Conexión (ADR-025): con `--instalacion <id>`, esa instalación de `PLATAFORMA_INSTALACIONES_ADICIONALES` (o la principal); sin el flag, si el archivo de
 * entorno administra varias instalaciones hay que elegir una (no cae en la principal en silencio); sin el flag y sin instalaciones adicionales, el
 * comportamiento de siempre: PLATAFORMA_DATABASE_URL (sin ella falla: no cae en la conexión de la app, S-33). La conexión tiene que ser del rol `motor2_plataforma` (se comprueba con
 * `select current_user`).
 *
 * `--actor` es el email de un administrador de plataforma ACTIVO (`AdminPlataforma`, S-33): se verifica contra la base de identidad de la consola (la instalación principal). NO tiene que
 * ser un usuario de la app ni se crea ninguno. El cambio queda en la auditoría de PLATAFORMA (`AuditoriaPlataforma`, con la instalación), no en el registro de auditoría de la empresa.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { ConexionDePlataformaError, describirConexion } from "./conexion-de-plataforma";
import { abrirContextoDePlataforma, type ContextoDePlataforma } from "./contexto-de-plataforma";
import { PoliticaDeEmpresaError } from "../src/core/features/empresa/cambio-de-politica";
import { cambiarPoliticaDeEmpresa } from "../src/server/operaciones-de-plataforma/cambiar-politica-de-empresa";
import { ActorDePlataformaError } from "../src/server/operaciones-de-plataforma/requerir-admin-de-plataforma";
import { PERFILES_DE_POLITICA, type NombreDePerfilDePolitica } from "../src/core/permisos/politica-de-empresa";

function siONo(valor: string | undefined, opcion: string): boolean | undefined {
  if (valor === undefined) return undefined;
  if (valor === "si") return true;
  if (valor === "no") return false;
  throw new PoliticaDeEmpresaError(`--${opcion} acepta "si" o "no" (llegó "${valor}").`);
}

function perfil(valor: string | undefined): NombreDePerfilDePolitica | undefined {
  if (valor === undefined) return undefined;
  if (valor in PERFILES_DE_POLITICA) return valor as NombreDePerfilDePolitica;
  throw new PoliticaDeEmpresaError(`--perfil acepta ${Object.keys(PERFILES_DE_POLITICA).join(" o ")} (llegó "${valor}").`);
}

let contexto: ContextoDePlataforma | undefined;

async function main() {
  const { values } = parseArgs({
    options: {
      slug: { type: "string" },
      actor: { type: "string" },
      instalacion: { type: "string" },
      perfil: { type: "string" },
      "permisos-editables": { type: "string" },
      "dos-paneles": { type: "string" },
    },
    strict: true,
  });
  if (!values.slug || !values.actor) throw new PoliticaDeEmpresaError("Faltan --slug y --actor (el email del administrador de plataforma que hace el cambio).");

  const permisosEditables = siONo(values["permisos-editables"], "permisos-editables");
  const dosPaneles = siONo(values["dos-paneles"], "dos-paneles");
  const perfilElegido = perfil(values.perfil);

  // La conexión, el rol y el actor (un AdminPlataforma activo de la base de identidad) quedan resueltos ANTES de la operación.
  contexto = await abrirContextoDePlataforma(process.env, { instalacion: values.instalacion, actor: values.actor });
  console.log(`Instalación: ${describirConexion(contexto.conexion)}. Actor: ${contexto.autor.adminEmail}.`);

  const resultado = await cambiarPoliticaDeEmpresa(
    contexto.db,
    {
      slug: values.slug,
      ...(perfilElegido ? { perfil: perfilElegido } : {}),
      ...(permisosEditables !== undefined ? { permisosEditables } : {}),
      ...(dosPaneles !== undefined ? { dosPaneles } : {}),
    },
    contexto.autor,
  );

  const { permisosEditables: edita, dosPaneles: paneles } = resultado.politica;
  const queda = `permisos editables: ${edita ? "sí" : "no"}, dos paneles: ${paneles ? "sí" : "no"}`;
  console.log(
    resultado.cambiadas.length === 0
      ? `Sin cambios: la empresa "${values.slug}" ya estaba así (${queda}).`
      : `Empresa "${values.slug}" actualizada (${resultado.cambiadas.join(", ")}). Ahora: ${queda}. Quedó en la auditoría de plataforma (no en el registro de la empresa).`,
  );
}

main()
  .catch((error: unknown) => {
    if (error instanceof PoliticaDeEmpresaError || error instanceof ConexionDePlataformaError || error instanceof ActorDePlataformaError) console.error(`Error: ${error.message}`);
    else console.error(error);
    process.exitCode = 1;
  })
  .finally(() => contexto?.cerrar());
