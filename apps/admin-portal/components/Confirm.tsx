'use client';
import { useState } from 'react';

/**
 * Inline click-through for actions that are immediate and hard to undo (suspend, revoke). Not a
 * modal: the question stays next to the thing it is about, and the first click already said what
 * would happen.
 */
export function Confirm(props: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  tone?: 'danger';
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        className={props.tone === 'danger' ? 'danger' : 'secondary'}
        disabled={props.disabled}
        onClick={() => setAsking(true)}
      >
        {props.label}
      </button>
    );
  }
  return (
    <span className="row">
      <button
        type="button"
        className={props.tone === 'danger' ? 'danger' : undefined}
        onClick={() => {
          setAsking(false);
          props.onConfirm();
        }}
      >
        {`Yes, ${props.confirmLabel}`}
      </button>
      <button type="button" className="secondary" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
