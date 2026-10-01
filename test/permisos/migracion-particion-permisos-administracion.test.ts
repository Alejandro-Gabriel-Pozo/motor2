import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración de datos 20261001160000_particion_permisos_administracion: `gestion_permisos` suelta la gestión de roles, `gestion_usuarios` suelta
 * activar/anotar usuarios en la sucursal y apagar la cuenta en la empresa (cruza de contexto: por eso el padre se declara «mixto»), y
 * `alta_sucursal` suelta activar y renombrar sucursales. `ver_auditoria_empresa` (piso gerente) se da de alta sin padre. Los padres siguen.
 */
probarMigracionDeParticion({
  directorio: "20261001160000_particion_permisos_administracion",
  titulo: "partición de las claves de administración (roles, usuarios, sucursales)",
  sentenciasEsperadas: 6,
  contextoDePadres: { gestion_usuarios: "mixto" },
  accionesSinPadre: ["ver_auditoria_empresa"],
});
