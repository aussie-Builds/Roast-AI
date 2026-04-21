import { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Pressable,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';

import { API_BASE_URL } from '@/constants/api';
import { canRoast, recordRoast } from '@/utils/rateLimiter';
import { track } from '@/utils/analytics';
import UpgradeModal from '@/components/UpgradeModal';

type RoastLevel = 'mild' | 'medium' | 'savage' | 'nuclear';
type Persona = 'default' | 'butler' | 'mean_girl' | 'gym_bro' | 'anime_villain' | 'therapist';

const TIER_COLORS: Record<RoastLevel, string> = {
  mild: '#4DA6FF',
  medium: '#FF9F0A',
  savage: '#FF3B30',
  nuclear: '#8B0000',
};

const TIER_BUTTON_COLORS: Record<RoastLevel, string> = {
  mild: '#3A8ADB',
  medium: '#D9870A',
  savage: '#B8261C',
  nuclear: '#580000',
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_SIZE = (SCREEN_WIDTH - 72) / 2; // 24px padding each side + 24px gap

type BattleResult = {
  roastA: string;
  roastB: string;
  winner: 'A' | 'B';
  verdict: string;
  reason: string;
};

async function getOptimizedBase64(uri: string): Promise<string> {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: 1080 } }],
    { compress: 0.75, format: SaveFormat.JPEG },
  );
  const file = new File(result.uri);
  return file.base64();
}

