import React, { useState, useEffect } from 'react';
import { Check, X, Loader2, Eye, EyeOff, ChevronDown } from 'lucide-react';
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
import {
  SettingSection,
  SettingRow,
  SettingDivider,
  SettingDescription,
} from './settings-ui';

type TestStatus = 'idle' | 'testing' | 'valid' | 'invalid';

// ─── Styled form controls ───

function SettingInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`text-base bg-input-background text-secondary-foreground rounded-lg px-3 h-8 border-none outline-none focus:ring-2 focus:ring-ring ${className}`}
    />
  );
}

function SettingSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="relative flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="appearance-none text-base bg-input-background text-secondary-foreground rounded-lg pl-3 pr-7 h-8 border-none outline-none cursor-pointer focus:ring-2 focus:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <option value="">Select...</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="absolute right-2 pointer-events-none text-muted-foreground"
      />
    </div>
  );
}

function TestButton({
  status,
  onClick,
  disabled,
  labels = { idle: 'Test', valid: 'Valid', invalid: 'Invalid' },
}: {
  status: TestStatus;
  onClick: () => void;
  disabled: boolean;
  labels?: { idle: string; valid: string; invalid: string };
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 text-[14px] font-semibold px-3 py-1.5 rounded-lg border border-border text-muted-foreground transition-all disabled:opacity-40 hover:bg-accent"
      type="button"
    >
      {status === 'testing' ? (
        <Loader2 size={14} className="animate-spin" />
      ) : status === 'valid' ? (
        <span className="flex items-center gap-1 text-green-500">
          <Check size={12} /> {labels.valid}
        </span>
      ) : status === 'invalid' ? (
        <span className="flex items-center gap-1 text-red-500">
          <X size={12} /> {labels.invalid}
        </span>
      ) : (
        labels.idle
      )}
    </button>
  );
}

// ─── Provider Section ───

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

  const providerOptions = providers.map((p) => ({
    value: p,
    label: providerNames[p] || p,
  }));

  const modelOptions = models.map((m) => ({ value: m.id, label: m.name }));

  return (
    <SettingSection label={label}>
      {/* Provider */}
      <SettingRow label="Provider">
        <SettingSelect
          value={selectedProvider}
          onChange={onProviderChange}
          options={providerOptions}
        />
      </SettingRow>

      <SettingDivider />

      {isNone ? (
        <SettingDescription>
          Vision is disabled. Photos taken with your glasses will be stored but
          not analyzed. You can enable vision anytime by selecting a provider
          above.
        </SettingDescription>
      ) : isCustom ? (
        <>
          {/* OpenAI-compatible note */}
          <SettingDescription>
            Connects to any server with an OpenAI-compatible API (Ollama, LM
            Studio, vLLM, llama.cpp, LocalAI, text-generation-webui, etc.). The
            server must support the{' '}
            <span className="font-medium">/v1/chat/completions</span> endpoint
            format.
          </SettingDescription>

          <SettingDivider />

          {/* Provider Name */}
          <SettingRow label="Name">
            <SettingInput
              value={customProviderName || ''}
              onChange={(v) => onCustomProviderNameChange?.(v)}
              placeholder="e.g. My Ollama Server"
              className="flex-1 text-right min-w-0 ml-2"
            />
          </SettingRow>

          <SettingDivider />

          {/* Base URL */}
          <SettingRow label="Base URL">
            <SettingInput
              value={customBaseUrl || ''}
              onChange={(v) => onCustomBaseUrlChange?.(v)}
              placeholder="http://localhost:11434/v1"
              className="flex-1 text-right min-w-0 ml-2"
            />
          </SettingRow>

          <SettingDivider />

          {/* Model (free text) */}
          <SettingRow label="Model">
            <SettingInput
              value={modelInput || ''}
              onChange={(v) => onModelInputChange?.(v)}
              placeholder="llama3.1, codellama:7b, etc."
              className="flex-1 text-right min-w-0 ml-2"
            />
          </SettingRow>

          <SettingDivider />

          {/* API Key (optional for custom) */}
          <div className="flex items-center gap-2 px-1.5 h-12">
            <span className="text-base font-medium text-secondary-foreground shrink-0">
              API Key
            </span>
            <div className="flex-1 flex items-center gap-1 min-w-0">
              <SettingInput
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={onApiKeyChange}
                placeholder="Optional for most local servers"
                className="flex-1 text-right min-w-0"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="shrink-0 p-1 text-muted-foreground"
                type="button"
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <SettingDivider />

          {/* Test Endpoint */}
          <SettingRow label="Endpoint">
            <TestButton
              status={customTestStatus || 'idle'}
              onClick={() => onTestCustom?.()}
              disabled={!customBaseUrl || customTestStatus === 'testing'}
              labels={{
                idle: 'Test Connection',
                valid: 'Reachable',
                invalid: 'Unreachable',
              }}
            />
          </SettingRow>
        </>
      ) : (
        <>
          {/* Model (dropdown) */}
          <SettingRow label="Model">
            <SettingSelect
              value={selectedModel}
              onChange={onModelChange}
              options={modelOptions}
              disabled={!selectedProvider}
            />
          </SettingRow>

          <SettingDivider />

          {/* API Key (required for standard providers) */}
          <div className="flex items-center gap-2 px-1.5 h-12">
            <span className="text-base font-medium text-secondary-foreground shrink-0">
              API Key
            </span>
            <div className="flex-1 flex items-center gap-1 min-w-0">
              <SettingInput
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={onApiKeyChange}
                placeholder={keyIsSet ? '••••••••' : 'Enter API key'}
                className="flex-1 text-right min-w-0"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="shrink-0 p-1 text-muted-foreground"
                type="button"
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <SettingDivider />

          {/* Test API Key */}
          <div className="flex items-center justify-end px-1.5 h-12">
            <TestButton
              status={testStatus}
              onClick={onTest}
              disabled={
                !apiKey || !selectedProvider || testStatus === 'testing'
              }
            />
          </div>
        </>
      )}
    </SettingSection>
  );
}

