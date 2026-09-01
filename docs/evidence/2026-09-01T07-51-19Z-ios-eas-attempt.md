# iOS EAS attempt - 2026-09-01T07:51:19Z

Commands run locally from `apps/mobile` with `EXPO_TOKEN` already present in the
shell environment:

```bash
../../node_modules/.bin/eas whoami
../../node_modules/.bin/eas project:info
../../node_modules/.bin/eas build --platform ios --profile ios-internal --non-interactive --wait
../../node_modules/.bin/eas build --platform ios --profile ios-testflight --non-interactive --wait
```

Observed results:

- `eas whoami` authenticated successfully as the public Expo owner `milo78`.
- `eas project:info` resolved the linked public project
  `@milo78/offline-routing-demo` with ID
  `1dd962e3-3f2c-4a4f-ad78-58eb973cdd07`.
- `ios-internal` failed after remote credential resolution with:
  `EAS CLI couldn't find any credentials suitable for internal distribution`
  and recommended rerunning interactively.
- the account-level distribution certificate already used by another app was
  visible and could be selected for the public demo without exporting it;
- the target iPad is already enrolled in the Apple team;
- creation of the bundle-specific ad hoc provisioning profile then required a
  fresh interactive Apple Developer login. The cached local Apple session had
  expired, so the operation was stopped before entering a password;
- no App Store Connect API key was stored in the EAS account as an alternative
  non-interactive bootstrap path.

Interpretation:

- The public repo configuration is valid enough for Expo to resolve the correct
  project and start iOS credential setup.
- The remaining blocker is one fresh Apple Developer authentication to create
  the provisioning profile for `dev.offlinerouting.demo`; the reusable
  certificate and registered device already exist remotely.
- No App Store Connect issuer ID or `EXPO_ASC_*` variables were present in the
  local shell during this run.

Next external action required:

1. authenticate once interactively in EAS/Apple to create the public bundle's
   ad hoc provisioning profile, or
2. create and provide an App Store Connect API key to CI through `EXPO_ASC_API_KEY_PATH`
   or `EXPO_ASC_API_KEY_BASE64` plus `EXPO_ASC_KEY_ID` and
   `EXPO_ASC_ISSUER_ID`.

No credential value, Apple account identifier, device identifier, certificate
serial, or provisioning material is recorded in this evidence.
