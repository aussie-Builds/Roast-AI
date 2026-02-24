import AsyncStorage from '@react-native-async-storage/async-storage';

type RoastLevel = 'mild' | 'medium' | 'savage' | 'nuclear';

const KEYS = {
  dailyCount: '@roast_daily_count',
  dailyStart: '@roast_daily_start',
  savageUsed: '@roast_savage_used',
  savageStart: '@roast_savage_start',
  premium: '@roast_premium',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const DEV_UNLOCK = true; // DEV TEST ONLY – remove before production

export async function canRoast(
  level: RoastLevel,
): Promise<{ allowed: boolean; reason?: string }> {
  const premium = await AsyncStorage.getItem(KEYS.premium);
  const isPremiumEffective = DEV_UNLOCK || premium === 'true';
  if (isPremiumEffective) return { allowed: true };

  if (level === 'nuclear') {
    return { allowed: false, reason: 'Nuclear mode is premium only' };
  }

  if (level === 'savage') {
    const [start, used] = await AsyncStorage.multiGet([
      KEYS.savageStart,
      KEYS.savageUsed,
    ]);
    const startVal = start[1];
    const usedVal = used[1];

    if (startVal && usedVal === 'true') {
      const elapsed = Date.now() - new Date(startVal).getTime();
      if (elapsed < WEEK_MS) {
        const remaining = WEEK_MS - elapsed;
        const days = Math.ceil(remaining / DAY_MS);
        return {
          allowed: false,
          reason: `You've used your weekly Savage roast. Resets in ${days} day${days !== 1 ? 's' : ''}.`,
        };
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
      if (countVal >= 3) {
        const remaining = DAY_MS - elapsed;
        const hours = Math.ceil(remaining / (60 * 60 * 1000));
        return {
          allowed: false,
          reason: `You've used all 3 daily roasts. Resets in ${hours} hour${hours !== 1 ? 's' : ''}.`,
        };
      }
      return { allowed: true };
    }
    // Window expired — will reset on next recordRoast
  }

  return { allowed: true };
}

export async function recordRoast(level: RoastLevel): Promise<void> {
  if (level === 'nuclear') return;

  if (level === 'savage') {
    const existing = await AsyncStorage.getItem(KEYS.savageStart);
    const withinWindow =
      existing && Date.now() - new Date(existing).getTime() < WEEK_MS;
    await AsyncStorage.multiSet([
      [KEYS.savageUsed, 'true'],
      ...(withinWindow ? [] : [[KEYS.savageStart, new Date().toISOString()]]),
    ] as [string, string][]);
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
