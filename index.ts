import { registerRootComponent } from 'expo';

import { installNativeLocalStoragePolyfill } from './src/ui/nativeLocalStorage';

// Must run before App (and everything it imports, like theme/zoom preferences and the graph
// session) so their first localStorage read on native sees the polyfill already installed.
installNativeLocalStoragePolyfill();

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
