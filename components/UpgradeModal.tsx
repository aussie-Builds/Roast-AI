import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { purchasePremium } from '@/utils/purchases';
import { track } from '@/utils/analytics';

const BULLET_COLORS = ['#4DA6FF', '#FF9F0A', '#FF3B30'];

const PERKS = [
  'Unlimited daily roasts',
  'Unlimited Savage mode',
  'Access to Nuclear mode',
];

interface UpgradeModalProps {
  visible: boolean;
  reason?: string;
  onClose: () => void;
}

export default function UpgradeModal({
  visible,
  reason,
  onClose,
}: UpgradeModalProps) {
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);
    track('upgrade_pressed');
    try {
      await purchasePremium();
      // purchaseUpdatedListener in purchases.ts handles setIsPremium(true)
      // Close modal after purchase flow completes (success or cancel)
      onClose();
    } catch {
      Alert.alert('Purchase failed', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>

          <Text style={styles.title}>Unlock Unlimited Roasts</Text>

          {reason ? <Text style={styles.reason}>{reason}</Text> : null}

          <View style={styles.perks}>
            {PERKS.map((perk, i) => (
              <View key={perk} style={styles.perkRow}>
                <Text style={[styles.bullet, { color: BULLET_COLORS[i] }]}>
                  ●
                </Text>
                <Text style={styles.perkText}>{perk}</Text>
              </View>
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.upgradeButton,
              (pressed || loading) && { opacity: 0.8 },
            ]}
            onPress={handleUpgrade}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.upgradeButtonText}>
                Subscribe to Premium
              </Text>
            )}
          </Pressable>

          <Text style={styles.terms}>
            Subscription renews automatically. Cancel anytime in Google Play.
          </Text>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '85%',
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 16,
    padding: 4,
  },
  closeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 18,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  reason: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  perks: {
    alignSelf: 'stretch',
    marginBottom: 24,
    gap: 12,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bullet: {
    fontSize: 10,
  },
  perkText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  upgradeButton: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  upgradeButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  terms: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
  },
});
