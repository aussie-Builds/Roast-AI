import { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Pressable,
  View,
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Text,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';

import { API_BASE_URL } from '@/constants/api';
import { canRoast, recordRoast } from '@/utils/rateLimiter';
import { track, getDeviceId } from '@/utils/analytics';
import UpgradeModal from '@/components/UpgradeModal';

type RoastLevel = 'mild' | 'medium' | 'savage' | 'nuclear';
type Persona = 'default' | 'butler' | 'mean_girl' | 'gym_bro' | 'anime_villain' | 'therapist';

const PERSONA_LABELS: Record<Persona, string> = {
  default: '🔥 Default',
  butler: '🎩 Butler',
  mean_girl: '💅 Mean Girl',
  gym_bro: '💪 Gym Bro',
  anime_villain: '🦹 Villain',
  therapist: '🧠 Therapist',
};

const TIER_COLORS: Record<RoastLevel, string> = {
  mild: '#4DA6FF',
  medium: '#FF9F0A',
  savage: '#FF3B30',
  nuclear: '#8B0000',
};

// Darker button variants — reduce visual competition with verdict
const TIER_BUTTON_COLORS: Record<RoastLevel, string> = {
  mild: '#3A8ADB',
  medium: '#D9870A',
  savage: '#B8261C',
  nuclear: '#580000',
};

// Savage/Nuclear buttons recede so verdict dominates
const TIER_BUTTON_OPACITY: Record<RoastLevel, number> = {
  mild: 1,
  medium: 1,
  savage: 0.9,
  nuclear: 0.88,
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Height reserved for the controls zone (buttons + padding)
const CONTROLS_HEIGHT = 200;

// ── Tier-based style escalation ──

const BASE_FONT_SIZE = 28;

const TIER_FONT_SIZE: Record<RoastLevel, number> = {
  mild: BASE_FONT_SIZE,
  medium: BASE_FONT_SIZE + 1,
  savage: BASE_FONT_SIZE + 2,
  nuclear: BASE_FONT_SIZE + 3,
};

const TIER_LETTER_SPACING: Record<RoastLevel, number> = {
  mild: 0,
  medium: 0,
  savage: 0,
  nuclear: 0.3,
};

const TIER_SHADOW: Record<RoastLevel, { color: string; radius: number }> = {
  mild: { color: 'rgba(0,0,0,0.8)', radius: 4 },
  medium: { color: 'rgba(0,0,0,0.8)', radius: 4 },
  savage: { color: 'rgba(0,0,0,0.8)', radius: 4 },
  nuclear: { color: 'rgba(0,0,0,0.8)', radius: 4 },
};

const TIER_GRADIENT: Record<RoastLevel, [string, string, string, string]> = {
  mild:    ['transparent', 'rgba(0,0,0,0.20)', 'rgba(0,0,0,0.50)', 'rgba(0,0,0,0.40)'],
  medium:  ['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.45)'],
  savage:  ['transparent', 'rgba(0,0,0,0.30)', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0.50)'],
  nuclear: ['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.70)', 'rgba(0,0,0,0.55)'],
};

// Nuclear gets a second vignette layer for a noticeably darker center band
const NUCLEAR_VIGNETTE: [string, string, string] = [
  'transparent', 'rgba(0,0,0,0.18)', 'transparent',
];

// Soft gradient behind roast text — stronger at savage/nuclear for readability
const VERDICT_BACKDROP: Record<RoastLevel, [string, string, string]> = {
  mild:    ['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.15)'],
  medium:  ['rgba(0,0,0,0.18)', 'rgba(0,0,0,0.50)', 'rgba(0,0,0,0.18)'],
  savage:  ['rgba(0,0,0,0.22)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.22)'],
  nuclear: ['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.60)', 'rgba(0,0,0,0.25)'],
};

const TIER_ANIM_DURATION: Record<RoastLevel, number> = {
  mild: 400,
  medium: 450,
  savage: 500,
  nuclear: 650,
};

const NEXT_TIER: Record<RoastLevel, RoastLevel | null> = {
  mild: 'medium',
  medium: 'savage',
  savage: 'nuclear',
  nuclear: null,
};

/** Split multi-sentence roasts into an array of sentences. */
function splitSentences(text: string): string[] {
  const parts = text.split(/\.\s+/);
  return parts.map((p, i) => (i < parts.length - 1 && !p.endsWith('.') ? p + '.' : p));
}

// Resize/compress before sending to the API to reduce payload size and latency.
async function getOptimizedBase64(uri: string): Promise<string> {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: 1080 } }],
    { compress: 0.75, format: SaveFormat.JPEG },
  );
  const file = new File(result.uri);
  return file.base64();
}

