import AsyncStorage from '@react-native-async-storage/async-storage';

// When true, all client-side usage limits and premium gating are bypassed.
// Server-side cooldowns, rate limiting, and concurrency caps remain active.
// Set EXPO_PUBLIC_CLOSED_TESTING=true in .env for closed testing builds.
const CLOSED_TESTING_BUILD =
  process.env.EXPO_PUBLIC_CLOSED_TESTING === 'true';

type RoastLevel = 'mild' | 'medium' | 'savage' | 'nuclear';

const KEYS = {
  premium: '@roast_premium',
  // Per-level keys generated dynamically: @roast_{level}_count, @roast_{level}_start
  battleCount: '@battle_count',
  battleStart: '@battle_start',
};

const DAILY_BATTLE_LIMIT = 1;

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
  if (CLOSED_TESTING_BUILD) return { allowed: true };
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

// ── Battle limits ────────────────────────────────────────────────────

export async function canBattle(
  level: RoastLevel,
): Promise<{ allowed: boolean; reason?: string }> {
  if (CLOSED_TESTING_BUILD) return { allowed: true };
  if (await getIsPremium()) return { allowed: true };

  if (level === 'nuclear') {
    return { allowed: false, reason: '☢️ Nuclear Battles are Premium\n\nUnlimited battles\nMaximum brutality' };
  }

  const [start, count] = await AsyncStorage.multiGet([KEYS.battleStart, KEYS.battleCount]);
  const startVal = start[1];
  const countVal = parseInt(count[1] ?? '0', 10);

  if (startVal) {
    const elapsed = Date.now() - new Date(startVal).getTime();
    if (elapsed < DAY_MS) {
      if (countVal >= DAILY_BATTLE_LIMIT) {
        return {
          allowed: false,
          reason: 'You’ve used today’s free Battle.\n\nPremium unlocks unlimited Battles.',
        };
      }
      return { allowed: true };
    }
  }

  return { allowed: true };
}

export async function recordBattle(): Promise<void> {
  if (CLOSED_TESTING_BUILD) return;
  if (await getIsPremium()) return;

  const existing = await AsyncStorage.getItem(KEYS.battleStart);
  const withinWindow =
    existing && Date.now() - new Date(existing).getTime() < DAY_MS;

  if (withinWindow) {
    const raw = await AsyncStorage.getItem(KEYS.battleCount);
    const current = parseInt(raw ?? '0', 10);
    await AsyncStorage.setItem(KEYS.battleCount, String(current + 1));
  } else {
    await AsyncStorage.multiSet([
      [KEYS.battleStart, new Date().toISOString()],
      [KEYS.battleCount, '1'],
    ]);
  }
}

export async function recordRoast(level: RoastLevel): Promise<void> {
  if (CLOSED_TESTING_BUILD) return; // no counting during closed testing
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
