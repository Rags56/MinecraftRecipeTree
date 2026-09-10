import * as DocumentPicker from 'expo-document-picker';
import {File, Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {MAX_PORTABLE_TREE_BYTES} from './portableTree.ts';

export async function sharePortableTree(
  filename: string,
  json: string,
): Promise<string> {
  if (!/^[A-Za-z0-9._-]+\.mrtree\.json$/.test(filename)) throw new Error('Invalid tree filename.');
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
  const file = new File(Paths.cache, filename);
  file.write(json);
  await Sharing.shareAsync(file.uri, {mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Share tree history'});
  return 'Tree share sheet closed.';
}

export async function pickPortableTreeFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (asset.size !== undefined && asset.size > MAX_PORTABLE_TREE_BYTES) {
    throw new Error('The selected tree is larger than the 1 MiB import limit.');
  }
  return new File(asset.uri).text();
}

export async function savePortableTreeToInstance(): Promise<string> {
  throw new Error('Saving into a Minecraft instance is available on desktop web.');
}
