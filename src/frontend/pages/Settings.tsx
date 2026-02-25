import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import ProviderSetup from '../components/ProviderSetup';
import BridgePairing from '../components/BridgePairing';

interface SettingsProps {
  isDarkMode: boolean;
  onEnableDebugMode?: () => void;
}

/**
 * Settings page component
 */
function Settings({
  isDarkMode,
  onEnableDebugMode,
}: SettingsProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Hidden 10-tap debug mode activation
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSettingsTap = () => {
    tapCountRef.current++;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 3000);
    if (tapCountRef.current >= 10) {
      tapCountRef.current = 0;
      onEnableDebugMode?.();
    }
  };

  return (
    <div
      onClick={handleSettingsTap}
      className={`h-screen flex flex-col ${isDarkMode ? 'dark' : ''}`}
      style={{
        backgroundColor: 'var(--background)',
        overscrollBehavior: 'none',
        touchAction: 'pan-y',
      }}
    >
      {/* Page Title */}
      <div className="w-full px-[24px] py-[12px] text-center">
        <h1
          className="text-[22px] font-bold"
          style={{ color: 'var(--secondary-foreground)' }}
        >
          App Configuration
        </h1>
      </div>

      {/* Settings Content */}
      <motion.div
        ref={scrollAreaRef}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 px-[24px] pt-0 pb-[24px] space-y-3 overflow-y-auto"
        style={{
          overscrollBehavior: 'none',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        {/* How-to instructions */}
        <div
          className="rounded-[16px] px-[5px] pt-0 pb-[14px]"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          <p
            className="text-[15px] leading-[1.5]"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Configure your AI provider and API key below, then say your{' '}
            <span style={{ color: 'var(--secondary-foreground)', fontWeight: 600 }}>
              wake word
            </span>{' '}
            followed by your question.
          </p>
        </div>

        {/* Claude Bridge */}
        <div className="space-y-1">
          <h3
            className="text-[14px] font-semibold uppercase tracking-wide px-[4px] mb-[6px]"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Claude Bridge
          </h3>
          <BridgePairing />
        </div>

        {/* AI Provider Setup */}
        <ProviderSetup />

        {/* Version Info */}
        <div className="pt-8 text-center">
          <p className="text-[13px] text-gray-500">Any AI v0.8.0</p>
        </div>
      </motion.div>
    </div>
  );
}

export default Settings;
