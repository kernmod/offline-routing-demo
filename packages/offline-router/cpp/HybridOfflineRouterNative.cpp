#include "HybridOfflineRouterNative.hpp"

#include <chrono>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace margelo::nitro::offlinerouter {
namespace {
class OwnedArrayBuffer final : public ArrayBuffer {
 public:
  explicit OwnedArrayBuffer(std::vector<std::uint8_t> bytes) : bytes_(std::move(bytes)) {}
  std::uint8_t* data() override { return bytes_.data(); }
  std::size_t size() const override { return bytes_.size(); }
  bool isOwner() const noexcept override { return true; }
 private:
  std::vector<std::uint8_t> bytes_;
};
} // namespace

HybridOfflineRouterNative::HybridOfflineRouterNative() : HybridObject(TAG) {}

HybridOfflineRouterNative::~HybridOfflineRouterNative() {
  if (router_ != nullptr) { routing_router_free(router_); router_ = nullptr; }
  offline_tiles_stop();
}

std::string HybridOfflineRouterNative::loadPack(const std::shared_ptr<ArrayBuffer>& pack) {
  if (!pack || pack->size() == 0) throw std::invalid_argument("routing pack is empty");
  RoutingHandle* loaded = routing_router_load(pack->data(), pack->size());
  if (loaded == nullptr) throw std::runtime_error("routing pack rejected by C ABI");
  if (router_ != nullptr) routing_router_free(router_);
  router_ = loaded;
  return "{\"bytes\":" + std::to_string(pack->size()) + "}";
}

std::string HybridOfflineRouterNative::route(const Coordinate& origin, const Coordinate& destination) {
  if (router_ == nullptr) throw std::runtime_error("routing pack has not been loaded");
  RoutingBuffer buffer{};
  const auto status = routing_router_route(router_, {origin.lat, origin.lng}, {destination.lat, destination.lng}, &buffer);
  if (status != 0 || buffer.ptr == nullptr) {
    if (buffer.ptr != nullptr) routing_buffer_free(&buffer);
    throw std::runtime_error("offline routing failed");
  }
  std::string json(reinterpret_cast<const char*>(buffer.ptr), buffer.len);
  routing_buffer_free(&buffer);
  return json;
}

std::string HybridOfflineRouterNative::benchmark(const std::string& device) {
  if (router_ == nullptr || device.empty() || device.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._()- ") != std::string::npos) {
    throw std::runtime_error("router or device unavailable");
  }
  RoutingBuffer buffer{};
  if (routing_router_benchmark(router_, &buffer) != 0 || buffer.ptr == nullptr) {
    if (buffer.ptr != nullptr) routing_buffer_free(&buffer);
    throw std::runtime_error("offline benchmark failed");
  }
  std::string metrics(reinterpret_cast<const char*>(buffer.ptr), buffer.len);
  routing_buffer_free(&buffer);
  if (metrics.empty() || metrics.front() != '{') throw std::runtime_error("offline benchmark returned invalid JSON");
  return "{\"device\":\"" + device + "\"," + metrics.substr(1);
}

double HybridOfflineRouterNative::startTileServer(const std::string& assetDirectory, double port) {
  if (assetDirectory.empty() || port < 0 || port > 65535) return 0;
  const auto bound_port = offline_tiles_start(assetDirectory.c_str(), static_cast<std::uint16_t>(port));
  if (bound_port == 0) {
    const char* detail = offline_tiles_last_error();
    throw std::runtime_error(detail == nullptr ? "local tile server failed" : detail);
  }
  return static_cast<double>(bound_port);
}

void HybridOfflineRouterNative::stopTileServer() { offline_tiles_stop(); }
} // namespace margelo::nitro::offlinerouter
