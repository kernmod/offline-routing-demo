import type { RenderableSegment } from "../lib/segments";

type SegmentListProps = Readonly<{
  segments: RenderableSegment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}>;

function segmentKind(segment: RenderableSegment): string {
  return segment.kind === "seed" ? "seeded reference" : "live publication";
}

export function SegmentList({ segments, selectedId, onSelect }: SegmentListProps) {
  if (segments.length === 0) {
    return <p className="empty-list">No valid public segments in this bbox.</p>;
  }
  return (
    <ul className="segment-list" aria-label="Visible segments">
      {segments.map((segment) => {
        const label = segment.name?.trim() || segment.id;
        return (
          <li key={segment.id}>
            <button
              type="button"
              className={`segment-row ${selectedId === segment.id ? "is-selected" : ""}`}
              aria-pressed={selectedId === segment.id}
              aria-label={`Segment ${label}`}
              onClick={() => onSelect(segment.id)}
            >
              <span className="segment-row__kind">{segmentKind(segment)}</span>
              <strong>{label}</strong>
              <span>{segment.distanceM} m</span>
              <span>{segment.pointCount} points</span>
              <code>{segment.id}</code>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
