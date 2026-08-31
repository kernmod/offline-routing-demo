package com.offlinerouter

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.margelo.nitro.offlinerouter.OfflineRouterOnLoad

class OfflineRouterPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null
  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { emptyMap() }
  companion object {
    init {
      System.loadLibrary("cch_routing_lite_ffi")
      System.loadLibrary("tile_server_lite")
      OfflineRouterOnLoad.initializeNative()
    }
  }
}
