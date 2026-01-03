import React from "react";
import { toJPLabel } from "./sounds-helper";

export type RadioItem = { id: string; label?: string };

export function RadioSound({
  list = [],
  value = "",
  onChange = () => {},
  name = "sound",
  wrapStyle,
  itemClassName,
}: {
  list: RadioItem[];
  value: string;
  onChange: (id: string) => void;
  name?: string;
  wrapStyle?: React.CSSProperties;
  itemClassName?: string;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, ...(wrapStyle || {}) }}>
      {list.map((o) => (
        <label
          key={o.id}
          className={itemClassName}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            border: "1px solid #ccc",
            borderRadius: 9999,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="radio"
            name={name}
            checked={value === o.id}
            onChange={() => onChange(o.id)}
            style={{ marginRight: 4 }}
          />
          <span>{toJPLabel(o.label || o.id)}</span>
        </label>
      ))}
    </div>
  );
}

type PickerOverlayProps<T extends { id: string; label: string }> = {
  open: boolean;
  title?: string;
  list: T[];
  value?: string;
  onPick: (id: string) => void;
  onClose: () => void;
  topOffset?: number;
};

export function PickerOverlay<T extends { id: string; label: string }>({
  open,
  title,
  list,
  value,
  onPick,
  onClose,
  topOffset = 84,
}: PickerOverlayProps<T>) {
  if (!open) return null;
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-50 w-[min(560px,92vw)] rounded-xl border bg-white shadow"
      style={{ top: topOffset }}
    >
      {title && <div className="px-3 py-2 font-semibold border-b bg-gray-50">{title}</div>}
      <div className="max-h-[50vh] overflow-y-auto">
        {list.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            className={`w-full text-left px-3 py-2 border-b last:border-b-0 ${
              value === s.id ? "bg-blue-100" : "bg-white"
            }`}
          >
            {toJPLabel(s.label)}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 p-2">
        <button className="h-8 rounded-md border px-3 bg-white text-black" onClick={() => onPick("")}>
          無音にする
        </button>
        <button className="h-8 rounded-md border px-3 bg-white text-black" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
