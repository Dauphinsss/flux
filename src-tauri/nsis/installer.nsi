!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh

; Definir información del instalador
!define PRODUCT_NAME "Flux"
!define PRODUCT_VERSION "0.1.0"
!define PRODUCT_PUBLISHER "Marko"
!define PRODUCT_WEB_SITE "https://github.com/marko"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\..\target\release\bundle\nsis\Flux_0.1.0_x64-setup.exe"
InstallDir "$LOCALAPPDATA\${PRODUCT_NAME}"
ShowInstDetails show
ShowUnInstDetails show

; Configuración de interfaz moderna
!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; Personalización de textos
!define MUI_WELCOMEPAGE_TITLE "¡Bienvenido a Flux!"
!define MUI_WELCOMEPAGE_TEXT "Este instalador te guiará en la instalación de Flux, un visor de PDF moderno y minimalista.$\r$\n$\r$\n✨ Creado con amor por Marko uwu$\r$\n$\r$\nHaz clic en Siguiente para continuar."

!define MUI_FINISHPAGE_TITLE "¡Instalación completada!"
!define MUI_FINISHPAGE_TEXT "Flux se ha instalado correctamente en tu computadora.$\r$\n$\r$\n💜 Hecho con pasión por Marko$\r$\n$\r$\nGracias por usar Flux. ¡Disfruta visualizando tus PDFs!"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Flux.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Ejecutar Flux ahora"
!define MUI_FINISHPAGE_LINK "Visitar el sitio web del desarrollador"
!define MUI_FINISHPAGE_LINK_LOCATION "${PRODUCT_WEB_SITE}"

; Páginas del instalador
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Páginas del desinstalador
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Idioma
!insertmacro MUI_LANGUAGE "Spanish"

; Información de versión
VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "© 2024 Marko. Todos los derechos reservados."
VIAddVersionKey "FileDescription" "Flux - Visor de PDF moderno"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"

Section "Instalación Principal" SEC01
  SetOutPath "$INSTDIR"
  SetOverwrite ifnewer

  ; Aquí irían los archivos de tu aplicación
  File /r "..\..\target\release\*.*"

  ; Crear accesos directos
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\Flux.exe"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Desinstalar.lnk" "$INSTDIR\uninstall.exe"
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\Flux.exe"

  ; Crear entrada en Programas y características
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\Flux.exe"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  ; Eliminar archivos y carpetas
  Delete "$INSTDIR\*.*"
  RMDir /r "$INSTDIR"

  ; Eliminar accesos directos
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\*.*"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"

  ; Eliminar entradas del registro
  DeleteRegKey HKCU "${PRODUCT_UNINST_KEY}"

  SetAutoClose true
SectionEnd
