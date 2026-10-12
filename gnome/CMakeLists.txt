cmake_minimum_required(VERSION 3.20)

project(ProjecteurGnomeBridge VERSION 0.4.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(ECM 6.6 REQUIRED NO_MODULE)
list(APPEND CMAKE_MODULE_PATH ${ECM_MODULE_PATH})
include(ECMQtDeclareLoggingCategory)

find_package(Qt6 6.10 REQUIRED COMPONENTS Core DBus Gui)
find_package(KF6 6.6 REQUIRED COMPONENTS CoreAddons I18n)

set(PROJECTEUR_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/..")

add_executable(projecteur-gnome-daemon
  daemon/main.cc
  ${PROJECTEUR_ROOT}/src/device.cc
  ${PROJECTEUR_ROOT}/src/device-hidpp.cc
  ${PROJECTEUR_ROOT}/src/deviceinput.cc
  ${PROJECTEUR_ROOT}/src/devicescan.cc
  ${PROJECTEUR_ROOT}/src/hidpp.cc
  ${PROJECTEUR_ROOT}/src/spotlight.cc
  ${PROJECTEUR_ROOT}/src/virtualdevice.cc
)

target_include_directories(projecteur-gnome-daemon PRIVATE
  "${PROJECTEUR_ROOT}/src"
  "${CMAKE_CURRENT_BINARY_DIR}"
)

target_link_libraries(projecteur-gnome-daemon PRIVATE
  Qt6::Core
  Qt6::DBus
  Qt6::Gui
  KF6::CoreAddons
  KF6::I18n
)

target_compile_options(projecteur-gnome-daemon PRIVATE
  $<$<OR:$<CXX_COMPILER_ID:GNU>,$<CXX_COMPILER_ID:Clang>>:-Wall -Wextra -Werror>
)

foreach(category IN ITEMS main device hid input virtual_device)
  string(TOUPPER "${category}" category_upper)
  ecm_qt_declare_logging_category(projecteur-gnome-daemon
    HEADER "projecteur_${category}_debug.h"
    IDENTIFIER "PROJECTEUR_${category_upper}_LOG"
    CATEGORY_NAME "projecteur.${category}"
    DEFAULT_SEVERITY Info
  )
endforeach()

# Generate the extra-device table used by DeviceScan.
set(idRegex "0x([0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F])")
set(lineRegex "^[ \t]*${idRegex}[ \t]*,[ \t]*${idRegex}[ \t]*,[ \t]*(usb|bt)[ \t]*,[ \t]*(.*)[ \t]*")
file(STRINGS "${PROJECTEUR_ROOT}/devices.conf" CONFLINES REGEX "${lineRegex}")
foreach(line ${CONFLINES})
  if(line MATCHES "${lineRegex}")
    string(TOLOWER "${CMAKE_MATCH_1}" vendorId)
    string(TOLOWER "${CMAKE_MATCH_2}" productId)
    set(deviceName "${CMAKE_MATCH_4}")
    if("${CMAKE_MATCH_3}" STREQUAL "bt")
      set(isBluetooth true)
      string(REGEX REPLACE "^0+" "" bluetoothVendorId "${vendorId}")
      string(REGEX REPLACE "^0+" "" bluetoothProductId "${productId}")
      string(APPEND EXTRA_BLUETOOTH_UDEV_RULES
        "\n## Extra-Device: ${deviceName}")
      string(APPEND EXTRA_BLUETOOTH_UDEV_RULES
        "\nSUBSYSTEMS==\"input\", ENV{LIBINPUT_DEVICE_GROUP}=\"5/${bluetoothVendorId}/${bluetoothProductId}*\", MODE=\"0660\", TAG+=\"uaccess\"")
    else()
      set(isBluetooth false)
      string(APPEND EXTRA_USB_UDEV_RULES
        "\n## Extra-Device: ${deviceName}")
      string(APPEND EXTRA_USB_UDEV_RULES
        "\nSUBSYSTEMS==\"usb\", ATTRS{idVendor}==\"${vendorId}\", ATTRS{idProduct}==\"${productId}\", MODE=\"0660\", TAG+=\"uaccess\"")
    endif()
    string(APPEND SUPPORTED_EXTRA_DEVICES
      "\n    {0x${vendorId}, 0x${productId}, ${isBluetooth}, \"${deviceName}\"},")
  endif()
endforeach()
configure_file("${PROJECTEUR_ROOT}/src/extra-devices.cc.in"
               "${CMAKE_CURRENT_BINARY_DIR}/extra-devices.cc" @ONLY)
target_sources(projecteur-gnome-daemon PRIVATE
  "${CMAKE_CURRENT_BINARY_DIR}/extra-devices.cc")

configure_file("${PROJECTEUR_ROOT}/55-projecteur.rules.in"
               "${CMAKE_CURRENT_BINARY_DIR}/55-projecteur.rules" @ONLY)

install(TARGETS projecteur-gnome-daemon DESTINATION bin)

# No hardware is opened by this parser/native-key-sequence check.
add_executable(projecteur-gnome-mapping-check
  tests/button-mappings-check.cc
  ${PROJECTEUR_ROOT}/src/deviceinput.cc
  ${PROJECTEUR_ROOT}/src/virtualdevice.cc
  "${CMAKE_CURRENT_BINARY_DIR}/projecteur_input_debug.cpp"
  "${CMAKE_CURRENT_BINARY_DIR}/projecteur_virtual_device_debug.cpp")
target_include_directories(projecteur-gnome-mapping-check PRIVATE
  "${PROJECTEUR_ROOT}/src" "${CMAKE_CURRENT_SOURCE_DIR}/daemon" "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(projecteur-gnome-mapping-check PRIVATE Qt6::Core Qt6::Gui KF6::I18n)
target_compile_options(projecteur-gnome-mapping-check PRIVATE -Wall -Wextra -Werror)
