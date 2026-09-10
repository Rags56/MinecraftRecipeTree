// Preserve the viewer's existing storage contracts on iOS using SQLite.
import 'expo-sqlite/localStorage/install';

import { registerRootComponent } from 'expo';

import { migrateLegacyNativeLocalStorage } from './src/ui/nativeLocalStorage';

// Must run after the SQLite-backed localStorage above is installed and before App (and everything
// it imports, like theme/zoom preferences and the graph session) first reads it, so state saved by
// builds that used the older JSON-file polyfill is already in place by the time anything asks.
migrateLegacyNativeLocalStorage();

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
