import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps a render failure inside the main landmark. The header, local-only
 * badge, and navigation remain usable, and the fallback offers both a retry
 * and a plain anchor back to projects.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The message is already visible to the user; this only aids local debugging.
    console.error('Slan UI error', error, info.componentStack);
  }

  private readonly handleRetry = () => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }

    return (
      <section className="panel panel--error" role="alert" aria-labelledby="app-error-title">
        <h1 className="panel__title" id="app-error-title">
          Something went wrong
        </h1>
        <p>The screen could not be displayed. No run was started or changed.</p>
        <p className="inline-error__meta">Error: {error.message}</p>
        <div className="panel__actions">
          <button type="button" className="button" onClick={this.handleRetry}>
            Try again
          </button>
          <a className="button button--secondary" href="/projects">
            Back to projects
          </a>
        </div>
      </section>
    );
  }
}
