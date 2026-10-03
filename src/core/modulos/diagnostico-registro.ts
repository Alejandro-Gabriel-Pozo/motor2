import { MODULOS, esModuloDelCatalogo } from "./catalogo";

export interface EmpresaParaDiagnostico {
  id: string;
  slug: string;
  estado: string;
  /** Se creó antes de que se aplicara la migración del registro: el backfill tenía que darle sus filas. */
  creadaAntesDeLaMigracion: boolean;
}

export interface FilaParaDiagnostico {
  empresaId: string;
  modulo: string;
}

export interface DiagnosticoDelRegistro {
  /** Hacen fallar el build: una empresa que ya existía y quedó sin registro perdería todos sus módulos al activarse el guard. */
  fallas: string[];
  /** Se informan pero no frenan: casos válidos (empresa nueva que la plataforma todavía no activó) o filas que el guard ignora. */
  avisos: string[];
}

const VENDIBLES = new Set<string>(MODULOS.filter((m) => m.tipo === "vendible").map((m) => m.id));

/**
 * Bloque 5A, P5. Regla: solo falla una empresa ACTIVE creada antes de la migración que no tiene ninguna fila (el backfill se la tenía que dar).
 * Una empresa creada después sin filas es un estado válido (el alta no siembra el registro: la activa la plataforma) y solo avisa; una empresa que
 * no está ACTIVE sin filas también. Las filas de un módulo que no es un vendible del catálogo se listan (el guard las ignora): son un error de carga.
 */
export function diagnosticarRegistroDeModulos(entrada: {
  empresas: readonly EmpresaParaDiagnostico[];
  filas: readonly FilaParaDiagnostico[];
}): DiagnosticoDelRegistro {
  const fallas: string[] = [];
  const avisos: string[] = [];
  const conFilas = new Set(entrada.filas.map((f) => f.empresaId));
  const empresas = [...entrada.empresas].sort((a, b) => a.slug.localeCompare(b.slug));

  for (const e of empresas) {
    if (conFilas.has(e.id)) continue;
    const etiqueta = `${e.slug} [${e.estado}]`;
    if (e.estado === "ACTIVE" && e.creadaAntesDeLaMigracion) {
      fallas.push(`${etiqueta}: existía antes de la migración y no tiene ninguna fila en ModuloEmpresa (el backfill no corrió o se perdió).`);
    } else {
      avisos.push(`${etiqueta}: sin filas en ModuloEmpresa (la plataforma todavía no le activó módulos).`);
    }
  }

  const slugPorId = new Map(empresas.map((e) => [e.id, e.slug]));
  for (const f of entrada.filas) {
    if (VENDIBLES.has(f.modulo)) continue;
    const motivo = esModuloDelCatalogo(f.modulo) ? "es un módulo fijo o de soporte, que se calcula y no se registra" : "no existe en el catálogo";
    avisos.push(`${slugPorId.get(f.empresaId) ?? f.empresaId}: la fila del módulo «${f.modulo}» ${motivo}; el guard la ignora.`);
  }

  return { fallas, avisos };
}
