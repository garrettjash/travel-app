import { useState } from 'react';
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { router } from 'expo-router';
import PageShell from '@/components/PageShell';
import { travelTheme } from '@/constants/travelTheme';

const heroImage =
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80';

export default function LandingPage() {
  const [guests, setGuests] = useState(67);
  const { width } = useWindowDimensions();
  const isNarrow = width < 900;

  return (
    <PageShell showSidebar={false} contentStyle={styles.shellContent}>
      <ImageBackground source={{ uri: heroImage }} style={styles.hero} resizeMode="cover">
        <View style={styles.overlay} />
        <View style={styles.heroContent}>
          <Text style={styles.title}>Enter Details About Your Travel</Text>
          <View style={[styles.card, isNarrow && styles.cardStack]}>
            <View style={styles.inputBlock}>
              <View style={styles.labelRow}>
                <FontAwesome name="map-marker" size={18} color={travelTheme.colors.ink} />
                <Text style={styles.label}>Destination</Text>
              </View>
              <TextInput
                placeholder="Where To?"
                placeholderTextColor={travelTheme.colors.smoke}
                style={styles.input}
              />
            </View>
            <View style={styles.inputBlock}>
              <View style={styles.labelRow}>
                <FontAwesome name="calendar" size={18} color={travelTheme.colors.ink} />
                <Text style={styles.label}>Dates</Text>
              </View>
              <TextInput
                placeholder="Departure & Return"
                placeholderTextColor={travelTheme.colors.smoke}
                style={styles.input}
              />
            </View>
            <View style={styles.inputBlock}>
              <View style={styles.labelRow}>
                <FontAwesome name="user" size={18} color={travelTheme.colors.ink} />
                <Text style={styles.label}>Guests</Text>
              </View>
              <View style={styles.guestRow}>
                <Pressable
                  style={styles.guestButton}
                  onPress={() => setGuests((value) => Math.max(1, value - 1))}>
                  <Text style={styles.guestSymbol}>-</Text>
                </Pressable>
                <Text style={styles.guestCount}>{guests}</Text>
                <Pressable
                  style={styles.guestButton}
                  onPress={() => setGuests((value) => value + 1)}>
                  <Text style={styles.guestSymbol}>+</Text>
                </Pressable>
              </View>
            </View>
          </View>
          <Pressable style={styles.goButton} onPress={() => router.push('/destinations')}>
            <Text style={styles.goText}>Go</Text>
            <FontAwesome name="arrow-right" size={16} color={travelTheme.colors.ink} />
          </Pressable>
        </View>
      </ImageBackground>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  shellContent: {
    flex: 1,
    backgroundColor: travelTheme.colors.white,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  heroContent: {
    paddingHorizontal: travelTheme.spacing.xxl,
    alignItems: 'center',
    gap: travelTheme.spacing.xl,
  },
  title: {
    fontSize: 36,
    color: travelTheme.colors.white,
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowRadius: 12,
  },
  card: {
    backgroundColor: travelTheme.colors.white,
    borderRadius: travelTheme.radius.xl,
    padding: travelTheme.spacing.lg,
    flexDirection: 'row',
    gap: travelTheme.spacing.lg,
    alignItems: 'center',
    minWidth: 720,
    shadowColor: travelTheme.colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
  },
  cardStack: {
    flexDirection: 'column',
    minWidth: 320,
    width: '90%',
  },
  inputBlock: {
    flex: 1,
    gap: travelTheme.spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: travelTheme.spacing.sm,
  },
  label: {
    fontSize: 14,
    color: travelTheme.colors.ink,
    fontWeight: '600',
  },
  input: {
    backgroundColor: travelTheme.colors.cloud,
    borderRadius: travelTheme.radius.lg,
    paddingHorizontal: travelTheme.spacing.md,
    paddingVertical: travelTheme.spacing.sm,
    color: travelTheme.colors.ink,
  },
  guestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: travelTheme.spacing.sm,
  },
  guestButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: travelTheme.colors.cloud,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestSymbol: {
    fontSize: 18,
    color: travelTheme.colors.ink,
  },
  guestCount: {
    fontSize: 16,
    color: travelTheme.colors.ink,
    minWidth: 24,
    textAlign: 'center',
  },
  goButton: {
    backgroundColor: travelTheme.colors.grass,
    borderRadius: 18,
    paddingHorizontal: travelTheme.spacing.xl,
    paddingVertical: travelTheme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: travelTheme.spacing.sm,
  },
  goText: {
    fontSize: 16,
    color: travelTheme.colors.ink,
    fontWeight: '600',
  },
});
