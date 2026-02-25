import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { Lock, Volume2, Trash2, Edit3, Check, Music, Upload, ArrowUpDown, Plus, Minus } from "lucide-react";

// ================= Types =================
export type SoundItem = {
  id: string;
  name: string;
  volume: number; // 0–100 (individual; separate from global volume)
  builtin?: boolean;
  fileUrl?: string;
  dataUrl?: string;
  base64?: string;
  mime?: string;
  url?: string;
};

export type AudioLibraryModalProps = {
  open: boolean;
  onClose: () => void;
  sounds?: SoundItem[];
  onChange?: (sounds: SoundItem[]) => void;
};

const BUILTINS: SoundItem[] = [
  { id: "builtin-beep", name: "ピッ", volume: 100, builtin: true },
  { id: "builtin-beep3", name: "ピピピッ", volume: 100, builtin: true },
];

function ensureBuiltins(sounds: SoundItem[]): SoundItem[] {
  const have = new Set(sounds.map((s) => s.id));
  const withBuiltins = [...sounds];
  for (const b of BUILTINS) {
    if (!have.has(b.id)) withBuiltins.unshift(b);
  }
  return [
    ...BUILTINS,
    ...withBuiltins.filter((s) => !s.builtin),
  ];
}

const nid = () => `snd_${Math.random().toString(36).slice(2, 10)}`;

