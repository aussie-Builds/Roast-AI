import AsyncStorage from '@react-native-async-storage/async-storage';

type RoastLevel = 'mild' | 'medium' | 'savage' | 'nuclear';

const KEYS = {
  premium: '@roast_premium',
  // Per-level keys generated dynamically: @roast_{level}_count, @roast_{level}_start
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Daily limits per level for free users
const DAILY_LIMITS: Record<RoastLevel, number> = {
  mild: 5,
  medium: 3,
  savage: 1,
  nuclear: 0, // locked for free users
};

function levelKey(level: RoastLevel, suffix: 'count' | 'start'): string {
  return `@roast_${level}_${suffix}`;
}

// ── Premium flag ──────────────────────────────────────────────────────

export async function getIsPremium(): Promise<boolean> {
  const val = await AsyncStorage.getItem(KEYS.premium);
  return val === 'true';
}

export async function setIsPremium(value: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.premium, value ? 'true' : 'false');
}

// ── Public API ───────────────────────────────────────────────────────

export async function canRoast(
  level: RoastLevel,
): Promise<{ allowed: boolean; reason?: string }> {
  if (await getIsPremium()) return { allowed: true };

  // Nuclear is premium-only
  if (level === 'nuclear') {
    return { allowed: false, reason: '☢️ Nuclear roasts are Premium\n\nUnlimited roasts\nMaximum brutality' };
  }

  const limit = DAILY_LIMITS[level];
  const startKey = levelKey(level, 'start');
  const countKey = levelKey(level, 'count');

  const [start, count] = await AsyncStorage.multiGet([startKey, countKey]);
  const startVal = start[1];
  const countVal = parseInt(count[1] ?? '0', 10);

  if (startVal) {
    const elapsed = Date.now() - new Date(startVal).getTime();
    if (elapsed < DAY_MS) {
      if (countVal >= limit) {
        const remaining = DAY_MS - elapsed;
        const hours = Math.ceil(remaining / (60 * 60 * 1000));
        return {
          allowed: false,
          reason: `Daily limit reached. Upgrade to Premium for unlimited roasts.\n\nResets in ${hours} hour${hours !== 1 ? 's' : ''}.`,
        };
      }
      return { allowed: true };
    }
  }

  return { allowed: true };
}

export async function recordRoast(level: RoastLevel): Promise<void> {
  if (level === 'nuclear') return; // premium only, no counter needed

  const startKey = levelKey(level, 'start');
  const countKey = levelKey(level, 'count');

  const existing = await AsyncStorage.getItem(startKey);
  const withinWindow =
    existing && Date.now() - new Date(existing).getTime() < DAY_MS;

  if (withinWindow) {
    const raw = await AsyncStorage.getItem(countKey);
    const current = parseInt(raw ?? '0', 10);
    await AsyncStorage.setItem(countKey, String(current + 1));
  } else {
    await AsyncStorage.multiSet([
      [startKey, new Date().toISOString()],
      [countKey, '1'],
    ]);
  }
}
