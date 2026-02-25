import React, { useState, useEffect } from 'react';
import { Check, X, Loader2, Eye, EyeOff } from 'lucide-react';
import {
  fetchProviderConfig,
  fetchProviderCatalog,
  saveProviderConfig,
  validateProviderKey,
  validateCustomEndpoint,
  updateUserSettings,
  saveGoogleCloudKey,
  deleteGoogleCloudKey,
  validateGoogleCloudKey,
  type ProviderCatalog,
  type ModelInfo,
} from '../api/settings.api';
import BridgePairing from './BridgePairing';

type TestStatus = 'idle' | 'testing' | 'valid' | 'invalid';

function ProviderSection({
  label,
  providers,
  providerNames,
  selectedProvider,
  onProviderChange,
  models,
  selectedModel,
  onModelChange,
  apiKey,
  onApiKeyChange,
  keyIsSet,
  testStatus,
  onTest,
  isCustom,
  isNone,
  customBaseUrl,
  onCustomBaseUrlChange,
  customProviderName,
  onCustomProviderNameChange,
  modelInput,
  onModelInputChange,
  customTestStatus,
  onTestCustom,
}: {
  label: string;
  providers: string[];
  providerNames: Record<string, string>;
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  keyIsSet: boolean;
  testStatus: TestStatus;
  onTest: () => void;
  isCustom?: boolean;
  isNone?: boolean;
  customBaseUrl?: string;
  onCustomBaseUrlChange?: (url: string) => void;
  customProviderName?: string;
  onCustomProviderNameChange?: (name: string) => void;
  modelInput?: string;
  onModelInputChange?: (model: string) => void;
  customTestStatus?: TestStatus;
  onTestCustom?: () => void;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div>
      <h3
        className="text-[14px] font-semibold uppercase tracking-wide px-[4px] mb-[6px]"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {label}
      </h3>
      <div
        className="rounded-[16px] overflow-hidden"
        style={{ backgroundColor: 'var(--primary-foreground)' }}
      >
        {/* Provider */}
        <div className="flex items-center justify-between px-[5px] h-[48px]">
          <span
            className="text-[16px] font-medium"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            Provider
          </span>
          <select
            value={selectedProvider}
            onChange={(e) => onProviderChange(e.target.value)}
            className="text-[16px] bg-transparent border-none outline-none cursor-pointer"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <option value="">Select...</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {providerNames[p] || p}
              </option>
            ))}
          </select>
        </div>

        <div
          className="mx-[5px]"
          style={{ borderBottom: '1px solid var(--border)' }}
        />

        {isNone ? (
          <div className="px-[5px] py-[12px]">
            <p
              className="text-[13px] leading-[20px]"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Vision is disabled. Photos taken with your glasses will be stored but not analyzed. You can enable vision anytime by selecting a provider above.
            </p>
          </div>
        ) : isCustom ? (
          <>
            {/* OpenAI-compatible note */}
            <div className="px-[5px] py-[10px]">
              <p
                className="text-[13px] leading-[20px]"
                style={{ color: 'var(--muted-foreground)' }}
              >
                Connects to any server with an OpenAI-compatible API (Ollama, LM Studio, vLLM, llama.cpp, LocalAI, text-generation-webui, etc.). The server must support the <span className="font-medium">/v1/chat/completions</span> endpoint format.
              </p>
            </div>

            <div
              className="mx-[5px]"
              style={{ borderBottom: '1px solid var(--border)' }}
            />

            {/* Provider Name (friendly label) */}
            <div className="flex items-center justify-between px-[5px] h-[48px]">
              <span
                className="text-[16px] font-medium shrink-0"
                style={{ color: 'var(--secondary-foreground)' }}
              >
                Name
              </span>
              <input
                type="text"
                value={customProviderName || ''}
                onChange={(e) => onCustomProviderNameChange?.(e.target.value)}
                placeholder="e.g. My Ollama Server"
                className="flex-1 text-[16px] bg-transparent border-none outline-none text-right min-w-0 ml-2"
                style={{ color: 'var(--secondary-foreground)' }}
              />
            </div>

            <div
              className="mx-[5px]"
              style={{ borderBottom: '1px solid var(--border)' }}
            />

            {/* Base URL (custom only) */}
            <div className="flex items-center justify-between px-[5px] h-[48px]">
              <span
                className="text-[16px] font-medium shrink-0"
                style={{ color: 'var(--secondary-foreground)' }}
              >
                Base URL
              </span>
              <input
                type="text"
                value={customBaseUrl || ''}
                onChange={(e) => onCustomBaseUrlChange?.(e.target.value)}
                placeholder="http://localhost:11434/v1"
                className="flex-1 text-[16px] bg-transparent border-none outline-none text-right min-w-0 ml-2"
                style={{ color: 'var(--secondary-foreground)' }}
              />
            </div>

            <div
              className="mx-[5px]"
              style={{ borderBottom: '1px solid var(--border)' }}
            />

            {/* Model (free text input for custom) */}
            <div className="flex items-center justify-between px-[5px] h-[48px]">
              <span
                className="text-[16px] font-medium shrink-0"
                style={{ color: 'var(--secondary-foreground)' }}
              >
                Model
              </span>
              <input
                type="text"
                value={modelInput || ''}
                onChange={(e) => onModelInputChange?.(e.target.value)}
                placeholder="llama3.1, codellama:7b, etc."
                className="flex-1 text-[16px] bg-transparent border-none outline-none text-right min-w-0 ml-2"
                style={{ color: 'var(--secondary-foreground)' }}
              />
            </div>

            <div
              className="mx-[5px]"
              style={{ borderBottom: '1px solid var(--border)' }}
            />

            {/* API Key (optional for custom) */}
            <div className="flex items-center gap-2 px-[5px] h-[48px]">
              <span
                className="text-[16px] font-medium shrink-0"
                style={{ color: 'var(--secondary-foreground)' }}
              >
                API Key
              </span>
              <div className="flex-1 flex items-center gap-1 min-w-0">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  placeholder="Optional for most local servers"
                  className="flex-1 text-[16px] bg-transparent border-none outline-none text-right min-w-0"
                  style={{ color: 'var(--secondary-foreground)' }}
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="shrink-0 p-1"
                  style={{ color: 'var(--muted-foreground)' }}
                  type="button"
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div
              className="mx-[5px]"
              style={{ borderBottom: '1px solid var(--border)' }}
            />

            {/* Test Endpoint (custom) */}
            <div className="flex items-center justify-between px-[5px] h-[48px]">
              <span
                className="text-[16px] font-medium"
                style={{ color: 'var(--secondary-foreground)' }}
              >
                Endpoint
              </span>
              <button
                onClick={onTestCustom}
                disabled={!customBaseUrl || customTestStatus === 'testing'}
                className="shrink-0 text-[14px] font-medium px-3 py-1 rounded-[8px] transition-all disabled:opacity-40"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--accent-foreground)',
                }}
                type="button"
              >
                {customTestStatus === 'testing' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : customTestStatus === 'valid' ? (
                  <span className="flex items-center gap-1 text-green-500">
                    <Check size={12} /> Reachable
                  </span>
                ) : customTestStatus === 'invalid' ? (
                  <span className="flex items-center gap-1 text-red-500">
                    <X size={12} /> Unreachable
                  </span>
                ) : (
                  'Test Connection'
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Model (dropdown for standard providers) */}
            <div className="flex items-center justify-between px-[5px] h-[48px]">
              <span
                className="text-[16px] font-medium"
                style={{ color: 'var(--secondary-foreground)' }}
              >
                Model
              </span>
              <select
                value={selectedModel}
                onChange={(e) => onModelChange(e.target.value)}
                className="text-[16px] bg-transparent border-none outline-none cursor-pointer"
                style={{ color: 'var(--muted-foreground)' }}
                disabled={!selectedProvider}
              >
                <option value="">Select...</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div
              className="mx-[5px]"
              style={{ borderBottom: '1px solid var(--border)' }}
            />

            {/* API Key (required for standard providers) */}
            <div className="flex items-center gap-2 px-[5px] h-[48px]">
              <span
                className="text-[16px] font-medium shrink-0"
                style={{ color: 'var(--secondary-foreground)' }}
              >
                API Key
              </span>
              <div className="flex-1 flex items-center gap-1 min-w-0">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  placeholder={keyIsSet ? '••••••••' : 'Enter API key'}
                  className="flex-1 text-[16px] bg-transparent border-none outline-none text-right min-w-0"
                  style={{ color: 'var(--secondary-foreground)' }}
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="shrink-0 p-1"
                  style={{ color: 'var(--muted-foreground)' }}
                  type="button"
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  onClick={onTest}
                  disabled={!apiKey || !selectedProvider || testStatus === 'testing'}
                  className="shrink-0 text-[14px] font-medium px-2 py-1 rounded-[8px] transition-all disabled:opacity-40"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: 'var(--accent-foreground)',
                  }}
                  type="button"
                >
                  {testStatus === 'testing' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : testStatus === 'valid' ? (
                    <span className="flex items-center gap-1 text-green-500">
                      <Check size={12} /> Valid
                    </span>
                  ) : testStatus === 'invalid' ? (
                    <span className="flex items-center gap-1 text-red-500">
                      <X size={12} /> Invalid
                    </span>
                  ) : (
                    'Test'
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ProviderSetup() {
  const [catalog, setCatalog] = useState<ProviderCatalog>({});
  const [loading, setLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Personalization
  const [agentName, setAgentName] = useState('');
  const [wakeWord, setWakeWord] = useState('');

  // LLM
  const [llmProvider, setLlmProvider] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmKeySet, setLlmKeySet] = useState(false);
  const [llmTestStatus, setLlmTestStatus] = useState<TestStatus>('idle');

  // Vision
  const [visionProvider, setVisionProvider] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [visionApiKey, setVisionApiKey] = useState('');
  const [visionKeySet, setVisionKeySet] = useState(false);
  const [visionTestStatus, setVisionTestStatus] = useState<TestStatus>('idle');

  // Custom / Local (per-purpose — LLM and vision can use different custom servers)
  const [llmCustomBaseUrl, setLlmCustomBaseUrl] = useState('');
  const [llmCustomProviderName, setLlmCustomProviderName] = useState('');
  const [llmModelInput, setLlmModelInput] = useState('');
  const [llmCustomTestStatus, setLlmCustomTestStatus] = useState<TestStatus>('idle');
  // Google Cloud (optional)
  const [googleCloudKey, setGoogleCloudKey] = useState('');
  const [googleCloudKeySet, setGoogleCloudKeySet] = useState(false);
  const [googleCloudTestStatus, setGoogleCloudTestStatus] = useState<TestStatus>('idle');

  // UI
  const [useSameProvider, setUseSameProvider] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load config + catalog on mount
  useEffect(() => {
    (async () => {
      try {
        const [config, cat] = await Promise.all([
          fetchProviderConfig(),
          fetchProviderCatalog(),
        ]);
        setCatalog(cat);
        setAgentName(config.agentName || '');
        setWakeWord(config.wakeWord || '');
        setLlmProvider(config.llm.provider || '');
        setLlmModel(config.llm.model || '');
        setLlmKeySet(config.llm.isConfigured);
        setVisionProvider(config.vision.provider || '');
        setVisionModel(config.vision.model || '');
        setVisionKeySet(config.vision.isConfigured);
        setGoogleCloudKeySet(config.googleCloud?.isConfigured ?? false);
        if (config.llm.provider === 'custom') {
          setLlmModelInput(config.llm.model || '');
          setLlmCustomBaseUrl(config.llm.customBaseUrl || '');
          setLlmCustomProviderName(config.llm.customProviderName || '');
        }
        // Note: "use same provider" always starts unchecked so vision section is visible
      } catch (err) {
        console.error('Failed to load provider settings:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Derived data
  const allProviderIds = Object.keys(catalog);
  const providerNames: Record<string, string> = {};
  for (const [id, entry] of Object.entries(catalog)) {
    providerNames[id] = entry.name;
  }
  // Add "none" display name (not in catalog since it has no models)
  providerNames['none'] = 'None — Disable Vision';

  // LLM providers: exclude "none" (can't disable LLM)
  const llmProviderIds = allProviderIds.filter(id => id !== 'none');
  // Vision providers: exclude "custom" (local vision isn't viable), include "none" for opt-out
  const visionProviderIds = [...allProviderIds.filter(id => id !== 'custom'), 'none'];

  const llmModels =
    llmProvider && catalog[llmProvider] ? catalog[llmProvider].models : [];
  const visionModels =
    visionProvider && catalog[visionProvider]
      ? catalog[visionProvider].models.filter((m) => m.supportsVision)
      : [];

  // Reset model when provider changes
  const handleLlmProviderChange = (provider: string) => {
    setLlmProvider(provider);
    setLlmModel('');
    setLlmModelInput('');
    setLlmTestStatus('idle');
    setLlmCustomTestStatus('idle');
    if (provider !== 'custom') {
      setLlmCustomBaseUrl('');
      setLlmCustomProviderName('');
    }
    // Can't use same provider for vision when LLM is custom (custom vision not supported)
    if (provider === 'custom') {
      setUseSameProvider(false);
    }
  };

  const handleVisionProviderChange = (provider: string) => {
    setVisionProvider(provider);
    setVisionModel('');
    setVisionTestStatus('idle');
  };

  // Test custom endpoint
  const handleTestCustomEndpoint = async (
    baseUrl: string,
    apiKey: string,
    setStatus: (s: TestStatus) => void,
  ) => {
    if (!baseUrl) return;
    setStatus('testing');
    try {
      const result = await validateCustomEndpoint(baseUrl, apiKey || undefined);
      setStatus(result.reachable ? 'valid' : 'invalid');
    } catch {
      setStatus('invalid');
    }
  };

  // Test API key
  const handleTestKey = async (
    provider: string,
    apiKey: string,
    setStatus: (s: TestStatus) => void,
  ) => {
    if (!provider || !apiKey) return;
    setStatus('testing');
    try {
      const result = await validateProviderKey(provider, apiKey);
      setStatus(result.valid ? 'valid' : 'invalid');
    } catch {
      setStatus('invalid');
    }
  };

  // Save all settings
  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);

    try {
      // 1. Save personalization
      await updateUserSettings({ agentName, wakeWord });

      // 2. Save LLM config
      const llmIsCustom = llmProvider === 'custom';
      const effectiveLlmModel = llmIsCustom ? llmModelInput : llmModel;
      const llmCanSave = llmIsCustom
        ? (llmProvider && effectiveLlmModel && llmCustomBaseUrl)
        : ((llmApiKey || llmKeySet) && llmProvider && effectiveLlmModel);

      if (llmCanSave) {
        const result = await saveProviderConfig({
          purpose: 'llm',
          provider: llmProvider,
          model: effectiveLlmModel,
          ...(llmApiKey ? { apiKey: llmApiKey } : {}),
          ...(llmIsCustom ? { baseUrl: llmCustomBaseUrl, providerName: llmCustomProviderName || undefined } : {}),
        });
        if (!result.success) {
          setSaveMessage({
            type: 'error',
            text: result.error || 'Failed to save LLM config',
          });
          setSaving(false);
          return;
        }
        if (llmApiKey) setLlmKeySet(true);

        // 3. If "use same provider", also save vision with LLM values
        if (useSameProvider) {
          const vResult = await saveProviderConfig({
            purpose: 'vision',
            provider: llmProvider,
            model: effectiveLlmModel,
            ...(llmApiKey ? { apiKey: llmApiKey } : {}),
            ...(llmIsCustom ? { baseUrl: llmCustomBaseUrl, providerName: llmCustomProviderName || undefined } : {}),
          });
          if (!vResult.success) {
            setSaveMessage({
              type: 'error',
              text: vResult.error || 'Failed to save vision config',
            });
            setSaving(false);
            return;
          }
          if (llmApiKey) setVisionKeySet(true);
          setVisionProvider(llmProvider);
          setVisionModel(effectiveLlmModel);
        }

        setLlmApiKey('');
      }

      // 4. Save vision separately if not using same provider
      const visionIsNone = visionProvider === 'none';

      if (!useSameProvider && visionIsNone) {
        // Vision disabled — just save provider as "none"
        const result = await saveProviderConfig({
          purpose: 'vision',
          provider: 'none',
          model: 'none',
        });
        if (!result.success) {
          setSaveMessage({
            type: 'error',
            text: result.error || 'Failed to save vision config',
          });
          setSaving(false);
          return;
        }
        setVisionKeySet(true); // "configured" in the sense of explicitly set
      } else if (!useSameProvider) {
        const visionCanSave = (visionApiKey || visionKeySet) && visionProvider && visionModel;

        if (visionCanSave) {
          const result = await saveProviderConfig({
            purpose: 'vision',
            provider: visionProvider,
            model: visionModel,
            ...(visionApiKey ? { apiKey: visionApiKey } : {}),
          });
          if (!result.success) {
            setSaveMessage({
              type: 'error',
              text: result.error || 'Failed to save vision config',
            });
            setSaving(false);
            return;
          }
          if (visionApiKey) setVisionKeySet(true);
          setVisionApiKey('');
        }
      }

      // 5. Save Google Cloud key if entered
      if (googleCloudKey) {
        const result = await saveGoogleCloudKey(googleCloudKey);
        if (!result.success) {
          setSaveMessage({
            type: 'error',
            text: result.error || 'Failed to save Google Cloud key',
          });
          setSaving(false);
          return;
        }
        setGoogleCloudKeySet(true);
        setGoogleCloudKey('');
      }

      setSaveMessage({ type: 'success', text: 'Settings saved' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch {
      setSaveMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[100px] rounded-[16px]"
            style={{ backgroundColor: 'var(--primary-foreground)' }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Personalization */}
      <div>
        <h3
          className="text-[14px] font-semibold uppercase tracking-wide px-[4px] mb-[6px]"
          style={{ color: 'var(--muted-foreground)' }}
        >
          Personalization
        </h3>
        <div
          className="rounded-[16px] overflow-hidden"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          <div className="flex items-center justify-between px-[5px] h-[48px]">
            <label
              className="text-[16px] font-medium"
              style={{ color: 'var(--secondary-foreground)' }}
            >
              Assistant Name
            </label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Any AI"
              className="text-[16px] bg-transparent border-none outline-none text-right w-[160px]"
              style={{ color: 'var(--secondary-foreground)' }}
            />
          </div>
          <div
            className="mx-[5px]"
            style={{ borderBottom: '1px solid var(--border)' }}
          />
          <div className="flex items-center justify-between px-[5px] h-[48px]">
            <label
              className="text-[16px] font-medium"
              style={{ color: 'var(--secondary-foreground)' }}
            >
              Wake Word
            </label>
            <input
              type="text"
              value={wakeWord}
              onChange={(e) => setWakeWord(e.target.value)}
              placeholder="Hey Jarvis"
              className="text-[16px] bg-transparent border-none outline-none text-right w-[160px]"
              style={{ color: 'var(--secondary-foreground)' }}
            />
          </div>
        </div>
      </div>

      {/* LLM Section */}
      <ProviderSection
        label="LLM (Chat)"
        providers={llmProviderIds}
        providerNames={providerNames}
        selectedProvider={llmProvider}
        onProviderChange={handleLlmProviderChange}
        models={llmModels}
        selectedModel={llmModel}
        onModelChange={setLlmModel}
        apiKey={llmApiKey}
        onApiKeyChange={(key) => {
          setLlmApiKey(key);
          setLlmTestStatus('idle');
        }}
        keyIsSet={llmKeySet}
        testStatus={llmTestStatus}
        onTest={() => handleTestKey(llmProvider, llmApiKey, setLlmTestStatus)}
        isCustom={llmProvider === 'custom'}
        customBaseUrl={llmCustomBaseUrl}
        onCustomBaseUrlChange={(url) => {
          setLlmCustomBaseUrl(url);
          setLlmCustomTestStatus('idle');
        }}
        customProviderName={llmCustomProviderName}
        onCustomProviderNameChange={setLlmCustomProviderName}
        modelInput={llmModelInput}
        onModelInputChange={setLlmModelInput}
        customTestStatus={llmCustomTestStatus}
        onTestCustom={() => handleTestCustomEndpoint(llmCustomBaseUrl, llmApiKey, setLlmCustomTestStatus)}
      />

      {/* Use same provider checkbox (hidden when LLM is custom — custom vision isn't supported) */}
      {llmProvider !== 'custom' && <div className="flex items-center gap-3 px-[4px]">
        <button
          type="button"
          role="checkbox"
          aria-checked={useSameProvider}
          onClick={() => setUseSameProvider(!useSameProvider)}
          className="w-[20px] h-[20px] rounded-[4px] border flex items-center justify-center transition-colors shrink-0"
          style={{
            backgroundColor: useSameProvider
              ? 'var(--secondary-foreground)'
              : 'transparent',
            borderColor: useSameProvider
              ? 'var(--secondary-foreground)'
              : 'var(--border)',
          }}
        >
          {useSameProvider && (
            <Check size={14} style={{ color: 'var(--primary-foreground)' }} />
          )}
        </button>
        <span
          onClick={() => setUseSameProvider(!useSameProvider)}
          className="text-[16px] cursor-pointer select-none"
          style={{ color: 'var(--secondary-foreground)' }}
        >
          Use same provider for vision
        </span>
      </div>}

      {/* Vision Section (hidden when using same provider) */}
      {!useSameProvider && (
        <ProviderSection
          label="Vision (Camera)"
          providers={visionProviderIds}
          providerNames={providerNames}
          selectedProvider={visionProvider}
          onProviderChange={handleVisionProviderChange}
          models={visionModels}
          selectedModel={visionModel}
          onModelChange={setVisionModel}
          apiKey={visionApiKey}
          onApiKeyChange={(key) => {
            setVisionApiKey(key);
            setVisionTestStatus('idle');
          }}
          keyIsSet={visionKeySet}
          testStatus={visionTestStatus}
          onTest={() =>
            handleTestKey(visionProvider, visionApiKey, setVisionTestStatus)
          }
          isNone={visionProvider === 'none'}
        />
      )}

      {/* Google Cloud (Optional) */}
      <div>
        <h3
          className="text-[14px] font-semibold uppercase tracking-wide px-[4px] mb-[6px]"
          style={{ color: 'var(--muted-foreground)' }}
        >
          Google Cloud (Optional)
        </h3>
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
              Enables location services: weather, air quality, pollen, nearby places, directions, and timezone detection. Requires a Google Cloud API key with these APIs enabled: Geocoding, Places (New), Routes, Time Zone, Weather, Air Quality, Pollen.
            </p>
          </div>

          <div
            className="mx-[5px]"
            style={{ borderBottom: '1px solid var(--border)' }}
          />

          {/* API Key */}
          <div className="flex items-center gap-2 px-[5px] h-[48px]">
            <span
              className="text-[16px] font-medium shrink-0"
              style={{ color: 'var(--secondary-foreground)' }}
            >
              API Key
            </span>
            <div className="flex-1 flex items-center gap-1 min-w-0">
              <input
                type="password"
                value={googleCloudKey}
                onChange={(e) => {
                  setGoogleCloudKey(e.target.value);
                  setGoogleCloudTestStatus('idle');
                }}
                placeholder={googleCloudKeySet ? '••••••••' : 'Enter API key'}
                className="flex-1 text-[16px] bg-transparent border-none outline-none text-right min-w-0"
                style={{ color: 'var(--secondary-foreground)' }}
              />
              <button
                onClick={async () => {
                  if (!googleCloudKey) return;
                  setGoogleCloudTestStatus('testing');
                  try {
                    const result = await validateGoogleCloudKey(googleCloudKey);
                    setGoogleCloudTestStatus(result.valid ? 'valid' : 'invalid');
                  } catch {
                    setGoogleCloudTestStatus('invalid');
                  }
                }}
                disabled={!googleCloudKey || googleCloudTestStatus === 'testing'}
                className="shrink-0 text-[14px] font-medium px-2 py-1 rounded-[8px] transition-all disabled:opacity-40"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--accent-foreground)',
                }}
                type="button"
              >
                {googleCloudTestStatus === 'testing' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : googleCloudTestStatus === 'valid' ? (
                  <span className="flex items-center gap-1 text-green-500">
                    <Check size={12} /> Valid
                  </span>
                ) : googleCloudTestStatus === 'invalid' ? (
                  <span className="flex items-center gap-1 text-red-500">
                    <X size={12} /> Invalid
                  </span>
                ) : (
                  'Test'
                )}
              </button>
            </div>
          </div>

          {/* Remove key button (only shown when key is set) */}
          {googleCloudKeySet && (
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
                  Status
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[15px] text-green-500">Configured</span>
                  <button
                    onClick={async () => {
                      try {
                        await deleteGoogleCloudKey();
                        setGoogleCloudKeySet(false);
                        setGoogleCloudKey('');
                        setSaveMessage({ type: 'success', text: 'Google Cloud key removed' });
                        setTimeout(() => setSaveMessage(null), 3000);
                      } catch {
                        setSaveMessage({ type: 'error', text: 'Failed to remove key' });
                      }
                    }}
                    className="text-[14px] font-medium px-2 py-1 rounded-[8px] text-red-500"
                    style={{ backgroundColor: 'var(--accent)' }}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full h-[48px] rounded-[16px] text-[16px] font-semibold transition-all disabled:opacity-50"
        style={{
          backgroundColor: 'var(--secondary-foreground)',
          color: 'var(--primary-foreground)',
        }}
        type="button"
      >
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>

      {/* Save feedback message */}
      {saveMessage && (
        <p
          className={`text-center text-[15px] font-medium ${
            saveMessage.type === 'success' ? 'text-green-500' : 'text-red-500'
          }`}
        >
          {saveMessage.text}
        </p>
      )}

      {/* Claude Code Bridge (Optional) */}
      <div className="space-y-1">
        <h3
          className="text-[14px] font-semibold uppercase tracking-wide px-[4px] mb-[6px]"
          style={{ color: 'var(--muted-foreground)' }}
        >
          Claude Code Bridge (Optional)
        </h3>
        <BridgePairing />
      </div>
    </div>
  );
}
