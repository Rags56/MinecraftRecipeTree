import {Platform} from 'react-native';

const ONBOARDING_STORAGE_KEY = 'minecraft-recipe-tree-onboarding-seen';

/**
 * Native has no durable equivalent wired up yet (interfaceZoom.ts and themePreference.tsx make
 * the same call), so a returning native visitor would otherwise see this every launch -- treating
 * native as already-seen is less wrong than repeating the prompt every session.
 */
export function hasSeenOnboarding(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch (cause) {
    console.error('Onboarding visit state could not be read; treating this as a first visit.', cause);
    return false;
  }
}

export function markOnboardingSeen(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
  } catch (cause) {
    console.error('Onboarding visit state could not be saved; it may show again next visit.', cause);
  }
}
