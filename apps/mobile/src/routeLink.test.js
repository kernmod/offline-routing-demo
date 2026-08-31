import assert from "node:assert/strict";
import test from "node:test";

import { parseRouteUrl, routeUrl } from "./routeLink.ts";

test("parseRouteUrl accepts the public route deep link", () => {
  assert.deepEqual(
    parseRouteUrl("offlineroutingdemo://route?origin=-33.8688%2C151.2093&destination=-33.8695%2C151.2102"),
    {
      origin: { lat: -33.8688, lng: 151.2093 },
      destination: { lat: -33.8695, lng: 151.2102 }
    }
  );
});

test("parseRouteUrl rejects unrelated or malformed URLs", () => {
  assert.equal(parseRouteUrl("https://example.test"), null);
  assert.equal(parseRouteUrl("offlineroutingdemo://benchmark?device=device"), null);
  assert.equal(parseRouteUrl("offlineroutingdemo://route?origin=-33.8,151.2"), null);
  assert.equal(parseRouteUrl("offlineroutingdemo://route?origin=nan,151.2&destination=-33.8,151.2"), null);
});

test("routeUrl encodes both coordinates with the public scheme", () => {
  assert.equal(
    routeUrl({ lat: -33.8688, lng: 151.2093 }, { lat: -33.8695, lng: 151.2102 }),
    "offlineroutingdemo://route?origin=-33.8688%2C151.2093&destination=-33.8695%2C151.2102"
  );
});
