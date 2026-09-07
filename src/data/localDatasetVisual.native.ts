import {Directory, File} from 'expo-file-system';

/** Materialize only the displayed image from a downloaded 1 MiB pack. */
export function localDatasetVisualUri(url: string): string {
  if (!url.startsWith('file://')) return url;
  const uri = url.split(/[?#]/, 1)[0];
  const match = /^(.*)\/assets\/s\/(\d+)-(\d+)-(\d+)\.webp$/.exec(uri);
  if (!match) return uri;
  const target = new File(uri);
  if (target.exists) return target.uri;
  const [, root, pack, offsetText, lengthText] = match;
  const offset = Number(offsetText), length = Number(lengthText);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || length > 1024 * 1024) throw new Error('Invalid downloaded image coordinate.');
  const source = new File(new Directory(root), 'assets', `pack-${String(Number(pack)).padStart(3, '0')}.bin`);
  if (!source.exists || offset + length > source.size) throw new Error('The downloaded image pack is missing or truncated.');
  const handle = source.open();
  try {
    handle.offset = offset;
    const bytes = handle.readBytes(length);
    target.create({intermediates: true}); target.write(bytes);
    return target.uri;
  } catch (error) {
    console.error('A downloaded pack image could not be read.', {uri, error});
    throw error;
  } finally { handle.close(); }
}
