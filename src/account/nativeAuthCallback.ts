export const NATIVE_AUTH_CALLBACK = 'minecraft-recipe-tree://auth/callback';
export function nativeAuthCode(value: string): string {
  const url = new URL(value);
  if (`${url.protocol}//${url.host}${url.pathname}` !== NATIVE_AUTH_CALLBACK) {
    throw new Error('The sign-in response did not return to Recipe Tree.');
  }
  if (url.searchParams.has('error')) throw new Error(url.searchParams.get('error_description') ?? 'Discord sign-in failed.');
  const codes = url.searchParams.getAll('code');
  if (codes.length !== 1 || !codes[0] || codes[0].length > 4096) throw new Error('Discord did not return a valid sign-in code.');
  return codes[0];
}
