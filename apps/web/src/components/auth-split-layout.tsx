import type { ReactNode } from 'react';

export interface AuthSplitLayoutProps {
  children: ReactNode;
}

export default function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  return (
    <div className="flex min-h-screen flex-wrap bg-slate-50">
      <section className="flex flex-1 basis-[420px] flex-col justify-between gap-8 border-r border-slate-300 bg-slate-100 p-12">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-lg border-2 border-dashed border-slate-400" aria-hidden="true" />
          <strong className="text-lg">[Clinic Name]</strong>
        </div>
        <div className="flex max-w-[440px] flex-col gap-4">
          <div
            className="flex h-[220px] w-full items-center justify-center rounded-xl border-2 border-dashed border-slate-400 text-sm text-slate-500"
            aria-hidden="true"
          >
            [Illustration / clinic photo]
          </div>
          <h1 className="text-[32px] leading-tight text-slate-900">
            Book and manage clinic appointments in one place.
          </h1>
          <p className="text-base leading-relaxed text-slate-700">
            Patients request a visit on a doctor's available day. Our Records team confirms it and
            you both get an email.
          </p>
        </div>
        <p className="text-sm text-slate-500">Need help? Call [CLINIC PHONE]</p>
      </section>
      <section className="flex flex-1 basis-[420px] items-center justify-center p-12">{children}</section>
    </div>
  );
}
