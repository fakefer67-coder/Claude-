# Baúl

App para iPhone donde guardar fotos, vídeos y documentos **comprimidos**, que se abre **sin internet**.
Todo se queda dentro del iPhone: no se sube nada a ningún servidor.

## Qué hace

- **Guarda sin esperar**: al elegir archivos se guardan al instante (cifrados) y aparecen en la cuadrícula; la compresión se hace después, en segundo plano, mientras sigues usando la app. Si sales o apagas el móvil, lo ya guardado está a salvo y la compresión continúa sola la próxima vez que abras el Baúl.
- **Cualquier tipo de archivo**: fotos, vídeos, audio, PDF, Word/Excel, ZIP, textos, JSON, CSV, código… Los textos y JSON se ven dentro de la app (el JSON, ordenado y con colores) y se pueden copiar.
- **Carpetas**: crea carpetas (y carpetas dentro de carpetas), mueve archivos entre ellas, renómbralas o bórralas. La búsqueda y los filtros buscan dentro de la carpeta abierta y todas sus subcarpetas. Desliza desde el borde izquierdo para volver atrás.
- **Compresión automática**:
  - Fotos: se optimizan a la resolución de la pantalla del iPhone (2560 px, calidad 82 %). Se ven nítidas y ocupan un 70–90 % menos. En Ajustes puedes elegir *Ahorro máximo* o *Original*.
  - Documentos y textos: compresión **sin pérdidas** (gzip). Al abrirlos son idénticos al original.
  - Vídeos: el iPhone ya los graba comprimidos, así que sin perder calidad no se pueden reducir más. Lo que sí puedes es **elegir la calidad**: al añadir un vídeo la app pregunta (Original, Alta 1080p, Media 720p o Ahorro 480p) y muestra cuánto ocupará cada opción; también puedes fijar una calidad por defecto en Ajustes o cambiar la de un vídeo ya guardado con el botón *Calidad* del visor. Se recodifica en el propio iPhone (HEVC o H.264 por hardware) y el audio se conserva tal cual. Tarda más o menos lo que dura el vídeo y necesita la app abierta (si sales, sigue al volver). Se guarda solo la versión comprimida.
  - Las fotos con transparencia y los GIF animados no se tocan.