export default function AudioLibraryModal({ open, onClose, sounds, onChange }: AudioLibraryModalProps) {
  // 既存登録の復元（ローカルストレージから）
  const loadSaved = (): SoundItem[] => {
    try {
      const raw = localStorage.getItem("timerBoard_sounds_v1");
      if (!raw) return [];
      const arr = JSON.parse(raw) as any[];
      return Array.isArray(arr)
        ? arr.map((s) => ({
            id: String(s.id ?? nid()),
            name: String(s.name ?? "名称未設定"),
            volume: Number.isFinite(Number(s.volume)) ? Math.max(0, Math.min(100, Number(s.volume))) : 100,
            builtin: !!s.builtin,
            dataUrl: s.dataUrl ?? undefined,
            base64: s.base64 ?? (typeof s.dataUrl === "string" && s.dataUrl.includes(",") ? s.dataUrl.split(",")[1] : undefined),
            mime: s.mime ?? "audio/wav",
            url: s.url ?? s.fileUrl ?? undefined,
          }))
        : [];
    } catch {
      return [];
    }
  };

  const [order, setOrder] = useState<"registered" | "aiueo">("registered");
  const [internal, setInternal] = useState<SoundItem[]>(() => ensureBuiltins((sounds && sounds.length ? sounds : loadSaved())));

  useEffect(() => {
    // 親から明示的に配列が来て、かつ要素があるときだけ上書き（空配列で消されないように）
    if (Array.isArray(sounds) && sounds.length > 0) {
      setInternal(ensureBuiltins(sounds));
    }
  }, [sounds]);

  // モーダルを開いたタイミングでローカル復元（親から何も来ていないケースをケア）
  useEffect(() => {
    if (!open) return;
    const saved = loadSaved();
    if (saved.length > 0) {
      setInternal(ensureBuiltins(saved));
    } else {
      // 少なくとも内蔵音は出す
      setInternal(ensureBuiltins([]));
    }
  }, [open]);

  useEffect(() => {
    (async () => {
      const target = internal.filter((s) => !s.builtin && s.fileUrl && s.fileUrl.startsWith("blob:") && !s.dataUrl);
      if (target.length === 0) return;
      const next = [...internal];
      let changed = false;
      for (const it of target) {
        try {
          const res = await fetch(it.fileUrl!);
          const blob = await res.blob();
          const dataUrl: string = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result || ""));
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          });
          const idx = next.findIndex((x) => x.id === it.id);
          if (idx >= 0) {
            next[idx] = { ...next[idx], dataUrl, mime: blob.type || next[idx].mime, fileUrl: undefined, base64: dataUrl.includes(',') ? dataUrl.split(',')[1] : next[idx].base64 } as SoundItem;
            changed = true;
          }
        } catch {}
      }
      if (changed) pushChange(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internal]);

  const sorted = useMemo(() => {
    const list = [...internal];
    const builtins = list.filter((s) => s.builtin);
    const custom = list.filter((s) => !s.builtin);
    if (order === "aiueo") {
      custom.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    }
    return [...builtins, ...custom];
  }, [internal, order]);

  const pushChange = (next: SoundItem[]) => {
    const withBuilt = ensureBuiltins(next);

    try {
      localStorage.setItem("timerBoard_sounds_v1", JSON.stringify(withBuilt));
    } catch (e: any) {
      const isQuota =
        e?.name === "QuotaExceededError" ||
        e?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        /quota/i.test(String(e?.name || "")) ||
        /quota|storage/i.test(String(e?.message || ""));

     window.alert(
  isQuota
    ? "音声ライブラリの保存容量がいっぱいです。\n不要な音声を削除するか、短い音声ファイルにしてください。"
    : "音声ライブラリの保存に失敗しました。"
);
      return;
    }

    setInternal(withBuilt);
    onChange?.(withBuilt);
  };


  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const canRegister = !!file;

  const handleRegister = () => {
    if (!file) return;

    // iPad実運用の安定性のため、登録時にサイズ上限を設ける
    // （IndexedDB移行後も「重すぎる音声」の事故防止として有効）
    const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB
    if (file.size > MAX_FILE_SIZE_BYTES) {
      window.alert(
  `音声ファイルが大きすぎます（${Math.round(file.size / 1024)}KB）。\n` +
  `1MB以下の短い音声ファイルを登録してください。`
);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const fallbackName = file.name.replace(/\.[^/.]+$/, "");
      const item: SoundItem = {
        id: nid(),
        name: (displayName.trim() || fallbackName),
        volume: 100,
        dataUrl,
        base64: dataUrl.includes(",") ? dataUrl.split(',')[1] : undefined,
        mime: file?.type || "audio/wav",
      };
      pushChange([...internal, item]);
      setFile(null);
      setDisplayName("");
    };
    reader.readAsDataURL(file);
  };

  const updateItem = (id: string, patch: Partial<SoundItem>) => {
    const next = internal.map((s) => (s.id === id ? { ...s, ...patch } : s));
    pushChange(next);
  };

  const removeItem = (id: string) => {
    const target = internal.find((s) => s.id === id);
    if (target?.builtin) return;
    const ok = window.confirm(`"${target?.name || "この音声"}" を削除します。よろしいですか？`);
    if (!ok) return;
    pushChange(internal.filter((s) => s.id !== id));
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const startEdit = (item: SoundItem) => {
    if (item.builtin) return;
    setEditingId(item.id);
    setEditingName(item.name);
  };

  const commitEdit = () => {
    if (!editingId) return;
    updateItem(editingId, { name: editingName.trim() || "名称未設定" });
    setEditingId(null);
    setEditingName("");
  };

  const play = (item: SoundItem) => {
    try {
      const vol = Math.max(0, Math.min(1, (item.volume ?? 100) / 100));
      const srcUrl = item.dataUrl || item.url || item.fileUrl;
      if (srcUrl) {
        const el = new Audio(srcUrl);
        el.volume = vol;
        void el.play();
        return;
      }
      const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
      const gain = ac.createGain();
      gain.gain.value = vol;
      gain.connect(ac.destination);
      const beep = (freq: number, durationMs: number, when = 0) => {
        const osc = ac.createOscillator();
        osc.type = "square";
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(ac.currentTime + when);
        osc.stop(ac.currentTime + when + durationMs / 1000);
      };
      if (item.id === "builtin-beep") {
        beep(2000, 80);
      } else if (item.id === "builtin-beep3") {
        beep(2000, 60, 0);
        beep(2000, 60, 0.12);
        beep(2000, 60, 0.24);
      }
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] p-0 overflow-auto">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-xl">音声ライブラリ</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            ・各音源ごとに個別の音量を設定できます（共通音量とは別）。<br/>
            ・端末の音量に依存します。<span className="font-medium">実際の使用音量で確認してください。</span>
          </DialogDescription>
        </DialogHeader>

        {/* Add Form */}
        <div className="px-6 pb-4">
          <Card className="border-dashed">
            <CardContent className="pt-6 grid gap-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <div className="grid gap-2">
                  <Label htmlFor="file">音声ファイルを追加</Label>
                  <Input id="file" type="file" accept=".wav,.mp3,.m4a,.aac,.aiff,.aif,.caf,audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="name">表示名</Label>
                  <Input id="name" placeholder="例：鍋用ベル" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <Button disabled={!canRegister} onClick={handleRegister} className="gap-2">
                    <Upload className="h-4 w-4"/> 登録
                  </Button>
                  {!canRegister && (
                    <span className="text-xs text-muted-foreground">ファイルを選択してください（名称未入力ならファイル名を使用します）</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sort / Options */}
        <div className="px-6 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">並び替え</span>
              <RadioGroup value={order} onValueChange={(v) => setOrder(v as any)} className="flex items-center gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="registered" id="order-registered" />
                  <Label htmlFor="order-registered" className="cursor-pointer flex items-center gap-1"><ArrowUpDown className="h-4 w-4"/>登録順</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="aiueo" id="order-aiueo" />
                  <Label htmlFor="order-aiueo" className="cursor-pointer">あいうえお順</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        </div>
        {/* List */}
        <div className="px-6 pb-6">
          <div className="grid gap-3">
            {sorted.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-1 sm:grid-cols-[minmax(20rem,1fr)_12rem_8rem] items-center gap-3 rounded-2xl border p-3"
              >
                {/* Name / inline edit */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="shrink-0 h-9 w-9 rounded-xl bg-muted flex items-center justify-center">
                    {item.builtin ? <Lock className="h-4 w-4"/> : <Music className="h-4 w-4"/>}
                  </div>
                  {editingId === item.id ? (
                    <div className="flex items-center gap-2">
                      <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} className="h-9 w-48"/>
                      <Button size="sm" className="h-9" onClick={commitEdit}><Check className="h-4 w-4"/></Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-medium break-words whitespace-normal ${item.builtin ? "opacity-70" : ""}`}>{item.name}</span>
                      {!item.builtin && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(item)}>
                          <Edit3 className="h-4 w-4"/>
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Volume（ステッパー方式・右寄せ） */}
<div className="flex items-center gap-2 justify-self-end mr-3">
  <Volume2 className="h-4 w-4 shrink-0" />

  <Button
    type="button"
    size="icon"
    variant="ghost"
    aria-label="音量を10%下げる"
    onClick={() =>
      updateItem(item.id, {
        volume: Math.max(0, Math.min(100, (item.volume ?? 100) - 10)),
      })
    }
    disabled={(item.volume ?? 100) <= 0}
  >
    <Minus className="h-4 w-4" />
  </Button>

  <span className="w-12 text-center text-sm tabular-nums select-none">
    {Math.round(item.volume ?? 100)}%
  </span>

  <Button
    type="button"
    size="icon"
    variant="ghost"
    aria-label="音量を10%上げる"
    onClick={() =>
      updateItem(item.id, {
        volume: Math.max(0, Math.min(100, (item.volume ?? 100) + 10)),
      })
    }
    disabled={(item.volume ?? 100) >= 100}
  >
    <Plus className="h-4 w-4" />
  </Button>
</div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 w-[4rem]">
  <Button variant="outline" size="sm" onClick={() => play(item)}>試聴</Button>
  <Button
    variant="ghost"
    size="icon"
    className={item.builtin ? "invisible pointer-events-none" : ""}
    onClick={() => { if (!item.builtin) removeItem(item.id); }}
  >
    <Trash2 className="h-4 w-4"/>
  </Button>
                  
                </div>
              </div>
            ))}

            {sorted.length === 0 && (
              <div className="text-sm text-muted-foreground px-2">まだ音声が登録されていません。</div>
            )}
          </div>
        </div>


        <div className="border-t px-6 py-3 flex items-center justify-end gap-2 bg-muted/30">
          <Button variant="secondary" onClick={onClose}>閉じる</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
