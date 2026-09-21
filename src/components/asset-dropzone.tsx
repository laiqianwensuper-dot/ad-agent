"use client";

import Image from "next/image";
import { useEffect, useId, useState } from "react";

export type UploadAsset = {
  id: string;
  file: File;
  displayName: string;
  originalFileName: string;
};

export function filesToUploadAssets(files: File[]): UploadAsset[] {
  return files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    displayName: file.name.replace(/\.[^/.]+$/, ""),
    originalFileName: file.name,
  }));
}

type AssetDropzoneProps = {
  assets: UploadAsset[];
  onChange: (assets: UploadAsset[]) => void;
  maxFiles: number;
  title: string;
  description: string;
  emptyLabel: string;
};

export function AssetDropzone({ assets, onChange, maxFiles, title, description, emptyLabel }: AssetDropzoneProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(assets.map((asset) => new Promise<[string, string]>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve([asset.id, String(reader.result)]);
      reader.onerror = () => resolve([asset.id, ""]);
      reader.readAsDataURL(asset.file);
    }))).then((entries) => { if (!cancelled) setPreviews(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [assets]);

  function append(files: File[]) {
    const images = files.filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type));
    onChange([...assets, ...filesToUploadAssets(images)].slice(0, maxFiles));
  }

  function reorder(overId: string) {
    if (!draggedId || draggedId === overId) return;
    const from = assets.findIndex((asset) => asset.id === draggedId);
    const to = assets.findIndex((asset) => asset.id === overId);
    if (from < 0 || to < 0) return;
    const next = [...assets];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
    setDraggedId(null);
  }

  return <div>
    <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
    <div
      className={`mt-2 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-7 text-center transition ${dragging ? "border-[var(--primary)] bg-[var(--active-bg)]" : "border-[#9bb9ff] bg-[#f7faff] hover:border-[var(--primary)] hover:bg-[#f3f7ff]"}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); append(Array.from(event.dataTransfer.files)); }}
      onClick={() => document.getElementById(inputId)?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") document.getElementById(inputId)?.click(); }}
    >
      <span className="grid h-10 w-10 place-items-center rounded-md bg-[#e8f0ff] text-xl text-[var(--primary)]" aria-hidden>↑</span>
      <span className="mt-3 text-sm font-semibold text-[var(--text-primary)]">{emptyLabel}</span>
      <span className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</span>
      <span className="mt-3 rounded-md border border-[#b8ccff] bg-white px-3 py-1.5 text-xs font-medium text-[var(--primary)]">选择图片</span>
      <input id={inputId} type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => append(Array.from(event.target.files ?? []))} />
    </div>

    {assets.length > 0 && <div className="mt-3 space-y-2">
      {assets.map((asset, index) => <article key={asset.id} draggable onDragStart={() => setDraggedId(asset.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(asset.id)} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-white p-2.5">
        <span className="cursor-grab text-base text-[var(--text-tertiary)]" title="拖拽排序" aria-label="拖拽排序">⠿</span>
        {previews[asset.id] && <Image src={previews[asset.id]} unoptimized width={52} height={52} alt="上传素材缩略图" className="h-[52px] w-[52px] shrink-0 rounded-md border border-[var(--border)] object-cover" />}
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor={`${inputId}-${asset.id}`}>素材显示名称</label>
          <input id={`${inputId}-${asset.id}`} value={asset.displayName} onChange={(event) => onChange(assets.map((item) => item.id === asset.id ? { ...item, displayName: event.target.value } : item))} className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-[var(--text-primary)] outline-none hover:border-[var(--border)] focus:border-[var(--primary)]" />
          <p className="mt-0.5 truncate px-2 text-xs text-[var(--text-tertiary)]">原文件：{asset.originalFileName} · 图片 {index + 1}</p>
        </div>
        <button type="button" onClick={() => onChange(assets.filter((item) => item.id !== asset.id))} className="rounded-md px-2 py-1.5 text-xs text-[var(--danger)] hover:bg-[#fff1f0]">删除</button>
      </article>)}
    </div>}
  </div>;
}
