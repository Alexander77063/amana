import { Pressable, View } from 'react-native';
import { Card } from '../layout/Card';
import { useTheme } from '../theme/ThemeContext';
import { AmountText } from '../typography/AmountText';
import { Caption } from '../typography/Caption';
import { Label } from '../typography/Label';

type Props = {
  /** Pre-formatted, e.g. "₦4,820.00". Screens format kobo → naira. */
  amount: string;
  /** When set, the card is announced as a button and fires this on tap. */
  onPress?: () => void;
};

const HEADLINE_SUFFIX = 'in bank fees covered';
const SUBTITLE = "Amana covers the bank's funding fee, so every naira you load lands.";

export function FeeCoverCard({ amount, onPress }: Props) {
  const theme = useTheme();
  const a11yLabel = `${amount} ${HEADLINE_SUFFIX}. ${SUBTITLE}`;

  const body = (
    <Card accent>
      <Label>Fees covered</Label>
      <AmountText
        size="lg"
        value={amount}
        sentiment="credit"
        style={{ marginTop: 4, marginBottom: 2 }}
      />
      <Caption style={{ color: theme.colors.credit }}>{HEADLINE_SUFFIX}</Caption>
      <Caption style={{ color: theme.colors.text.muted, marginTop: 8 }}>{SUBTITLE}</Caption>
    </Card>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={a11yLabel}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Learn how fee cover works"
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}
