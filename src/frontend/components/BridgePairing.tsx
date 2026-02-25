import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Copy, Check, ChevronDown, ChevronUp, Trash2, Plus } from 'lucide-react';
import {
  generateBridgeApiKey,
  confirmBridgePairing,
  getBridgePairingStatus,
  unpairBridge,
  type BridgeKeyInfo,
} from '../api/settings.api';

export default function BridgePairing() {
  const [keys, setKeys] = useState<BridgeKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Key generation state
  const [generating, setGenerating] = useState(false);
  const [label, setLabel] = useState('');
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

  const loadStatus = () => {
    getBridgePairingStatus()
      .then((status) => setKeys(status.keys || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStatus(); }, []);

  // ─── Key Generation ───

  const handleGenerateKey = async () => {
    setGenerating(true);
    setError(null);

    const result = await generateBridgeApiKey(label || undefined);
    setGenerating(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setGeneratedKey(result.apiKey || null);
    setMcpCommand(result.mcpCommand || null);
    setLabel('');
    loadStatus();
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
      setDigits(['', '', '', '', '', '']);
      loadStatus();
    } else {
      setError(result.error || 'Pairing failed');
    }
  };

  // ─── Revoke ───

  const handleRevoke = async (keyId: string) => {
    try {
      await unpairBridge(keyId);
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    } catch {
      setError('Failed to revoke key');
    }
  };

  // ─── Helpers ───

  const formatRelativeTime = (isoDate: string): string => {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
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

  // ── Main view: key list + add new ──
  return (
    <div className="space-y-3">
      {/* Existing keys */}
      {keys.length > 0 && (
        <div
          className="rounded-[16px] overflow-hidden"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          {keys.map((key, i) => (
            <React.Fragment key={key.id}>
              {i > 0 && (
                <div
                  className="mx-[5px]"
                  style={{ borderBottom: '1px solid var(--border)' }}
                />
              )}
              <div className="flex items-center justify-between px-[5px] h-[52px]">
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[15px] font-medium truncate"
                    style={{ color: 'var(--secondary-foreground)' }}
                  >
                    {key.label}
                  </p>
                  <p
                    className="text-[12px]"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    Last used {formatRelativeTime(key.lastSeenAt)}
                  </p>
                </div>
                <button
                  onClick={() => handleRevoke(key.id)}
                  className="shrink-0 p-[6px] rounded-[8px] transition-colors"
                  style={{ backgroundColor: 'var(--accent)' }}
                  type="button"
                  title="Revoke this key"
                >
                  <Trash2 size={14} className="text-red-500" />
                </button>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Add new key */}
      <div
        className="rounded-[16px] overflow-hidden"
        style={{ backgroundColor: 'var(--primary-foreground)' }}
      >
        {keys.length === 0 && (
          <>
            <div className="px-[5px] py-[12px]">
              <p
                className="text-[14px] leading-[22px]"
                style={{ color: 'var(--muted-foreground)' }}
              >
                Generate an API key to connect Claude Code to your glasses. You can create multiple keys for different machines.
              </p>
            </div>
            <div className="mx-[5px]" style={{ borderBottom: '1px solid var(--border)' }} />
          </>
        )}

        {/* Label input + generate button */}
        <div className="px-[5px] py-[12px] space-y-[10px]">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={keys.length > 0 ? 'Label (e.g. Work laptop)' : 'Label (optional)'}
              className="flex-1 text-[15px] bg-transparent border outline-none rounded-[8px] px-[10px] h-[38px]"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--secondary-foreground)',
              }}
            />
          </div>
          <button
            onClick={handleGenerateKey}
            disabled={generating}
            className="w-full h-[40px] rounded-[12px] text-[15px] font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            style={{
              backgroundColor: 'var(--secondary-foreground)',
              color: 'var(--primary-foreground)',
            }}
            type="button"
          >
            {generating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                {keys.length > 0 && <Plus size={16} />}
                {keys.length > 0 ? 'Add Another Key' : 'Generate API Key'}
              </>
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
      </div>

      {/* Error / success messages */}
      {error && (
        <p className="text-center text-[14px] text-red-500 px-[5px]">
          {error}
        </p>
      )}
      {success && (
        <p className="text-center text-[14px] text-green-500 px-[5px]">
          Paired successfully!
        </p>
      )}
    </div>
  );
}
