import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import {
  generateBridgeApiKey,
  confirmBridgePairing,
  getBridgePairingStatus,
  unpairBridge,
} from '../api/settings.api';

export default function BridgePairing() {
  const [paired, setPaired] = useState(false);
  const [displayName, setDisplayName] = useState<string>();
  const [loading, setLoading] = useState(true);

  // Key generation state
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [mcpCommand, setMcpCommand] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);

  // 6-digit code entry (secondary option)
  const [showCodeEntry, setShowCodeEntry] = useState(false);
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

  // ─── Key Generation ───

  const handleGenerateKey = async () => {
    setGenerating(true);
    setError(null);

    const result = await generateBridgeApiKey();
    setGenerating(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setGeneratedKey(result.apiKey || null);
    setMcpCommand(result.mcpCommand || null);
    setPaired(true);

    // Refresh status for display name
    getBridgePairingStatus()
      .then((s) => setDisplayName(s.displayName))
      .catch(() => {});
  };

  const copyToClipboard = async (text: string, which: 'key' | 'cmd') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'key') {
        setKeyCopied(true);
        setTimeout(() => setKeyCopied(false), 2000);
      } else {
        setCmdCopied(true);
        setTimeout(() => setCmdCopied(false), 2000);
      }
    } catch {
      // Clipboard API might not be available
    }
  };

  // ─── 6-Digit Code Entry ───

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setError(null);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
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
    const nextEmpty = newDigits.findIndex((d) => !d);
    inputRefs.current[nextEmpty >= 0 ? nextEmpty : 5]?.focus();
  };

  const handleCodeSubmit = async () => {
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
      getBridgePairingStatus()
        .then((s) => setDisplayName(s.displayName))
        .catch(() => {});
    } else {
      setError(result.error || 'Pairing failed');
    }
  };

  // ─── Unpair ───

  const handleUnpair = async () => {
    try {
      await unpairBridge();
      setPaired(false);
      setDisplayName(undefined);
      setGeneratedKey(null);
      setMcpCommand(null);
      setDigits(['', '', '', '', '', '']);
      setSuccess(false);
      setShowCodeEntry(false);
    } catch {
      setError('Failed to unpair');
    }
  };

  // ─── Render ───

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

  // ── Just generated a key — show it once ──
  if (generatedKey) {
    return (
      <div
        className="rounded-[16px] overflow-hidden"
        style={{ backgroundColor: 'var(--primary-foreground)' }}
      >
        <div className="px-[5px] py-[12px]">
          <p
            className="text-[14px] leading-[22px] font-medium"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            Your API key has been created. Copy it now — it won't be shown again.
          </p>
        </div>

        <div className="mx-[5px]" style={{ borderBottom: '1px solid var(--border)' }} />

        {/* API Key */}
        <div className="px-[5px] py-[12px]">
          <p
            className="text-[13px] font-medium mb-[6px]"
            style={{ color: 'var(--muted-foreground)' }}
          >
            API Key
          </p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 text-[13px] px-[10px] py-[8px] rounded-[8px] break-all select-all"
              style={{
                backgroundColor: 'var(--background)',
                color: 'var(--secondary-foreground)',
                border: '1px solid var(--border)',
              }}
            >
              {generatedKey}
            </code>
            <button
              onClick={() => copyToClipboard(generatedKey, 'key')}
              className="shrink-0 p-[8px] rounded-[8px] transition-colors"
              style={{ backgroundColor: 'var(--accent)' }}
              type="button"
            >
              {keyCopied ? (
                <Check size={16} className="text-green-500" />
              ) : (
                <Copy size={16} style={{ color: 'var(--muted-foreground)' }} />
              )}
            </button>
          </div>
        </div>

        <div className="mx-[5px]" style={{ borderBottom: '1px solid var(--border)' }} />

        {/* MCP Command */}
        {mcpCommand && (
          <>
            <div className="px-[5px] py-[12px]">
              <p
                className="text-[13px] font-medium mb-[6px]"
                style={{ color: 'var(--muted-foreground)' }}
              >
                Run this in your terminal
              </p>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 text-[12px] px-[10px] py-[8px] rounded-[8px] break-all select-all"
                  style={{
                    backgroundColor: 'var(--background)',
                    color: 'var(--secondary-foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {mcpCommand}
                </code>
                <button
                  onClick={() => copyToClipboard(mcpCommand, 'cmd')}
                  className="shrink-0 p-[8px] rounded-[8px] transition-colors"
                  style={{ backgroundColor: 'var(--accent)' }}
                  type="button"
                >
                  {cmdCopied ? (
                    <Check size={16} className="text-green-500" />
                  ) : (
                    <Copy size={16} style={{ color: 'var(--muted-foreground)' }} />
                  )}
                </button>
              </div>
            </div>

            <div className="mx-[5px]" style={{ borderBottom: '1px solid var(--border)' }} />
          </>
        )}

        {/* Done button */}
        <div className="px-[5px] py-[12px]">
          <button
            onClick={() => setGeneratedKey(null)}
            className="w-full h-[40px] rounded-[12px] text-[15px] font-semibold"
            style={{
              backgroundColor: 'var(--secondary-foreground)',
              color: 'var(--primary-foreground)',
            }}
            type="button"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Paired state ──
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
            <div className="mx-[5px]" style={{ borderBottom: '1px solid var(--border)' }} />
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

  // ── Unpaired state — key generation + code entry ──
  return (
    <div
      className="rounded-[16px] overflow-hidden"
      style={{ backgroundColor: 'var(--primary-foreground)' }}
    >
      {/* Generate API Key */}
      <div className="px-[5px] py-[12px]">
        <p
          className="text-[14px] leading-[22px] mb-[12px]"
          style={{ color: 'var(--muted-foreground)' }}
        >
          Generate an API key to connect Claude Code to your glasses.
        </p>
        <button
          onClick={handleGenerateKey}
          disabled={generating}
          className="w-full h-[40px] rounded-[12px] text-[15px] font-semibold transition-all disabled:opacity-40"
          style={{
            backgroundColor: 'var(--secondary-foreground)',
            color: 'var(--primary-foreground)',
          }}
          type="button"
        >
          {generating ? (
            <Loader2 size={16} className="animate-spin mx-auto" />
          ) : (
            'Generate API Key'
          )}
        </button>
      </div>

      <div className="mx-[5px]" style={{ borderBottom: '1px solid var(--border)' }} />

      {/* Secondary: 6-digit code entry */}
      <button
        onClick={() => setShowCodeEntry(!showCodeEntry)}
        className="w-full flex items-center justify-between px-[5px] h-[44px]"
        type="button"
      >
        <span
          className="text-[14px]"
          style={{ color: 'var(--muted-foreground)' }}
        >
          Already have a pairing code?
        </span>
        {showCodeEntry ? (
          <ChevronUp size={16} style={{ color: 'var(--muted-foreground)' }} />
        ) : (
          <ChevronDown size={16} style={{ color: 'var(--muted-foreground)' }} />
        )}
      </button>

      {showCodeEntry && (
        <>
          <div className="mx-[5px]" style={{ borderBottom: '1px solid var(--border)' }} />

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

          <div className="px-[5px] pb-[12px]">
            <button
              onClick={handleCodeSubmit}
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
        </>
      )}

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
