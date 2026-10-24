import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { key, modKey } from "../platform";

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
  hint?: string;
  run?: () => void;
}

interface Props {
  placeholder: string;
  items: (query: string) => PickerItem[];
  onClose: () => void;
  header?: ReactNode;
  footer?: ReactNode;
  /** Multi-select: Enter toggles, ⌘Enter (Ctrl+Enter on Windows) confirms with the selected ids. */
  multi?: { initial: string[]; onConfirm: (ids: string[]) => void };
  /** Extra key handling (e.g. Tab to cycle profiles); return true when handled. */
  onKey?: (e: React.KeyboardEvent) => boolean;
  /** Shown right of the input, e.g. a button. */
  inputAccessory?: ReactNode;
}

export function Picker({ placeholder, items, onClose, header, footer, multi, onKey, inputAccessory }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>(multi?.initial ?? []);
  const list = useMemo(() => items(query), [items, query]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".picker-item.active")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const pick = (item: PickerItem | undefined) => {
    if (!item) return;
    if (multi) {
      setSelected((s) => (s.includes(item.id) ? s.filter((x) => x !== item.id) : [...s, item.id]));
      return;
    }
    onClose();
    item.run?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (onKey?.(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (multi && modKey(e)) {
        onClose();
        multi.onConfirm(selected);
      } else pick(list[index]);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
        {header}
        <div className="picker-input-row">
          <input
            autoFocus
            className="picker-input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          {inputAccessory}
        </div>
        <div className="picker-list" ref={listRef}>
          {list.length === 0 && <div className="picker-empty">No matches</div>}
          {list.map((item, i) => (
            <div
              key={item.id}
              className={"picker-item" + (i === index ? " active" : "")}
              onMouseMove={() => setIndex(i)}
              onClick={() => pick(item)}
            >
              {multi && <span className={"check" + (selected.includes(item.id) ? " on" : "")}>✓</span>}
              <span className="picker-label">{item.label}</span>
              {item.detail && <span className="picker-detail">{item.detail}</span>}
              {item.hint && <span className="picker-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
        {multi ? (
          <div className="picker-footer">
            <span>
              {selected.length} selected · Enter toggles · {key("confirm")} saves
            </span>
            <button
              className="btn primary"
              onClick={() => {
                onClose();
                multi.onConfirm(selected);
              }}
            >
              Save
            </button>
          </div>
        ) : (
          footer
        )}
      </div>
    </div>
  );
}

export function PromptModal({
  title,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="picker prompt" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-title">{title}</div>
        <input
          autoFocus
          className="picker-input"
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter") {
              onClose();
              onSubmit(value);
            }
          }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
