import { SPEND_CATEGORIES, SPEND_CATEGORY_VALUES } from '@amana/types';
import {
  AmountText,
  Badge,
  Body,
  Button,
  Card,
  Chip,
  Label,
  Screen,
  TextInput,
  useTheme,
} from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';
import { useAgentStore } from '../state/agent.store';

type Props = NativeStackScreenProps<PayStackParamList, 'Confirm'>;

export function ConfirmScreen({ route, navigation }: Props): JSX.Element {
  const theme = useTheme();
  // Destructured EXPLICITLY, and kept that way. `vendorId` and `category` are inputs to this
  // screen's rendering only; `vendorId` in particular must never reach the spend intent, and
  // `{ ...route.params }` in the intent literal below would put it there while typechecking green
  // (TypeScript exempts spreads from excess-property checking). See ConfirmScreen.test.tsx.
  const {
    resolvedName,
    bankCode,
    accountNumber,
    accountMasked,
    vendorId,
    category: registryCategory,
  } = route.params;
  const [amountNaira, setAmountNaira] = useState('');
  const [note, setNote] = useState('');
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // The principal's category rules compare against this exact string, so it has to come from
  // the shared vocabulary in @amana/types. The previous hardcoded 'ad_hoc_service' meant any
  // allowlist the parent set would have denied every payment.
  //
  // The registry's category seeds it when the payment came from an Amana Vendor Code. That is a
  // PRE-FILL and nothing more: the server is authoritative when enforcement is on, and a client
  // that pretended to enforce would be a second, weaker copy of the rule in the one place a
  // modified client can ignore. The picker below stays live and unlocked.
  //
  // Membership is checked because this is the only path that sets the state from something other
  // than a Chip press. An out-of-vocabulary value would leave NO chip lit and then ride onto the
  // intent — `POST /transactions/intent` takes `category` as free text — which is precisely the
  // silent allow/deny drift the closed vocabulary exists to prevent. Both writers of
  // `vendors.category` constrain it today, so this is belt-and-braces; it costs one comparison
  // against the same shared constant the picker is built from, so the two cannot drift apart.
  const [category, setCategory] = useState<string>(
    registryCategory && SPEND_CATEGORY_VALUES.includes(registryCategory)
      ? registryCategory
      : 'other',
  );

  const send = async () => {
    const sw = useAgentStore.getState().selectedSubWallet;
    if (!sw) return;
    const naira = Number.parseFloat(amountNaira);
    if (!Number.isFinite(naira) || naira <= 0) {
      setErrorMsg('Enter a valid amount.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);

    let geolocation: { lat: number; lng: number } | null = null;
    if (gpsEnabled) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          geolocation = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        }
      } catch {
        // GPS failed — send without location rather than blocking payment
      }
    }

    try {
      const { transactionId } = await api.transaction.createIntent({
        masterWalletId: sw.masterWalletId,
        subWalletId: sw.id,
        amountKobo: String(Math.round(naira * 100)),
        idempotencyKey: `${sw.id}-${Date.now()}`,
        vendorBankCode: bankCode,
        vendorAccountNumber: accountNumber,
        vendorResolvedName: resolvedName,
        category,
        agentNote: note.trim() || null,
        geolocation,
      });
      const evalResult = await api.transaction.evaluate(transactionId);
      if (evalResult.kind === 'allow') {
        navigation.replace('Sending', { transactionId });
      } else {
        navigation.replace('BumpWait', {
          transactionId,
          amountKobo: String(Math.round(naira * 100)),
          resolvedName,
          expiresAt: evalResult.expiresAt,
        });
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Payment failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Confirm Payment" keyboardAvoiding scrollable>
      <Card style={{ alignItems: 'center', gap: 4, marginBottom: 8 }}>
        {/* The name keeps its own line and its own weight — decision #16 makes that large bold
            name the in-person trust handshake, so the badge sits under it rather than beside it,
            where a long trading name would otherwise push one of the two out of the row. */}
        <Body strong>{resolvedName}</Body>
        {/* An identity claim about the merchant, so it is only ever rendered for a payment that
            actually came from a registry code. `vendorId` is absent (not null) on every other
            capture path, and a badge that is always on is worse than no badge at all. */}
        {vendorId ? (
          <View accessibilityRole="text" accessibilityLabel="Verified Amana vendor">
            <Badge label="Verified" variant="success" />
          </View>
        ) : null}
        <Body muted>{accountMasked}</Body>
        {amountNaira ? (
          <AmountText
            size="xl"
            value={`₦${Number.parseFloat(amountNaira || '0').toLocaleString('en-NG', { minimumFractionDigits: 2 })}`}
            sentiment="debit"
            style={{ marginTop: 8 }}
          />
        ) : null}
      </Card>

      <TextInput
        label="AMOUNT (₦)"
        keyboardType="decimal-pad"
        placeholder="0.00"
        value={amountNaira}
        onChangeText={setAmountNaira}
        autoFocus
        style={{ fontSize: 24, fontWeight: '600', height: 56 }}
      />

      <Label>CATEGORY</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SPEND_CATEGORIES.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            selected={category === c.value}
            onPress={() => setCategory(c.value)}
          />
        ))}
      </View>

      <TextInput
        label="NOTE (OPTIONAL)"
        placeholder="What is this for?"
        value={note}
        onChangeText={setNote}
        multiline
        style={{ minHeight: 72, textAlignVertical: 'top', height: undefined }}
      />

      <View style={styles.row}>
        <Body>Capture GPS location</Body>
        <Switch value={gpsEnabled} onValueChange={setGpsEnabled} />
      </View>

      {errorMsg ? <Body style={{ color: theme.colors.debit }}>{errorMsg}</Body> : null}

      <Button
        label="CONFIRM PAYMENT"
        onPress={() => void send()}
        loading={busy}
        style={{ marginTop: 8 }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
});
