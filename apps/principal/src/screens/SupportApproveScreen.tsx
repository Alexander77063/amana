import { SupportApi, type SupportRespondResult } from '@amana/api-client';
import { Body, Button, Card, Heading, Screen } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { MainStackParamList } from '../nav/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'SupportApprove'>;

type Outcome = SupportRespondResult['outcome'] | null;

/**
 * Answer a support verification by tapping the number the agent read to you.
 *
 * ONE tap. The server allows a single attempt, so every button is disabled the moment one is
 * pressed — a double-tap must not look like the customer's mistake. The warning line above the
 * numbers is the mechanism, not decoration: number matching only works if the person understands
 * that approving without having been read a number is the attack.
 */
export function SupportApproveScreen({ route }: Props): JSX.Element {
  const { verificationId, options } = route.params;
  const supportApi = useMemo(() => new SupportApi(api), []);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [failed, setFailed] = useState(false);

  const choose = async (chosenNumber: number) => {
    if (busy || outcome) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await supportApi.respond(verificationId, chosenNumber);
      setOutcome(res.outcome);
    } catch {
      // A transport failure is NOT a denial — the attempt may not have reached the server. Say so
      // rather than telling someone they failed a check they may never have taken.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (outcome === 'verified') {
    return (
      <Screen title="Amana support">
        <Card accent>
          <Heading>You're verified</Heading>
          <Body>
            Go back to your call. The agent can now help you, and they still cannot see your name,
            BVN or NIN.
          </Body>
        </Card>
      </Screen>
    );
  }

  if (outcome) {
    return (
      <Screen title="Amana support">
        <Card>
          <Heading>Not verified</Heading>
          <Body muted>
            {outcome === 'expired'
              ? 'That request timed out. Ask the agent to send a new one.'
              : 'That did not match. Ask the agent to send a new one — there is only one tap per request.'}
          </Body>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Amana support" scrollable>
      <Card accent>
        <Heading>Which number did they read you?</Heading>
        <Body>Only approve if you called Amana support and they read you this number.</Body>
      </Card>
      {failed ? (
        <Card>
          <Body muted>
            We could not reach Amana. Check your connection and tap the number again.
          </Body>
        </Card>
      ) : null}
      {options.map((n) => (
        <Button
          key={n}
          label={String(n)}
          onPress={() => void choose(n)}
          disabled={busy}
          fullWidth
        />
      ))}
      <Card>
        <Body muted>
          If nobody read you a number, close this and do not tap anything. Amana will never ask you
          to approve a request you did not expect.
        </Body>
      </Card>
    </Screen>
  );
}
