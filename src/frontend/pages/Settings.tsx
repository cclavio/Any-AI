import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import Header from '../components/Header';
import { fetchUserSettings } from '../api/settings.api';
import ProviderSetup from '../components/ProviderSetup';

interface SettingsProps {
  onBack: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  userId: string;
  onChatHistoryToggle?: (enabled: boolean) => void;
  onEnableDebugMode?: () => void;
}

/**
 * Settings page component
 */
function Settings({
  onBack,
  isDarkMode,
  onToggleDarkMode,
  userId,
  onChatHistoryToggle,
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
      {/* Header */}
      <Header
        isDarkMode={isDarkMode}
        onToggleDarkMode={onToggleDarkMode}
        onSettingsClick={() => {}}
        showBackArrow={false}
      />

      {/* Settings Content */}
      <motion.div
        ref={scrollAreaRef}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 px-[24px] pt-[24px] space-y-3 overflow-y-auto"
        style={{
          overscrollBehavior: 'none',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        {/* How-to instructions */}
        <div
          className="rounded-[16px] px-[16px] py-[14px]"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          <p
            className="text-[13px] leading-[1.5]"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Configure your AI provider and API key below, then say{' '}
            <span style={{ color: 'var(--secondary-foreground)', fontWeight: 600 }}>
              "Hey Jarvis"
            </span>{' '}
            followed by your question.
          </p>
        </div>

        {/* AI Provider Setup */}
        <ProviderSetup />

        {/* Version Info */}
        <div className="pt-8 text-center">
          <p className="text-[12px] text-gray-500">Any AI v0.8.0</p>
        </div>
      </motion.div>
    </div>
  );
}

export default Settings;
