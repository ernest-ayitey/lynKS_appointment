import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort safety net: catches render-time errors anywhere below it so a
 * single thrown error renders a message instead of a blank white page.
 *
 * Deliberately minimal — no reporting backend, no retry/reset UI. Errors a
 * form submit can produce are handled in the pages themselves (see
 * applyApiError / GENERIC_ERROR_MESSAGE); this only catches what escapes.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <div role="alert" className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow">
            <h1 className="mb-2 text-lg font-semibold text-slate-900">Something went wrong</h1>
            <p className="text-sm text-slate-600">Please reload the page and try again.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
