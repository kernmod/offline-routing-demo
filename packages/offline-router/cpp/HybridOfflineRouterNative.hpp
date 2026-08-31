#pragma once

#include "HybridOfflineRouterNativeSpec.hpp"
#include "routing_ffi.h"

namespace margelo::nitro::offlinerouter {
class HybridOfflineRouterNative final : public HybridOfflineRouterNativeSpec {
 public:
  HybridOfflineRouterNative();
  ~HybridOfflineRouterNative() override;
  std::string loadPack(const std::shared_ptr<ArrayBuffer>& pack) override;
  std::string route(const Coordinate& origin, const Coordinate& destination) override;
  std::string benchmark(const std::string& device) override;
  double startTileServer(const std::string& assetDirectory, double port) override;
  void stopTileServer() override;

 private:
  RoutingHandle* router_ = nullptr;
};
} // namespace margelo::nitro::offlinerouter
