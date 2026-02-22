import React, { useState, useEffect } from 'react';
import { Check, X, Loader2, Eye, EyeOff } from 'lucide-react';
import {
  fetchProviderConfig,
  fetchProviderCatalog,
  saveProviderConfig,
  validateProviderKey,
  updateUserSettings,
  saveGoogleCloudKey,
  deleteGoogleCloudKey,
  validateGoogleCloudKey,
  type ProviderCatalog,
  type ModelInfo,
} from '../api/settings.api';

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

        {/* Model */}
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

        // Note: "use same provider" always starts unchecked so vision section is visible
      } catch (err) {
        console.error('Failed to load provider settings:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Derived data
  const providerIds = Object.keys(catalog);
  const providerNames: Record<string, string> = {};
  for (const [id, entry] of Object.entries(catalog)) {
    providerNames[id] = entry.name;
  }

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
    setLlmTestStatus('idle');
  };

  const handleVisionProviderChange = (provider: string) => {
    setVisionProvider(provider);
    setVisionModel('');
    setVisionTestStatus('idle');
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

      // 2. Save LLM config if API key was entered
      if (llmApiKey && llmProvider && llmModel) {
        const result = await saveProviderConfig({
          purpose: 'llm',
          provider: llmProvider,
          model: llmModel,
          apiKey: llmApiKey,
        });
        if (!result.success) {
          setSaveMessage({
            type: 'error',
            text: result.error || 'Failed to save LLM config',
          });
          setSaving(false);
          return;
        }
        setLlmKeySet(true);

        // 3. If "use same provider", also save vision with LLM values
        if (useSameProvider) {
          const vResult = await saveProviderConfig({
            purpose: 'vision',
            provider: llmProvider,
            model: llmModel,
            apiKey: llmApiKey,
          });
          if (!vResult.success) {
            setSaveMessage({
              type: 'error',
              text: vResult.error || 'Failed to save vision config',
            });
            setSaving(false);
            return;
          }
          setVisionKeySet(true);
          setVisionProvider(llmProvider);
          setVisionModel(llmModel);
        }

        setLlmApiKey('');
      }

      // 4. Save vision separately if not using same provider
      if (!useSameProvider && visionApiKey && visionProvider && visionModel) {
        const result = await saveProviderConfig({
          purpose: 'vision',
          provider: visionProvider,
          model: visionModel,
          apiKey: visionApiKey,
        });
        if (!result.success) {
          setSaveMessage({
            type: 'error',
            text: result.error || 'Failed to save vision config',
          });
          setSaving(false);
          return;
        }
        setVisionKeySet(true);
        setVisionApiKey('');
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
        providers={providerIds}
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
      />

      {/* Use same provider checkbox */}
      <div className="flex items-center gap-3 px-[4px]">
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
      </div>

      {/* Vision Section (hidden when using same provider) */}
      {!useSameProvider && (
        <ProviderSection
          label="Vision (Camera)"
          providers={providerIds}
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
    </div>
  );
}
