#include <jni.h>
#include "OfflineRouterOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::offlinerouter::initialize(vm);
}
