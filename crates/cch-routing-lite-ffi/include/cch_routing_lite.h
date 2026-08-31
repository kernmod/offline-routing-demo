#ifndef CCH_ROUTING_LITE_H
#define CCH_ROUTING_LITE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct RoutingHandle RoutingHandle;

typedef struct RoutingCoordinate {
  double lat;
  double lng;
} RoutingCoordinate;

/* Rust owns ptr. Read exactly len bytes, then call routing_buffer_free. */
typedef struct RoutingBuffer {
  uint8_t *ptr;
  size_t len;
  /* Opaque generation token. Do not interpret as an allocation capacity. */
  size_t cap;
} RoutingBuffer;

enum RoutingStatus {
  ROUTING_OK = 0,
  ROUTING_ERR_INVALID_ARGUMENT = 1,
  ROUTING_ERR_BAD_PACK = 2,
  ROUTING_ERR_ROUTE = 3,
  ROUTING_ERR_INTERNAL = 4,
};

RoutingHandle *routing_router_load(const uint8_t *pack_ptr, size_t pack_len);
int32_t routing_last_error(void);

int32_t routing_router_route(const RoutingHandle *router,
                             RoutingCoordinate origin,
                             RoutingCoordinate destination,
                             RoutingBuffer *out_buffer);

int32_t routing_router_benchmark(const RoutingHandle *router,
                                 RoutingBuffer *out_buffer);

void routing_router_free(RoutingHandle *router);
void routing_buffer_free(RoutingBuffer *buffer);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* CCH_ROUTING_LITE_H */
