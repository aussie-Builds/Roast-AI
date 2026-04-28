import { PostHog } from 'posthog-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

const DEVICE_ID_KEY = 'device_id';

let posthog: PostHog | null = null;

function getClient(): PostHog | null {
  if (posthog) return posthog;
  if (!POSTHOG_API_KEY) return null;

  posthog = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
  console.log('PostHog initialized');
  return posthog;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function identifyDevice(): Promise<void> {
  let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = generateUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  console.log('Device ID:', deviceId);
  const client = getClient();
  client?.identify(deviceId);
}

export async function getDeviceId(): Promise<string> {
  let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = generateUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

type TrackProps = Record<string, string | number | boolean | undefined>;

export function track(event: string, properties?: TrackProps) {
  const client = getClient();
  if (!properties) {
    client?.capture(event);
    return;
  }
  const cleaned: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (v !== undefined) cleaned[k] = v;
  }
  client?.capture(event, cleaned);
}
