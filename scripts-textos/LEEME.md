# Scripts de los lotes del catálogo de textos (respaldo; esta rama NO se mergea)

Rama `textos-scripts` de `motor2`, solo respaldo (autorizado por el dueño, 2026-11-16: «Sí, respaldar ramas propias sin PR (Recomendada)»). No van a `main` (knip y los cercos los tomarían por código del repo). Se copian a una carpeta temporal y se corren desde la raíz del repo, sobre la rama del lote.

| Script | Qué hace | Cómo se corre |
|---|---|---|
| `lote-columnas.cjs` | Reemplaza literales de rótulos de columna (`etiqueta`/`encabezado`/`label`/`texto`/`titulo`) en `src/app/(app)/reportes/` por `textoDe("columna.<tema>")` y agrega el import; deja un JSON con archivo, clave, valor y función que lo usa | `node lote-columnas.cjs <raíz> medir|aplicar <salida.json> "Producto=producto,Cantidad=cantidad,…"` |
| `entradas-columnas.py` | Con ese JSON agrega las entradas `columna.*` al catálogo (con `usos` y `fuente`), la clase de clave `columna.` al guardián y su prueba | `python3 entradas-columnas.py <lote.json> DEC-NNNN <orden> "<comentario>"` |
| `c1.py` | Lote C1: primitiva `entidad`, `ENTIDADES`, `rechazo.NO_ENCONTRADO`, los 9 casos de uso de `server/actions/auth/`, oráculo y DEC | en la raíz, sobre la rama del lote A: `python3 c1.py DEC-NNNN` |
| `c2.py` | Lote C2: 32 sitios de «No se encontró …» en 25 archivos al molde con entidad, 14 entidades, 10 pruebas adaptadas, DEC | en la raíz, sobre C1: `python3 c2.py DEC-NNNN` |
| `d.py` y `d-congeladas.py` | Lote D: «Ya existe {un/una} … llamado «X». Elegí otro nombre.» en clientes (artículo `{entidad:un}`), golden `dinero-tramo-c`, DEC; el segundo declara la regeneración del golden en un commit hijo | `python3 d.py DEC-NNNN`; commit; `python3 d-congeladas.py <sha-corto> 322721c0f9c21f71ee6b4e8f022528d50d6efa94` |
| `shards.sh` | Corre Vitest en 4 partes, cada una con su copia de la base (`motor2_s1..4`, hechas con `createdb -T motor2_dev`) | `shards.sh <raíz>`; deja `/tmp/shard{1..4}.log` y `/tmp/shards.done` |

**Listas:** valores del lote B: Producto, Cantidad, Sección, Proveedor, Insumo, Categoría, Unidades, Origen (`producto,cantidad,seccion,proveedor,insumo,categoria,unidades,origen`); lote E: Importe, Cobrado, Margen, Food cost %, Costo unitario, A precio de lista, Margen Real (cobrado) (`importe,cobrado,margen,food_cost,costo_unitario,a_precio_de_lista,margen_real_cobrado`). Los archivos de C2 y los textos de cada DEC están dentro de `c2.py` y `d.py`. **No incluidos** (se escribieron de memoria y se reconstruyeron en el momento): los scripts de medición de inventario (`medir-datos`, `medir-mensajes`), descritos en `docs/diseno-textos-en-datos-2026-11-16.md` §2 y §8.

Entorno de pruebas: Postgres 16 con locale `en_US.utf8`, roles de `.github/workflows/ci.yml` (`scripts/operaciones/crear-rol-motor2-app.sql`, `crear-rol-motor2-plataforma.sql`), `npx prisma migrate deploy` y variables de entorno del `ci.yml`.