// ─── Main Component ───

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
  const [llmCustomTestStatus, setLlmCustomTestStatus] =
    useState<TestStatus>('idle');

  // Google Cloud (optional)
  const [googleCloudKey, setGoogleCloudKey] = useState('');
  const [googleCloudKeySet, setGoogleCloudKeySet] = useState(false);
  const [googleCloudTestStatus, setGoogleCloudTestStatus] =
    useState<TestStatus>('idle');

  // UI
  const [useSameProvider, setUseSameProvider] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showGoogleKey, setShowGoogleKey] = useState(false);

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
  const llmProviderIds = allProviderIds.filter((id) => id !== 'none');
  // Vision providers: exclude "custom" (local vision isn't viable), include "none" for opt-out
  const visionProviderIds = [
    ...allProviderIds.filter((id) => id !== 'custom'),
    'none',
  ];

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
        ? llmProvider && effectiveLlmModel && llmCustomBaseUrl
        : (llmApiKey || llmKeySet) && llmProvider && effectiveLlmModel;

      if (llmCanSave) {
        const result = await saveProviderConfig({
          purpose: 'llm',
          provider: llmProvider,
          model: effectiveLlmModel,
          ...(llmApiKey ? { apiKey: llmApiKey } : {}),
          ...(llmIsCustom
            ? {
                baseUrl: llmCustomBaseUrl,
                providerName: llmCustomProviderName || undefined,
              }
            : {}),
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
            ...(llmIsCustom
              ? {
                  baseUrl: llmCustomBaseUrl,
                  providerName: llmCustomProviderName || undefined,
                }
              : {}),
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
        const visionCanSave =
          (visionApiKey || visionKeySet) && visionProvider && visionModel;

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
            className="h-[100px] rounded-2xl bg-primary-foreground"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Personalization */}
      <SettingSection label="Personalization">
        <SettingRow label="Assistant Name">
          <SettingInput
            value={agentName}
            onChange={setAgentName}
            placeholder="Any AI"
            className="w-40 text-right"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow label="Wake Word">
          <SettingInput
            value={wakeWord}
            onChange={setWakeWord}
            placeholder="Hey Jarvis"
            className="w-40 text-right"
          />
        </SettingRow>
      </SettingSection>

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
        onTestCustom={() =>
          handleTestCustomEndpoint(
            llmCustomBaseUrl,
            llmApiKey,
            setLlmCustomTestStatus,
          )
        }
      />

      {/* Use same provider checkbox (hidden when LLM is custom — custom vision isn't supported) */}
      {llmProvider !== 'custom' && (
        <div className="flex items-center gap-3 px-1">
          <button
            type="button"
            role="checkbox"
            aria-checked={useSameProvider}
            onClick={() => setUseSameProvider(!useSameProvider)}
            className="w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0"
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
              <Check size={14} className="text-primary-foreground" />
            )}
          </button>
          <span
            onClick={() => setUseSameProvider(!useSameProvider)}
            className="text-base text-secondary-foreground cursor-pointer select-none"
          >
            Use same provider for vision
          </span>
        </div>
      )}

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
      <SettingSection label="Google Cloud (Optional)">
        <SettingDescription>
          Enables location services: weather, air quality, pollen, nearby
          places, directions, and timezone detection. Requires a Google Cloud
          API key with these APIs enabled: Geocoding, Places (New), Routes,
          Time Zone, Weather, Air Quality, Pollen.
        </SettingDescription>

        <SettingDivider />

        {/* API Key */}
        <div className="flex items-center gap-2 px-1.5 h-12">
          <span className="text-base font-medium text-secondary-foreground shrink-0">
            API Key
          </span>
          <div className="flex-1 flex items-center gap-1 min-w-0">
            <SettingInput
              type={showGoogleKey ? 'text' : 'password'}
              value={googleCloudKey}
              onChange={(v) => {
                setGoogleCloudKey(v);
                setGoogleCloudTestStatus('idle');
              }}
              placeholder={googleCloudKeySet ? '••••••••' : 'Enter API key'}
              className="flex-1 text-right min-w-0"
            />
            <button
              onClick={() => setShowGoogleKey(!showGoogleKey)}
              className="shrink-0 p-1 text-muted-foreground"
              type="button"
              aria-label={showGoogleKey ? 'Hide API key' : 'Show API key'}
            >
              {showGoogleKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <SettingDivider />

        {/* Test API Key */}
        <div className="flex items-center justify-end px-1.5 h-12">
          <TestButton
            status={googleCloudTestStatus}
            onClick={async () => {
              if (!googleCloudKey) return;
              setGoogleCloudTestStatus('testing');
              try {
                const result =
                  await validateGoogleCloudKey(googleCloudKey);
                setGoogleCloudTestStatus(
                  result.valid ? 'valid' : 'invalid',
                );
              } catch {
                setGoogleCloudTestStatus('invalid');
              }
            }}
            disabled={
              !googleCloudKey || googleCloudTestStatus === 'testing'
            }
          />
        </div>

        {/* Remove key (shown when key is set) */}
        {googleCloudKeySet && (
          <>
            <SettingDivider />
            <SettingRow label="Status">
              <div className="flex items-center gap-2">
                <span className="text-[15px] text-green-500">Configured</span>
                <button
                  onClick={async () => {
                    try {
                      await deleteGoogleCloudKey();
                      setGoogleCloudKeySet(false);
                      setGoogleCloudKey('');
                      setSaveMessage({
                        type: 'success',
                        text: 'Google Cloud key removed',
                      });
                      setTimeout(() => setSaveMessage(null), 3000);
                    } catch {
                      setSaveMessage({
                        type: 'error',
                        text: 'Failed to remove key',
                      });
                    }
                  }}
                  className="text-[14px] font-medium px-2 py-1 rounded-lg bg-accent text-red-500"
                  type="button"
                >
                  Remove
                </button>
              </div>
            </SettingRow>
          </>
        )}
      </SettingSection>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full h-12 rounded-2xl text-base font-semibold bg-secondary-foreground text-primary-foreground transition-all disabled:opacity-50"
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

      {/* Separator */}
      <div className="border-t border-border my-2" />

      {/* Claude Code Bridge (Optional) */}
      <div className="space-y-1">
        <h3 className="text-[18px] font-bold px-1 mb-1.5 text-secondary-foreground">
          Claude Code Bridge
        </h3>
        <p className="text-[13px] leading-5 text-muted-foreground px-1 mb-2">
          Connect Claude Code to your glasses via the Mentra Bridge MCP server.
          Claude sends you notifications and questions through your glasses — you
          respond by voice, and your answer goes back to Claude.
        </p>
        <BridgePairing />
      </div>
    </div>
  );
}
