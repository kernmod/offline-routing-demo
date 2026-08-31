#pragma once
#include <cstdint>

#include "../../../crates/cch-routing-lite-ffi/include/cch_routing_lite.h"

extern "C" {
std::uint16_t offline_tiles_start(const char* root, std::uint16_t port);
const char* offline_tiles_last_error();
void offline_tiles_stop();
}
