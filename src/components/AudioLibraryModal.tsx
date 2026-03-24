import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  getCachedSoundUrl,
  hydrateAudioLibrary,
  loadAudioLibraryMeta,
  saveAudioLibrary,
} from "@/lib/audio-library-storage";
import { Lock, Volume2, Trash2, Edit3, Check, Music, Upload, ArrowUpDown, Plus, Minus } from "lucide-react";

export type SoundItem = {
  id: string;
  name: string;
  volume: number;
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

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const nid = () => `snd_${Math.random().toString(36).slice(2, 10)}`;

function ensureBuiltins(sounds: SoundItem[]): SoundItem[] {
  const custom = sounds.filter((s) => !s.builtin);
  return [...BUILTINS, ...custom];
}

function toSoundItems(items: any[]): SoundItem[] {
  return items.map((s) => ({
    id: String(s.id ?? nid()),
    name: String(s.name ?? "名称未設定"),
    volume: Number.isFinite(Number(s.volume)) ? Math.max(0, Math.min(100, Number(s.volume))) : 100,
    builtin: !!s.builtin,
    mime: s.mime ?? "audio/wav",
    url: s.url ?? (getCachedSoundUrl(String(s.id ?? "")) || undefined),
  }));
}

export default function AudioLibraryModal({ open, onClose, sounds, onChange }: AudioLibraryModalProps) {
  const loadSaved = (): SoundItem[] => toSoundItems(loadAudioLibraryMeta());

  const [order, setOrder] = useState<"registered" | "aiueo">("registered");
  const [internal, setInternal] = useState<SoundItem[]>(() => ensureBuiltins((sounds && sounds.length ? sounds : loadSaved())));
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const canRegister = !!file && !saving;

  useEffect(() => {
    if (Array.isArray(sounds) && sounds.length > 0) {
      setInternal(ensureBuiltins(sounds));
    }
  }, [sounds]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void hydrateAudioLibrary().then((saved) => {
      if (cancelled) return;
      setInternal(ensureBuiltins(toSoundItems(saved)));
    }).catch(() => {
      if (!cancelled) setInternal(ensureBuiltins(loadSaved()));
    });
    return () => { cancelled = true; };
  }, [open]);

  const sorted = useMemo(() => {
    const builtins = internal.filter((s) => s.builtin);
    const custom = internal.filter((s) => !s.builtin);
    if (order === "aiueo") custom.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return [...builtins, ...custom];
  }, [internal, order]);

  const pushChange = async (next: SoundItem[]) => {
    const withBuilt = ensureBuiltins(next);
    setSaving(true);
    try {
      const saved = await saveAudioLibrary(withBuilt);
      const hydrated = ensureBuiltins(toSoundItems(saved));
      setInternal(hydrated);
      onChange?.(hydrated);
    } catch (e: any) {
      const isQuota =
        e?.name === "QuotaExceededError" ||
        e?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        /quota/i.test(String(e?.name || "")) ||
        /quota|storage|audio-library-idb-save-failed/i.test(String(e?.message || ""));
      window.alert(
        isQuota
          ? "音声の保存領域が不足しているため保存できませんでした。不要な音声を削除するか、端末の空き容量を確認してください。"
          : "音声ライブラリの保存に失敗しました。"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRegister = () => {
    if (!file || saving) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      window.alert(
        `音声ファイルが大きすぎます（${Math.round(file.size / 1024)}KB）。\n` +
        "10MB 以下の音声ファイルを選んでください。"
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const dataUrl = String(reader.result || "");
        if (!dataUrl) throw new Error("empty-audio-data");
        const fallbackName = file.name.replace(/\.[^/.]+$/, "");
        const item: SoundItem = {
          id: nid(),
          name: displayName.trim() || fallbackName,
          volume: 100,
          dataUrl,
          mime: file.type || "audio/wav",
        };
        void pushChange([...internal, item]);
        setFile(null);
        setDisplayName("");
      } catch {
        window.alert("音声ファイルの読み込みに失敗しました。");
      }
    };
    reader.onerror = () => {
      window.alert("音声ファイルの読み込みに失敗しました。");
    };
    reader.readAsDataURL(file);
  };

  const updateItem = (id: string, patch: Partial<SoundItem>) => {
    void pushChange(internal.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeItem = (id: string) => {
    const target = internal.find((s) => s.id === id);
    if (target?.builtin) return;
    const ok = window.confirm(`"${target?.name || "この音声"}" を削除します。よろしいですか？`);
    if (!ok) return;
    void pushChange(internal.filter((s) => s.id !== id));
  };

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
      const srcUrl = item.dataUrl || item.url || item.fileUrl || getCachedSoundUrl(item.id);
      if (srcUrl) {
        const el = new Audio(srcUrl);
        el.volume = vol;
        void el.play();
        return;
      }
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
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
            追加の通知音を登録できます。保存本体は端末内に保持され、ここでは名前や音量などの設定を管理します。
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4">
          <Card className="border-dashed">
            <CardContent className="pt-6 grid gap-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <div className="grid gap-2">
                  <Label htmlFor="file">音声ファイルを選ぶ</Label>
                  <Input id="file" type="file" accept=".wav,.mp3,.m4a,.aac,.aiff,.aif,.caf,audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="name">表示名</Label>
                  <Input id="name" placeholder="例: 料理ベル" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <Button disabled={!canRegister} onClick={handleRegister} className="gap-2">
                    <Upload className="h-4 w-4" /> 保存
                  </Button>
                  {!canRegister && (
                    <span className="text-xs text-muted-foreground">ファイルを選ぶと保存できます。</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="px-6 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">並び順</span>
              <RadioGroup value={order} onValueChange={(v) => setOrder(v as "registered" | "aiueo")} className="flex items-center gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="registered" id="order-registered" />
                  <Label htmlFor="order-registered" className="cursor-pointer flex items-center gap-1">
                    <ArrowUpDown className="h-4 w-4" />
                    登録順
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="aiueo" id="order-aiueo" />
                  <Label htmlFor="order-aiueo" className="cursor-pointer">あいうえお順</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6">
          <div className="grid gap-3">
            {sorted.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-1 sm:grid-cols-[minmax(20rem,1fr)_12rem_8rem] items-center gap-3 rounded-2xl border p-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="shrink-0 h-9 w-9 rounded-xl bg-muted flex items-center justify-center">
                    {item.builtin ? <Lock className="h-4 w-4" /> : <Music className="h-4 w-4" />}
                  </div>
                  {editingId === item.id ? (
                    <div className="flex items-center gap-2">
                      <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} className="h-9 w-48" />
                      <Button size="sm" className="h-9" onClick={commitEdit}>
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-medium break-words whitespace-normal ${item.builtin ? "opacity-70" : ""}`}>{item.name}</span>
                      {!item.builtin && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(item)}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 justify-self-end mr-3">
                  <Volume2 className="h-4 w-4 shrink-0" />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="音量を10%下げる"
                    onClick={() => updateItem(item.id, { volume: Math.max(0, Math.min(100, (item.volume ?? 100) - 10)) })}
                    disabled={(item.volume ?? 100) <= 0 || saving}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-12 text-center text-sm tabular-nums select-none">{Math.round(item.volume ?? 100)}%</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="音量を10%上げる"
                    onClick={() => updateItem(item.id, { volume: Math.max(0, Math.min(100, (item.volume ?? 100) + 10)) })}
                    disabled={(item.volume ?? 100) >= 100 || saving}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center justify-end gap-2 w-[4rem]">
                  <Button variant="outline" size="sm" onClick={() => play(item)}>試聴</Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={item.builtin ? "invisible pointer-events-none" : ""}
                    onClick={() => { if (!item.builtin) removeItem(item.id); }}
                    disabled={saving}
                  >
                    <Trash2 className="h-4 w-4" />
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
