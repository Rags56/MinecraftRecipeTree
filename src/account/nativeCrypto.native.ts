import * as ExpoCrypto from 'expo-crypto';

/** Supabase's PKCE helper expects Web Crypto; Hermes supplies neither entropy nor SHA-256. */
export function installNativeAuthCrypto(): void {
  const nativeCrypto = globalThis.crypto ?? ({} as Crypto);
  if (!nativeCrypto.getRandomValues) {
    Object.defineProperty(nativeCrypto, 'getRandomValues', {value: ExpoCrypto.getRandomValues, configurable: true});
  }
  if (!nativeCrypto.subtle) {
    Object.defineProperty(nativeCrypto, 'subtle', {value: {
      async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
        const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
        if (name.toUpperCase() !== 'SHA-256') throw new Error(`Native account cryptography does not support ${name}.`);
        return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
      },
    }, configurable: true});
  }
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', {value: nativeCrypto, configurable: true});
}
