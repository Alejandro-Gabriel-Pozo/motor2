# ADR-001: Definición de Empresa en Motor2

> Redactado el 2026-09-28, Fase 0.5 del checklist de multi-tenancy
> (`Downloads/Motor 2/motor2-multitenancy-checklist (1).md`). El contenido ya
> estaba decidido en `motor2-sesion-decisiones-pre-multitenant-v3.md`
> (Bloques 1, 2 y 10) — este documento solo lo redacta como ADR formal, no
> decide nada nuevo. Documentación pura: no toca código ni schema.

## Contexto

Motor2 hoy es un solo negocio con varias sucursales (Varvarco, Huinganco, Las
Ovejas, Manzano Amargo, Los Miches). El objetivo de la segunda
refactorización es evolucionarlo a varias empresas independientes en la
misma base, con aislamiento garantizado por diseño — no por un `WHERE` que
alguien recuerda escribir.

Antes de escribir el primer `empresaId` hace falta una definición única y
escrita de qué es una empresa, para evitar la mezcla `empresa = razón
social` en un lugar y `empresa = sucursal` en otro.

## Decisión

Una empresa es una razón social/CUIT. Una sucursal pertenece exactamente a
una empresa. Un usuario puede pertenecer a varias empresas y cambiar de
empresa activa durante una misma sesión (pertenencia `UsuarioEmpresa`). La
empresa es frontera legal, operativa y técnica de los datos.

Nombre del modelo: `Empresa`; columna: `empresaId`. **"Tenant" queda solo
como término de arquitectura** (aislamiento, RLS, "tenant-scoped" =
con `empresaId`): en el código de la carta ya significa otra cosa (una
sucursal publicada en el portal — `registro-tenants.ts`, `SucursalPublica`,
`GET /api/carta/tenants`, contrato externo). No confundirlos.

Un usuario con `UsuarioEmpresa.esGerente` gestiona usuarios y sus
asignaciones a sucursales en toda la empresa; nada más — no da permiso
sobre precios ni catálogo.

## Jerarquía

```
plataforma → empresa → sucursal → operación
```

Excepción: los reportes consolidan varias sucursales hacia la empresa.

Si en algún punto del código aparece una jerarquía alternativa como
`usuario → sucursal → empresa implícita`, es señal de que la empresa se
está infiriendo en vez de resolverse explícitamente — el mismo tipo de bug
que produce fugas de datos entre empresas.

## Alternativas consideradas

- **Empresa = sucursal** (no distinguir los dos conceptos): descartada — un
  negocio real con varias sucursales bajo una sola razón social (el caso
  actual de motor2) necesita que "empresa" y "sucursal" sean cosas
  distintas, con la empresa como frontera de aislamiento y la sucursal como
  unidad operativa dentro de ella.
- **Reusar "Tenant" como nombre del modelo**: descartada — el código de la
  carta pública ya usa "tenant" con un significado distinto y ya
  establecido (`registro-tenants.ts`). Reusarlo generaría ambigüedad real,
  no solo de nombre.

## Consecuencias

- Queda fijo el vocabulario para toda la segunda refactorización: `Empresa`
  / `empresaId` / `UsuarioEmpresa` (pertenencia) / `UsuarioSucursal`
  (membresía, ya existente).
- La jerarquía `plataforma → empresa → sucursal → operación` es la única
  verdad — cualquier código que la contradiga es una señal de alarma a
  corregir, no una variante aceptable.
- Queda pospuesto (fuera de alcance de esta decisión): facturación de la
  plataforma / planes y add-ons; marcas con múltiples razones sociales (no
  soportado en v1); cambio de una sucursal de una empresa a otra (no
  soportado en v1).
- Sigue abierto (no lo resuelve este ADR): `UsuarioEmpresa.rolId` (roles de
  sucursal vs. roles generales de empresa), detalle del superadmin de
  plataforma, ciclo de vida de add-ons.

## Revisar cuando

Si en algún momento una sucursal necesita pertenecer a más de una empresa
simultáneamente, o una marca necesita agrupar varias razones sociales bajo
un mismo panel — ninguno de los dos casos está soportado hoy ni se prevé
para v1.
