import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.hash = '';
    window.location.reload();
  };

  toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-gray-900 p-6">
          <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-800 p-8 text-center shadow-2xl">
            {/* Error Icon */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-900/30">
              <svg
                className="h-8 w-8 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            {/* Message */}
            <h1 className="mb-2 text-xl font-semibold text-gray-100">
              Something went wrong
            </h1>
            <p className="mb-6 text-sm text-gray-400">
              An unexpected error occurred. You can try reloading the page or
              going back to the home screen.
            </p>

            {/* Action Buttons */}
            <div className="mb-6 flex items-center justify-center gap-3">
              <button
                onClick={this.handleReload}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
              >
                Reload
              </button>
              <button
                onClick={this.handleGoHome}
                className="rounded-lg border border-gray-600 bg-gray-700 px-5 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600"
              >
                Go Home
              </button>
            </div>

            {/* Collapsible Error Details */}
            <div className="text-left">
              <button
                onClick={this.toggleDetails}
                className="flex w-full items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-300"
              >
                <svg
                  className={`h-3 w-3 transition-transform ${
                    this.state.showDetails ? 'rotate-90' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                Error Details
              </button>
              {this.state.showDetails && this.state.error && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-red-300">
                  {this.state.error.message}
                  {'\n\n'}
                  {this.state.error.stack}
                </pre>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
