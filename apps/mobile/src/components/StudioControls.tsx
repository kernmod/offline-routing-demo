import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from "react-native";
import type { ControlPoint, DraftMetrics, DraftSelection, ProfilePoint, RouteStudioDraft } from "@offline-routing/route-studio";
import { profileBars } from "../studioViewModel";

const colors = {
  ink: "#161a18", panel: "#202622", raised: "#29312b", paper: "#eee9dc", muted: "#a7b1a5",
  moss: "#819271", ochre: "#d2a16f", sage: "#a5c294", sienna: "#cb6e45", line: "#3a463e"
};

type ButtonProps = {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "quiet" | "danger";
  compact?: boolean;
};

export function ActionButton({ label, accessibilityLabel = label, onPress, disabled = false, tone = "quiet", compact = false }: ButtonProps) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, compact && styles.buttonCompact, tone === "primary" && styles.buttonPrimary,
      tone === "danger" && styles.buttonDanger, pressed && styles.pressed, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, tone === "primary" && styles.buttonTextDark]}>{label}</Text>
  </Pressable>;
}

export function MetricStrip({ full, selected }: { full: DraftMetrics; selected: DraftMetrics }) {
  const changed = full.distanceM !== selected.distanceM;
  return <View style={styles.metricStrip} accessibilityLabel="Route and selection metrics">
    <View><Text style={styles.metricValue}>{selected.distanceM} m</Text><Text style={styles.metricLabel}>{changed ? "selection" : "distance"}</Text></View>
    <View><Text style={styles.metricValue}>+{selected.ascentM} m</Text><Text style={styles.metricLabel}>ascent</Text></View>
    <View><Text style={styles.metricValue}>−{selected.descentM} m</Text><Text style={styles.metricLabel}>descent</Text></View>
    <View><Text style={styles.metricValue}>{full.pointCount}</Text><Text style={styles.metricLabel}>shape pts</Text></View>
  </View>;
}

export function EditorToolbar({ draft, busy, onUndo, onRedo, onLoop, onReset }: {
  draft: RouteStudioDraft; busy: boolean; onUndo: () => void; onRedo: () => void; onLoop: () => void; onReset: () => void;
}) {
  return <View style={styles.toolbar}>
    <ActionButton compact label="Undo" disabled={busy || draft.undoStack.length === 0} onPress={onUndo} />
    <ActionButton compact label="Redo" disabled={busy || draft.redoStack.length === 0} onPress={onRedo} />
    <ActionButton compact label={draft.closedLoop ? "Open loop" : "Close loop"} disabled={busy || draft.controlPoints.length < 2} onPress={onLoop} />
    <ActionButton compact label="New" disabled={busy || draft.controlPoints.length === 0} tone="danger" onPress={onReset} />
  </View>;
}

export function ControlPointList({ points, movingId, disabled, onMove, onDelete, onReorder }: {
  points: readonly ControlPoint[]; movingId: string | null; disabled: boolean;
  onMove: (id: string) => void; onDelete: (id: string) => void; onReorder: (id: string, index: number) => void;
}) {
  if (points.length === 0) return <Text style={styles.empty}>Tap the map for a start, destination, then any waypoints.</Text>;
  return <View style={styles.pointList}>{points.map((point, index) =>
    <View key={point.id} style={[styles.pointRow, movingId === point.id && styles.pointRowActive]}>
      <View style={styles.pointNumber}><Text style={styles.pointNumberText}>{index + 1}</Text></View>
      <View style={styles.pointBody}>
        <Text style={styles.pointRole}>{index === 0 ? "start" : index === points.length - 1 ? "finish" : `waypoint ${index}`}</Text>
        <Text style={styles.coordinate}>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</Text>
      </View>
      <View style={styles.pointActions}>
        <ActionButton compact label="Move" accessibilityLabel={`Move point ${index + 1}`} disabled={disabled} onPress={() => onMove(point.id)} />
        <ActionButton compact label="↑" accessibilityLabel={`Move point ${index + 1} up`} disabled={disabled || index === 0} onPress={() => onReorder(point.id, index - 1)} />
        <ActionButton compact label="↓" accessibilityLabel={`Move point ${index + 1} down`} disabled={disabled || index === points.length - 1} onPress={() => onReorder(point.id, index + 1)} />
        <ActionButton compact label="Delete" accessibilityLabel={`Delete point ${index + 1}`} disabled={disabled} tone="danger" onPress={() => onDelete(point.id)} />
      </View>
    </View>
  )}</View>;
}

export type ProfileMode = "inspect" | "start" | "end";

