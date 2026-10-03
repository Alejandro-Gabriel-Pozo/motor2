export interface EmpresaParaDiagnosticoDeRoles {
  id: string;
  slug: string;
  estado: string;
}

export interface RolParaDiagnostico {
  empresaId: string;
  nombre: string;
  clave: string | null;
}

export interface DiagnosticoDeRolesDeSistema {
  /** Hacen fallar el build: el código va a identificar al administrador por la clave, y una empresa con un «admin» sin clave se quedaría sin él. */
  fallas: string[];
  /** Se informan pero no frenan: una empresa ACTIVE todavía sin ningún rol administrador. */
  avisos: string[];
}

/**
 * Bloque G, G1. Regla: toda empresa que tenga un rol llamado «admin» tiene también uno con la clave «admin» (el backfill de la migración, o el punto que
 * creó el rol, tenía que ponerla). Una empresa ACTIVE sin ningún rol administrador solo avisa: puede ser una empresa recién creada a mano, y no la rompe
 * esta migración.
 */
export function diagnosticarRolesDeSistema(entrada: {
  empresas: readonly EmpresaParaDiagnosticoDeRoles[];
  roles: readonly RolParaDiagnostico[];
}): DiagnosticoDeRolesDeSistema {
  const fallas: string[] = [];
  const avisos: string[] = [];

  for (const e of [...entrada.empresas].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const roles = entrada.roles.filter((r) => r.empresaId === e.id);
    const etiqueta = `${e.slug} [${e.estado}]`;
    const conNombreAdmin = roles.some((r) => r.nombre === "admin");
    const conClaveAdmin = roles.some((r) => r.clave === "admin");
    if (conNombreAdmin && !conClaveAdmin) {
      fallas.push(`${etiqueta}: tiene un rol llamado «admin» pero ninguno con la clave «admin» (el backfill de Rol.clave no corrió o un alta no la puso).`);
    } else if (!conNombreAdmin && !conClaveAdmin && e.estado === "ACTIVE") {
      avisos.push(`${etiqueta}: sin ningún rol administrador (ni por nombre ni por clave).`);
    }
  }

  return { fallas, avisos };
}
