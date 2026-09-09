import {AppState} from 'react-native';
import {Directory, File as NativeFile, Paths} from 'expo-file-system';

const ROOT_DIRECTORY_NAME = 'minecraft-recipe-tree';
const STORAGE_FILE_NAME = 'local-storage.json';
// Batches rapid successive writes (e.g. every tree edit re-persisting the graph session) into
// one disk write instead of one per change, while getItem always reads the up-to-date in-memory
// copy regardless of whether that write has flushed yet.
const WRITE_DEBOUNCE_MS = 500;

function storageDirectory(): Directory {
  return new Directory(Paths.document, ROOT_DIRECTORY_NAME);
}

function storageFile(): NativeFile {
  return new NativeFile(storageDirectory(), STORAGE_FILE_NAME);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(entry => typeof entry === 'string')
  );
}

function readAll(): Record<string, string> {
  try {
    const file = storageFile();
    if (!file.exists) return {};
    const parsed = JSON.parse(file.textSync()) as unknown;
    return isStringRecord(parsed) ? parsed : {};
  } catch (error) {
    console.error('The native localStorage polyfill could not be read; starting empty.', error);
    return {};
  }
}

function writeAll(data: Record<string, string>): void {
  try {
    storageDirectory().create({idempotent: true, intermediates: true});
    const file = storageFile();
    file.create({intermediates: true, overwrite: true});
    file.write(JSON.stringify(data));
  } catch (error) {
    console.error('The native localStorage polyfill could not be saved.', error);
  }
}

/** A synchronous, expo-file-system-backed stand-in for the Storage interface localStorage
 * implements, so every existing `globalThis.localStorage?.getItem(...)`-style call already
 * spread across this codebase (graph sessions, theme/zoom preferences, etc.) just works on
 * native without those files needing any platform-specific branches of their own. */
class NativeLocalStorage {
  private data: Record<string, string> = readAll();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleFlush(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      writeAll(this.data);
    }, WRITE_DEBOUNCE_MS);
  }

  /** Anything still inside the debounce window is lost if the process dies, and leaving the
   * foreground is the last moment this is reliably able to run. */
  flushPending(): void {
    if (this.flushTimer === null) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    writeAll(this.data);
  }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
  }

  setItem(key: string, value: string): void {
    this.data[key] = value;
    this.scheduleFlush();
  }

  removeItem(key: string): void {
    delete this.data[key];
    this.scheduleFlush();
  }
}

export function installNativeLocalStoragePolyfill(): void {
  if (typeof globalThis.localStorage !== 'undefined') return;
  // Every existing caller in this codebase only ever uses getItem/setItem/removeItem; this
  // deliberately doesn't implement the rest of the Storage interface (length, clear, key).
  const storage = new NativeLocalStorage();
  (globalThis as {localStorage?: unknown}).localStorage = storage;
  AppState.addEventListener('change', state => {
    if (state !== 'active') storage.flushPending();
  });
}