export function ElevationProfile({ profile, selection, cursorDistanceM, mode, onMode, onScrub }: {
  profile: readonly ProfilePoint[]; selection: DraftSelection | null; cursorDistanceM: number | null; mode: ProfileMode;
  onMode: (mode: ProfileMode) => void; onScrub: (distanceM: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const total = profile.at(-1)?.distanceM ?? 0;
  const sampleStep = Math.max(1, Math.ceil(profile.length / 72));
  const sampled = useMemo(() => profile.filter((_, index) => index % sampleStep === 0 || index === profile.length - 1), [profile, sampleStep]);
  const bars = profileBars([...sampled], 64);
  const handlePress = (event: GestureResponderEvent) => onScrub(Math.max(0, Math.min(total, (event.nativeEvent.locationX / width) * total)));
  const handleLayout = (event: LayoutChangeEvent) => setWidth(Math.max(1, event.nativeEvent.layout.width));
  const startPct = total > 0 ? ((selection?.startM ?? 0) / total) * 100 : 0;
  const endPct = total > 0 ? ((selection?.endM ?? total) / total) * 100 : 100;
  const cursorPct = total > 0 && cursorDistanceM !== null ? (cursorDistanceM / total) * 100 : null;
  return <View>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>elevation</Text><Text style={styles.sectionMeta}>public DEM · local profile</Text></View>
    <View style={styles.modeRow}>
      {(["inspect", "start", "end"] as ProfileMode[]).map((entry) =>
        <Pressable key={entry} accessibilityRole="button" accessibilityLabel={entry === "start" ? "Start handle" : entry === "end" ? "End handle" : "Inspect profile"}
          onPress={() => onMode(entry)} style={[styles.mode, mode === entry && styles.modeActive]}>
          <Text style={[styles.modeText, mode === entry && styles.modeTextActive]}>{entry}</Text>
        </Pressable>)}
    </View>
    <Pressable accessibilityRole="adjustable" accessibilityLabel={`Elevation profile, ${mode} mode`} onLayout={handleLayout} onPress={handlePress} style={styles.profile}>
      <View pointerEvents="none" style={[styles.excluded, { left: 0, width: `${startPct}%` }]} />
      <View pointerEvents="none" style={[styles.excluded, { left: `${endPct}%`, right: 0 }]} />
      <View style={styles.bars}>{bars.map((height, index) => <View key={index} style={[styles.bar, { height: Math.max(2, height) }]} />)}</View>
      <View pointerEvents="none" style={[styles.handle, { left: `${startPct}%` }]} />
      <View pointerEvents="none" style={[styles.handle, styles.handleEnd, { left: `${endPct}%` }]} />
      {cursorPct !== null && <View pointerEvents="none" style={[styles.cursor, { left: `${cursorPct}%` }]} />}
    </Pressable>
  </View>;
}

export function TrimStepper({ disabled, onStep, onReset }: { disabled: boolean; onStep: (handle: "start" | "end", direction: number) => void; onReset: () => void }) {
  return <View style={styles.trimRow}>
    <Text style={styles.trimLabel}>start</Text><ActionButton compact label="Start handle backward" disabled={disabled} onPress={() => onStep("start", -1)} />
    <ActionButton compact label="Start handle forward" disabled={disabled} onPress={() => onStep("start", 1)} />
    <Text style={styles.trimLabel}>end</Text><ActionButton compact label="End handle backward" disabled={disabled} onPress={() => onStep("end", -1)} />
    <ActionButton compact label="End handle forward" disabled={disabled} onPress={() => onStep("end", 1)} />
    <ActionButton compact label="Restore full route" disabled={disabled} onPress={onReset} />
  </View>;
}

export function PublicationPanel({ name, status, disabled, onName, onPublish, onResume, onNearby }: {
  name: string; status: string; disabled: boolean; onName: (value: string) => void; onPublish: () => void; onResume: () => void; onNearby: () => void;
}) {
  return <View style={styles.publication}>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>publish</Text><Text style={styles.statusBadge}>{status}</Text></View>
    <TextInput accessibilityLabel="Segment name" value={name} onChangeText={onName} editable={!disabled && status !== "published"} maxLength={80}
      placeholder="Name this route" placeholderTextColor="#78827a" style={styles.input} returnKeyType="done" />
    <Text style={styles.note}>Drafts stay private on this device. Only a confirmed published snapshot is sent.</Text>
    <View style={styles.publishActions}>
      {status === "published" ? <ActionButton label="Resume editing" onPress={onResume} /> : <ActionButton label={status === "failed" ? "Retry publish" : "Review publication"} tone="primary" disabled={disabled} onPress={onPublish} />}
      <ActionButton label="Refresh published" disabled={disabled} onPress={onNearby} />
    </View>
  </View>;
}

export function PublishConfirmation({ visible, name, metrics, pointCount, onCancel, onConfirm }: {
  visible: boolean; name: string; metrics: DraftMetrics; pointCount: number; onCancel: () => void; onConfirm: () => void;
}) {
  return <Modal animationType="fade" transparent visible={visible} onRequestClose={onCancel}>
    <View style={styles.modalBackdrop}><View style={styles.modalCard} accessibilityViewIsModal>
      <Text style={styles.modalKicker}>published snapshot</Text><Text style={styles.modalTitle}>{name}</Text>
      <Text style={styles.modalMetric}>{metrics.distanceM} m · +{metrics.ascentM} / −{metrics.descentM} m</Text>
      <Text style={styles.note}>{pointCount} geometry points and generic control indexes will be public for the demo TTL.</Text>
      <View style={styles.publishActions}><ActionButton label="Keep editing" onPress={onCancel} /><ActionButton label="Publish now" tone="primary" onPress={onConfirm} /></View>
    </View></View>
  </Modal>;
}

export function StudioSheet({ children }: { children: React.ReactNode }) {
  return <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.panel }, sheetContent: { padding: 16, paddingBottom: 42, gap: 16 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, button: { minHeight: 42, justifyContent: "center", alignItems: "center", paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.raised, borderRadius: 10 },
  buttonCompact: { minHeight: 34, paddingHorizontal: 10, borderRadius: 8 }, buttonPrimary: { backgroundColor: colors.ochre, borderColor: colors.ochre }, buttonDanger: { borderColor: "#704936" }, buttonText: { color: colors.paper, fontSize: 12, fontWeight: "700" }, buttonTextDark: { color: colors.ink }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.34 },
  metricStrip: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 12 }, metricValue: { color: colors.paper, fontSize: 15, fontWeight: "800" }, metricLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
  empty: { color: colors.muted, lineHeight: 20 }, pointList: { gap: 8 }, pointRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 8, backgroundColor: colors.raised }, pointRowActive: { borderColor: colors.ochre }, pointNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.moss, alignItems: "center", justifyContent: "center" }, pointNumberText: { color: colors.ink, fontWeight: "900", fontSize: 12 }, pointBody: { flex: 1, minWidth: 0, paddingHorizontal: 9 }, pointRole: { color: colors.paper, fontWeight: "700", fontSize: 12 }, coordinate: { color: colors.muted, fontSize: 10, marginTop: 2 }, pointActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 4, maxWidth: 190 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, sectionTitle: { color: colors.paper, fontSize: 18, fontWeight: "800" }, sectionMeta: { color: colors.muted, fontSize: 10 }, modeRow: { flexDirection: "row", gap: 6, marginTop: 10 }, mode: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line }, modeActive: { borderColor: colors.ochre, backgroundColor: "#3b3328" }, modeText: { color: colors.muted, fontSize: 11 }, modeTextActive: { color: colors.ochre, fontWeight: "800" },
  profile: { height: 82, marginTop: 8, overflow: "hidden", borderRadius: 10, backgroundColor: colors.ink, justifyContent: "flex-end" }, bars: { height: 66, paddingHorizontal: 4, flexDirection: "row", alignItems: "flex-end", gap: 1 }, bar: { flex: 1, minWidth: 1, backgroundColor: colors.sage, opacity: 0.82 }, excluded: { position: "absolute", zIndex: 2, top: 0, bottom: 0, backgroundColor: "rgba(10,12,11,0.65)" }, handle: { position: "absolute", zIndex: 3, top: 0, bottom: 0, width: 3, backgroundColor: colors.ochre }, handleEnd: { backgroundColor: colors.sage }, cursor: { position: "absolute", zIndex: 4, top: 0, bottom: 0, width: 1, backgroundColor: colors.paper },
  trimRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, alignItems: "center" }, trimLabel: { color: colors.muted, fontSize: 10, width: 28 }, publication: { gap: 10, paddingTop: 2 }, statusBadge: { color: colors.sage, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3, fontSize: 10 }, input: { color: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 10, minHeight: 46, paddingHorizontal: 13, backgroundColor: colors.ink }, note: { color: colors.muted, fontSize: 11, lineHeight: 17 }, publishActions: { flexDirection: "row", gap: 8 },
  modalBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(7,10,8,0.82)" }, modalCard: { padding: 22, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, gap: 12 }, modalKicker: { color: colors.ochre, fontSize: 10, fontWeight: "900", letterSpacing: 1.8 }, modalTitle: { color: colors.paper, fontSize: 24, fontWeight: "800" }, modalMetric: { color: colors.sage, fontSize: 16, fontWeight: "700" }
});
