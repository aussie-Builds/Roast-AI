import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { track, identifyDevice } from '@/utils/analytics';
import { initPurchases, restorePurchases, teardownPurchases } from '@/utils/purchases';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();

  useEffect(() => {
    identifyDevice();
    track('app_opened');
    initPurchases().then(() => restorePurchases());
    return () => { teardownPurchases(); };
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen
          name="index"
          options={{
            title: 'Roast Me',
            headerRight: () => (
              <Pressable
                onPress={() => router.push('/about')}
                style={{ paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>About</Text>
              </Pressable>
            ),
          }}
        />
        <Stack.Screen name="camera" options={{ title: 'Take Selfie', headerShown: false }} />
        <Stack.Screen name="preview" options={{ title: 'Your Roast' }} />
        <Stack.Screen name="about" options={{ title: 'About', presentation: 'modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
