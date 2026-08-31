# Redroid Android 14 airplane-mode evidence

The commands below were run against the explicitly named emulator
`localhost:5555` (`redroid14_x86_64`, Android 14, x86_64). Before every
route and benchmark command, the harness checks `airplane_mode_on == 1` and
disables Wi-Fi and cellular data.

`2026-08-31T09-47-00Z-two-tap.json` and its screenshot/XML are the primary
device evidence. They record two `adb input tap` gestures on the MapLibre
map, a native route result of 392 m / 31 points, and the rendered counter
`network attempts this session: 0`.

The route uses the bundled CCHP1 pack:

```text
f76d7fb4f9323db1eeb2f6cebe575c8ca3fda94c04e07d45b434f8adb6907088  fixtures/sydney/routing.pack
```

The release APK installed for the final smoke run had this SHA-256:

```text
e86ac7ca36ec3fd6f85184e3621474884bc970a152856b06fcc52d6e9121f84d
```

Global emulator traffic is not used as a proof because other installed apps
emit background packets even in airplane mode. The process-scoped routing
capture `2026-08-31T09-49-02Z-route-connect.strace.log` is the relevant
evidence for the route gesture: it attaches to the app process with
`strace -f -e trace=connect` and contains no `connect(...)` syscall while the
native route is calculated. Its scope is the observed route gesture, not a
claim about unrelated emulator processes.

This evidence does not exercise publication or a live API.

`2026-08-31T09-50-00Z-memory.txt` is a device-side `dumpsys meminfo` snapshot
after the offline route screen was loaded (TOTAL PSS 156561 KB, TOTAL RSS
291620 KB). Redroid reports native PSS unusually as zero; use the raw dump,
not that field, for comparison.
