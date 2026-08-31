export const SYDNEY_BBOX = { minLng: 151.204, minLat: -33.873, maxLng: 151.217, maxLat: -33.862 };

const initialState = () => ({ status: "booting", message: "Preparing local map assets.", selectedPoints: [], route: null, segments: [], publishStatus: "idle" });

export function createDemoController({ router, tileServer, api, pack, online }) {
  if (!router?.loadPack || !router?.route || !tileServer?.start) throw new TypeError("router must expose local routing and tile server operations");
  let state = initialState();
  const snapshot = () => structuredClone(state);
  return {
    async boot() {
      await tileServer.start();
      await router.loadPack(pack);
      state = { ...state, status: "ready", message: "Tap two points to calculate a route on this device." };
      return snapshot();
    },
    async tapPoint(point) {
      if (state.selectedPoints.length === 2) state = { ...state, selectedPoints: [], route: null, publishStatus: "idle" };
      const selectedPoints = [...state.selectedPoints, point];
      if (selectedPoints.length === 1) {
        state = { ...state, selectedPoints, status: "awaiting_destination", message: "Tap a destination point." };
        return snapshot();
      }
      state = { ...state, status: "routing", message: "Calculating locally.", selectedPoints };
      const route = await router.route(selectedPoints[0], selectedPoints[1]);
      state = { ...state, status: "route_ready", message: `${route.distanceM} m route ready offline.`, selectedPoints, route, routeSource: "local_native", publishStatus: "idle" };
      return snapshot();
    },
    async publishRoute() {
      if (!state.route) throw new Error("route_not_ready");
      if (!online()) { state = { ...state, message: "Publishing requires a network connection.", publishStatus: "offline" }; return snapshot(); }
      state = { ...state, publishStatus: "publishing", message: "Publishing segment." };
      const published = await api.publishSegment({ geometry: state.route.polyline });
      state = { ...state, publishStatus: "published", lastPublishedId: published.id, message: "Segment published." };
      return snapshot();
    },
    async refreshSegments() {
      if (!online()) { state = { ...state, segments: [], message: "Nearby segments require a network connection." }; return snapshot(); }
      const segments = await api.listSegments(SYDNEY_BBOX);
      state = { ...state, segments, message: `${segments.length} nearby segments loaded.` };
      return snapshot();
    },
    snapshot
  };
}
