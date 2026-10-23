# Baúl

App para iPhone donde guardar fotos, vídeos y documentos **comprimidos**, que se abre **sin internet**.
Todo se queda dentro del iPhone: no se sube nada a ningún servidor.

## Qué hace

- **Añadir**: fotos y vídeos de la Fototeca, fotos con la cámara o cualquier archivo de la app Archivos (PDF, Word, textos…), varios a la vez.
- **Compresión automática**:
  - Fotos: se optimizan a la resolución de la pantalla del iPhone (2560 px, calidad 82 %). Se ven nítidas y ocupan un 70–90 % menos. En Ajustes puedes elegir *Ahorro máximo* o *Original*.
  - Documentos y textos: compresión **sin pérdidas** (gzip). Al abrirlos son idénticos al original.
  - Vídeos: se guardan tal cual (ya vienen comprimidos por el iPhone).
  - Las fotos con transparencia y los GIF animados no se tocan.
- **Código de acceso**: al abrirla pide un código de 6 números. Todo se guarda cifrado (AES-256) con él, incluidos los nombres de los archivos. Se bloquea sola al salir (al momento, tras 1 minuto o tras 5, a elegir) y con el candado de arriba. Tras 5 intentos fallidos hay que esperar. Si olvidas el código, los archivos no se pueden recuperar: solo queda borrar el baúl y empezar de cero.
- **Visor**: fotos con pellizcar/doble toque para ampliar, deslizar para pasar y hacia abajo para cerrar; vídeos, audio, PDF y textos.
- **Guardar en otra app**: el botón *Guardar / Compartir* abre el menú de iOS (Guardar en Fotos, Guardar en Archivos, WhatsApp, Mail…). También para varios archivos a la vez con *Seleccionar*.
- **No se pierde nada** al cerrar la app, cambiar de app o apagar el iPhone: los archivos quedan guardados en el almacenamiento del teléfono.
- **Copia de seguridad**: Ajustes → *Exportar todo (.zip)* para guardarla en Archivos/iCloud Drive, y *Restaurar desde una copia* para recuperarla (no duplica lo que ya está). La copia va cifrada: para restaurarla pide el código que tenías al hacerla.

## Ponerla en tu iPhone

La app es una web instalable (PWA): se publica una vez y se instala desde Safari. Después funciona sin conexión.

1. **Publicarla con GitHub Pages** (gratis):
   - GitHub Pages en repositorios privados necesita GitHub Pro. Con cuenta gratuita, haz el repositorio público
     (*Settings → General → Change visibility → Public*). Solo es público el código de la app; tus archivos nunca salen del iPhone.
   - *Settings → Pages → Build and deployment → Source: Deploy from a branch*, elige la rama `main` y la carpeta `/ (root)`, y pulsa *Save*.
   - En 1–2 minutos estará en `https://fakefer67-coder.github.io/Claude-/`.
2. **Instalarla**: abre esa dirección en **Safari** en el iPhone → botón Compartir → **Añadir a pantalla de inicio**.
3. Ábrela desde el icono **Baúl** y crea tu código. La primera vez necesita internet; a partir de ahí funciona en modo avión.

> Importante: usa siempre el icono de la pantalla de inicio, no la pestaña de Safari. Son almacenes separados y la versión instalada es la que iOS protege contra el borrado automático.
> Si borras el icono, iOS borra también los archivos del baúl: haz antes una copia de seguridad.

## Archivos

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | Interfaz y estilos |
| `app.js` | Compresión, cifrado, código de acceso, almacenamiento (IndexedDB), visor, compartir y copias de seguridad |
| `sw.js` | Guarda la app en el iPhone para que abra sin internet |
| `manifest.webmanifest`, `icons/` | Nombre e icono al instalarla |

Requisitos: iOS 16.4 o superior (para la compresión sin pérdidas; en versiones anteriores funciona pero sin comprimir documentos).

Para publicar una versión nueva, cambia `CACHE` en `sw.js` (por ejemplo `baul-v2`) para que los iPhone descarguen la actualización.
