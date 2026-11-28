import type { ReactNode } from 'react';

export interface AuthCardProps {
  title: string;
  subtitle?: string;
  stepLabel?: string;
  maxWidth?: 'narrow' | 'wide';
  children: ReactNode;
}

export default function AuthCard({ title, subtitle, stepLabel, maxWidth = 'narrow', children }: AuthCardProps) {
  const maxWidthClass = maxWidth === 'wide' ? 'max-w-[720px]' : 'max-w-[420px]';

  return (
    <div className="flex min-h-screen w-full flex-col items-center gap-6 bg-slate-50 px-6 py-10">
      {stepLabel ? (
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{stepLabel}</span>
      ) : (
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg border-2 border-dashed border-slate-400" aria-hidden="true" />
          <strong className="text-lg">[Clinic Name]</strong>
        </div>
      )}
      <div className={`flex w-full ${maxWidthClass} flex-col gap-5 rounded-xl border border-slate-300 bg-white p-8`}>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-2xl text-slate-900">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
