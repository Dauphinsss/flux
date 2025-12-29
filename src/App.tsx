import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile, exists } from '@tauri-apps/plugin-fs'
import { FileTextIcon, ZoomInIcon, ZoomOutIcon, ResetIcon, Cross2Icon, GearIcon, MagnifyingGlassIcon, EnterFullScreenIcon, ExitFullScreenIcon } from '@radix-ui/react-icons'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { Store } from '@tauri-apps/plugin-store'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'

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

interface PdfFileInfo {
  path: string
  name: string
  size: number
  modified: number
}

type ThemeMode = 'light' | 'dark' | 'system'
type SortBy = 'name' | 'size' | 'modified'
type ViewMode = 'cascade' | 'single'

function App() {
  const [tabs, setTabs] = useState<PDFTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false)
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
  const [showRecents, setShowRecents] = useState<boolean>(false)
  const [recentsPosition, setRecentsPosition] = useState<{ top: number; left: number } | null>(null)
  const recentsButtonRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<Map<string, Map<number, HTMLCanvasElement>>>(new Map())

  // Estados para explorador de PDFs
  const [showExplorer, setShowExplorer] = useState<boolean>(false)
  const [explorerPdfs, setExplorerPdfs] = useState<PdfFileInfo[]>([])
  const [isSearching, setIsSearching] = useState<boolean>(false)
  const [sortBy, setSortBy] = useState<SortBy>('modified')
  const [sortAscending, setSortAscending] = useState<boolean>(false)
  const [explorerSearchTerm, setExplorerSearchTerm] = useState<string>('')

  // Estados para búsqueda en PDF
  const [showSearch, setShowSearch] = useState<boolean>(false)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [searchMatches, setSearchMatches] = useState<Array<{ pageNum: number; matchIndex: number }>>([])
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0)

  // Estados para visualización
  const [viewMode, setViewMode] = useState<ViewMode>('cascade')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)

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

  // Eliminar archivo de recientes
  const removeFromRecents = useCallback(async (path: string) => {
    try {
      const store = await Store.load('settings.json')
      let recents = await store.get<RecentFile[]>('recentFiles') || []
      recents = recents.filter(r => r.path !== path)
      await store.set('recentFiles', recents)
      await store.save()
      setRecentFiles(recents)
    } catch (error) {
      console.error('Error al eliminar de recientes:', error)
    }
  }, [])

  // Limpiar todos los recientes
  const clearRecents = useCallback(async () => {
    try {
      const store = await Store.load('settings.json')
      await store.set('recentFiles', [])
      await store.save()
      setRecentFiles([])
    } catch (error) {
      console.error('Error al limpiar recientes:', error)
    }
  }, [])

  // Buscar PDFs en directorios comunes
  const searchPdfsInSystem = useCallback(async () => {
    setIsSearching(true)
    try {
      const directories = await invoke<string[]>('get_common_directories')
      let allPdfs: PdfFileInfo[] = []

      for (const dir of directories) {
        try {
          const pdfs = await invoke<PdfFileInfo[]>('search_pdfs_in_directory', { directory: dir })
          allPdfs = [...allPdfs, ...pdfs]
        } catch (error) {
          console.error(`Error al buscar en ${dir}:`, error)
        }
      }

      setExplorerPdfs(allPdfs)
    } catch (error) {
      console.error('Error al buscar PDFs:', error)
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Buscar en el PDF activo
  const searchInPDF = useCallback(async (term: string) => {
    if (!activeTab || !term.trim()) {
      setSearchMatches([])
      setCurrentMatchIndex(0)
      // Limpiar resaltados
      document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight', 'current-highlight'))
      return
    }

    const matches: Array<{ pageNum: number; matchIndex: number }> = []
    const lowerTerm = term.toLowerCase()

    for (let pageNum = 1; pageNum <= activeTab.document.numPages; pageNum++) {
      const page = await activeTab.document.getPage(pageNum)
      const textContent = await page.getTextContent()

      let pageText = ''
      textContent.items.forEach((item: any) => {
        pageText += item.str + ' '
      })

      const lowerPageText = pageText.toLowerCase()
      let index = lowerPageText.indexOf(lowerTerm)
      let matchIndex = 0

      while (index !== -1) {
        matches.push({ pageNum, matchIndex })
        matchIndex++
        index = lowerPageText.indexOf(lowerTerm, index + 1)
      }
    }

    setSearchMatches(matches)
    setCurrentMatchIndex(0)

    // Resaltar coincidencias
    if (matches.length > 0) {
      highlightMatches(term)
      scrollToMatch(0, matches)
    }
  }, [activeTab])

  // Resaltar coincidencias en el PDF
  const highlightMatches = useCallback((term: string) => {
    if (!term.trim()) return

    const lowerTerm = term.toLowerCase()
    document.querySelectorAll('.textLayer span').forEach((span) => {
      const text = span.textContent || ''
      if (text.toLowerCase().includes(lowerTerm)) {
        span.classList.add('highlight')
      } else {
        span.classList.remove('highlight', 'current-highlight')
      }
    })
  }, [])

  // Navegar al resultado
  const scrollToMatch = useCallback((index: number, matches: Array<{ pageNum: number; matchIndex: number }>) => {
    if (matches.length === 0) return

    const match = matches[index]
    const pageElement = document.querySelector(`[data-page="${match.pageNum}"]`)?.parentElement

    if (pageElement) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    // Marcar coincidencia actual
    document.querySelectorAll('.current-highlight').forEach(el => el.classList.remove('current-highlight'))
    const textLayer = document.querySelector(`.textLayer[data-page="${match.pageNum}"]`)
    if (textLayer) {
      const spans = Array.from(textLayer.querySelectorAll('span.highlight'))
      if (spans[match.matchIndex]) {
        spans[match.matchIndex].classList.add('current-highlight')
      }
    }
  }, [])

  // Navegar a siguiente resultado
  const nextMatch = useCallback(() => {
    if (searchMatches.length === 0) return
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length
    setCurrentMatchIndex(nextIndex)
    scrollToMatch(nextIndex, searchMatches)
  }, [searchMatches, currentMatchIndex, scrollToMatch])

  // Navegar a resultado anterior
  const prevMatch = useCallback(() => {
    if (searchMatches.length === 0) return
    const prevIndex = currentMatchIndex === 0 ? searchMatches.length - 1 : currentMatchIndex - 1
    setCurrentMatchIndex(prevIndex)
    scrollToMatch(prevIndex, searchMatches)
  }, [searchMatches, currentMatchIndex, scrollToMatch])

  // Efecto para buscar cuando cambia el término
  useEffect(() => {
    const debounceSearch = setTimeout(() => {
      searchInPDF(searchTerm)
    }, 300)

    return () => clearTimeout(debounceSearch)
  }, [searchTerm, searchInPDF])

  // Ordenar PDFs del explorador
  const sortedExplorerPdfs = useCallback(() => {
    let filtered = explorerPdfs

    // Filtrar por término de búsqueda
    if (explorerSearchTerm) {
      filtered = filtered.filter(pdf =>
        pdf.name.toLowerCase().includes(explorerSearchTerm.toLowerCase())
      )
    }

    // Ordenar
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'size':
          comparison = a.size - b.size
          break
        case 'modified':
          comparison = a.modified - b.modified
          break
      }
      return sortAscending ? comparison : -comparison
    })

    return sorted
  }, [explorerPdfs, explorerSearchTerm, sortBy, sortAscending])

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

  // Cargar configuración al iniciar (solo una vez)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (initialized) return

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

        // Cargar el último PDF abierto
        if (savedTabs && savedTabs.length > 0) {
          const lastPath = savedTabs[0].path
          console.log('Cargando último PDF:', lastPath)

          try {
            // Verificar que existe
            const fileExists = await exists(lastPath)
            if (fileExists) {
              const fileData = await readFile(lastPath)
              const fileName = lastPath.split('\\').pop() || lastPath.split('/').pop() || 'documento.pdf'

              const loadingTask = pdfjsLib.getDocument({ data: fileData })
              const pdf = await loadingTask.promise

              const newTab: PDFTab = {
                id: Date.now().toString(),
                fileName,
                filePath: lastPath,
                document: pdf,
                scale: 1.2
              }

              setTabs([newTab])
              setActiveTabId(newTab.id)
            }
          } catch (error) {
            console.log('No se pudo cargar el último PDF:', error)
            // Limpiar la configuración de tabs guardados si falla
            const store = await Store.load('settings.json')
            await store.set('openTabs', [])
            await store.save()
          }
        }

        setInitialized(true)
      } catch (error) {
        console.error('Error al cargar configuración:', error)
        setInitialized(true)
      }
    }

    loadSettings()
  }, [initialized])

  // Cargar PDFs pendientes al iniciar (asociaciones/argumentos)
  useEffect(() => {
    const loadPendingFiles = async () => {
      try {
        const pending = await invoke<string[]>('take_pending_files')
        if (pending && pending.length > 0) {
          for (const filePath of pending) {
            if (filePath.toLowerCase().endsWith('.pdf')) {
              await loadPDFFromPath(filePath)
            }
          }
        }
      } catch (error) {
        console.error('Error al cargar archivos pendientes:', error)
      }
    }

    loadPendingFiles()
  }, [loadPDFFromPath])

  // Escuchar eventos del menú
  useEffect(() => {
    const setupMenuListeners = async () => {
      const appWindow = getCurrentWindow()

      const unlistenOpen = await appWindow.listen('menu-open-pdf', () => {
        openPDF()
      })

      const unlistenZoomIn = await appWindow.listen('menu-zoom-in', () => {
        handleZoomIn()
      })

      const unlistenZoomOut = await appWindow.listen('menu-zoom-out', () => {
        handleZoomOut()
      })

      const unlistenZoomReset = await appWindow.listen('menu-zoom-reset', () => {
        handleResetZoom()
      })

      const unlistenAbout = await appWindow.listen('menu-show-about', () => {
        setShowSettings(true)
      })

      return () => {
        unlistenOpen()
        unlistenZoomIn()
        unlistenZoomOut()
        unlistenZoomReset()
        unlistenAbout()
      }
    }

    setupMenuListeners()
  }, [])

  // Escuchar archivos abiertos desde línea de comandos o asociación de archivos
  useEffect(() => {
    let unlisten: (() => void) | undefined

    const setupFileListener = async () => {
      const appWindow = getCurrentWindow()

      console.log('[FRONTEND] Setting up file listener...')

      // Escuchar el evento unificado 'open-files'
      unlisten = await appWindow.listen<string[]>('open-files', async (event) => {
        console.log('[FRONTEND] ========== open-files event received ==========')
        console.log('[FRONTEND] Event payload:', event.payload)
        console.log('[FRONTEND] Payload type:', typeof event.payload)
        console.log('[FRONTEND] Payload is array:', Array.isArray(event.payload))
        for (const filePath of event.payload) {
          console.log('[FRONTEND] Processing file:', filePath)
          if (filePath.toLowerCase().endsWith('.pdf')) {
            // Cargar el PDF directamente
            try {
              console.log('[FRONTEND] Checking if file exists:', filePath)
              const fileExists = await exists(filePath)
              console.log('[FRONTEND] File exists:', fileExists)

              if (!fileExists) {
                console.error('[FRONTEND] El archivo no existe:', filePath)
                continue
              }

              console.log('[FRONTEND] Reading file data...')
              const fileData = await readFile(filePath)
              console.log('[FRONTEND] File data read, size:', fileData.length)

              const fileName = filePath.split('\\').pop() || filePath.split('/').pop() || 'documento.pdf'
              console.log('[FRONTEND] File name:', fileName)

              console.log('[FRONTEND] Loading PDF document...')
              const loadingTask = pdfjsLib.getDocument({ data: fileData })
              const pdf = await loadingTask.promise
              console.log('[FRONTEND] PDF loaded, pages:', pdf.numPages)

              const newTab: PDFTab = {
                id: Date.now().toString(),
                fileName,
                filePath,
                document: pdf,
                scale: 1.2
              }

              console.log('[FRONTEND] Adding tab to state...')
              setTabs(prev => {
                // Verificar si ya está abierto
                const existing = prev.find(tab => tab.filePath === filePath)
                if (existing) {
                  console.log('[FRONTEND] File already open, switching to existing tab')
                  setActiveTabId(existing.id)
                  return prev
                }
                console.log('[FRONTEND] Creating new tab')
                setActiveTabId(newTab.id)
                return [...prev, newTab]
              })
              console.log('[FRONTEND] Adding to recents...')
              await addToRecents(filePath, fileName)
              console.log('[FRONTEND] Successfully loaded PDF!')
            } catch (error) {
              console.error('[FRONTEND] Error al cargar PDF:', error)
            }
          }
        }
      })
    }

    setupFileListener()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

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

  const toggleFullscreen = async () => {
    const appWindow = getCurrentWindow()
    const newFullscreenState = !isFullscreen

    await appWindow.setFullscreen(newFullscreenState)
    setIsFullscreen(newFullscreenState)
  }

  const goToNextPage = () => {
    if (activeTab && viewMode === 'single' && currentPage < activeTab.document.numPages) {
      const nextPage = currentPage + 1
      setCurrentPage(nextPage)
      scrollToPage(nextPage)
    }
  }

  const goToPreviousPage = () => {
    if (viewMode === 'single' && currentPage > 1) {
      const prevPage = currentPage - 1
      setCurrentPage(prevPage)
      scrollToPage(prevPage)
    }
  }

  const scrollToPage = (pageNum: number) => {
    const pageElement = document.querySelector(`[data-page="${pageNum}"]`)?.parentElement
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

    let cancelled = false
    const renderTasks = new Map<number, pdfjsLib.RenderTask>()

    const renderPage = async (pageNum: number, canvas: HTMLCanvasElement) => {
      try {
        if (cancelled) return

        const page = await activeTab.document.getPage(pageNum)
        const viewport = page.getViewport({ scale: activeTab.scale })
        const context = canvas.getContext('2d')

        if (!context || cancelled) return

        canvas.height = viewport.height
        canvas.width = viewport.width

        const renderContext = {
          canvasContext: context,
          viewport: viewport
        }

        const renderTask = page.render(renderContext)
        renderTasks.set(pageNum, renderTask)

        await renderTask.promise

        if (!cancelled) {
          renderTasks.delete(pageNum)

          // Renderizar capa de texto para selección
          const textLayer = document.querySelector(`.textLayer[data-page="${pageNum}"]`) as HTMLElement
          if (textLayer) {
            textLayer.innerHTML = ''
            textLayer.style.width = `${canvas.width}px`
            textLayer.style.height = `${canvas.height}px`

            const textContent = await page.getTextContent()

            // Crear elementos de texto para cada item
            textContent.items.forEach((item: any) => {
              if (!item.str || item.str.trim() === '') return

              const textDiv = document.createElement('span')
              textDiv.textContent = item.str
              textDiv.style.position = 'absolute'

              // Transformar coordenadas
              const tx = pdfjsLib.Util.transform(
                viewport.transform,
                item.transform
              )

              const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]))
              const fontSize = fontHeight

              textDiv.style.left = `${tx[4]}px`
              textDiv.style.top = `${tx[5] - fontSize}px`
              textDiv.style.fontSize = `${fontSize}px`
              textDiv.style.fontFamily = 'sans-serif'

              // Calcular el ancho del texto
              const textWidth = item.width * viewport.scale
              textDiv.style.width = `${textWidth}px`

              textDiv.style.color = 'transparent'
              textDiv.style.userSelect = 'text'
              textDiv.style.cursor = 'text'
              textDiv.style.pointerEvents = 'all'

              textLayer.appendChild(textDiv)
            })
          }
        }
      } catch (error: any) {
        // Ignorar errores de cancelación
        if (error?.name !== 'RenderingCancelledException') {
          console.error(`Error al renderizar página ${pageNum}:`, error)
        }
      }
    }

    const renderAllPages = async () => {
      // Esperar un tick para que los refs estén disponibles
      await new Promise(resolve => setTimeout(resolve, 50))

      if (cancelled) return

      const tabCanvases = canvasRefs.current.get(activeTab.id)
      if (!tabCanvases || tabCanvases.size === 0) {
        // Reintentar si no hay canvas disponibles
        if (!cancelled) {
          setTimeout(renderAllPages, 100)
        }
        return
      }

      if (viewMode === 'cascade') {
        // Renderizar todas las páginas
        for (let i = 1; i <= activeTab.document.numPages; i++) {
          if (cancelled) break
          const canvas = tabCanvases.get(i)
          if (canvas) {
            await renderPage(i, canvas)
          }
        }
      } else {
        // Renderizar solo la página actual
        const canvas = tabCanvases.get(currentPage)
        if (canvas) {
          await renderPage(currentPage, canvas)
        }
      }
    }

    renderAllPages()

    return () => {
      cancelled = true
      // Cancelar todas las tareas de renderizado pendientes
      renderTasks.forEach(task => {
        try {
          task.cancel()
        } catch (e) {
          // Ignorar errores al cancelar
        }
      })
      renderTasks.clear()
    }
  }, [activeTab?.id, activeTab?.scale, viewMode, currentPage])

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
    const handleKeyPress = async (e: KeyboardEvent) => {
      // Ctrl + Shift + I: Abrir DevTools
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
        e.preventDefault()
        try {
          await invoke('open_devtools')
          console.log('DevTools opened')
        } catch (error) {
          console.error('Error opening DevTools:', error)
        }
        return
      }

      // Ctrl + H: Abrir búsqueda en PDF
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault()
        if (activeTab) {
          setShowSearch(prev => !prev)
        }
      }

      // Ctrl + E: Abrir explorador de PDFs
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault()
        setShowExplorer(prev => !prev)
        if (!showExplorer && explorerPdfs.length === 0) {
          searchPdfsInSystem()
        }
      }

      // F11 o Ctrl + F: Pantalla completa
      if (e.key === 'F11' || ((e.ctrlKey || e.metaKey) && e.key === 'f')) {
        e.preventDefault()
        toggleFullscreen()
      }

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

      // Flechas para navegación de páginas en modo single
      if (viewMode === 'single' && activeTab) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          goToNextPage()
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          goToPreviousPage()
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isLoading, activeTabId, activeTab, showExplorer, explorerPdfs.length, searchPdfsInSystem, viewMode, goToNextPage, goToPreviousPage])

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950 relative">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 relative z-20">
        {/* Tabs Bar */}
        <div className="flex items-center h-10 px-2 gap-1 overflow-x-auto scrollbar-hide">
          <button
            onClick={openPDF}
            disabled={isLoading}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors disabled:opacity-50"
          >
            + Nuevo
          </button>

          <button
            ref={recentsButtonRef}
            onClick={() => {
              if (!showRecents && recentsButtonRef.current) {
                const rect = recentsButtonRef.current.getBoundingClientRect()
                setRecentsPosition({
                  top: rect.bottom + 4,
                  left: rect.left
                })
              }
              setShowRecents(!showRecents)
            }}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          >
            Recientes
          </button>

          <button
            onClick={() => {
              setShowExplorer(!showExplorer)
              if (!showExplorer && explorerPdfs.length === 0) {
                searchPdfsInSystem()
              }
            }}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          >
            Explorador
          </button>

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
              {/* View Mode Toggle */}
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('cascade')}
                  className={`px-2 py-1.5 text-xs rounded transition-colors ${
                    viewMode === 'cascade'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                  }`}
                  title="Vista en cascada"
                >
                  Cascada
                </button>
                <button
                  onClick={() => {
                    setViewMode('single')
                    setCurrentPage(1)
                  }}
                  className={`px-2 py-1.5 text-xs rounded transition-colors ${
                    viewMode === 'single'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                  }`}
                  title="Vista página por página"
                >
                  Página
                </button>
              </div>

              {/* Page Navigation (only in single mode) */}
              {viewMode === 'single' && (
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                  <button
                    onClick={goToPreviousPage}
                    disabled={currentPage === 1}
                    className="p-1.5 hover:bg-white dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Página anterior (←)"
                  >
                    <svg className="w-4 h-4 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  <span className="px-3 text-xs font-medium text-gray-700 dark:text-gray-300 min-w-[60px] text-center">
                    {currentPage} / {activeTab.document.numPages}
                  </span>

                  <button
                    onClick={goToNextPage}
                    disabled={currentPage === activeTab.document.numPages}
                    className="p-1.5 hover:bg-white dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Página siguiente (→)"
                  >
                    <svg className="w-4 h-4 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Search Button */}
              <button
                onClick={() => setShowSearch(!showSearch)}
                className={`p-2 rounded-lg transition-colors ${
                  showSearch
                    ? 'bg-gray-900 dark:bg-gray-100'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                title="Buscar (Ctrl+H)"
              >
                <MagnifyingGlassIcon className={`w-4 h-4 ${showSearch ? 'text-white dark:text-gray-900' : 'text-gray-700 dark:text-gray-300'}`} />
              </button>

              {/* Fullscreen Button */}
              <button
                onClick={toggleFullscreen}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                title="Pantalla completa (F11)"
              >
                {isFullscreen ? (
                  <ExitFullScreenIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                ) : (
                  <EnterFullScreenIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                )}
              </button>

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

        {/* Search Bar */}
        {activeTab && showSearch && (
          <div className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-md">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (e.shiftKey) {
                        prevMatch()
                      } else {
                        nextMatch()
                      }
                    }
                    if (e.key === 'Escape') {
                      setShowSearch(false)
                    }
                  }}
                  placeholder="Buscar en el PDF..."
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 text-gray-900 dark:text-gray-100"
                  autoFocus
                />
              </div>
              {searchMatches.length > 0 && (
                <>
                  <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {currentMatchIndex + 1} de {searchMatches.length}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={prevMatch}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                      title="Anterior (Shift+Enter)"
                    >
                      <svg className="w-4 h-4 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      onClick={nextMatch}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                      title="Siguiente (Enter)"
                    >
                      <svg className="w-4 h-4 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Explorer Panel */}
      {showExplorer && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40"
            onClick={() => setShowExplorer(false)}
          />

          {/* Panel */}
          <div className="absolute top-0 left-0 w-80 h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 shadow-xl z-50 flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Explorador de PDFs</h2>
                <button
                  onClick={() => setShowExplorer(false)}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                  title="Cerrar"
                >
                  <Cross2Icon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>
              </div>

              {/* Search Input */}
              <div className="relative mb-3">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={explorerSearchTerm}
                  onChange={(e) => setExplorerSearchTerm(e.target.value)}
                  placeholder="Filtrar por nombre..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 text-gray-900 dark:text-gray-100"
                />
              </div>

              {/* Sort Options */}
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    if (sortBy === 'name') {
                      setSortAscending(!sortAscending)
                    } else {
                      setSortBy('name')
                      setSortAscending(true)
                    }
                  }}
                  className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                    sortBy === 'name'
                      ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  Nombre {sortBy === 'name' && (sortAscending ? '↑' : '↓')}
                </button>
                <button
                  onClick={() => {
                    if (sortBy === 'size') {
                      setSortAscending(!sortAscending)
                    } else {
                      setSortBy('size')
                      setSortAscending(false)
                    }
                  }}
                  className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                    sortBy === 'size'
                      ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  Tamaño {sortBy === 'size' && (sortAscending ? '↑' : '↓')}
                </button>
                <button
                  onClick={() => {
                    if (sortBy === 'modified') {
                      setSortAscending(!sortAscending)
                    } else {
                      setSortBy('modified')
                      setSortAscending(false)
                    }
                  }}
                  className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                    sortBy === 'modified'
                      ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  Fecha {sortBy === 'modified' && (sortAscending ? '↑' : '↓')}
                </button>
              </div>
            </div>

            {/* Files List */}
            <div className="flex-1 overflow-y-auto">
              {isSearching ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-3">
                    <div className="w-8 h-8 border-3 border-gray-200 dark:border-gray-800 border-t-gray-900 dark:border-t-gray-100 rounded-full animate-spin mx-auto"></div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Buscando PDFs...</p>
                  </div>
                </div>
              ) : sortedExplorerPdfs().length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-2 px-4">
                    <FileTextIcon className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-600" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {explorerPdfs.length === 0 ? 'No se encontraron PDFs' : 'No hay resultados'}
                    </p>
                    <button
                      onClick={searchPdfsInSystem}
                      className="px-3 py-1.5 text-xs bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
                    >
                      Buscar de nuevo
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-2">
                  {sortedExplorerPdfs().map((pdf) => (
                    <button
                      key={pdf.path}
                      onClick={async () => {
                        setShowExplorer(false)
                        await loadPDFFromPath(pdf.path)
                      }}
                      className="w-full p-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors mb-1"
                    >
                      <div className="flex items-start gap-2">
                        <FileTextIcon className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {pdf.name}
                          </p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-500">
                            <span>{(pdf.size / 1024 / 1024).toFixed(2)} MB</span>
                            <span>{new Date(pdf.modified * 1000).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20 dark:bg-black/40 z-30"
            onClick={() => setShowSettings(false)}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 w-80 h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-xl z-40">
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
                    <span>Buscar en PDF</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">Ctrl+H</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Explorador</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">Ctrl+E</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Pantalla completa</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">F11</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Navegar páginas</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">←→↑↓</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Zoom +/-</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">Ctrl +/-</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Ajustes</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">Ctrl+,</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>DevTools</span>
                    <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">Ctrl+Shift+I</kbd>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-200 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Acerca de
                </h3>
                <div className="space-y-3 text-xs text-gray-600 dark:text-gray-400">
                  <div className="text-center py-4">
                    <p className="font-semibold text-lg text-gray-900 dark:text-gray-100 mb-1">Flux</p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">Versión 0.1.0</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">Visor de PDF moderno y minimalista</p>

                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-xs text-gray-600 dark:text-gray-400">Desarrollado por</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">Marko</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-500">github.com/Dauphinsss</p>
                    </div>

                    <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 mb-3">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1">Software de Código Abierto</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Este proyecto es de código abierto y está disponible bajo la licencia MIT
                      </p>
                    </div>

                    <p className="text-xs text-gray-500 dark:text-gray-500">© 2025 Marko. Todos los derechos reservados.</p>
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
      <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950 relative z-10" ref={containerRef}>
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
            {viewMode === 'cascade' ? (
              // Mostrar todas las páginas en cascada
              Array.from({ length: activeTab.document.numPages }, (_, i) => i + 1).map((pageNum) => (
                <div
                  key={pageNum}
                  className="bg-white dark:bg-gray-900 rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden relative"
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
                  <div
                    className="textLayer absolute top-0 left-0 overflow-hidden pointer-events-none"
                    data-page={pageNum}
                    style={{
                      lineHeight: '1',
                      whiteSpace: 'pre',
                    }}
                  />
                </div>
              ))
            ) : (
              // Mostrar solo la página actual
              <div
                key={currentPage}
                className="bg-white dark:bg-gray-900 rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden relative"
              >
                <canvas
                  ref={(el) => {
                    if (el) {
                      if (!canvasRefs.current.has(activeTab.id)) {
                        canvasRefs.current.set(activeTab.id, new Map())
                      }
                      canvasRefs.current.get(activeTab.id)!.set(currentPage, el)
                    }
                  }}
                  className="block"
                />
                <div
                  className="textLayer absolute top-0 left-0 overflow-hidden pointer-events-none"
                  data-page={currentPage}
                  style={{
                    lineHeight: '1',
                    whiteSpace: 'pre',
                  }}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Recents Menu Portal */}
      {showRecents && recentsPosition && createPortal(
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowRecents(false)}
          />
          <div
            className="fixed w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto"
            style={{
              top: `${recentsPosition.top}px`,
              left: `${recentsPosition.left}px`
            }}
          >
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 px-2">Archivos Recientes</p>
            </div>
            {recentFiles.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">No hay archivos recientes</p>
              </div>
            ) : (
              <>
                {recentFiles.map((file) => (
                  <button
                    key={file.path}
                    onClick={async () => {
                      setShowRecents(false)
                      const fileExists = await exists(file.path)
                      if (fileExists) {
                        await loadPDFFromPath(file.path)
                      } else {
                        await removeFromRecents(file.path)
                      }
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
                <div className="border-t border-gray-200 dark:border-gray-700 p-2">
                  <button
                    onClick={async () => {
                      setShowRecents(false)
                      await clearRecents()
                    }}
                    className="w-full px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  >
                    Limpiar historial
                  </button>
                </div>
              </>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

export default App
