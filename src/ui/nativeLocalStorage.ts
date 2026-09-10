/**
 * Web has always had a real localStorage and never ran the native JSON-file polyfill, so there is
 * nothing to migrate here. See nativeLocalStorage.native.ts.
 */
export function migrateLegacyNativeLocalStorage(): void {}
