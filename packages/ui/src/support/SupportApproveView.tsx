import { Button } from '../controls/Button';
import { Card } from '../layout/Card';
import { Screen } from '../layout/Screen';
import { Body } from '../typography/Body';
import { Heading } from '../typography/Heading';

export type SupportApproveOutcome = 'verified' | 'denied' | 'expired' | 'not_found';

export type SupportApproveViewProps = {
  options: number[];
  busy: boolean;
  outcome: SupportApproveOutcome | null;
  /** True when the request never reached Amana — distinct from a denial. */
  unreachable: boolean;
  onChoose: (chosenNumber: number) => void;
};

/**
 * The customer's side of support number matching, shared by BOTH apps.
 *
 * It lives here rather than being written twice because the part that must not drift is the
 * WORDING. Number matching only defeats a fished approval if the person understands that approving
 * unprompted is the attack, so the two warning lines are the mechanism, not decoration — and a
 * second copy of a security control's copy is a second copy to get wrong.
 *
 * Presentational only: it holds no client and no navigation. Each app owns the SupportApi call and
 * its own route params, which is the part that genuinely differs between them.
 */
export function SupportApproveView({
  options,
  busy,
  outcome,
  unreachable,
  onChoose,
}: SupportApproveViewProps): JSX.Element {
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
      {unreachable ? (
        <Card>
          <Body muted>
            We could not reach Amana. Check your connection and tap the number again.
          </Body>
        </Card>
      ) : null}
      {options.map((n) => (
        // Every button disables on the first press, not just the pressed one: the server allows a
        // single attempt, and a double-tap must not look like the customer's mistake.
        <Button key={n} label={String(n)} onPress={() => onChoose(n)} disabled={busy} fullWidth />
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
