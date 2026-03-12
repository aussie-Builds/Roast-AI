import { useState, useEffect } from 'react';
import { StyleSheet, Pressable, View, Text, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { track } from '@/utils/analytics';

type RoastLevel = 'mild' | 'medium' | 'savage' | 'nuclear';
type Persona = 'default' | 'butler' | 'mean_girl' | 'gym_bro' | 'anime_villain' | 'therapist';

const TIER_COLORS: Record<RoastLevel, string> = {
  mild: '#4DA6FF',
  medium: '#FF9F0A',
  savage: '#FF3B30',
  nuclear: '#8B0000',
};

const PERSONA_LABELS: Record<Persona, string> = {
  default: '🔥 Default',
  butler: '🎩 Butler',
  mean_girl: '💅 Mean Girl',
  gym_bro: '💪 Gym Bro',
  anime_villain: '🦹 Villain',
  therapist: '🧠 Therapist',
};

const LEVELS: RoastLevel[] = ['mild', 'medium', 'savage', 'nuclear'];
const PERSONAS = Object.keys(PERSONA_LABELS) as Persona[];

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [level, setLevel] = useState<RoastLevel>('medium');
  const [persona, setPersona] = useState<Persona>('default');

  useEffect(() => {
    track('home_viewed');
  }, []);

  return (
    <LinearGradient colors={['#0f0f12', '#140c0f']} style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Confidence test.</Text>
        <Text style={styles.subtitle}>Choose your level. Take the hit.</Text>

        {/* Level selector */}
        <View style={styles.tierRow}>
          {LEVELS.map((l) => (
            <Pressable
              key={l}
              style={[
                styles.tierButton,
                level === l && { backgroundColor: TIER_COLORS[l], borderColor: TIER_COLORS[l] },
              ]}
              onPress={() => { setLevel(l); track('level_selected', { level: l }); }}
            >
              <Text style={[styles.tierButtonText, level === l && styles.tierButtonTextActive]}>
                {l.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Persona selector */}
        <Text style={styles.personaLabel}>Choose your roaster</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.personaScroll}
        >
          {PERSONAS.map((p) => {
            const [emoji, ...rest] = PERSONA_LABELS[p].split(' ');
            return (
              <Pressable
                key={p}
                style={[
                  styles.personaCard,
                  persona === p && styles.personaCardActive,
                ]}
                onPress={() => { setPersona(p); track('persona_selected', { persona: p }); }}
              >
                <Text style={styles.personaEmoji}>{emoji}</Text>
                <Text style={[styles.personaCardText, persona === p && styles.personaCardTextActive]}>
                  {rest.join(' ')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Action button — anchored above safe area */}
      <View style={[styles.buttonContainer, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => router.push({ pathname: '/camera', params: { level, persona } })}
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
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 16,
  },
  buttonContainer: {
    alignItems: 'center',
    paddingTop: 8,
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

  // Level selector
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  tierButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  tierButtonText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  tierButtonTextActive: {
    color: '#fff',
  },

  // Persona selector
  personaLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  personaScroll: {
    paddingHorizontal: 4,
    marginBottom: 32,
  },
  personaCard: {
    width: 110,
    height: 100,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  personaCardActive: {
    backgroundColor: '#1f1f1f',
    borderColor: '#ff9800',
    borderWidth: 2,
  },
  personaEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  personaCardText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
  },
  personaCardTextActive: {
    color: '#fff',
  },

  // Button
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
