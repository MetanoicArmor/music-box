cmake_minimum_required(VERSION 3.21)
project(MusicBoxHost LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Network)

set(MUSICBOX_SOURCES
  src/main.cpp
  src/ConfigFile.cpp
  src/ServerProcess.cpp
  src/ApiClient.cpp
  src/UiText.cpp
  src/MainWindow.cpp
  src/DropZone.cpp
  third_party/qrcodegen.cpp
)

if(WIN32)
  add_executable(MusicBox WIN32 ${MUSICBOX_SOURCES})
elseif(APPLE)
  add_executable(MusicBox MACOSX_BUNDLE ${MUSICBOX_SOURCES})
else()
  add_executable(MusicBox ${MUSICBOX_SOURCES})
endif()

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../VERSION" MUSICBOX_VERSION)
string(STRIP "${MUSICBOX_VERSION}" MUSICBOX_VERSION)
if(NOT MUSICBOX_VERSION MATCHES "^[0-9]+\\.[0-9]+\\.[0-9]+$")
  message(FATAL_ERROR "VERSION must be major.minor.patch")
endif()
string(REPLACE "." ";" MUSICBOX_VERSION_PARTS "${MUSICBOX_VERSION}")
list(GET MUSICBOX_VERSION_PARTS 0 MUSICBOX_VER_MAJOR)
list(GET MUSICBOX_VERSION_PARTS 1 MUSICBOX_VER_MINOR)
list(GET MUSICBOX_VERSION_PARTS 2 MUSICBOX_VER_PATCH)

set_target_properties(MusicBox PROPERTIES
  OUTPUT_NAME "MusicBox"
  MACOSX_BUNDLE_GUI_IDENTIFIER "com.metanoicarmor.musicbox"
  MACOSX_BUNDLE_BUNDLE_NAME "Music Box"
  MACOSX_BUNDLE_BUNDLE_VERSION "${MUSICBOX_VERSION}"
  MACOSX_BUNDLE_SHORT_VERSION_STRING "${MUSICBOX_VERSION}"
)

qt_add_resources(MusicBox "musicbox_icons"
  PREFIX "/"
  FILES
    assets/app-icon.png
)

if(APPLE AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/assets/app-icon.icns")
  set_source_files_properties(assets/app-icon.icns PROPERTIES MACOSX_PACKAGE_LOCATION "Resources")
  target_sources(MusicBox PRIVATE assets/app-icon.icns)
  set_target_properties(MusicBox PROPERTIES MACOSX_BUNDLE_ICON_FILE "app-icon.icns")
endif()

if(UNIX AND NOT APPLE)
  set_target_properties(MusicBox PROPERTIES
    BUILD_WITH_INSTALL_RPATH TRUE
    INSTALL_RPATH "$ORIGIN/lib"
  )
endif()

target_include_directories(MusicBox PRIVATE src third_party)
target_link_libraries(MusicBox PRIVATE Qt6::Widgets Qt6::Network)

if(WIN32)
  set(MUSICBOX_RC "${CMAKE_CURRENT_BINARY_DIR}/MusicBox.rc")
  file(CONFIGURE OUTPUT "${MUSICBOX_RC}" CONTENT [[
IDI_ICON1 ICON "@CMAKE_CURRENT_SOURCE_DIR@/assets/app-icon.ico"
1 VERSIONINFO
FILEVERSION @MUSICBOX_VER_MAJOR@,@MUSICBOX_VER_MINOR@,@MUSICBOX_VER_PATCH@,0
PRODUCTVERSION @MUSICBOX_VER_MAJOR@,@MUSICBOX_VER_MINOR@,@MUSICBOX_VER_PATCH@,0
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904B0"
    BEGIN
      VALUE "FileDescription", "Music Box"
      VALUE "FileVersion", "@MUSICBOX_VERSION@"
      VALUE "ProductName", "Music Box"
      VALUE "ProductVersion", "@MUSICBOX_VERSION@"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END
]] @ONLY)
  target_sources(MusicBox PRIVATE "${MUSICBOX_RC}")
endif()

if(MSVC)
  target_compile_options(MusicBox PRIVATE /W3 /utf-8)
endif()
