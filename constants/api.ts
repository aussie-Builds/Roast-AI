import Constants from 'expo-constants';

function getExpoHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).expoGoConfig?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost;

  if (!hostUri) return null;
  return hostUri.split(':')[0] ?? null;
}

const envBase = process.env.EXPO_PUBLIC_API_BASE_URL;

export const API_BASE_URL =
  envBase ||
  (getExpoHost() ? `http://${getExpoHost()}:3000` : 'http://localhost:3000');

if (__DEV__) {
  console.log('[API] Base URL:', API_BASE_URL);
}
