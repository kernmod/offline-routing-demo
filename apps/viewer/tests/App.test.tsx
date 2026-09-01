import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";

vi.mock("../src/components/MapCanvas", () => ({
  MapCanvas: ({ onTilesReady, onSelect }: { onTilesReady: () => void; onSelect: (id: string) => void }) => (
    <section aria-label="Map of Sydney CBD">
      <span>Embedded PMTiles</span>
      <button aria-label="Test map" onClick={() => { onTilesReady(); onSelect("seed-sydney-cbd-001"); }}>Map ready</button>
    </section>
  )
}));

afterEach(cleanup);

const seed = {
  id: "seed-sydney-cbd-001",
  name: "seeded reference",
  publicationState: "published",
  encodedGeometry: "vxdr_Awgal_Hfw@gw@",
  pointCount: 2,
  distanceM: 130,
  isSeed: true,
  elevationsM: [8, 10],
  controlPoints: [0, 1],
  elevationGainM: 2,
  elevationLossM: 0,
  metricsVersion: 2
};

describe("App", () => {
  it("shows local tile provenance, seed data and an accessible selection detail", async () => {
    render(<App apiBase="https://api.example" fetcher={vi.fn().mockResolvedValue(new Response(JSON.stringify({ segments: [seed] })))}/>);

    expect(await screen.findByText("seeded reference")).toBeVisible();
    expect(screen.getByText("Embedded PMTiles")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Segment seed-sydney-cbd-001" }));
    expect(screen.getByRole("region", { name: "Selected segment" })).toHaveTextContent("130 m");
  });

  it("keeps the map shell and an honest failure state when the API is down", async () => {
    render(<App apiBase="https://api.example" fetcher={vi.fn().mockRejectedValue(new TypeError("network"))}/>);

    expect(await screen.findByText("Local map is still available")).toBeVisible();
    expect(screen.getByLabelText("Map of Sydney CBD")).toBeVisible();
  });

  it("ignores an attacker-controlled API origin in the public URL", async () => {
    window.history.replaceState({}, "", "/?api=https://attacker.example");
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ segments: [seed] }))
    );

    render(<App fetcher={fetcher} />);

    expect(await screen.findByText("seeded reference")).toBeVisible();
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/localhost(?::\d+)?\/v2\/segments\?/),
      expect.any(Object)
    );
    window.history.replaceState({}, "", "/");
  });

  it("pluralizes invalid geometry rows before excluding them from the map", async () => {
    render(
      <App
        apiBase="https://api.example"
        fetcher={vi.fn().mockResolvedValue(new Response(JSON.stringify({
          segments: [
            { ...seed, id: "broken-1", encodedGeometry: "~" },
            { ...seed, id: "broken-2", encodedGeometry: "~" }
          ]
        })))}
      />
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 invalid geometry rows were excluded from the map."
    );
  });
});
