import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type AnnouncementTone = 'polite' | 'assertive';

export interface StatusAnnouncer {
  /**
   * Publish a short transition message. Polite is the default; assertive is
   * reserved for run failures and other urgent interruptions.
   */
  announce: (message: string, tone?: AnnouncementTone) => void;
}

interface Messages {
  polite: string;
  assertive: string;
}

interface StatusContextValue extends StatusAnnouncer {
  messages: Messages;
}

const EMPTY_MESSAGES: Messages = { polite: '', assertive: '' };

const StatusContext = createContext<StatusContextValue | null>(null);

export function StatusAnnouncerProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Messages>(EMPTY_MESSAGES);

  const announce = useCallback((message: string, tone: AnnouncementTone = 'polite') => {
    const trimmed = message.trim();
    if (trimmed === '') {
      return;
    }

    setMessages(() =>
      tone === 'assertive'
        ? { polite: '', assertive: trimmed }
        : { polite: trimmed, assertive: '' },
    );
  }, []);

  const value = useMemo<StatusContextValue>(
    () => ({ announce, messages }),
    [announce, messages],
  );

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

function useStatusContext(): StatusContextValue {
  const context = useContext(StatusContext);
  if (context === null) {
    throw new Error('Status announcements require a StatusAnnouncerProvider.');
  }
  return context;
}

export function useStatusAnnouncer(): StatusAnnouncer {
  return useStatusContext();
}

/**
 * The persistent aria-live region. It is mounted once by App, outside the
 * route boundary, so route changes and render failures never replace the live
 * nodes. It carries short transition messages only; terminal output is never
 * streamed through it.
 */
export function StatusRegion() {
  const { messages } = useStatusContext();

  return (
    <div className="status-region">
      <p
        className="status-region__message"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {messages.polite}
      </p>
      <p
        className="status-region__message"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {messages.assertive}
      </p>
    </div>
  );
}
