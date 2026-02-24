import { StyleSheet, Pressable, View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

const TIER_HINTS = [
  { label: 'MILD', color: '#4DA6FF' },
  { label: 'MEDIUM', color: '#FF9F0A' },
  { label: 'SAVAGE', color: '#FF3B30' },
  { label: 'NUCLEAR', color: '#8B0000' },
] as const;

export default function HomeScreen() {
  const router = useRouter();

  return (
    <LinearGradient colors={['#0f0f12', '#140c0f']} style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Confidence test.</Text>
        <Text style={styles.subtitle}>Choose your level. Take the hit.</Text>

        {/* Escalation indicator — visual only */}
        <View style={styles.tierRow}>
          {TIER_HINTS.map((t, i) => (
            <View key={t.label} style={styles.tierItem}>
              {i > 0 && <Text style={styles.tierDot}>{'\u00B7'}</Text>}
              <Text style={[styles.tierLabel, { color: t.color }]}>{t.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Button zone — kept separate for future persona section above it */}
      <View style={styles.buttonZone}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => router.push('/camera')}
        >
          <Text style={styles.buttonText}>Take a Selfie</Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.8,
    marginBottom: 16,
  },
  subtitle: {
    color: '#bbbbbb',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 28,
  },

  // Escalation indicator
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 48,
  },
  tierItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tierDot: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 14,
    marginHorizontal: 8,
  },
  tierLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
  },

  // Button
  buttonZone: {
    position: 'absolute',
    bottom: 80,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#B11212',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
