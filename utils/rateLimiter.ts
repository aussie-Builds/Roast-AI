import AsyncStorage from '@react-native-async-storage/async-storage';

type RoastLevel = 'mild' | 'medium' | 'savage' | 'nuclear';

const KEYS = {
  dailyCount: '@roast_daily_count',
  dailyStart: '@roast_daily_start',
  savageCount: '@roast_savage_count',
  savageStart: '@roast_savage_start',
  premium: '@roast_premium',
};

const DAY_MS = 24 * 60 * 60 * 1000;

const DEV_UNLOCK = false; // Set true to bypass all limits

// ── Rate limit profiles ─────────────────────────────────────────────
// Switch ACTIVE_PROFILE to change limits across the app.

type LimitProfile = {
  dailyMildMedium: number;   // mild+medium shared pool per day
  savagePerDay: number;      // savage roasts per day
  nuclearAllowed: boolean;   // whether nuclear is available
};

const PROFILES: Record<string, LimitProfile> = {
  tester: {
    dailyMildMedium: 25,
    savagePerDay: 10,
    nuclearAllowed: true,
  },
  production: {
    dailyMildMedium: 3,
    savagePerDay: 1,
    nuclearAllowed: false,
  },
};

const ACTIVE_PROFILE: string = 'tester';
const LIMITS = PROFILES[ACTIVE_PROFILE];

// ── Public API ───────────────────────────────────────────────────────

export async function canRoast(
  level: RoastLevel,
): Promise<{ allowed: boolean; reason?: string }> {
  const premium = await AsyncStorage.getItem(KEYS.premium);
  const isPremiumEffective = DEV_UNLOCK || premium === 'true';
  if (isPremiumEffective) return { allowed: true };

  if (level === 'nuclear') {
    if (!LIMITS.nuclearAllowed) {
      return { allowed: false, reason: 'Nuclear mode is premium only' };
    }
    return { allowed: true };
  }

  if (level === 'savage') {
    const [start, count] = await AsyncStorage.multiGet([
      KEYS.savageStart,
      KEYS.savageCount,
    ]);
    const startVal = start[1];
    const countVal = parseInt(count[1] ?? '0', 10);

    if (startVal) {
      const elapsed = Date.now() - new Date(startVal).getTime();
      if (elapsed < DAY_MS) {
        if (countVal >= LIMITS.savagePerDay) {
          const remaining = DAY_MS - elapsed;
          const hours = Math.ceil(remaining / (60 * 60 * 1000));
          return {
            allowed: false,
            reason: `You've used all ${LIMITS.savagePerDay} Savage roast${LIMITS.savagePerDay !== 1 ? 's' : ''} today. Resets in ${hours} hour${hours !== 1 ? 's' : ''}.`,
          };
        }
        return { allowed: true };
      }
    }
    return { allowed: true };
  }

  // mild / medium — shared daily pool
  const [start, count] = await AsyncStorage.multiGet([
    KEYS.dailyStart,
    KEYS.dailyCount,
  ]);
  const startVal = start[1];
  const countVal = parseInt(count[1] ?? '0', 10);

  if (startVal) {
    const elapsed = Date.now() - new Date(startVal).getTime();
    if (elapsed < DAY_MS) {
      if (countVal >= LIMITS.dailyMildMedium) {
        const remaining = DAY_MS - elapsed;
        const hours = Math.ceil(remaining / (60 * 60 * 1000));
        return {
          allowed: false,
          reason: `You've used all ${LIMITS.dailyMildMedium} daily roasts. Resets in ${hours} hour${hours !== 1 ? 's' : ''}.`,
        };
      }
      return { allowed: true };
    }
  }

  return { allowed: true };
}

export async function recordRoast(level: RoastLevel): Promise<void> {
  if (level === 'nuclear') return;

  if (level === 'savage') {
    const existing = await AsyncStorage.getItem(KEYS.savageStart);
    const withinWindow =
      existing && Date.now() - new Date(existing).getTime() < DAY_MS;

    if (withinWindow) {
      const raw = await AsyncStorage.getItem(KEYS.savageCount);
      const current = parseInt(raw ?? '0', 10);
      await AsyncStorage.setItem(KEYS.savageCount, String(current + 1));
    } else {
      await AsyncStorage.multiSet([
        [KEYS.savageStart, new Date().toISOString()],
        [KEYS.savageCount, '1'],
      ]);
    }
    return;
  }

  // mild / medium
  const existing = await AsyncStorage.getItem(KEYS.dailyStart);
  const withinWindow =
    existing && Date.now() - new Date(existing).getTime() < DAY_MS;

  if (withinWindow) {
    const raw = await AsyncStorage.getItem(KEYS.dailyCount);
    const current = parseInt(raw ?? '0', 10);
    await AsyncStorage.setItem(KEYS.dailyCount, String(current + 1));
  } else {
    await AsyncStorage.multiSet([
      [KEYS.dailyStart, new Date().toISOString()],
      [KEYS.dailyCount, '1'],
    ]);
  }
}
