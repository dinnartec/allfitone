# Portadas de los programas del catálogo

Las veinticuatro imágenes que el catálogo sirve, una por programa global.

**Están aquí porque no se reconstruyen desde este repositorio.** Las demostraciones de
movimiento sí: `media.ts` vuelve a descargarlas y convertirlas desde su fuente. Éstas
salen del tablero `IMG-P · Portadas de programa` del lienzo de diseño —fotografía de
Unsplash con el tratamiento encima—, así que un manifiesto cuyos checksums apuntaran a
bytes que nadie tiene sería un manifiesto que no prueba nada.

**Sí se regeneran desde el lienzo**, y el 20 de septiembre de 2026 se hizo: los veinticuatro
marcos siguen ahí con su relleno de imagen en modo `fill`, así que cambiar el alto vuelve a
recortar del original en vez de estirar, y `Export` los saca en `webp` a escala 3.

El nombre del archivo es su `sha256`, que es también su dirección en el origen:
`programs/<program_id>/<sha256>.webp`. El que manda es `program-covers.json`, y
`004_program_covers.sql` se genera de él.

**Fotografía de Unsplash**, con la autoría en los metadatos de cada pieza del lienzo. Uso
comercial permitido; queda por decidir si acreditamos y dónde.

## Desplegar

Van al mismo origen que las demostraciones, bajo el prefijo `catalog`:

```
catalog/programs/<program_id>/<sha256>.webp
```

Son inmutables —la clave es el contenido, así que un arte nuevo es una dirección nueva y
nunca hay que purgar nada—, y el despliegue se hace desde `.media/site` entero:

```bash
bunx wrangler pages deploy packages/db/curation/import/.media/site \
  --project-name allfit-media --branch main
```

**El directorio entero, no sólo lo nuevo.** Un despliegue de Pages es el sitio completo:
subir sólo las portadas dejaría fuera las 388 demostraciones. Cloudflare deduplica lo que
ya tiene, así que subirlo todo cuesta lo mismo que subir lo que cambió. Antes de
desplegar, verificar cada objeto contra el checksum de su manifiesto: eso es lo que
prueba que lo que se sirve es lo que alguien revisó.

Desplegado por primera vez el 19 de septiembre de 2026: 24 objetos nuevos, 388 ya
presentes, y las 412 direcciones comprobadas después contra su checksum.

## Regeneradas el 20 de septiembre de 2026

Tres cosas a la vez, y las tres se veían:

1. **De 2,33:1 a 4:3** (1050 × 786). Eran bandas, y en una tarjeta de 330 × 300 se veía el
   47 % central: un poste, una espalda, nada. Ahora la tarjeta recorta un 17 % y la banda
   de Entrenar un 26 %.
2. **Se quitó «Contraste»** —`#4E5C64` en `overlay` al 55 %, que no está en ninguna
   pantalla del lienzo— y «Grado frío» bajó de 0,5 a **0,34**, que es lo que usa `FIN-2b`.
   Eso era el azul que se comía la fotografía. El velo pasa también al de `FIN-2b`.
3. **Seis fotografías cambiadas** porque no decían nada: árboles secos, nubes, un poste de
   madera, un campo vacío de noche. Se buscaron de nuevo con términos de entrenamiento.

## Regeneradas otra vez el 20 de septiembre de 2026

Dos cosas, y las dos se veían en la banda de Entrenar, que es donde la fotografía sale
grande:

1. **Dos fotografías retiradas por su encuadre.** «Fuerza básica» y «Torso y pierna» eran
   la misma toma: una mujer de espaldas en la sentadilla, encuadrada en espalda y glúteos.
   En una tarjeta cuadrada pasaba; en una banda de 1,9:1, que recorta la franja central,
   no quedaba otra cosa. Ahora son una barra cargada y alguien entrenando en una sala.
2. **El tratamiento pesaba demasiado.** «Desaturar» pasó a 0,55 y «Grado frío» de 0,34 a
   **0,18**. El conjunto había quedado tan frío y tan oscuro que media docena de piezas no
   se distinguían entre sí, que es el mismo defecto que la vez anterior con otro número.
   Con esto vuelven los colores propios de cada fotografía —la pista roja, la camiseta
   amarilla— y el velo sigue haciendo legible el rótulo.

El despliegue de esta tanda **conserva también las veinticuatro direcciones anteriores**.
La clave es el contenido, así que las nuevas son direcciones nuevas, y una base de datos
que todavía no haya corrido `004_program_covers.sql` sigue pidiendo las viejas: retirarlas
del sitio en el mismo despliegue que trae las nuevas habría dejado producción sin portadas
hasta que alguien corriera el guion.
