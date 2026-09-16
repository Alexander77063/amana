import { SupportApi } from '@amana/api-client';
import { type SupportApproveOutcome, SupportApproveView } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { MainStackParamList } from '../nav/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'SupportApprove'>;

/**
 * Answer a support verification by tapping the number the agent read to you.
 *
 * The screen itself is `SupportApproveView` in `@amana/ui` — shared with the agent app, because
 * the warning copy IS the security mechanism and a second copy of it would be a second copy to get
 * wrong. What lives here is the part that genuinely differs: this app's client and route params.
 */
export function SupportApproveScreen({ route }: Props): JSX.Element {
  const { verificationId, options } = route.params;
  const supportApi = useMemo(() => new SupportApi(api), []);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SupportApproveOutcome | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const choose = async (chosenNumber: number) => {
    if (busy || outcome) return;
    setBusy(true);
    setUnreachable(false);
    try {
      const res = await supportApi.respond(verificationId, chosenNumber);
      setOutcome(res.outcome);
    } catch {
      // A transport failure is NOT a denial — the attempt may never have reached the server, and
      // telling someone they failed a check they may not have taken is both wrong and alarming.
      setUnreachable(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SupportApproveView
      options={options}
      busy={busy}
      outcome={outcome}
      unreachable={unreachable}
      onChoose={(n) => void choose(n)}
    />
  );
}
