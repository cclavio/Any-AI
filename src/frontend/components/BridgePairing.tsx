import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import {
  confirmBridgePairing,
  getBridgePairingStatus,
  unpairBridge,
} from '../api/settings.api';

export default function BridgePairing() {
  const [paired, setPaired] = useState(false);
  const [displayName, setDisplayName] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Load pairing status on mount
  useEffect(() => {
    getBridgePairingStatus()
      .then((status) => {
        setPaired(status.paired);
        setDisplayName(status.displayName);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDigitChange = (index: number, value: string) => {
    // Only accept digits
    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setError(null);

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    // Backspace on empty field → go to previous
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || '';
    }
    setDigits(newDigits);
    // Focus the next empty field or the last one
    const nextEmpty = newDigits.findIndex((d) => !d);
    inputRefs.current[nextEmpty >= 0 ? nextEmpty : 5]?.focus();
  };

  const handleSubmit = async () => {
    const code = digits.join('');
    if (code.length !== 6) {
      setError('Enter all 6 digits');
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await confirmBridgePairing(code);
    setSubmitting(false);

    if (result.success) {
      setSuccess(true);
      setPaired(true);
      // Refresh status to get display name
      getBridgePairingStatus()
        .then((s) => setDisplayName(s.displayName))
        .catch(() => {});
    } else {
      setError(result.error || 'Pairing failed');
    }
  };

  const handleUnpair = async () => {
    try {
      await unpairBridge();
      setPaired(false);
      setDisplayName(undefined);
      setDigits(['', '', '', '', '', '']);
      setSuccess(false);
    } catch {
      setError('Failed to unpair');
    }
  };

  if (loading) {
    return (
      <div
        className="h-[48px] rounded-[16px] flex items-center justify-center"
        style={{ backgroundColor: 'var(--primary-foreground)' }}
      >
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--muted-foreground)' }} />
      </div>
    );
  }

  // Paired state
  if (paired) {
    return (
      <div
        className="rounded-[16px] overflow-hidden"
        style={{ backgroundColor: 'var(--primary-foreground)' }}
      >
        <div className="flex items-center justify-between px-[5px] h-[48px]">
          <span
            className="text-[16px] font-medium"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            Status
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[15px] text-green-500">Connected</span>
            <button
              onClick={handleUnpair}
              className="text-[14px] font-medium px-2 py-1 rounded-[8px] text-red-500"
              style={{ backgroundColor: 'var(--accent)' }}
              type="button"
            >
              Unpair
            </button>
          </div>
        </div>
        {displayName && (
          <>
            <div
              className="mx-[5px]"
              style={{ borderBottom: '1px solid var(--border)' }}
            />
            <div className="flex items-center justify-between px-[5px] h-[48px]">
              <span
                className="text-[16px] font-medium"
                style={{ color: 'var(--secondary-foreground)' }}
              >
                Name
              </span>
              <span
                className="text-[15px]"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {displayName}
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  // Unpaired state — code entry
  return (
    <div
      className="rounded-[16px] overflow-hidden"
      style={{ backgroundColor: 'var(--primary-foreground)' }}
    >
      {/* Description */}
      <div className="px-[5px] py-[12px]">
        <p
          className="text-[14px] leading-[22px]"
          style={{ color: 'var(--muted-foreground)' }}
        >
          Enter the 6-digit code from Claude Code to link your glasses.
        </p>
      </div>

      <div
        className="mx-[5px]"
        style={{ borderBottom: '1px solid var(--border)' }}
      />

      {/* Code input */}
      <div className="flex items-center justify-center gap-2 px-[5px] py-[16px]">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            className="w-[40px] h-[48px] text-center text-[20px] font-semibold rounded-[8px] border outline-none transition-colors"
            style={{
              backgroundColor: 'var(--background)',
              borderColor: digit ? 'var(--secondary-foreground)' : 'var(--border)',
              color: 'var(--secondary-foreground)',
            }}
          />
        ))}
      </div>

      <div
        className="mx-[5px]"
        style={{ borderBottom: '1px solid var(--border)' }}
      />

      {/* Submit */}
      <div className="px-[5px] py-[12px]">
        <button
          onClick={handleSubmit}
          disabled={submitting || digits.some((d) => !d)}
          className="w-full h-[40px] rounded-[12px] text-[15px] font-semibold transition-all disabled:opacity-40"
          style={{
            backgroundColor: 'var(--secondary-foreground)',
            color: 'var(--primary-foreground)',
          }}
          type="button"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin mx-auto" />
          ) : (
            'Pair'
          )}
        </button>
      </div>

      {/* Error / success messages */}
      {error && (
        <p className="text-center text-[14px] text-red-500 pb-[12px] px-[5px]">
          {error}
        </p>
      )}
      {success && (
        <p className="text-center text-[14px] text-green-500 pb-[12px] px-[5px]">
          Paired successfully!
        </p>
      )}
    </div>
  );
}
