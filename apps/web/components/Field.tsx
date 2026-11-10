'use client';
import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';

type Control = ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;

/**
 * A labelled form control. The label names the control and nothing else. Hints and errors are
 * linked with aria-describedby, so a screen reader reads a short name followed by the help.
 */
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: Control }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true } : {}) })}
      {hint ? <small id={hintId}>{hint}</small> : null}
      {error ? <small id={errorId} className="form-error">{error}</small> : null}
    </div>
  );
}