export default function BattleScreen() {
  const params = useLocalSearchParams<{ level: string; persona: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [level, setLevel] = useState<RoastLevel>((params.level as RoastLevel) || 'medium');
  const [persona, setPersona] = useState<Persona>((params.persona as Persona) || 'default');
  const [uriA, setUriA] = useState<string | null>(null);
  const [uriB, setUriB] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState('');
  const [shareMode, setShareMode] = useState(false);
  const viewShotRef = useRef<ViewShot>(null);

  useEffect(() => {
    track('battle_opened');
  }, []);

  const pickImage = async (slot: 'A' | 'B') => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to upload a photo.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });

    if (!picked.canceled && picked.assets.length > 0) {
      if (slot === 'A') setUriA(picked.assets[0].uri);
      else setUriB(picked.assets[0].uri);
      // Clear previous result when changing photos
      if (result) {
        setResult(null);
        setError(null);
      }
    }
  };

  const runBattle = async () => {
    if (!uriA || !uriB) {
      Alert.alert('Missing photos', 'Pick both Photo A and Photo B to battle.');
      return;
    }

    const check = await canRoast(level);
    if (!check.allowed) {
      setUpgradeReason(check.reason ?? '');
      setUpgradeVisible(true);
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    track('battle_started', { level, persona });

    try {
      const [base64A, base64B] = await Promise.all([
        getOptimizedBase64(uriA),
        getOptimizedBase64(uriB),
      ]);

      const response = await fetch(`${API_BASE_URL}/api/battle-v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64A: base64A,
          imageBase64B: base64B,
          level,
          persona,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Battle failed');
      }

      if (!data.roastA || !data.roastB || !data.winner) {
        throw new Error('Invalid battle response');
      }

      setResult(data as BattleResult);
      await recordRoast(level);
      track('battle_completed', { level, persona, winner: data.winner });
    } catch (err) {
      console.error('Battle error:', err);
      if (err instanceof TypeError && err.message.includes('Network request failed')) {
        setError('Cannot connect to server. Make sure the backend is running.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRematch = () => {
    track('battle_rematch', { level, persona });
    setResult(null);
    setError(null);
    runBattle();
  };

  const handleShare = async () => {
    if (!viewShotRef.current?.capture) return;
    setShareMode(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      const capturedUri = await viewShotRef.current.capture();
      await Sharing.shareAsync(capturedUri);
      track('battle_share_pressed', { level, persona });
    } catch (err) {
      console.log(err);
    } finally {
      setShareMode(false);
    }
  };

  const handleSave = async () => {
    if (!viewShotRef.current?.capture) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to save the battle.');
      return;
    }
    setShareMode(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      const capturedUri = await viewShotRef.current.capture();
      await MediaLibrary.saveToLibraryAsync(capturedUri);
      track('battle_save_pressed', { level, persona });
      Alert.alert('Saved', 'Battle saved to gallery');
    } catch (err) {
      console.log(err);
      Alert.alert('Error', 'Failed to save image');
    } finally {
      setShareMode(false);
    }
  };

  const goHome = () => router.replace('/');

  // ── Setup view (pick photos + settings) ──
  const renderSetup = () => (
    <>
      <Text style={styles.title}>Battle Mode</Text>
      <Text style={styles.subtitle}>Pick two photos. Let the roasts decide.</Text>

      {/* Photo slots */}
      <View style={styles.photoRow}>
        <Pressable
          style={({ pressed }) => [styles.photoSlot, pressed && styles.photoSlotPressed]}
          onPress={() => pickImage('A')}
        >
          {uriA ? (
            <Image source={{ uri: uriA }} style={styles.photoImage} contentFit="cover" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderEmoji}>📸</Text>
              <Text style={styles.photoPlaceholderText}>Photo A</Text>
            </View>
          )}
          <View style={styles.photoLabel}>
            <Text style={styles.photoLabelText}>A</Text>
          </View>
        </Pressable>

        <Text style={styles.vsText}>VS</Text>

        <Pressable
          style={({ pressed }) => [styles.photoSlot, pressed && styles.photoSlotPressed]}
          onPress={() => pickImage('B')}
        >
          {uriB ? (
            <Image source={{ uri: uriB }} style={styles.photoImage} contentFit="cover" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderEmoji}>📸</Text>
              <Text style={styles.photoPlaceholderText}>Photo B</Text>
            </View>
          )}
          <View style={styles.photoLabel}>
            <Text style={styles.photoLabelText}>B</Text>
          </View>
        </Pressable>
      </View>

      {/* Level selector */}
      <View style={styles.tierRow}>
        {LEVELS.map((l) => (
          <Pressable
            key={l}
            style={[
              styles.tierButton,
              level === l && { backgroundColor: TIER_COLORS[l], borderColor: TIER_COLORS[l] },
            ]}
            onPress={() => setLevel(l)}
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
              style={[styles.personaCard, persona === p && styles.personaCardActive]}
              onPress={() => setPersona(p)}
            >
              <Text style={styles.personaEmoji}>{emoji}</Text>
              <Text style={[styles.personaCardText, persona === p && styles.personaCardTextActive]}>
                {rest.join(' ')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );

  // ── Result view ──
  const renderResult = () => {
    if (!result) return null;
    const winnerColor = TIER_COLORS[level];

    return (
      <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1 }}>
        <View style={styles.resultContainer}>
          {/* Battle header — always visible in capture */}
          <Text style={styles.captureTitle}>ROAST BATTLE</Text>

          {/* Photos with winner highlight */}
          <View style={styles.photoRow}>
            <View style={[styles.resultPhotoWrap, result.winner === 'A' && { borderColor: winnerColor, borderWidth: 3 }]}>
              <Image source={{ uri: uriA! }} style={styles.resultPhoto} contentFit="cover" />
              {result.winner === 'A' && (
                <View style={[styles.winnerBadge, { backgroundColor: winnerColor }]}>
                  <Text style={styles.winnerBadgeText}>WINNER</Text>
                </View>
              )}
              <View style={styles.photoLabel}>
                <Text style={styles.photoLabelText}>A</Text>
              </View>
            </View>

            <Text style={styles.vsText}>VS</Text>

            <View style={[styles.resultPhotoWrap, result.winner === 'B' && { borderColor: winnerColor, borderWidth: 3 }]}>
              <Image source={{ uri: uriB! }} style={styles.resultPhoto} contentFit="cover" />
              {result.winner === 'B' && (
                <View style={[styles.winnerBadge, { backgroundColor: winnerColor }]}>
                  <Text style={styles.winnerBadgeText}>WINNER</Text>
                </View>
              )}
              <View style={styles.photoLabel}>
                <Text style={styles.photoLabelText}>B</Text>
              </View>
            </View>
          </View>

          {/* Roasts */}
          <View style={styles.roastCard}>
            <Text style={styles.roastLabel}>Photo A</Text>
            <Text style={[styles.roastText, result.winner === 'A' && { color: winnerColor }]}>
              {result.roastA}
            </Text>
          </View>

          <View style={styles.roastCard}>
            <Text style={styles.roastLabel}>Photo B</Text>
            <Text style={[styles.roastText, result.winner === 'B' && { color: winnerColor }]}>
              {result.roastB}
            </Text>
          </View>

          {/* Verdict */}
          <View style={[styles.verdictCard, { borderColor: winnerColor }]}>
            <Text style={[styles.verdictText, { color: winnerColor }]}>{result.verdict}</Text>
            <Text style={styles.reasonText}>{result.reason}</Text>
          </View>

          {/* Watermark — always present but only prominent during capture */}
          <View style={styles.watermark}>
            <View style={styles.watermarkRow}>
              <Text style={styles.watermarkBrand}>ROASTLAB</Text>
              <View style={styles.watermarkDot} />
              <Text style={[styles.watermarkLevel, { color: winnerColor }]}>
                {level.toUpperCase()}
              </Text>
              {shareMode && (
                <>
                  <View style={styles.watermarkDot} />
                  <Text style={styles.watermarkPersona}>{PERSONA_LABELS[persona]}</Text>
                </>
              )}
            </View>
          </View>
        </View>
      </ViewShot>
    );
  };

  return (
    <LinearGradient colors={['#0f0f12', '#140c0f']} style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          result ? styles.scrollContentResult : styles.scrollContent,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!result ? renderSetup() : renderResult()}

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={runBattle}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Bottom actions */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {!result ? (
          <Pressable
            style={({ pressed }) => [
              styles.battleButton,
              { backgroundColor: TIER_BUTTON_COLORS[level] },
              pressed && !isLoading && styles.buttonPressed,
              (isLoading || !uriA || !uriB) && styles.buttonDisabled,
            ]}
            onPress={runBattle}
            disabled={isLoading || !uriA || !uriB}
          >
            {isLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.battleButtonText}>Battling...</Text>
              </View>
            ) : (
              <Text style={styles.battleButtonText}>Battle</Text>
            )}
          </Pressable>
        ) : (
          <>
            <View style={styles.resultButtonRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.battleButton,
                  styles.resultButtonItem,
                  { backgroundColor: TIER_BUTTON_COLORS[level] },
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleRematch}
              >
                <Text style={styles.battleButtonText}>Rematch</Text>
              </Pressable>
            </View>
            <View style={styles.shareRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.shareButton,
                  styles.shareRowItem,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleShare}
              >
                <Text style={styles.shareButtonText}>Share Result</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.shareButton,
                  styles.shareRowItem,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleSave}
              >
                <Text style={styles.shareButtonText}>Save Image</Text>
              </Pressable>
            </View>
          </>
        )}
        <Pressable style={styles.linkButton} onPress={goHome} disabled={isLoading}>
          <Text style={[styles.linkButtonText, isLoading && styles.textDisabled]}>
            Back to Home
          </Text>
        </Pressable>
      </View>

      <UpgradeModal
        visible={upgradeVisible}
        reason={upgradeReason}
        onClose={() => setUpgradeVisible(false)}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  scrollContentResult: {
    paddingTop: 0,
  },

  // Header
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  subtitle: {
    color: '#bbbbbb',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },

  // Photo slots
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  photoSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  photoSlotPressed: {
    opacity: 0.8,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPlaceholderEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  photoPlaceholderText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontWeight: '600',
  },
  photoLabel: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  photoLabelText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  vsText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    fontWeight: '800',
    marginHorizontal: 12,
  },

  // Level selector (matches home screen)
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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

  // Persona selector (matches home screen)
  personaLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 12,
    textAlign: 'center',
  },
  personaScroll: {
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  personaCard: {
    width: 90,
    height: 80,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  personaCardActive: {
    backgroundColor: '#1f1f1f',
    borderColor: '#ff9800',
    borderWidth: 2,
  },
  personaEmoji: {
    fontSize: 22,
    marginBottom: 4,
  },
  personaCardText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
  },
  personaCardTextActive: {
    color: '#fff',
  },

  // Result (capture area)
  captureTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 16,
  },
  resultContainer: {
    alignItems: 'center',
    backgroundColor: '#0f0f12',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
  },
  resultPhotoWrap: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  resultPhoto: {
    width: '100%',
    height: '100%',
  },
  winnerBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 5,
    alignItems: 'center',
  },
  winnerBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },

  // Roast cards
  roastCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  roastLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  roastText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },

  // Verdict
  verdictCard: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  verdictText: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  reasonText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Error
  errorContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF6B6B',
  },
  retryButtonText: {
    color: '#FF6B6B',
    fontSize: 14,
    fontWeight: '600',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: 'rgba(15,15,18,0.95)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  battleButton: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  battleButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  resultButtonItem: {
    flex: 1,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  linkButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkButtonText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
  },
  textDisabled: {
    opacity: 0.4,
  },

  // Share / Save row (matches preview.tsx)
  shareRow: {
    flexDirection: 'row',
    gap: 10,
  },
  shareRowItem: {
    flex: 1,
  },
  shareButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Watermark (matches preview.tsx branding)
  watermark: {
    alignItems: 'center',
    marginTop: 6,
    paddingBottom: 4,
  },
  watermarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  watermarkBrand: {
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.85)',
  },
  watermarkDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  watermarkLevel: {
    fontSize: 12,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  watermarkPersona: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
});
