import { useState, useRef, useEffect, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile, exists } from '@tauri-apps/plugin-fs'
import { FileTextIcon, ZoomInIcon, ZoomOutIcon, ResetIcon, Cross2Icon, GearIcon, HeartFilledIcon } from '@radix-ui/react-icons'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Store } from '@tauri-apps/plugin-store'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Configurar el worker de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

interface PDFTab {
  id: string
  fileName: string
  filePath: string
  document: pdfjsLib.PDFDocumentProxy
  scale: number
}

interface RecentFile {
  path: string
  fileName: string
  lastOpened: number
}

type ThemeMode = 'light' | 'dark' | 'system'

function App() {
  const [tabs, setTabs] = useState<PDFTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false)
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
  const [showRecents, setShowRecents] = useState<boolean>(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<Map<string, Map<number, HTMLCanvasElement>>>(new Map())

  const activeTab = tabs.find(tab => tab.id === activeTabId)

  // Agregar archivo a recientes
  const addToRecents = useCallback(async (path: string, fileName: string) => {
    try {
      const store = await Store.load('settings.json')
      let recents = await store.get<RecentFile[]>('recentFiles') || []

      // Eliminar duplicados
      recents = recents.filter(r => r.path !== path)

      // Agregar al principio
      recents.unshift({
        path,
        fileName,
        lastOpened: Date.now()
      })

      // Mantener solo los últimos 10
      recents = recents.slice(0, 10)

      await store.set('recentFiles', recents)
      await store.save()
      setRecentFiles(recents)
    } catch (error) {
      console.error('Error al guardar en recientes:', error)
    }
  }, [])

  // Cargar PDF desde una ruta
  const loadPDFFromPath = useCallback(async (path: string) => {
    try {
      setIsLoading(true)

      const fileExists = await exists(path)
      if (!fileExists) {
        console.error('El archivo no existe:', path)
        setIsLoading(false)
        return
      }

      const fileData = await readFile(path)
      const fileName = path.split('\\').pop() || path.split('/').pop() || 'documento.pdf'

      const loadingTask = pdfjsLib.getDocument({ data: fileData })
      const pdf = await loadingTask.promise

      const newTab: PDFTab = {
        id: Date.now().toString(),
        fileName,
        filePath: path,
        document: pdf,
        scale: 1.2
      }

      setTabs(prev => [...prev, newTab])
      setActiveTabId(newTab.id)

      // Agregar a recientes
      await addToRecents(path, fileName)

      setIsLoading(false)
    } catch (error) {
      console.error('Error al cargar el PDF:', error)
      setIsLoading(false)
    }
  }, [addToRecents])

  // Aplicar tema
  useEffect(() => {
    const applyTheme = async () => {
      const appWindow = getCurrentWindow()

      if (themeMode === 'system') {
        const systemTheme = await appWindow.theme()
        const isDark = systemTheme === 'dark'
        document.documentElement.classList.toggle('dark', isDark)
      } else {
        document.documentElement.classList.toggle('dark', themeMode === 'dark')
      }
    }

    applyTheme()

    // Escuchar cambios en el tema del sistema
    if (themeMode === 'system') {
      const appWindow = getCurrentWindow()
      const unlisten = appWindow.onThemeChanged(({ payload: theme }) => {
        document.documentElement.classList.toggle('dark', theme === 'dark')
      })

      return () => {
        unlisten.then(fn => fn())
      }
    }
  }, [themeMode])

  // Cargar configuración al iniciar
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const store = await Store.load('settings.json')
        const savedTheme = await store.get<ThemeMode>('theme')
        const savedTabs = await store.get<{ path: string }[]>('openTabs')
        const savedRecents = await store.get<RecentFile[]>('recentFiles') || []

        console.log('Configuración cargada:', { savedTheme, savedTabs, savedRecents })

        if (savedTheme) {
          setThemeMode(savedTheme)
        }

        setRecentFiles(savedRecents)

        if (savedTabs && savedTabs.length > 0) {
          console.log('Cargando último PDF:', savedTabs[0].path)
          await loadPDFFromPath(savedTabs[0].path)
        }
      } catch (error) {
        console.error('Error al cargar configuración:', error)
      }
    }

    loadSettings()
  }, [loadPDFFromPath])

  // Escuchar archivos abiertos desde línea de comandos
  useEffect(() => {
    const setupCliListener = async () => {
      const appWindow = getCurrentWindow()

      await appWindow.listen<string[]>('open-file-from-cli', async (event) => {
        console.log('Archivos desde CLI:', event.payload)
        for (const path of event.payload) {
          if (path.toLowerCase().endsWith('.pdf')) {
            await loadPDFFromPath(path)
          }
        }
      })
    }

    setupCliListener()
  }, [loadPDFFromPath])

  // Guardar pestañas abiertas
  useEffect(() => {
    const saveTabs = async () => {
      if (tabs.length === 0) return

      try {
        const store = await Store.load('settings.json')
        const tabsToSave = tabs.map(tab => ({ path: tab.filePath }))
        await store.set('openTabs', tabsToSave)
        await store.save()
        console.log('Pestañas guardadas:', tabsToSave)
      } catch (error) {
        console.error('Error al guardar pestañas:', error)
      }
    }

    saveTabs()
  }, [tabs])

  const openPDF = async () => {
    try {
      setIsLoading(true)

      const selected = await open({
        multiple: false,
        filters: [{
          name: 'PDF',
          extensions: ['pdf']
        }]
      })

      if (!selected || typeof selected !== 'string') {
        setIsLoading(false)
        return
      }

      await loadPDFFromPath(selected)
    } catch (error) {
      console.error('Error al abrir el PDF:', error)
      setIsLoading(false)
    }
  }

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    setTabs(prev => {
      const newTabs = prev.filter(tab => tab.id !== tabId)

      if (activeTabId === tabId && newTabs.length > 0) {
        setActiveTabId(newTabs[0].id)
      } else if (newTabs.length === 0) {
        setActiveTabId(null)
      }

      return newTabs
    })

    canvasRefs.current.delete(tabId)
  }

  const updateTabScale = (tabId: string, newScale: number) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId ? { ...tab, scale: newScale } : tab
    ))
  }

  const handleZoomIn = () => {
    if (activeTabId) {
      updateTabScale(activeTabId, Math.min((activeTab?.scale || 1) + 0.25, 3))
    }
  }

  const handleZoomOut = () => {
    if (activeTabId) {
      updateTabScale(activeTabId, Math.max((activeTab?.scale || 1) - 0.25, 0.5))
    }
  }

  const handleResetZoom = () => {
    if (activeTabId) {
      updateTabScale(activeTabId, 1.2)
    }
  }

  const saveTheme = async (theme: ThemeMode) => {
    try {
      const store = await Store.load('settings.json')
      await store.set('theme', theme)
      await store.save()
      console.log('Tema guardado:', theme)
    } catch (error) {
      console.error('Error al guardar tema:', error)
    }
  }

  const handleThemeChange = (theme: ThemeMode) => {
    setThemeMode(theme)
    saveTheme(theme)
  }

  // Renderizar páginas del PDF activo
  useEffect(() => {
    if (!activeTab) return

    const renderPage = async (pageNum: number, canvas: HTMLCanvasElement) => {
      try {
        const page = await activeTab.document.getPage(pageNum)
        const viewport = page.getViewport({ scale: activeTab.scale })
        const context = canvas.getContext('2d')

        if (!context) return

        canvas.height = viewport.height
        canvas.width = viewport.width

        const renderContext = {
          canvasContext: context,
          viewport: viewport
        }

        await page.render(renderContext).promise
      } catch (error) {
        console.error(`Error al renderizar página ${pageNum}:`, error)
      }
    }

    const renderAllPages = async () => {
      const tabCanvases = canvasRefs.current.get(activeTab.id)
      if (!tabCanvases) return

      for (let i = 1; i <= activeTab.document.numPages; i++) {
        const canvas = tabCanvases.get(i)
        if (canvas) {
          await renderPage(i, canvas)
        }
      }
    }

    renderAllPages()
  }, [activeTab?.id, activeTab?.scale])

  // File drop handler
  useEffect(() => {
    const setupFileDrop = async () => {
      const appWindow = getCurrentWindow()

      await appWindow.onDragDropEvent(async (event) => {
        if (event.payload.type === 'enter') {
          setIsDraggingFile(true)
        } else if (event.payload.type === 'leave') {
          setIsDraggingFile(false)
        } else if (event.payload.type === 'drop') {
          setIsDraggingFile(false)
          const paths = event.payload.paths

          // Filtrar solo archivos PDF
          for (const path of paths) {
            if (path.toLowerCase().endsWith('.pdf')) {
              await loadPDFFromPath(path)
            }
          }
        }
      })
    }

    setupFileDrop()
  }, [loadPDFFromPath])

  // Hotkeys
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ctrl + O: Abrir PDF
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault()
        if (!isLoading) {
          openPDF()
        }
      }

      // Ctrl + W: Cerrar pestaña activa
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault()
        if (activeTabId) {
          closeTab(activeTabId, e as any)
        }
      }

      // Ctrl + ,: Abrir ajustes
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(prev => !prev)
      }

      if (!activeTab) return

      // Ctrl + +: Zoom In
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        handleZoomIn()
      }

      // Ctrl + -: Zoom Out
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        handleZoomOut()
      }

      // Ctrl + 0: Reset Zoom
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        handleResetZoom()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isLoading, activeTabId, activeTab])

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        {/* Tabs Bar */}
        <div className="flex items-center h-10 px-2 gap-1 overflow-x-auto scrollbar-hide">
          <button
            onClick={openPDF}
            disabled={isLoading}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors disabled:opacity-50"
          >
            + Nuevo
          </button>

          {recentFiles.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowRecents(!showRecents)}
                className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
              >
                Recientes
              </button>

              {showRecents && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setShowRecents(false)}
                  />
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-40 max-h-80 overflow-y-auto">
                    <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 px-2">Archivos Recientes</p>
                    </div>
                    {recentFiles.map((file) => (
                      <button
                        key={file.path}
                        onClick={async () => {
                          setShowRecents(false)
                          await loadPDFFromPath(file.path)
                        }}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <FileTextIcon className="w-3 h-3 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-900 dark:text-gray-100 truncate font-medium">{file.fileName}</p>
                            <p className="text-gray-500 dark:text-gray-500 truncate text-[10px]">{file.path}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded cursor-pointer transition-colors ${
                activeTabId === tab.id
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}
            >
              <FileTextIcon className="w-3 h-3 flex-shrink-0" />
              <span className="max-w-[120px] truncate">{tab.fileName}</span>
              <button
                onClick={(e) => closeTab(tab.id, e)}
                className="opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-700 rounded p-0.5 transition-opacity"
              >
                <Cross2Icon className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Controls Bar */}
        {activeTab && (
          <div className="h-12 px-4 flex items-center justify-between border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {activeTab.fileName}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-500">
                {activeTab.document.numPages} páginas
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Zoom Controls */}
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                <button
                  onClick={handleZoomOut}
                  className="p-1.5 hover:bg-white dark:hover:bg-gray-700 rounded transition-colors"
                  title="Reducir zoom"
                >
                  <ZoomOutIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>

                <span className="px-3 text-xs font-medium text-gray-700 dark:text-gray-300 min-w-[50px] text-center">
                  {Math.round(activeTab.scale * 100)}%
                </span>

                <button
                  onClick={handleZoomIn}
                  className="p-1.5 hover:bg-white dark:hover:bg-gray-700 rounded transition-colors"
                  title="Aumentar zoom"
                >
                  <ZoomInIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>

                <button
                  onClick={handleResetZoom}
                  className="p-1.5 hover:bg-white dark:hover:bg-gray-700 rounded transition-colors"
                  title="Restablecer zoom"
                >
                  <ResetIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>
              </div>

              {/* Settings Button */}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                title="Ajustes"
              >
                <GearIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40"
            onClick={() => setShowSettings(false)}
          />

          {/* Panel */}
          <div className="absolute top-0 right-0 w-80 h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-xl z-50">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Ajustes</h2>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                  title="Cerrar"
                >
                  <Cross2Icon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>
              </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Tema
                </label>
                <div className="space-y-2">
                  {(['light', 'dark', 'system'] as ThemeMode[]).map(theme => (
                    <button
                      key={theme}
                      onClick={() => handleThemeChange(theme)}
                      className={`w-full px-4 py-2.5 text-sm text-left rounded-lg transition-colors ${
                        themeMode === theme
                          ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {theme === 'light' ? 'Claro' : theme === 'dark' ? 'Oscuro' : 'Sistema'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-gray-200 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Atajos de teclado
                </h3>
                <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                  <div className="flex justify-between">
                    <span>Abrir PDF</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">Ctrl+O</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Cerrar pestaña</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">Ctrl+W</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Zoom +/-</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">Ctrl +/-</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Ajustes</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">Ctrl+,</kbd>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-200 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Acerca de
                </h3>
                <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                  <div className="text-center py-4">
                    <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">Flux v0.1.0</p>
                    <p className="text-xs">Visor de PDF moderno y minimalista</p>
                    <div className="flex items-center justify-center gap-2 mt-4 text-sm">
                      <span>Creado con</span>
                      <HeartFilledIcon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      <span>por <span className="font-semibold text-purple-600 dark:text-purple-400">Marko</span></span>
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">github.com/Dauphinsss</p>
                    <p className="mt-1 text-xs">© 2025 Marko. Todos los derechos reservados.</p>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        </>
      )}

      {/* Drag and Drop Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 bg-blue-500/10 dark:bg-blue-400/10 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 border-2 border-dashed border-blue-500 dark:border-blue-400">
            <FileTextIcon className="w-16 h-16 mx-auto text-blue-500 dark:text-blue-400 mb-4" />
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Suelta el PDF aquí
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Para abrir en una nueva pestaña
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950" ref={containerRef}>
        {!activeTab && !isLoading && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-6 px-4">
              <div className="w-16 h-16 mx-auto bg-gray-100 dark:bg-gray-900 rounded-2xl flex items-center justify-center">
                <FileTextIcon className="w-8 h-8 text-gray-400 dark:text-gray-600" />
              </div>
              <div>
                <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100 mb-2">
                  Bienvenido a Flux
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-500">
                  Abre un PDF para comenzar
                </p>
                <button
                  onClick={openPDF}
                  className="mt-4 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
                >
                  Abrir PDF
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="w-10 h-10 border-3 border-gray-200 dark:border-gray-800 border-t-gray-900 dark:border-t-gray-100 rounded-full animate-spin mx-auto"></div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Cargando PDF...</p>
            </div>
          </div>
        )}

        {activeTab && !isLoading && (
          <div className="py-8 px-4 flex flex-col items-center gap-4">
            {Array.from({ length: activeTab.document.numPages }, (_, i) => i + 1).map((pageNum) => (
              <div
                key={pageNum}
                className="bg-white dark:bg-gray-900 rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden"
              >
                <canvas
                  ref={(el) => {
                    if (el) {
                      if (!canvasRefs.current.has(activeTab.id)) {
                        canvasRefs.current.set(activeTab.id, new Map())
                      }
                      canvasRefs.current.get(activeTab.id)!.set(pageNum, el)
                    }
                  }}
                  className="block"
                />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default App
