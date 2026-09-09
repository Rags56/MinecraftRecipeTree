export interface CachedPublishedDocument {
  text: string;
  bytes: number;
}

/**
 * Web has its own persistence layer for this (the service worker in public/local-pack-sw.js,
 * plus the browser's own HTTP cache honoring the immutable/long-max-age headers these documents
 * already carry). This native-only cache exists because React Native's networking layer has no
 * equivalent persistent disk cache by default, so without it every cold app start would re-fetch
 * the full dataset from the network even though the content is immutable per URL.
 */
export async function readCachedPublishedDocument(
  _url: string,
): Promise<CachedPublishedDocument | null> {
  return null;
}

export async function writeCachedPublishedDocument(_url: string, _text: string): Promise<void> {}
