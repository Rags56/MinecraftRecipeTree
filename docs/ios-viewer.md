# iOS adaptation of the viewer

Recipe Tree on iOS runs the existing `App.tsx`, recipe browser, graph, recipe picker,
item details and pack contracts. Metro selects small `.native` adapters for platform
services. It is not a separate viewer implementation or a WebView pointing at the site.

## Build and run on Nemo

The project targets Expo 56 / React Native 0.85.3. Keep the existing Metro alias to
`react-native-react`: the website's React patch version differs from the native renderer.
Use Xcode 26.4 or later and the configured Apple development team.

```sh
npm install
npm run test:ios
npx tsc --noEmit
npm run ios:nemo
```

`ios:nemo` creates a Release build with its JS bundle embedded, so the phone does not
need Metro or the Mac after installation. It requires Nemo to be paired, available,
and unlocked for the launch. This is a development-signed install, not an App Store release.
Generated `ios/` files remain ignored; Expo app configuration and dependencies are tracked.

## Accounts and local packs

- Discord uses the existing Supabase project through iOS's system authentication session.
  PKCE uses native entropy and SHA-256; the browser will not open if the authorization
  request has a weaker challenge method. Session tokens and PKCE verifiers use Keychain.
- Supabase allows the exact redirect `minecraft-recipe-tree://auth/callback` under
  Authentication → URL Configuration → Redirect URLs for project `ebahymgbekjsxhacubxk`.
  It was added with user approval on September 6 after an anonymous cancelled OAuth flow
  reproduced the nested-website login: the unlisted native callback returned to the Site URL.
  The saved configuration now has five entries, preserving the Site URL and all four
  existing production, beta and local development redirects. No Discord secret belongs in
  the app. Fresh cancelled OAuth flows now return HTTP 302 to the exact requested native,
  production web and beta web callbacks. This server configuration fix applies to Nemo's
  installed build; close the old authentication browser and begin a new sign-in attempt.
  Completed native login and session persistence after an app restart still need an
  on-device check.
- Authenticated requests attach the session only to the canonical Recipe Tree `/api/`
  origin. The existing API's Origin requirement is also supplied by the native client.
- Settings lists public published packs. Downloaded copies are scoped to the signed-in
  account **on this device**; this is not a new cloud pack-storage service.
- Downloads traverse the viewer's complete JSON/shard graph and retrieve bounded image
  packs. Preview manifests bind the exact dataset and preview identities, sizes and hashes.
  A staging directory becomes selectable only when every requested file is saved.
- Download progress is visible, cancellation removes staged files, and failures are logged
  and displayed. Limits are 30,000 files, 8 MiB per JSON document, 1 MiB per image pack,
  and 2 GiB total. Keep the app open during a download. Interrupted process termination
  is not a resumable/background-download implementation.
- Completed downloads can be selected offline using the saved catalog. Packed images are
  extracted locally when displayed. Extracted images consume additional local storage.
- Existing Files/ZIP import remains available without publishing the export. Those local
  imports retain the existing device-wide library behavior.
- Expo's SQLite-backed `localStorage` preserves the existing graph session, recent history,
  preferred sources and recipe-stage storage contracts. It does not imply cloud history sync.
- Portable `.mrtree.json` files use the native file share sheet and Files picker.

## Automatic tree-history sync feasibility

The requested history is **saved recipe trees**, not search telemetry or inventory activity.
The Minecraft companion already has full tree snapshots and world/server-scoped history;
the viewer already imports/exports versioned portable trees with strict pack compatibility.
An iPhone cannot directly watch the Minecraft instance's desktop filesystem.

The recommended next increment is account-based, explicitly paired instance sync:

1. The mod requests a short-lived one-use pairing code. The signed-in viewer approves that
   instance and the desired world/server. Store a revocable, narrowly scoped device credential
   for the mod; never copy a user's Supabase refresh token into Minecraft configuration.
2. Bind the pairing to the canonical pack identity, Minecraft version, exact publication
   when available, and an opaque instance/world identifier. A same-named pack alone does
   not authorize or establish compatibility. Reuse the portable-tree import validation.
3. Upload immutable portable snapshots after completed tree saves, off the game/render
   thread, using a small bounded queue and retry backoff. Address each saved tree and
   revision independently; preserve concurrent edits instead of overwriting the newest file.
4. Pull new revisions when the viewer opens/resumes and after local saves. Show last sync,
   pending changes, conflicts and failures. Begin with importing the Minecraft history into
   the viewer; add conflict-aware editing in both directions after this path is verified.
5. Treat iOS background refresh as opportunistic. It cannot guarantee immediate sync while
   the app is closed or force-quit. Foreground/resume sync must be the reliable path.

