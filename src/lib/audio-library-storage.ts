const META_KEY = "timerBoard_sounds_v1";
const DB_NAME = "kitchen-timer-audio-library";
const STORE_NAME = "sounds";
const DB_VERSION = 1;

type AudioMeta = {
  id: string;
  name: string;
  volume?: number;
  builtin?: boolean;
  dataUrl?: string;
  base64?: string;
  mime?: string;
  url?: string;
  fileUrl?: string;
};

const blobUrlCache = new Map<string, string>();
let hydrateTask: Promise<AudioMeta[]> | null = null;

const isHttpUrl = (v: string) => /^https?:\/\//.test(String(v || ""));
const isDataUrl = (v: string) => /^data:/i.test(String(v || ""));
const isBlobUrl = (v: string) => /^blob:/i.test(String(v || ""));

const loadMetaFromLocalStorage = (): AudioMeta[] => {
  try {
    const raw = localStorage.getItem(META_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const saveMetaToLocalStorage = (items: AudioMeta[]) => {
  localStorage.setItem(META_KEY, JSON.stringify(items));
};

const sanitizeMeta = (item: AudioMeta): AudioMeta => {
  const meta: AudioMeta = {
    id: String(item.id || ""),
    name: String(item.name || ""),
    volume: Number.isFinite(Number(item.volume)) ? Math.max(0, Math.min(100, Number(item.volume))) : 100,
    builtin: !!item.builtin,
    mime: item.mime || undefined,
  };
  if (item.url && isHttpUrl(item.url)) meta.url = item.url;
  return meta;
};

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const res = await fetch(dataUrl);
  return res.blob();
};

const blobSourceToBlob = async (item: AudioMeta): Promise<Blob | null> => {
  if (item.dataUrl && isDataUrl(item.dataUrl)) return dataUrlToBlob(item.dataUrl);
  if (item.url && isDataUrl(item.url)) return dataUrlToBlob(item.url);
  if (item.fileUrl && isBlobUrl(item.fileUrl)) {
    const res = await fetch(item.fileUrl);
    return res.blob();
  }
  if (item.url && isBlobUrl(item.url)) {
    const res = await fetch(item.url);
    return res.blob();
  }
  if (item.base64) {
    const mime = item.mime || "audio/wav";
    return dataUrlToBlob(`data:${mime};base64,${item.base64}`);
  }
  return null;
};

const openDb = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

const withStore = async <T,>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T | null> => {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = await run(store);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } catch {
    try { db.close(); } catch {}
    return null;
  } finally {
    try { db.close(); } catch {}
  }
};

const idbGet = async (id: string): Promise<Blob | null> => {
  const out = await withStore("readonly", (store) => new Promise<Blob | null>((resolve) => {
    const req = store.get(id);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => resolve(null);
  }));
  return out || null;
};

const idbPut = async (id: string, blob: Blob): Promise<boolean> => {
  const out = await withStore("readwrite", (store) => new Promise<boolean>((resolve) => {
    const req = store.put(blob, id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  }));
  return !!out;
};

const idbDelete = async (id: string): Promise<boolean> => {
  const out = await withStore("readwrite", (store) => new Promise<boolean>((resolve) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  }));
  return !!out;
};

const idbKeys = async (): Promise<string[]> => {
  const out = await withStore("readonly", (store) => new Promise<string[]>((resolve) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve((req.result || []).map((v) => String(v)));
    req.onerror = () => resolve([]);
  }));
  return out || [];
};

const setCachedBlobUrl = (id: string, blob: Blob) => {
  const prev = blobUrlCache.get(id);
  if (prev) {
    try { URL.revokeObjectURL(prev); } catch {}
  }
  const next = URL.createObjectURL(blob);
  blobUrlCache.set(id, next);
  return next;
};

const dropCachedBlobUrl = (id: string) => {
  const prev = blobUrlCache.get(id);
  if (prev) {
    try { URL.revokeObjectURL(prev); } catch {}
  }
  blobUrlCache.delete(id);
};

export const getCachedSoundUrl = (id: string) => blobUrlCache.get(String(id || "")) || "";

export const loadAudioLibraryMeta = () => loadMetaFromLocalStorage();

export const hydrateAudioLibrary = async (): Promise<AudioMeta[]> => {
  if (hydrateTask) return hydrateTask;
  hydrateTask = (async () => {
    const items = loadMetaFromLocalStorage();
    const needsMigration = items.some((item) =>
      !item?.builtin && !!(item?.dataUrl || item?.base64 || isDataUrl(item?.url || "") || isBlobUrl(item?.url || "") || isBlobUrl(item?.fileUrl || ""))
    );
    if (needsMigration) {
      return saveAudioLibrary(items);
    }

    for (const item of items) {
      if (item?.builtin) continue;
      if (item?.url && isHttpUrl(item.url)) continue;
      if (blobUrlCache.has(item.id)) continue;
      const blob = await idbGet(item.id);
      if (blob) setCachedBlobUrl(item.id, blob);
    }
    return items.map(sanitizeMeta);
  })().finally(() => {
    hydrateTask = null;
  });
  return hydrateTask;
};

export const saveAudioLibrary = async (items: AudioMeta[]): Promise<AudioMeta[]> => {
  const nextMeta: AudioMeta[] = [];
  const keepIds = new Set<string>();

  for (const raw of items) {
    const item = sanitizeMeta(raw);
    if (!item.id) continue;
    keepIds.add(item.id);
    if (item.builtin) {
      nextMeta.push(item);
      continue;
    }

    const blob = await blobSourceToBlob(raw);
    if (blob) {
      const ok = await idbPut(item.id, blob);
      if (!ok) throw new Error("audio-library-idb-save-failed");
      setCachedBlobUrl(item.id, blob);
    } else if (!blobUrlCache.has(item.id) && !(item.url && isHttpUrl(item.url))) {
      const existing = await idbGet(item.id);
      if (existing) {
        setCachedBlobUrl(item.id, existing);
      }
    }
    nextMeta.push(item);
  }

  const existingKeys = await idbKeys();
  for (const id of existingKeys) {
    if (!keepIds.has(id)) {
      await idbDelete(id);
      dropCachedBlobUrl(id);
    }
  }

  saveMetaToLocalStorage(nextMeta);
  return nextMeta;
};

export const deleteAudioLibrarySound = async (id: string) => {
  await idbDelete(id);
  dropCachedBlobUrl(id);
};

void hydrateAudioLibrary();
