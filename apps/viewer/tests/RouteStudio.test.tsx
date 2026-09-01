import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

const points = [
  { lat: -33.8701, lng: 151.2088 },
  { lat: -33.8695, lng: 151.2101 },
  { lat: -33.8689, lng: 151.2113 }
];

vi.mock("../src/components/MapCanvas", () => ({
  MapCanvas: ({ onMapPoint, onControlMove, activeProfilePoint }: {
    onMapPoint?: (point: { lat: number; lng: number }) => void;
    onControlMove?: (id: string, point: { lat: number; lng: number }) => void;
    activeProfilePoint?: { lat: number; lng: number } | null;
  }) => (
    <section aria-label="Map of Sydney CBD">
      {points.map((point, index) => (
        <button key={index} type="button" onClick={() => onMapPoint?.(point)}>map point {index + 1}</button>
      ))}
      <button type="button" onClick={() => onControlMove?.("cp-0002", points[2])}>drag via</button>
      {activeProfilePoint && <output data-testid="map-profile-marker">{activeProfilePoint.lat}</output>}
    </section>
  )
}));

import { RouteStudio } from "../src/components/RouteStudio";
import { decodeRenderableSegments } from "../src/lib/segments";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function makeRouter() {
  return {
    route: vi.fn(async (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => ({
      geometry: [
        { ...from, elevationM: 8 },
        {
          lat: (from.lat + to.lat) / 2,
          lng: (from.lng + to.lng) / 2,
          elevationM: 18
        },
        { ...to, elevationM: 12 }
      ]
    }))
  };
}

function renderStudio(options: Partial<React.ComponentProps<typeof RouteStudio>> = {}) {
  return render(
    <RouteStudio
      segments={[]}
      selectedId={null}
      router={makeRouter()}
      routerStatus="ready"
      apiBase="https://api.example"
      fetcher={vi.fn()}
      onSelect={vi.fn()}
      onPublished={vi.fn()}
      onTilesReady={vi.fn()}
      onTilesError={vi.fn()}
      {...options}
    />
  );
}

function renderStudioHarness(options: Partial<React.ComponentProps<typeof RouteStudio>> = {}) {
  function Harness() {
    const [segments, setSegments] = useState(options.segments ?? []);
    const [selectedId, setSelectedId] = useState<string | null>(options.selectedId ?? null);
    const externalOnPublished = options.onPublished ?? vi.fn();
    return (
      <RouteStudio
        segments={segments}
        selectedId={selectedId}
        router={makeRouter()}
        routerStatus="ready"
        apiBase="https://api.example"
        fetcher={options.fetcher ?? vi.fn()}
        onSelect={setSelectedId}
        onPublished={(segment) => {
          setSegments((current) => decodeRenderableSegments([segment, ...current.filter((entry) => entry.id !== segment.id)]));
          setSelectedId(segment.id);
          externalOnPublished(segment);
        }}
        onTilesReady={vi.fn()}
        onTilesError={vi.fn()}
      />
    );
  }

  return render(<Harness />);
}

async function addThreePoints() {
  fireEvent.click(screen.getByRole("button", { name: "map point 1" }));
  fireEvent.click(screen.getByRole("button", { name: "map point 2" }));
  fireEvent.click(screen.getByRole("button", { name: "map point 3" }));
  await screen.findByText("3 control points");
  await waitFor(() => expect(screen.getByText(/route ready/i)).toBeVisible());
}

describe("RouteStudio", () => {
  it("creates a multipoint route locally and exposes accessible reorder, delete, undo and redo controls", async () => {
    const router = makeRouter();
    renderStudio({ router });

    await addThreePoints();
    expect(router.route).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("start")[0]).toBeVisible();
    expect(screen.getByText("finish")).toBeVisible();
    expect(screen.getByText("via 1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Move via 1 up" }));
    await waitFor(() => expect(router.route.mock.calls.length).toBeGreaterThan(2));
    fireEvent.click(screen.getByRole("button", { name: "Undo last edit" }));
    expect(screen.getByText("3 control points")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Redo last edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete via 1" }));
    expect(await screen.findByText("2 control points")).toBeVisible();
  });

  it("routes an explicit loop closing leg and recomputes a dragged control", async () => {
    const router = makeRouter();
    renderStudio({ router });
    await addThreePoints();

    fireEvent.click(screen.getByRole("button", { name: "Close loop" }));
    await waitFor(() => expect(router.route).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "Open loop" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "drag via" }));
    await waitFor(() => expect(router.route.mock.calls.length).toBeGreaterThan(3));
  });

  it("keeps elevation scrub and non-destructive start/end handles synchronized with route metrics", async () => {
    renderStudio();
    await addThreePoints();

    expect(screen.getByRole("img", { name: "Elevation profile" })).toBeVisible();
    expect(screen.getByText(/D\+ 20 m/)).toBeVisible();
    const end = screen.getByRole("slider", { name: "Selection end" });
    fireEvent.change(end, { target: { value: "100" } });
    expect(await screen.findByText(/selected/i)).toBeVisible();
    fireEvent.change(screen.getByRole("slider", { name: "Profile position" }), { target: { value: "50" } });
    expect(screen.getByTestId("map-profile-marker")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Use full route" }));
    expect(screen.getAllByText(/full route/i)[0]).toBeVisible();
  });

  it("saves a private local draft and publishes only after named confirmation", async () => {
    const published = {
      id: "77aeafc2-d8dc-40a7-bfd9-d231cf5e04e0",
      name: "Harbour rise",
      publicationState: "published" as const,
      encodedGeometry: "vxdr_Awgal_Hfw@gw@",
      pointCount: 3,
      distanceM: 210,
      isSeed: false,
      elevationsM: [8, 18, 12],
      controlPoints: [0, 2],
      elevationGainM: 10,
      elevationLossM: 6,
      metricsVersion: 2 as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: null
    };
    let resolvePublication!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolvePublication = resolve; }));
    const onPublished = vi.fn();
    renderStudioHarness({ fetcher, onPublished });
    await addThreePoints();
    fireEvent.change(screen.getByRole("textbox", { name: "Segment name" }), { target: { value: "Harbour rise" } });
    fireEvent.click(screen.getByRole("button", { name: "Save private draft" }));
    expect(localStorage.getItem("offline-routing.route-studio.v2")).toContain("Harbour rise");

    fireEvent.click(screen.getByRole("button", { name: "Review publication" }));
    expect(screen.getByRole("dialog", { name: "Confirm publication" })).toHaveTextContent("Harbour rise");
    expect(screen.getByLabelText("Route Studio editor")).toHaveAttribute("data-draft-status", "ready");
    fireEvent.click(screen.getByRole("button", { name: "Publish segment" }));
    expect(screen.getByLabelText("Route Studio editor")).toHaveAttribute("data-draft-status", "publishing");
    resolvePublication(new Response(JSON.stringify(published), { status: 201 }));

    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(published));
    expect(screen.getByLabelText("Route Studio editor")).toHaveAttribute("data-draft-status", "published");
    await waitFor(() => expect(screen.getByRole("button", { name: "Segment Harbour rise" })).toBeVisible());
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected segment" })).toHaveTextContent("Harbour rise"));
    const publishedDetail = screen.getByRole("region", { name: "Selected segment" });
    expect(publishedDetail).toHaveTextContent("published");
    expect(publishedDetail).toHaveTextContent("D+ 10 m · D− 6 m");
    expect(publishedDetail).toHaveTextContent("metrics v2");
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(expect.objectContaining({ "idempotency-key": expect.stringMatching(/^[0-9a-f-]{36}$/) }));
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Harbour rise",
      geometry: expect.arrayContaining([expect.objectContaining({ elevationM: expect.any(Number) })]),
      controlPoints: expect.arrayContaining([0])
    });
    expect(screen.getAllByRole("status").some((element) => /published/i.test(element.textContent ?? ""))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Continue editing published draft" }));
    expect(screen.getByLabelText("Route Studio editor")).toHaveAttribute("data-draft-status", "draft");
  });

  it("returns a failed publication to ready and reuses its idempotency key", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"));
    renderStudio({ fetcher });
    await addThreePoints();
    fireEvent.change(screen.getByRole("textbox", { name: "Segment name" }), { target: { value: "Retry route" } });
    fireEvent.click(screen.getByRole("button", { name: "Review publication" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish segment" }));
    await waitFor(() => expect(screen.getByLabelText("Route Studio editor")).toHaveAttribute("data-draft-status", "ready"));
    fireEvent.click(screen.getByRole("button", { name: "Publish segment" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    const firstHeaders = fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetcher.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondHeaders["idempotency-key"]).toBe(firstHeaders["idempotency-key"]);
  });

  it("reports local routing failure without inventing a path", async () => {
    const router = { route: vi.fn().mockRejectedValue(new Error("no_path")) };
    renderStudio({ router });
    fireEvent.click(screen.getByRole("button", { name: "map point 1" }));
    fireEvent.click(screen.getByRole("button", { name: "map point 2" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/local route unavailable/i);
    expect(screen.queryByText(/route ready/i)).not.toBeInTheDocument();
  });
});
