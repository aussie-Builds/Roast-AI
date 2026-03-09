import { PostHog } from 'posthog-react-native';

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let posthog: PostHog | null = null;

function getClient(): PostHog | null {
  if (posthog) return posthog;
  if (!POSTHOG_API_KEY) return null;

  posthog = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
  return posthog;
}

export function track(event: string, properties?: Record<string, string>) {
  const client = getClient();
  client?.capture(event, properties);
}