- **Código de acceso con candado animado**: al abrirla pide un código de 6 números; al acertarlo, el candado se abre y entras al baúl. Todo se guarda cifrado (AES-256) con él, incluidos los nombres de archivos y carpetas. Se bloquea sola al salir (al momento, tras 1 minuto o tras 5, a elegir) y con el candado de arriba. Tras 5 intentos fallidos hay que esperar. Si olvidas el código, los archivos no se pueden recuperar: solo queda borrar el baúl y empezar de cero.
- **Juegos con emulador**: guarda tus juegos de NES, Super Nintendo, Game Boy / Color, Game Boy Advance, Mega Drive, Master System, Game Gear, Nintendo 64, PlayStation o Nintendo DS (sueltos o dentro de un .zip/.7z) y ábrelos con *Jugar*: se juegan dentro de la app, con mando táctil, guardado de partidas y sin internet (en Ajustes → *Descargar emuladores para jugar sin internet*). Hay un filtro *Juegos*.
- **Programas y juegos de MS-DOS**: los .exe, .com y .bat de MS-DOS, los paquetes .jsdos y los .zip con un juego de PC antiguo se abren con *Ejecutar*, dentro de la app y sin internet, con teclado en pantalla ([js-dos](https://js-dos.com) / DOSBox). Si el .zip trae varios programas, la app pregunta cuál abrir. Lo que el programa guarda en su disco (partidas, configuración) se guarda cifrado en el baúl y vuelve la próxima vez.
- **Juegos hechos con Godot** (Android y PC): los .apk de juegos hechos con Godot 3 o 4 se abren con *Ejecutar* dentro del Baúl, sin internet, con el motor web oficial de Godot de la misma versión (3.6, 4.3, 4.4 y 4.7). También su .pck, el .exe de PC que lleva el juego dentro, o un .zip con ellos. La app saca los archivos del juego, monta el paquete (.pck) que espera el motor y elige las texturas que trae el juego.
- **Apps y juegos web de Android**: los .apk (y .xapk/.apks) hechos con tecnología web —Cordova, Capacitor, RPG Maker, Construct y similares— y los .zip con un juego HTML5 (con su `index.html`) se abren con *Ejecutar* dentro del Baúl, sin internet. Cada app guarda sus partidas aparte, y la copia descifrada que usa mientras está abierta se borra al cerrarla.
- **Windows y Android nativos**: la app distingue un .exe de MS-DOS de uno de Windows (mirando su cabecera) y un .apk web de uno nativo (Unity, Unreal, Godot…). Los programas de Windows y las apps nativas de Android no pueden ejecutarse dentro de una app web; al abrirlos, *Otras formas (fuera del Baúl)* enseña las alternativas: apps que los ejecutan en el propio iPhone sin jailbreak instalándolas fuera de la App Store ([Husk](https://github.com/Leviidev/Husk) para .apk y [Madeira](https://github.com/willfaust/Madeira) para juegos de Windows), manejar tu PC desde el iPhone (Windows App, Steam Link, Moonlight), juegos en la nube (GeForce NOW, now.gg), emular Windows antiguo con UTM SE, o Android en la nube (Appetize.io). También se pueden pasar a otro dispositivo con *Guardar*.
- **Visor**: fotos con pellizcar/doble toque para ampliar, deslizar para pasar y hacia abajo para cerrar; vídeos, audio, PDF y textos.
- **Guardar en otra app**: el botón *Guardar* abre el menú de iOS (Guardar en Fotos, Guardar en Archivos, WhatsApp, Mail…). También para varios archivos a la vez con *Seleccionar*.
- **Copia de seguridad**: Ajustes → *Exportar todo (.zip)* para guardarla en Archivos/iCloud Drive, y *Restaurar desde una copia* para recuperarla (incluye las carpetas y no duplica lo que ya está). La copia va cifrada: para restaurarla pide el código que tenías al hacerla.

> iOS no deja que ninguna web app trabaje con la app cerrada o el móvil apagado. Por eso el Baúl guarda primero (rápido) y comprime después: lo guardado nunca se pierde, y lo que queda por comprimir se termina al volver. Si cierras la app justo mientras se está copiando un archivo muy grande, ese archivo concreto habrá que añadirlo otra vez.

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
| `emulator.html`, `vendor/emulatorjs/` | [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) 4.2.3 (GPL-3.0, sin modificar: los scripts de `data/src` del paquete de npm, unidos en `emulator.min.js`) con los núcleos de RetroArch fceumm, snes9x, gambatte, mgba, genesis_plus_gx, pcsx_rearmed, mupen64plus_next, parallel_n64 y melonds; la licencia de cada núcleo va dentro de su archivo `.data` |
| `godot.html`, `vendor/godot-*/` | Motor web oficial de [Godot](https://godotengine.org) (MIT; licencia y avisos de terceros en cada carpeta), versiones 3.6.3, 4.3, 4.4.1 y 4.7.2 sin hilos, sin modificar |
| `apk-shim.js` | Se carga antes que cada app web abierta desde el Baúl: le da su propio almacenamiento y responde al puente de Cordova |
| `dos.html`, `vendor/jsdos/` | [js-dos](https://github.com/caiiiycuk/js-dos) 8.5.3 (GPL-2.0, licencia en `vendor/jsdos/LICENSE.txt`; código fuente en su repositorio) con el emulador DOSBox de [emulators](https://github.com/caiiiycuk/emulators); sin modificar, salvo quitar las referencias a los mapas de código |
| `vendor/mediabunny-1.61.3.min.mjs` | [Mediabunny](https://github.com/Vanilagy/mediabunny) 1.61.3 (MPL-2.0, sin modificar; licencia en `vendor/mediabunny-LICENSE.txt`) para recodificar vídeos |

Requisitos: iOS 16.4 o superior (para la compresión sin pérdidas; en versiones anteriores funciona pero sin comprimir documentos).

Para publicar una versión nueva, cambia `CACHE` en `sw.js` (por ejemplo `baul-v11`). La app instalada se actualiza sola la próxima vez que se abre con internet.

> El icono de la pantalla de inicio lo guarda iOS al instalar la app. Para ver un icono nuevo hay que quitar el Baúl de la pantalla de inicio y volver a añadirlo, y **quitarlo borra sus archivos**: exporta antes una copia de seguridad y restáurala después.
