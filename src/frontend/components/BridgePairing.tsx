import React, { useState, useEffect } from 'react';
import { Loader2, Copy, Check, Trash2, Plus } from 'lucide-react';
import {
  generateBridgeApiKey,
  getBridgePairingStatus,
  unpairBridge,
  type BridgeKeyInfo,
} from '../api/settings.api';
import { SettingDivider } from './settings-ui';

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

  const [error, setError] = useState<string | null>(null);

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
      <div className="h-12 rounded-2xl flex items-center justify-center bg-primary-foreground">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Just generated a key — show it once ──
  if (generatedKey) {
    return (
      <div className="rounded-2xl overflow-hidden bg-primary-foreground">
        <div className="px-1.5 py-3">
          <p className="text-[14px] leading-[22px] font-medium text-secondary-foreground">
            Your API key has been created. Copy it now — it won't be shown again.
          </p>
        </div>

        <SettingDivider />

        {/* API Key */}
        <div className="px-1.5 py-3">
          <p className="text-[13px] font-medium mb-1.5 text-muted-foreground">
            API Key
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[13px] px-2.5 py-2 rounded-lg break-all select-all bg-background text-secondary-foreground border border-border">
              {generatedKey}
            </code>
            <button
              onClick={() => copyToClipboard(generatedKey, 'key')}
              className="shrink-0 p-2 rounded-lg bg-accent transition-colors"
              type="button"
            >
              {keyCopied ? (
                <Check size={16} className="text-green-500" />
              ) : (
                <Copy size={16} className="text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        <SettingDivider />

        {/* MCP Command */}
        {mcpCommand && (
          <>
            <div className="px-1.5 py-3">
              <p className="text-[13px] font-medium mb-1.5 text-muted-foreground">
                Run this in your terminal
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[12px] px-2.5 py-2 rounded-lg break-all select-all bg-background text-secondary-foreground border border-border">
                  {mcpCommand}
                </code>
                <button
                  onClick={() => copyToClipboard(mcpCommand, 'cmd')}
                  className="shrink-0 p-2 rounded-lg bg-accent transition-colors"
                  type="button"
                >
                  {cmdCopied ? (
                    <Check size={16} className="text-green-500" />
                  ) : (
                    <Copy size={16} className="text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>

            <SettingDivider />
          </>
        )}

        {/* Done button */}
        <div className="px-1.5 py-3">
          <button
            onClick={() => setGeneratedKey(null)}
            className="w-full h-10 rounded-xl text-[15px] font-semibold bg-secondary-foreground text-primary-foreground"
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
        <div className="rounded-2xl overflow-hidden bg-primary-foreground">
          {keys.map((key, i) => (
            <React.Fragment key={key.id}>
              {i > 0 && <SettingDivider />}
              <div className="flex items-center justify-between px-1.5 h-[52px]">
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium truncate text-secondary-foreground">
                    {key.label}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    Last used {formatRelativeTime(key.lastSeenAt)}
                  </p>
                </div>
                <button
                  onClick={() => handleRevoke(key.id)}
                  className="shrink-0 p-1.5 rounded-lg bg-accent transition-colors"
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
      <div className="rounded-2xl overflow-hidden bg-primary-foreground">
        {/* Description (shown when no keys yet) */}
        {keys.length === 0 && (
          <>
            <div className="px-1.5 py-3">
              <p className="text-[14px] leading-[22px] text-muted-foreground">
                Generate an API key below, then run the setup command in your terminal to add the Mentra Bridge MCP server to Claude Code.
              </p>
            </div>
            <SettingDivider />
          </>
        )}

        {/* Label input + generate button */}
        <div className="px-1.5 py-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={keys.length > 0 ? 'Label (e.g. Work laptop)' : 'Label (optional)'}
              className="flex-1 text-[15px] bg-input-background text-secondary-foreground border-none outline-none rounded-lg px-2.5 h-[38px] focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            onClick={handleGenerateKey}
            disabled={generating}
            className="w-full h-10 rounded-xl text-[15px] font-semibold bg-secondary-foreground text-primary-foreground transition-all disabled:opacity-40 flex items-center justify-center gap-2"
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
      </div>

      {/* Error message */}
      {error && (
        <p className="text-center text-[14px] text-red-500 px-1.5">
          {error}
        </p>
      )}
    </div>
  );
}
