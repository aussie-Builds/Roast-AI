import { useState } from 'react';
import { StyleSheet, Pressable, View, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Image } from 'expo-image';
import { File } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { API_BASE_URL } from '@/constants/api';

type RoastLevel = 'mild' | 'medium' | 'savage' | 'nuclear';

export default function PreviewScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const router = useRouter();
  const [roasts, setRoasts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<RoastLevel>('medium');

  const generateRoast = async () => {
    if (!uri) {
      setError('No image found. Please retake the photo.');
      return;
    }

    if (level === 'nuclear') {
      const confirmed = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Nuclear mode is experimental. Proceed?',
          undefined,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Proceed', style: 'destructive', onPress: () => resolve(true) },
          ],
        ),
      );
      if (!confirmed) return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Convert image to base64 using new File API
      const file = new File(uri);
      const base64 = await file.base64();

      const response = await fetch(`${API_BASE_URL}/api/roast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageBase64: base64,
          level,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to generate roast');
      }

      if (!data.roasts || !Array.isArray(data.roasts)) {
        throw new Error('Invalid response from server');
      }

      setRoasts(data.roasts);
    } catch (err) {
      console.error('Roast error:', err);
      if (err instanceof TypeError && err.message.includes('Network request failed')) {
        setError('Cannot connect to server. Make sure the backend is running.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const retake = () => {
    router.replace('/camera');
  };

  const goHome = () => {
    router.replace('/');
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.imageContainer}>
        <Image source={{ uri }} style={styles.image} contentFit="cover" />
      </View>

      {/* Level Selector - only show before generating */}
      {roasts.length === 0 && !isLoading && (
        <View style={styles.levelContainer}>
          <ThemedText style={styles.levelLabel}>Roast Level:</ThemedText>
          <View style={styles.levelButtons}>
            {(['mild', 'medium', 'savage', 'nuclear'] as RoastLevel[]).map((l) => (
              <Pressable
                key={l}
                style={[styles.levelButton, level === l && styles.levelButtonActive]}
                onPress={() => setLevel(l)}
              >
                <ThemedText
                  style={[styles.levelButtonText, level === l && styles.levelButtonTextActive]}
                >
                  {l.charAt(0).toUpperCase() + l.slice(1)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Content Area */}
      <ScrollView style={styles.roastContainer} contentContainerStyle={styles.roastContent}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FF6B6B" />
            <ThemedText style={styles.loadingText}>Analyzing your face...</ThemedText>
            <ThemedText style={styles.loadingSubtext}>Preparing roasts...</ThemedText>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
            <Pressable style={styles.retryButton} onPress={generateRoast}>
              <ThemedText style={styles.retryButtonText}>Try Again</ThemedText>
            </Pressable>
          </View>
        ) : roasts.length > 0 ? (
          roasts.map((roast, index) => (
            <View key={index} style={styles.roastItem}>
              <ThemedText style={styles.roastNumber}>{index + 1}</ThemedText>
              <ThemedText style={styles.roastText}>{roast}</ThemedText>
            </View>
          ))
        ) : (
          <ThemedText style={styles.placeholderText}>
            Select your roast level and tap Generate!
          </ThemedText>
        )}
      </ScrollView>

      {/* Buttons */}
      <View style={styles.buttonContainer}>
        {roasts.length === 0 && !error ? (
          <Pressable
            style={({ pressed }) => [
              styles.roastButton,
              pressed && !isLoading && styles.buttonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            onPress={generateRoast}
            disabled={isLoading}
          >
            <ThemedText style={styles.roastButtonText}>
              {isLoading ? 'Generating...' : 'Generate Roast'}
            </ThemedText>
          </Pressable>
        ) : roasts.length > 0 ? (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.roastButton,
                pressed && !isLoading && styles.buttonPressed,
                isLoading && styles.buttonDisabled,
              ]}
              onPress={generateRoast}
              disabled={isLoading}
            >
              <ThemedText style={styles.roastButtonText}>
                {isLoading ? 'Generating...' : 'Roast Again'}
              </ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={retake}
              disabled={isLoading}
            >
              <ThemedText style={styles.secondaryButtonText}>Retake Photo</ThemedText>
            </Pressable>
          </>
        ) : null}
        <Pressable style={styles.linkButton} onPress={goHome} disabled={isLoading}>
          <ThemedText style={[styles.linkButtonText, isLoading && styles.textDisabled]}>
            Back to Home
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  imageContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  image: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 3,
    borderColor: '#FF6B6B',
  },
  levelContainer: {
    marginBottom: 16,
  },
  levelLabel: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 8,
    textAlign: 'center',
  },
  levelButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  levelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#666',
  },
  levelButtonActive: {
    backgroundColor: '#FF6B6B',
    borderColor: '#FF6B6B',
  },
  levelButtonText: {
    fontSize: 14,
  },
  levelButtonTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  roastContainer: {
    flex: 1,
  },
  roastContent: {
    paddingVertical: 8,
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 18,
    marginTop: 16,
    fontWeight: '600',
  },
  loadingSubtext: {
    fontSize: 14,
    marginTop: 4,
    opacity: 0.6,
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#FF6B6B',
    marginBottom: 16,
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
  roastItem: {
    flexDirection: 'row',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  roastNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FF6B6B',
    marginRight: 12,
    width: 30,
  },
  roastText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
  },
  placeholderText: {
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.6,
    marginTop: 32,
  },
  buttonContainer: {
    gap: 12,
    paddingTop: 16,
  },
  roastButton: {
    backgroundColor: '#FF6B6B',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  roastButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#444',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
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
    paddingVertical: 12,
    alignItems: 'center',
  },
  linkButtonText: {
    fontSize: 14,
    opacity: 0.7,
  },
});
