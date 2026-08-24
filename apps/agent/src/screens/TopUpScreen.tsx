import type { VasBiller, VasCategory, VasProduct } from '@amana/api-client';
import { ApiError } from '@amana/api-client';
import { Body, Button, Caption, Card, Chip, Label, Screen, TextInput, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';
import { useAgentStore } from '../state/agent.store';

type Props = NativeStackScreenProps<PayStackParamList, 'TopUp'>;

const CATEGORIES: Array<{ value: VasCategory; label: string }> = [
  { value: 'airtime', label: 'Airtime' },
  { value: 'data', label: 'Data' },
  { value: 'electricity', label: 'Electricity' },
  { value: 'cabletv', label: 'Cable TV' },
];

/** What the recipient field is actually asking for, per category. */
const RECIPIENT_FIELD: Record<VasCategory, { label: string; placeholder: string }> = {
  airtime: { label: 'PHONE NUMBER', placeholder: '+2348012345678' },
  data: { label: 'PHONE NUMBER', placeholder: '+2348012345678' },
  electricity: { label: 'METER NUMBER', placeholder: '12345678901' },
  cabletv: { label: 'SMARTCARD NUMBER', placeholder: '1234567890' },
};

/** Electricity and cable resolve the account holder before any money moves. */
const NEEDS_VALIDATION: Record<VasCategory, boolean> = {
  airtime: false,
  data: false,
  electricity: true,
  cabletv: true,
};

const nairaToKobo = (naira: string): string => {
  const [whole = '0', frac = ''] = naira.split('.');
  return `${BigInt(whole) * 100n + BigInt(`${frac}00`.slice(0, 2) || '0')}`;
};

const koboToNaira = (k: string): string =>
  `₦${(Number(k) / 100).toLocaleString('en-NG', { minimumFractionDigits: 0 })}`;

export function TopUpScreen({ navigation }: Props): JSX.Element {
  const theme = useTheme();
  const subWallet = useAgentStore((s) => s.selectedSubWallet);

  const [category, setCategory] = useState<VasCategory>('airtime');
  const [billers, setBillers] = useState<VasBiller[]>([]);
  const [billerId, setBillerId] = useState<string | null>(null);
  const [products, setProducts] = useState<VasProduct[]>([]);
  const [productSlug, setProductSlug] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amountNaira, setAmountNaira] = useState('');
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const biller = billers.find((b) => b.id === billerId);
  const product = products.find((p) => p.slug === productSlug);
  const fixedPrice = product?.amountKobo ?? null;

  // Reset everything downstream of the category — a provider or bundle from the previous
  // category would silently submit the wrong thing.
  useEffect(() => {
    let alive = true;
    setBillerId(null);
    setProducts([]);
    setProductSlug(null);
    setCustomerName(null);
    setErrorMsg(null);
    setLoadingCatalog(true);
    api.vas
      .listBillers(category)
      .then((r) => {
        if (!alive) return;
        setBillers(r.billers);
        if (r.billers.length === 1) setBillerId(r.billers[0]?.id ?? null);
      })
      .catch(() => alive && setErrorMsg('Could not load providers.'))
      .finally(() => alive && setLoadingCatalog(false));
    return () => {
      alive = false;
    };
  }, [category]);

  useEffect(() => {
    if (!billerId) return;
    let alive = true;
    setProductSlug(null);
    api.vas
      .listProducts(billerId)
      .then((r) => alive && setProducts(r.products))
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, [billerId]);

  const validate = async () => {
    if (!biller || recipient.length < 3) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const { customer } = await api.vas.validate(biller.slug, recipient);
      setCustomerName(customer.customerName);
    } catch {
      setErrorMsg('Could not find that account. Check the number.');
      setCustomerName(null);
    } finally {
      setBusy(false);
    }
  };

  const amountKobo = fixedPrice ?? (amountNaira ? nairaToKobo(amountNaira) : '0');
  const ready =
    !!subWallet &&
    !!biller &&
    recipient.length >= 3 &&
    BigInt(amountKobo || '0') > 0n &&
    (!NEEDS_VALIDATION[category] || !!customerName);

  const buy = async () => {
    if (!ready || !biller || !subWallet) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const { purchase } = await api.vas.purchase({
        subWalletId: subWallet.id,
        category,
        provider: biller.slug,
        productSlug: productSlug ?? null,
        recipient,
        amountKobo,
        idempotencyKey: `${subWallet.id}-vas-${Date.now()}`,
      });
      navigation.replace('TopUpReceipt', { purchaseId: purchase.id });
    } catch (e: unknown) {
      // A rule denial is the parent's decision, not a failure — say which rule stopped it.
      if (e instanceof ApiError && e.code === 'rule_denied') {
        const reasons = ((e.body as { reasons?: string[] })?.reasons ?? []).join(', ');
        setErrorMsg(
          reasons.includes('CATEGORY_NOT_ALLOWED')
            ? 'Your principal has not allowed this category.'
            : reasons.includes('OUTSIDE_TIME_WINDOW')
              ? 'Outside the hours your principal allows.'
              : 'Blocked by one of your principal’s rules.',
        );
      } else if (e instanceof ApiError && e.code === 'limit_exceeded') {
        setErrorMsg('This would go over your daily limit.');
      } else if (e instanceof ApiError && e.status === 403) {
        setErrorMsg('That recipient is not on your approved list.');
      } else {
        setErrorMsg(e instanceof Error ? e.message : 'Purchase failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const field = RECIPIENT_FIELD[category];

  return (
    <Screen title="Airtime & bills" keyboardAvoiding scrollable>
      <Label>WHAT ARE YOU BUYING?</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {CATEGORIES.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            selected={category === c.value}
            onPress={() => setCategory(c.value)}
          />
        ))}
      </View>

      <Label>PROVIDER</Label>
      {loadingCatalog ? (
        <ActivityIndicator />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {billers.map((b) => (
            <Chip
              key={b.id}
              label={b.name}
              selected={billerId === b.id}
              onPress={() => setBillerId(b.id)}
            />
          ))}
        </View>
      )}

      {products.length > 0 && (
        <>
          <Label>BUNDLE</Label>
          <View style={{ gap: 8 }}>
            {products.map((p) => (
              <Chip
                key={p.id}
                label={p.amountKobo ? `${p.name} — ${koboToNaira(p.amountKobo)}` : p.name}
                selected={productSlug === p.slug}
                onPress={() => setProductSlug(p.slug)}
              />
            ))}
          </View>
        </>
      )}

      <TextInput
        label={field.label}
        placeholder={field.placeholder}
        keyboardType="number-pad"
        value={recipient}
        onChangeText={(v) => {
          setRecipient(v);
          setCustomerName(null);
        }}
      />

      {NEEDS_VALIDATION[category] && (
        <>
          <Button
            variant="secondary"
            label={customerName ? 'CHECK AGAIN' : 'CHECK ACCOUNT'}
            onPress={() => void validate()}
            loading={busy}
            disabled={!biller || recipient.length < 3}
          />
          {customerName ? (
            <Card style={{ gap: 2 }}>
              <Label>ACCOUNT NAME</Label>
              <Body strong>{customerName}</Body>
            </Card>
          ) : null}
        </>
      )}

      {/* A fixed-price bundle sets the amount; open-value top-ups ask for one. */}
      {fixedPrice ? (
        <Card style={{ gap: 2 }}>
          <Label>AMOUNT</Label>
          <Body strong>{koboToNaira(fixedPrice)}</Body>
        </Card>
      ) : (
        <TextInput
          label="AMOUNT (₦)"
          placeholder="1000"
          keyboardType="decimal-pad"
          value={amountNaira}
          onChangeText={setAmountNaira}
        />
      )}

      <Caption>
        Airtime and data can go to your own number, or to a recipient your principal has approved.
      </Caption>

      {errorMsg ? <Body style={{ color: theme.colors.debit }}>{errorMsg}</Body> : null}

      <Button label="BUY" onPress={() => void buy()} loading={busy} disabled={!ready || busy} />
    </Screen>
  );
}
