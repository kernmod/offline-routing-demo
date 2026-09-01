cmake_minimum_required(VERSION 3.18.0)
project(OfflineRouter)
set(CMAKE_CXX_STANDARD 20)

set(NITRO_GENERATED_BUILD_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated-cmake")
file(MAKE_DIRECTORY "${NITRO_GENERATED_BUILD_DIR}")
configure_file(../nitrogen/generated/android/OfflineRouterOnLoad.cpp "${NITRO_GENERATED_BUILD_DIR}/OfflineRouterOnLoad.cpp" COPYONLY)
configure_file(../nitrogen/generated/shared/c++/HybridOfflineRouterNativeSpec.cpp "${NITRO_GENERATED_BUILD_DIR}/HybridOfflineRouterNativeSpec.cpp" COPYONLY)

add_library(OfflineRouter SHARED src/main/cpp/cpp-adapter.cpp ../cpp/HybridOfflineRouterNative.cpp)

add_definitions(-DBUILDING_OFFLINEROUTER_WITH_GENERATED_CMAKE_PROJECT)
add_definitions(-DRN_SERIALIZABLE_STATE)
include_directories(
  ../nitrogen/generated/shared/c++
  ../nitrogen/generated/android/c++
  ../nitrogen/generated/android/
)
target_sources(
  OfflineRouter PRIVATE
  "${NITRO_GENERATED_BUILD_DIR}/OfflineRouterOnLoad.cpp"
  "${NITRO_GENERATED_BUILD_DIR}/HybridOfflineRouterNativeSpec.cpp"
)
target_compile_definitions(
  OfflineRouter PRIVATE
  -DFOLLY_NO_CONFIG=1
  -DFOLLY_HAVE_CLOCK_GETTIME=1
  -DFOLLY_USE_LIBCPP=1
  -DFOLLY_CFG_NO_COROUTINES=1
  -DFOLLY_MOBILE=1
  -DFOLLY_HAVE_RECVMMSG=1
  -DFOLLY_HAVE_PTHREAD=1
  -DFOLLY_HAVE_XSI_STRERROR_R=1
)

set(RUST_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/build/rustJniLibs/${ANDROID_ABI}")
add_library(cch_routing_lite_ffi SHARED IMPORTED)
set_target_properties(cch_routing_lite_ffi PROPERTIES IMPORTED_LOCATION "${RUST_LIB_DIR}/libcch_routing_lite_ffi.so" IMPORTED_NO_SONAME TRUE)
add_library(tile_server_lite SHARED IMPORTED)
set_target_properties(tile_server_lite PROPERTIES IMPORTED_LOCATION "${RUST_LIB_DIR}/libtile_server_lite.so" IMPORTED_NO_SONAME TRUE)
target_include_directories(OfflineRouter PRIVATE ../cpp)
find_package(fbjni REQUIRED)
find_package(ReactAndroid REQUIRED)
find_package(react-native-nitro-modules REQUIRED)
find_library(LOG_LIB log)
target_link_libraries(
  OfflineRouter
  ${LOG_LIB}
  fbjni::fbjni
  ReactAndroid::jsi
  react-native-nitro-modules::NitroModules
  cch_routing_lite_ffi
  tile_server_lite
)

if(ReactAndroid_VERSION_MINOR GREATER_EQUAL 76)
  target_link_libraries(OfflineRouter ReactAndroid::reactnative)
else()
  target_link_libraries(OfflineRouter ReactAndroid::react_nativemodule_core)
endif()
