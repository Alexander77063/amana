import type { RecentVendorResponse } from '@amana/api-client';
import { Body, Card, Heading, Screen, SectionHeader, TransactionRow, useTheme } from '@amana/ui';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { api } from '../lib/api';
import { useAgentStore } from '../state/agent.store';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'CaptureMethod'>;

export function CaptureMethodScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const sw = useAgentStore((s) => s.selectedSubWallet);
  const [recents, setRecents] = useState<RecentVendorResponse[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!sw) return;
      setLoading(true);
      api.vendor
        .recents(sw.id)
        .then(setRecents)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [sw]),
  );

  const goConfirm = (v: RecentVendorResponse) =>
    navigation.navigate('Confirm', {
      resolvedName: v.accountName,
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      accountMasked: `****${v.accountNumber.slice(-4)}`,
    });

  return (
    <Screen title="Capture Payment" noPadding>
      <FlatList
        data={recents}
        keyExtractor={(item) => `${item.bankCode}-${item.accountNumber}`}
        ListHeaderComponent={
          <View style={{ padding: 20, gap: 12 }}>
            <Card style={{ gap: 8 }}>
              <Heading size="md">Scan QR code</Heading>
              <Body muted>NIBSS NQR or bank QR</Body>
              <Pressable onPress={() => navigation.navigate('NQRScan')}>
                <Body style={{ color: theme.colors.accent }}>Scan now</Body>
              </Pressable>
            </Card>

            <Card style={{ gap: 4 }}>
              <Heading size="md">Pay by phone number</Heading>
              <Pressable onPress={() => navigation.navigate('PhoneLookup')}>
                <Body style={{ color: theme.colors.accent }}>Look up</Body>
              </Pressable>
            </Card>

            <Card style={{ gap: 4 }}>
              <Heading size="md">Pay by account number</Heading>
              <Pressable onPress={() => navigation.navigate('AccountEntry')}>
                <Body style={{ color: theme.colors.accent }}>Enter details</Body>
              </Pressable>
            </Card>

            {loading && <ActivityIndicator style={{ marginTop: 8 }} />}

            {recents.length > 0 && <SectionHeader title="RECENTS" />}
          </View>
        }
        renderItem={({ item }) => (
          <TransactionRow
            merchant={item.accountName}
            timestamp={`****${item.accountNumber.slice(-4)}`}
            amount=""
            sentiment="debit"
            onPress={() => goConfirm(item)}
          />
        )}
      />
    </Screen>
  );
}
