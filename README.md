# Flux

Visor de PDF moderno y minimalista para Windows, construido con Tauri v2 y React.

## Características

- **Múltiples pestañas**: Abre y gestiona varios PDFs simultáneamente
- **Temas adaptativos**: Modo claro, oscuro y automático según el sistema
- **Persistencia**: Recuerda automáticamente los PDFs abiertos entre sesiones
- **Controles de zoom**: Ajusta el tamaño del documento con facilidad
- **Atajos de teclado**: Navegación rápida y eficiente
- **Interfaz minimalista**: Diseño limpio y moderno
- **Rendimiento nativo**: Compilado a binario nativo para máxima eficiencia

## Stack Tecnológico

- [Tauri v2](https://tauri.app/) - Framework de aplicaciones de escritorio
- [React 18](https://react.dev/) - Biblioteca de interfaz de usuario
- [TypeScript](https://www.typescriptlang.org/) - Lenguaje tipado
- [Vite](https://vitejs.dev/) - Build tool ultrarrápido
- [Tailwind CSS](https://tailwindcss.com/) - Framework de estilos
- [PDF.js](https://mozilla.github.io/pdf.js/) - Renderizado de PDFs
- [Radix UI](https://www.radix-ui.com/) - Componentes e iconos

## Requisitos

- [Node.js](https://nodejs.org/) v18 o superior
- [Rust](https://www.rust-lang.org/) (última versión estable)
- Windows 10/11

## Instalación

### Para desarrollo

```bash
# Clonar el repositorio
git clone https://github.com/Dauphinsss/flux.git
cd flux

# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run tauri:dev
```

### Compilar instalador

```bash
# Compilar para producción
npm run tauri:build
```

El instalador se generará en `src-tauri/target/release/bundle/nsis/`

## Atajos de Teclado

| Atajo | Acción |
|-------|--------|
| `Ctrl + O` | Abrir PDF |
| `Ctrl + W` | Cerrar pestaña actual |
| `Ctrl + +` | Aumentar zoom |
| `Ctrl + -` | Reducir zoom |
| `Ctrl + 0` | Restablecer zoom |
| `Ctrl + ,` | Abrir ajustes |

## Estructura del Proyecto

```
flux/
├── src/                    # Código fuente de React
│   ├── App.tsx            # Componente principal
│   ├── main.tsx           # Punto de entrada
│   └── index.css          # Estilos globales
├── src-tauri/             # Código de Tauri
│   ├── src/               # Código Rust
│   │   ├── lib.rs         # Lógica principal
│   │   └── main.rs        # Punto de entrada
│   ├── icons/             # Iconos de la aplicación
│   ├── Cargo.toml         # Dependencias Rust
│   └── tauri.conf.json    # Configuración Tauri
├── index.html             # HTML base
├── package.json           # Dependencias npm
├── vite.config.ts         # Configuración Vite
├── tailwind.config.js     # Configuración Tailwind
└── LICENSE                # Licencia MIT
```

## Configuración

La aplicación guarda automáticamente:
- PDFs abiertos en pestañas
- Preferencia de tema
- Última ubicación y zoom de cada documento

Los datos se almacenan en: `%APPDATA%\com.flux.app\settings.json`

## Desarrollo

### Scripts disponibles

```bash
npm run dev           # Vite dev server
npm run build         # Build de producción (frontend)
npm run tauri:dev     # Ejecutar app en desarrollo
npm run tauri:build   # Compilar instalador
```

### Agregar nuevas características

1. Frontend: Edita `src/App.tsx`
2. Backend: Edita `src-tauri/src/lib.rs`
3. Configuración: Modifica `src-tauri/tauri.conf.json`

## Licencia

MIT License - Copyright (c) 2025 Marko

## Autor

Creado con pasión por [Marko](https://github.com/Dauphinsss)

---

Si encuentras útil este proyecto, considera darle una estrella en GitHub.
