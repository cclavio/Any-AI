import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import ProviderSetup from '../components/ProviderSetup';

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
      className={`h-screen flex flex-col bg-background ${isDarkMode ? 'dark' : ''}`}
      style={{
        overscrollBehavior: 'none',
        touchAction: 'pan-y',
      }}
    >
      {/* Page Title */}
      <div className="w-full px-6 py-3 text-center">
        <h1 className="text-[22px] font-bold text-secondary-foreground">
          App Configuration
        </h1>
      </div>

      {/* Settings Content */}
      <motion.div
        ref={scrollAreaRef}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 px-6 pt-0 pb-6 space-y-3 overflow-y-auto"
        style={{
          overscrollBehavior: 'none',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        {/* How-to instructions */}
        <div className="rounded-2xl px-1.5 pt-0 pb-3.5 bg-primary-foreground">
          <p className="text-[15px] leading-[1.5] text-muted-foreground">
            Configure your AI provider and API key below, then say your{' '}
            <span className="text-secondary-foreground font-semibold">
              wake word
            </span>{' '}
            followed by your question.
          </p>
        </div>

        {/* AI Provider Setup + Claude Bridge */}
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
