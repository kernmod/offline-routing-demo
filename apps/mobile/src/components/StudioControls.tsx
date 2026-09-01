import { useMemo, useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from "react-native";
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop } from "react-native-svg";
import type { ControlPoint, DraftMetrics, DraftSelection, ProfilePoint, RouteStudioDraft } from "@offline-routing/route-studio";
import {
  profilePath,
  profileRangeViewModel,
  selectionFromProfileGesture,
  xToProfileDistance,
  type TrimHandle
} from "../studioViewModel";

const colors = {
  ink: "#161a18", panel: "#202622", raised: "#29312b", paper: "#eee9dc", muted: "#a7b1a5",
  moss: "#819271", ochre: "#d2a16f", sage: "#a5c294", sienna: "#cb6e45", line: "#3a463e"
};

const adjustableActions = [
  { name: "increment", label: "Move forward" },
  { name: "decrement", label: "Move backward" }
];

function formatDistance(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(2)} km` : `${Math.round(distanceM)} m`;
}

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

export function ElevationProfile({ profile, totalDistanceM, selection, cursorDistanceM, disabled, onTrimPreview, onTrimCommit, onScrub }: {
  profile: readonly ProfilePoint[]; totalDistanceM: number; selection: DraftSelection | null; cursorDistanceM: number | null; disabled: boolean;
  onTrimPreview: (startM: number, endM: number, cursorDistanceM: number) => void;
  onTrimCommit: (startM: number, endM: number) => void;
  onScrub: (distanceM: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const [activeHandle, setActiveHandle] = useState<TrimHandle>("start");
  const selectionRef = useRef<DraftSelection>({ startM: 0, endM: 0 });
  const dragOriginRef = useRef<DraftSelection>({ startM: 0, endM: 0 });
  const gestureMovedRef = useRef(false);
  const total = Math.max(0, totalDistanceM);
  const handleLayout = (event: LayoutChangeEvent) => setWidth(Math.max(1, event.nativeEvent.layout.width));
  const range = profileRangeViewModel(total, selection, cursorDistanceM);
  const currentSelection = selection ?? { startM: 0, endM: total };
  selectionRef.current = currentSelection;
  const path = useMemo(() => profilePath(profile), [profile]);
  const x = (percent: number) => (percent / 100) * 600;
  const markerX = (percent: number) => Math.min(586, Math.max(14, x(percent)));
  const startGesture = (handle: TrimHandle) => {
    const current = selectionRef.current;
    setActiveHandle(handle);
    dragOriginRef.current = current;
    gestureMovedRef.current = false;
    onScrub(handle === "start" ? current.startM : current.endM);
  };
  const previewGesture = (handle: TrimHandle, deltaX: number) => {
    const origin = dragOriginRef.current;
    const anchor = handle === "start" ? origin.startM : origin.endM;
    const originX = total > 0 ? (anchor / total) * width : 0;
    const next = selectionFromProfileGesture(total, origin, handle, xToProfileDistance(originX + deltaX, width, total));
    gestureMovedRef.current ||= Math.abs(deltaX) >= 0.5;
    selectionRef.current = next;
    onTrimPreview(next.startM, next.endM, handle === "start" ? next.startM : next.endM);
  };
  const finishGesture = () => {
    if (gestureMovedRef.current) onTrimCommit(selectionRef.current.startM, selectionRef.current.endM);
    gestureMovedRef.current = false;
  };
  const adjustHandle = (handle: TrimHandle, direction: number) => {
    if (disabled || total <= 0 || direction === 0) return;
    const current = selectionRef.current;
    const anchor = handle === "start" ? current.startM : current.endM;
    const next = selectionFromProfileGesture(total, current, handle, anchor + Math.max(1, total * 0.025) * direction);
    const cursor = handle === "start" ? next.startM : next.endM;
    selectionRef.current = next;
    setActiveHandle(handle);
    onTrimPreview(next.startM, next.endM, cursor);
    onTrimCommit(next.startM, next.endM);
  };
  const startHandleResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled && total > 0,
    onMoveShouldSetPanResponder: () => !disabled && total > 0,
    onPanResponderGrant: () => startGesture("start"),
    onPanResponderMove: (_event, gesture) => previewGesture("start", gesture.dx),
    onPanResponderRelease: finishGesture,
    onPanResponderTerminate: finishGesture,
    onPanResponderTerminationRequest: () => false
  }), [disabled, total, width]);
  const endHandleResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled && total > 0,
    onMoveShouldSetPanResponder: () => !disabled && total > 0,
    onPanResponderGrant: () => startGesture("end"),
    onPanResponderMove: (_event, gesture) => previewGesture("end", gesture.dx),
    onPanResponderRelease: finishGesture,
    onPanResponderTerminate: finishGesture,
    onPanResponderTerminationRequest: () => false
  }), [disabled, total, width]);
  const inspectDistance = cursorDistanceM ?? (currentSelection.startM + currentSelection.endM) / 2;
  const adjustInspection = (direction: number) => {
    if (total <= 0 || direction === 0) return;
    onScrub(Math.max(0, Math.min(total, inspectDistance + Math.max(1, total * 0.025) * direction)));
  };
  return <View>
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>elevation cut</Text>
      <Text style={styles.sectionMeta}>public DEM · local profile</Text>
    </View>
    <View
      onLayout={handleLayout}
      style={styles.profile}
    >
      <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 600 150" preserveAspectRatio="none" style={styles.profileSvg}>
        <Defs>
          <LinearGradient id="elevationFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.sage} stopOpacity="0.28" />
            <Stop offset="1" stopColor={colors.sage} stopOpacity="0.03" />
          </LinearGradient>
        </Defs>
        <Rect x={x(range.selectedLeftPct)} y={0} width={x(range.selectedWidthPct)} height={150} fill="rgba(210,161,111,0.1)" stroke="rgba(210,161,111,0.72)" strokeWidth={2} />
        {path.length > 0 && <Path d={`${path} L600,142 L0,142 Z`} fill="url(#elevationFill)" />}
        {path.length > 0 && <Path d={path} fill="none" stroke={colors.sage} strokeWidth={3} vectorEffect="non-scaling-stroke" />}
        <Rect x={0} y={0} width={x(range.beforeWidthPct)} height={150} fill={colors.ink} fillOpacity={0.7} />
        <Rect x={x(range.afterLeftPct)} y={0} width={600 - x(range.afterLeftPct)} height={150} fill={colors.ink} fillOpacity={0.7} />
        <Line x1={x(range.startPct)} x2={x(range.startPct)} y1={4} y2={146} stroke={colors.ochre} strokeWidth={activeHandle === "start" ? 8 : 5} />
        <Line x1={x(range.endPct)} x2={x(range.endPct)} y1={4} y2={146} stroke={colors.sage} strokeWidth={activeHandle === "end" ? 8 : 5} />
        <Circle cx={markerX(range.startPct)} cy={18} r={12} fill={colors.ochre} stroke={colors.paper} strokeWidth={2.5} />
        <Circle cx={markerX(range.endPct)} cy={18} r={12} fill={colors.sage} stroke={colors.paper} strokeWidth={2.5} />
        {range.cursorPct !== null && <Line x1={x(range.cursorPct)} x2={x(range.cursorPct)} y1={4} y2={146} stroke={colors.sienna} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      </Svg>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Profile position"
        accessibilityHint="Tap or adjust to inspect elevation on the map."
        accessibilityActions={adjustableActions}
        accessibilityValue={{ min: 0, max: Math.round(total), now: Math.round(inspectDistance), text: formatDistance(inspectDistance) }}
        onAccessibilityAction={(event) => adjustInspection(event.nativeEvent.actionName === "increment" ? 1 : event.nativeEvent.actionName === "decrement" ? -1 : 0)}
        onPress={(event: GestureResponderEvent) => onScrub(xToProfileDistance(event.nativeEvent.locationX, width, total))}
        style={styles.profileInspect}
      />
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Selection start"
        accessibilityHint="Drag to change where the published segment begins."
        accessibilityActions={adjustableActions}
        accessibilityValue={{ min: 0, max: Math.round(total), now: Math.round(currentSelection.startM), text: formatDistance(currentSelection.startM) }}
        accessibilityState={{ disabled: disabled || total <= 0 }}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        onAccessibilityAction={(event) => adjustHandle("start", event.nativeEvent.actionName === "increment" ? 1 : event.nativeEvent.actionName === "decrement" ? -1 : 0)}
        style={[styles.handleTouch, { left: `${range.startPct}%` }]}
        {...startHandleResponder.panHandlers}
      >
        <View style={[styles.handle, styles.handleStart, activeHandle === "start" && styles.handleActive]} />
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Selection end"
        accessibilityHint="Drag to change where the published segment ends."
        accessibilityActions={adjustableActions}
        accessibilityValue={{ min: 0, max: Math.round(total), now: Math.round(currentSelection.endM), text: formatDistance(currentSelection.endM) }}
        accessibilityState={{ disabled: disabled || total <= 0 }}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        onAccessibilityAction={(event) => adjustHandle("end", event.nativeEvent.actionName === "increment" ? 1 : event.nativeEvent.actionName === "decrement" ? -1 : 0)}
        style={[styles.handleTouch, { left: `${range.endPct}%` }]}
        {...endHandleResponder.panHandlers}
      >
        <View style={[styles.handle, styles.handleEnd, activeHandle === "end" && styles.handleActive]} />
      </View>
    </View>
    <View style={styles.profileReadout}>
      <View style={styles.profileReadoutItem}><View style={[styles.readoutDot, styles.readoutDotStart]} /><Text style={styles.profileReadoutLabel}>from</Text><Text style={styles.profileReadoutValue}>{formatDistance(currentSelection.startM)}</Text></View>
      <View style={styles.profileReadoutRule} />
      <View style={styles.profileReadoutItem}><View style={[styles.readoutDot, styles.readoutDotEnd]} /><Text style={styles.profileReadoutLabel}>to</Text><Text style={styles.profileReadoutValue}>{formatDistance(currentSelection.endM)}</Text></View>
    </View>
  </View>;
}

export function TrimStepper({ disabled, onStep, onReset }: { disabled: boolean; onStep: (handle: "start" | "end", direction: number) => void; onReset: () => void }) {
  return <View style={styles.trimRow} accessibilityLabel="Fine trim adjustments">
    <View style={styles.nudgeGroup}><Text style={styles.trimLabel}>from</Text><ActionButton compact label="−" accessibilityLabel="Move start backward" disabled={disabled} onPress={() => onStep("start", -1)} /><ActionButton compact label="+" accessibilityLabel="Move start forward" disabled={disabled} onPress={() => onStep("start", 1)} /></View>
    <View style={styles.nudgeGroup}><Text style={styles.trimLabel}>to</Text><ActionButton compact label="−" accessibilityLabel="Move end backward" disabled={disabled} onPress={() => onStep("end", -1)} /><ActionButton compact label="+" accessibilityLabel="Move end forward" disabled={disabled} onPress={() => onStep("end", 1)} /></View>
    <ActionButton compact label="full route" accessibilityLabel="Restore full route" disabled={disabled} onPress={onReset} />
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
  buttonCompact: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, borderRadius: 8 }, buttonPrimary: { backgroundColor: colors.ochre, borderColor: colors.ochre }, buttonDanger: { borderColor: "#704936" }, buttonText: { color: colors.paper, fontSize: 12, fontWeight: "700" }, buttonTextDark: { color: colors.ink }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.34 },
  metricStrip: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 12 }, metricValue: { color: colors.paper, fontSize: 15, fontWeight: "800" }, metricLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
  empty: { color: colors.muted, lineHeight: 20 }, pointList: { gap: 8 }, pointRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 8, backgroundColor: colors.raised }, pointRowActive: { borderColor: colors.ochre }, pointNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.moss, alignItems: "center", justifyContent: "center" }, pointNumberText: { color: colors.ink, fontWeight: "900", fontSize: 12 }, pointBody: { flex: 1, minWidth: 0, paddingHorizontal: 9 }, pointRole: { color: colors.paper, fontWeight: "700", fontSize: 12 }, coordinate: { color: colors.muted, fontSize: 10, marginTop: 2 }, pointActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 4, maxWidth: 190 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, sectionTitle: { color: colors.paper, fontSize: 18, fontWeight: "800" }, sectionMeta: { color: colors.muted, fontSize: 10 },
  profile: { height: 142, marginTop: 10, marginHorizontal: 22, overflow: "visible", borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink }, profileSvg: { position: "absolute", inset: 0 }, profileInspect: { position: "absolute", zIndex: 2, inset: 0 }, handleTouch: { position: "absolute", zIndex: 5, top: 0, bottom: 0, width: 44, marginLeft: -22, alignItems: "center", justifyContent: "center" }, handle: { width: 3, height: "100%", borderRadius: 3, backgroundColor: colors.ochre }, handleStart: { backgroundColor: colors.ochre }, handleEnd: { backgroundColor: colors.sage }, handleActive: { width: 5 }, profileReadout: { flexDirection: "row", alignItems: "center", marginTop: 8, paddingHorizontal: 2 }, profileReadoutItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }, profileReadoutRule: { width: 1, height: 18, marginHorizontal: 10, backgroundColor: colors.line }, readoutDot: { width: 7, height: 7, borderRadius: 4 }, readoutDotStart: { backgroundColor: colors.ochre }, readoutDotEnd: { backgroundColor: colors.sage }, profileReadoutLabel: { color: colors.muted, fontSize: 10 }, profileReadoutValue: { color: colors.paper, fontSize: 12, fontWeight: "800", marginLeft: "auto" },
  trimRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }, nudgeGroup: { flexDirection: "row", alignItems: "center", gap: 5, padding: 4, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.ink }, trimLabel: { color: colors.muted, fontSize: 10, width: 30, marginLeft: 4 }, publication: { gap: 10, paddingTop: 2 }, statusBadge: { color: colors.sage, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3, fontSize: 10 }, input: { color: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 10, minHeight: 46, paddingHorizontal: 13, backgroundColor: colors.ink }, note: { color: colors.muted, fontSize: 11, lineHeight: 17 }, publishActions: { flexDirection: "row", gap: 8 },
  modalBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(7,10,8,0.82)" }, modalCard: { padding: 22, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, gap: 12 }, modalKicker: { color: colors.ochre, fontSize: 10, fontWeight: "900", letterSpacing: 1.8 }, modalTitle: { color: colors.paper, fontSize: 24, fontWeight: "800" }, modalMetric: { color: colors.sage, fontSize: 16, fontWeight: "700" }
});