A local-network bridge is the alternative: it keeps history off a cloud service and avoids
cloud storage, but requires both devices to be reachable, local-network permission, and
secure pairing/TLS. Account-based sync works across networks and has clearer device
revocation, at the cost of maintaining an authenticated sync API and cloud history storage.
No automatic-sync toggle, backend endpoint, or Minecraft mod change is claimed in this build.
The existing exporter work in the checkout is preserved.

## Documentation consulted

- [Expo 56 platform/version requirements](https://docs.expo.dev/versions/v56.0.0/)
- [Expo 56 system authentication browser](https://docs.expo.dev/versions/v56.0.0/sdk/webbrowser/)
- [Expo 56 Keychain storage](https://docs.expo.dev/versions/v56.0.0/sdk/securestore/)
- [Expo 56 SQLite localStorage adapter](https://docs.expo.dev/versions/v56.0.0/sdk/sqlite/#the-localstorage-api)
- [Supabase native deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
- [Apple settings guidance](https://developer.apple.com/design/human-interface-guidelines/settings)
- [Expo 56 background-task limitations](https://docs.expo.dev/versions/v56.0.0/sdk/background-task/)

## Verification — 2026-09-06

- TypeScript completed without errors; all 33 `test:ios` checks passed.
- Release builds succeeded for physical iPhone and iPhone simulator.
- The final development-signed build installed and launched on Nemo (iPhone 17 Pro).
- Simulator UI checks confirmed the existing item browser and icons, the themed header dropdown
  menu, the Settings tab, and the iOS authentication session reaching Discord's
  login page. Cancelling login returns to Settings without an error.
- A real Multiblock Madness 2 download completed in temporary host storage: 834 files,
  229,045,898 bytes. The first five-minute validation run timed out; a second validation
  reused the downloaded immutable files and finished. This reuse was a test-harness feature,
  not a claimed in-app resumable-download feature.
- The simulator build requires Xcode signing entitlements for Keychain tests. An unsigned
  simulator build initially reported missing Keychain entitlements; the Xcode-signed build
  resolved this. The device build is signed with the configured development team.
- Completed Discord login, authenticated account operations, and offline viewing through
  an authenticated on-device download remain unverified pending the on-device login check.
  The server redirect configuration is corrected and verified as described above; the full
  download traversal was verified separately with the host-side check recorded above.

The iOS overflow menu uses the viewer’s themed dropdown anchored beneath the ••• button,
with 44-point touch targets and tap-outside dismissal. It replaces the initial system action sheet.

Scale controls live in Settings → Display. UI scale uses 75%, 100%, 125% and 150%
steps and scales native menus, controls and modal layouts. Recipe/item scale changes
actual icon dimensions and recipe artwork independently, including the Browse grid,
recipe cards and recipe picker. Enlarged native recipes scroll horizontally instead of
silently stopping at the screen width. Both preferences persist across launches.

Display includes a small grid of real Minecraft items and a real crafting recipe from
the selected pack. The examples reuse the viewer's rendering components. Loading errors
are visible and logged, and the recipe preview can be retried. The former native ≡ menu
is removed; Import tree lives in the ••• menu, which no longer includes Import pack.
Recipe stages remain in that menu when supported, and pack attribution is in Settings.

Sign in now opens in a compact, themed popover anchored to the account header button,
with a pointer, close button and outside-tap dismissal. Simulator checks verified its
placement, both dismissal paths, the Discord authentication prompt and recovery after
cancelling authentication. Account and offline downloads are available in the Settings tab.


Settings now lives in the native bottom tab bar. The screen uses compact account,
downloads and history sections; signed-out users do not see empty username fields or
unavailable session actions. Display-name editing is shown only when requested, and
saved packs expose Open and Remove actions with their local storage size. Settings stays
mounted after its first visit so switching tabs does not cancel an active download.
The duplicate Settings entry was removed from the information dropdown, and selecting
a signed-in account in the header opens the tab.

The Settings follow-up passed TypeScript, 33 iOS checks and 17 zoom/navigation checks.
Both Release builds succeeded. Simulator checks verified the signed-out screen, its
history action and switching back to Browse. Nemo's first install was interrupted by a
device connection failure; the retry succeeded. Automatic launch was blocked because Nemo
was locked; the installed update is ready to open after unlocking. Signed-in account/download UI verification still depends on the
live login check described above.


The scaling follow-up adds regression coverage for independent UI/content sizing,
continuous native icon growth and recipes wider than the viewport. Simulator checks
confirmed the stepper changes UI size, the content slider changes artwork and grid
layout, and the information menu exposes Import tree without Import pack. A build
initially failed on a JSX guard; the guard was corrected and TypeScript passed.
The final Release builds passed, along with all 37 iOS tests and 23 scale/preview tests.
The update installed on Nemo. Automatic launch was blocked by the device lock screen;
open Recipe Tree after unlocking to use the installed update.
