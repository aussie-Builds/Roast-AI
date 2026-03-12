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
  (getExpoHost() ? `http://${getExpoHost()}:3000` : 'https://roast-ai-0bfe.onrender.com');

if (__DEV__) console.log('API BASE URL:', API_BASE_URL);

export const PRIVACY_POLICY_URL = 'https://midi-clematis-e6a.notion.site/3201b1d13cce802d8b4acfa0b8634282?source=copy_link';
