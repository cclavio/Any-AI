import React from 'react';

export function SettingSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold uppercase tracking-wide px-1 mb-1.5 text-muted-foreground">
        {label}
      </h3>
      <div className="rounded-2xl overflow-hidden bg-primary-foreground">
        {children}
      </div>
    </div>
  );
}

export function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-1.5 h-12">
      <span className="text-base font-medium text-secondary-foreground shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

export function SettingDivider() {
  return <div className="mx-1.5 border-b border-border" />;
}

export function SettingDescription({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="px-1.5 py-2.5">
      <p className="text-[13px] leading-5 text-muted-foreground">{children}</p>
    </div>
  );
}