export default function PreviewScreen() {
  const params = useLocalSearchParams<{ uri: string; level: string; persona: string; source: string }>();
  const uri = params.uri;
  const source = (params.source as 'camera' | 'upload') || 'camera';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [roasts, setRoasts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<RoastLevel>((params.level as RoastLevel) || 'medium');
  const [persona] = useState<Persona>((params.persona as Persona) || 'default');
  const [shareMode, setShareMode] = useState(false);
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const animValue = useRef(new Animated.Value(0)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const viewShotRef = useRef<ViewShot>(null);

  const hasRoast = roasts.length > 0;

  // Load device ID for analytics
  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  // Entrance: fade in dark overlay on mount
  useEffect(() => {
    track('preview_viewed', { level, persona });
    Animated.timing(overlayAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, []);

  // Roast reveal: delayed fade-in after overlay settles
  useEffect(() => {
    if (hasRoast) {
      animValue.setValue(0);
      scaleAnim.setValue(level === 'nuclear' ? 1.03 : 1);
      const delay = setTimeout(() => {
        const anims: Animated.CompositeAnimation[] = [
          Animated.timing(animValue, {
            toValue: 1,
            duration: TIER_ANIM_DURATION[level],
            useNativeDriver: true,
          }),
        ];
        if (level === 'nuclear') {
          anims.push(
            Animated.timing(scaleAnim, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
          );
        }
        Animated.parallel(anims).start();
      }, 500);
      return () => clearTimeout(delay);
    }
  }, [roasts]);

  const roastOpacity = animValue;
  const roastTranslateY = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  const generateRoast = async () => {
    if (!uri) {
      setError('No image found. Please retake the photo.');
      return;
    }

    // Rate limit check
    const check = await canRoast(level);
    if (!check.allowed) {
      setUpgradeReason(check.reason ?? '');
      setUpgradeVisible(true);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const base64 = await getOptimizedBase64(uri);

      const response = await fetch(`${API_BASE_URL}/api/roast-v3`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, level, persona }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to generate roast');
      }

      if (!data.roasts || !Array.isArray(data.roasts)) {
        throw new Error('Invalid response from server');
      }

      setRoasts(data.roasts);
      await recordRoast(level);
      track('roast_generated', { level, persona, source });
    } catch (err) {
      console.error('Roast error:', err);
      track('roast_failed', { level, persona, source });
      if (err instanceof TypeError && err.message.includes('Network request failed')) {
        setError('Cannot connect to server. Make sure the backend is running.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoastHarder = async () => {
    if (isLoading) return;
    const nextLevel = NEXT_TIER[level];
    if (!nextLevel) return;

    const check = await canRoast(nextLevel);
    if (!check.allowed) {
      setUpgradeReason(check.reason ?? '');
      setUpgradeVisible(true);
      return;
    }

    setLevel(nextLevel);
    setIsLoading(true);
    setError(null);

    try {
      const base64 = await getOptimizedBase64(uri!);

      const response = await fetch(`${API_BASE_URL}/api/roast-v3`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, level: nextLevel, persona }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to generate roast');
      }

      if (!data.roasts || !Array.isArray(data.roasts)) {
        throw new Error('Invalid response from server');
      }

      setRoasts(data.roasts);
      await recordRoast(nextLevel);
      track('roast_generated', { level: nextLevel, persona, source });
    } catch (err) {
      console.error('Roast error:', err);
      track('roast_failed', { level: nextLevel, persona, source });
      if (err instanceof TypeError && err.message.includes('Network request failed')) {
        setError('Cannot connect to server. Make sure the backend is running.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const retake = () => router.replace({ pathname: '/camera', params: { level, persona } });
  const goHome = () => router.replace('/');

  const handleShare = async () => {
    if (!viewShotRef.current?.capture) return;
    setShareMode(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      const uri = await viewShotRef.current.capture();
      await Sharing.shareAsync(uri);
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
      Alert.alert('Permission needed', 'Please allow photo library access to save the roast.');
      return;
    }
    setShareMode(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      const capturedUri = await viewShotRef.current.capture();
      await MediaLibrary.saveToLibraryAsync(capturedUri);
      track('save_pressed', { level, persona });
      Alert.alert('Saved', 'Roast saved to gallery');
    } catch (err) {
      console.log(err);
      Alert.alert('Error', 'Failed to save image');
    } finally {
      setShareMode(false);
    }
  };

  const controlsBottom = insets.bottom + 16;

  // Tier-based text style
  const shadow = TIER_SHADOW[level];
  const roastTextStyle = {
    fontSize: TIER_FONT_SIZE[level],
    lineHeight: TIER_FONT_SIZE[level] + (level === 'savage' || level === 'nuclear' ? 6 : 10),
    letterSpacing: TIER_LETTER_SPACING[level],
    textShadowColor: shadow.color,
    textShadowRadius: shadow.radius,
    textShadowOffset: { width: 0, height: 2 },
  };

  // Render roast sentences as separate blocks for 2-sentence roasts
  const renderRoastText = () => {
    const sentences = splitSentences(roasts[0]);
    if (sentences.length >= 2) {
      return (
        <>
          <Text
            style={[styles.roastText, roastTextStyle]}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {sentences[0]}
          </Text>
          <View style={{ height: level === 'nuclear' ? 8 : level === 'savage' ? 4 : 8 }} />
          <Text
            style={[styles.roastText, roastTextStyle]}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {sentences.slice(1).join(' ')}
          </Text>
        </>
      );
    }
    return (
      <Text
        style={[styles.roastText, roastTextStyle]}
        numberOfLines={3}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {roasts[0]}
      </Text>
    );
  };

  return (
    <View style={styles.container}>
      {/* ── Capture area: everything the share screenshot includes ── */}
      <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1 }} style={styles.captureArea}>
        {/* Full-screen background image */}
        <Image source={{ uri }} style={styles.backgroundImage} contentFit="cover" />

        {/* Gradient overlay — tier-escalated, fades in on entrance */}
        <Animated.View style={[styles.gradient, { opacity: overlayAnim }]}>
          <LinearGradient
            colors={TIER_GRADIENT[level]}
            locations={[0, 0.35, 0.6, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          {/* Nuclear extra vignette — darker center band */}
          {level === 'nuclear' && (
            <LinearGradient
              colors={NUCLEAR_VIGNETTE}
              locations={[0.2, 0.5, 0.8]}
              style={StyleSheet.absoluteFillObject}
            />
          )}
        </Animated.View>

        {/* ── Verdict zone: roast text / loading / error ── */}
        <View style={[styles.verdictContainer, { bottom: CONTROLS_HEIGHT + controlsBottom }]}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.loadingText}>Analyzing...</Text>
            </View>
          ) : error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.retryButton} onPress={() => generateRoast()}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </Pressable>
            </View>
          ) : hasRoast ? (
            <Animated.View
              style={[
                styles.roastTextContainer,
                level === 'savage' && styles.roastTextContainerSavage,
                level === 'nuclear' && styles.roastTextContainerNuclear,
                { opacity: roastOpacity, transform: [{ translateY: roastTranslateY }, { scale: scaleAnim }] },
              ]}
            >
              <LinearGradient
                colors={VERDICT_BACKDROP[level]}
                locations={[0, 0.5, 1]}
                style={styles.verdictBackdrop}
              />
              {renderRoastText()}
            </Animated.View>
          ) : (
            <Text style={styles.placeholderText}>
              Tap Generate to get roasted
            </Text>
          )}
        </View>

        {/* Selection badges — inside capture so they appear in shared screenshots */}
        <View style={[styles.selectionBadges, { top: insets.top + 12 }]}>
          <View style={[styles.selectionBadge, { backgroundColor: TIER_COLORS[level] }]}>
            <Text style={styles.selectionBadgeText}>{level.toUpperCase()}</Text>
          </View>
          <View style={styles.selectionBadge}>
            <Text style={styles.selectionBadgeText}>{PERSONA_LABELS[persona]}</Text>
          </View>
        </View>

        {/* Watermark — only visible during share capture */}
        {shareMode && (
          <>
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.6)']}
              style={styles.watermarkGradient}
            />
            <View style={styles.watermark}>
              <View style={styles.watermarkRow}>
                <Text style={styles.watermarkBrand}>ROAST AI</Text>
                <View style={styles.watermarkDot} />
                <Text style={[styles.watermarkLevel, { color: TIER_COLORS[level] }]}>
                  {level.toUpperCase()}
                </Text>
                <View style={styles.watermarkDot} />
                <Text style={styles.watermarkPersona}>{PERSONA_LABELS[persona]}</Text>
              </View>
            </View>
          </>
        )}
      </ViewShot>

      {/* ── Controls zone: buttons anchored at bottom — outside capture ref ── */}
      <View style={[styles.controlsContainer, { bottom: controlsBottom }]}>
        {!hasRoast && !error ? (
          <Pressable
            style={({ pressed }) => [
              styles.generateButton,
              { backgroundColor: TIER_BUTTON_COLORS[level] },
              pressed && !isLoading && styles.buttonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            onPress={() => generateRoast()}
            disabled={isLoading}
          >
            <Text style={styles.generateButtonText}>
              {isLoading ? 'Generating...' : 'Generate Roast'}
            </Text>
          </Pressable>
        ) : hasRoast ? (
          <>
            <View style={styles.roastButtonRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.generateButton,
                  styles.roastButtonRowItem,
                  { backgroundColor: TIER_BUTTON_COLORS[level], opacity: isLoading ? 0.5 : TIER_BUTTON_OPACITY[level] },
                  pressed && !isLoading && styles.buttonPressed,
                ]}
                onPress={() => { track('roast_again_pressed', { level, persona, device_id: deviceId }); generateRoast(); }}
                disabled={isLoading}
              >
                <Text style={styles.generateButtonText}>
                  {isLoading ? 'Generating...' : 'Roast Again'}
                </Text>
              </Pressable>
              {NEXT_TIER[level] && (
                <Pressable
                  style={({ pressed }) => [
                    styles.generateButton,
                    styles.roastButtonRowItem,
                    { backgroundColor: TIER_BUTTON_COLORS[NEXT_TIER[level]!], opacity: isLoading ? 0.5 : TIER_BUTTON_OPACITY[level] },
                    pressed && !isLoading && styles.buttonPressed,
                  ]}
                  onPress={() => { track('roast_harder_pressed', { level, persona, device_id: deviceId }); handleRoastHarder(); }}
                  disabled={isLoading}
                >
                  <Text style={styles.generateButtonText}>Roast Harder</Text>
                </Pressable>
              )}
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                { opacity: TIER_BUTTON_OPACITY[level] },
                pressed && styles.buttonPressed,
              ]}
              onPress={() => { track('retake_photo_pressed', { level, persona }); retake(); }}
              disabled={isLoading}
            >
              <Text style={styles.secondaryButtonText}>Retake Photo</Text>
            </Pressable>
            <View style={styles.shareRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.shareButton,
                  styles.shareRowItem,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => { track('share_pressed', { level, persona }); handleShare(); }}
              >
                <Text style={styles.shareButtonText}>Share Roast</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.shareButton,
                  styles.shareRowItem,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleSave}
              >
                <Text style={styles.shareButtonText}>Save Roast</Text>
              </Pressable>
            </View>
          </>
        ) : null}
        <Pressable style={styles.linkButton} onPress={() => { track('back_home_pressed'); goHome(); }} disabled={isLoading}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  // Capture area for share screenshot
  captureArea: {
    ...StyleSheet.absoluteFillObject,
  },

  // Full-screen image
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },

  // Gradient overlay
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },

  // Selection badges (level + persona, read-only)
  selectionBadges: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    gap: 8,
    zIndex: 10,
  },
  selectionBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  selectionBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // ── Verdict zone ──
  verdictContainer: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '35%',
    justifyContent: 'flex-end',
    zIndex: 10,
  },

  // Roast text
  roastTextContainer: {
    alignItems: 'center',
    maxWidth: SCREEN_WIDTH - 48,
    alignSelf: 'center',
    borderRadius: 16,
    overflow: 'hidden',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  roastTextContainerSavage: {
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  roastTextContainerNuclear: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(120,0,0,0.35)',
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  verdictBackdrop: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
  },
  roastText: {
    color: '#fff',
    fontSize: BASE_FONT_SIZE,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: BASE_FONT_SIZE + 10,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },

  // Loading
  loadingContainer: {
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Error
  errorContainer: {
    alignItems: 'center',
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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

  // Placeholder
  placeholderText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 26,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // ── Controls zone ──
  controlsContainer: {
    position: 'absolute',
    left: 24,
    right: 24,
    gap: 10,
    zIndex: 10,
  },
  roastButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  roastButtonRowItem: {
    flex: 1,
  },
  generateButton: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  generateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  textDisabled: {
    opacity: 0.4,
  },
  linkButton: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  linkButtonText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
  },

  // Share / Save row
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

  // Watermark (visible only during share capture)
  watermarkGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
  },
  watermark: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  watermarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
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
