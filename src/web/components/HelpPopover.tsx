import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { guideAnchor } from '../help/guide';
import { HELP_TOPICS, type HelpTopicId } from '../help/topics';

interface HelpPopoverContextValue {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

const HelpPopoverContext = createContext<HelpPopoverContextValue | null>(null);

export function HelpPopoverProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenIdState] = useState<string | null>(null);
  const setOpenId = useCallback((id: string | null) => setOpenIdState(id), []);
  const value = useMemo(() => ({ openId, setOpenId }), [openId, setOpenId]);
  return <HelpPopoverContext.Provider value={value}>{children}</HelpPopoverContext.Provider>;
}

function useHelpPopoverContext(): HelpPopoverContextValue {
  const context = useContext(HelpPopoverContext);
  if (context === null) {
    throw new Error('Help popovers require a HelpPopoverProvider.');
  }
  return context;
}

export function HelpPopover({ topic }: { topic: HelpTopicId }) {
  const instanceId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { openId, setOpenId } = useHelpPopoverContext();
  const isOpen = openId === instanceId;
  const details = HELP_TOPICS[topic];
  const panelId = `${instanceId}-help`;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpenId(null);
        triggerRef.current?.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpenId(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [isOpen, setOpenId]);

  return (
    <span className="help-popover">
      <button
        ref={triggerRef}
        type="button"
        className="help-popover__trigger"
        aria-label={`Help: ${details.title}`}
        aria-expanded={isOpen}
        aria-controls={panelId}
        title={`Help: ${details.title}`}
        onClick={() => setOpenId(isOpen ? null : instanceId)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {isOpen ? (
        <div
          ref={panelRef}
          className="help-popover__panel"
          id={panelId}
          role="region"
          aria-label={`Help: ${details.title}`}
        >
          <div className="help-popover__heading">
            <strong>{details.title}</strong>
            <button
              type="button"
              className="help-popover__close"
              aria-label={`Close help: ${details.title}`}
              onClick={() => {
                setOpenId(null);
                triggerRef.current?.focus();
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <p>{details.summary}</p>
          <a
            href={`/help#${guideAnchor(details.article, details.anchor)}`}
            target="_blank"
            rel="noopener"
          >
            Read the full guide (opens in a new tab)
          </a>
        </div>
      ) : null}
    </span>
  );
}
