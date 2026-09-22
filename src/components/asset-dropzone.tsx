"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { GripVertical, ImagePlus, Pencil, Upload, X } from "lucide-react";

export type UploadAsset = { id: string; file: File; displayName: string; originalFileName: string };

export function filesToUploadAssets(files: File[]): UploadAsset[] {
  return files.filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type)).map((file) => ({ id: crypto.randomUUID(), file, displayName: file.name.replace(/\.[^/.]+$/, ""), originalFileName: file.name }));
}

type AssetDropzoneProps = { assets: UploadAsset[]; onChange: (assets: UploadAsset[]) => void; maxFiles: number; title: string; description: string; emptyLabel: string; compact?: boolean; fill?: boolean };

export function AssetDropzone({ assets, onChange, maxFiles, title, description, emptyLabel }: AssetDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(assets.map((asset) => new Promise<[string, string]>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve([asset.id, String(reader.result)]); reader.onerror = () => resolve([asset.id, ""]); reader.readAsDataURL(asset.file); }))).then((entries) => { if (!cancelled) setPreviews(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [assets]);

  function append(files: File[]) { onChange([...assets, ...filesToUploadAssets(files)].slice(0, maxFiles)); }
  function reorder(overId: string) {
    if (!draggedId || draggedId === overId) return;
    const from = assets.findIndex((asset) => asset.id === draggedId); const to = assets.findIndex((asset) => asset.id === overId);
    if (from < 0 || to < 0) return;
    const next = [...assets]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); onChange(next); setDraggedId(null);
  }
  function drop(event: React.DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); append(Array.from(event.dataTransfer.files)); }

  return <div><div className="flex items-baseline justify-between gap-3"><p className="text-sm font-semibold">{title}</p>{assets.length > 0 && <span className="text-xs text-[var(--text-tertiary)]">{assets.length} / {maxFiles}</span>}</div>{assets.length === 0 ? <div className={`mt-2 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-5 py-6 text-center transition ${dragging ? "border-[var(--primary)] bg-[var(--active-bg)]" : "border-[#a8c4ff] bg-[#f8fbff] hover:border-[var(--primary)]"}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}><span className="grid h-9 w-9 place-items-center rounded-md bg-[#e8f0ff] text-[var(--primary)]"><Upload size={19} /></span><span className="mt-3 text-sm font-medium">{emptyLabel}</span><span className="mt-1 text-xs text-[var(--text-secondary)]">{description}</span></div> : <div className={`mt-2 rounded-md border p-2 ${dragging ? "border-[var(--primary)] bg-[var(--active-bg)]" : "border-[#dfe5ee] bg-white"}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>{assets.map((asset, index) => <article key={asset.id} draggable onDragStart={() => setDraggedId(asset.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(asset.id)} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-[#f7f9fc]"><GripVertical size={17} className="cursor-grab text-[var(--text-tertiary)]" aria-label="拖拽排序" />{previews[asset.id] ? <Image src={previews[asset.id]} unoptimized width={46} height={46} alt="上传素材缩略图" className="h-[46px] w-[46px] shrink-0 rounded border border-[var(--border)] object-cover" /> : <span className="grid h-[46px] w-[46px] place-items-center rounded border border-[var(--border)] bg-[#f7f9fc] text-[var(--text-tertiary)]"><ImagePlus size={16} /></span>}<div className="min-w-0 flex-1"><label className="sr-only" htmlFor={`${inputId}-${asset.id}`}>素材显示名称</label><div className="flex items-center"><input id={`${inputId}-${asset.id}`} value={asset.displayName} onChange={(event) => onChange(assets.map((item) => item.id === asset.id ? { ...item, displayName: event.target.value } : item))} className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium outline-none hover:border-[var(--border)] focus:border-[var(--primary)]" /><Pencil size={13} className="text-[var(--text-tertiary)]" /></div><p className="truncate px-1 text-xs text-[var(--text-tertiary)]">原文件：{asset.originalFileName} · 图片 {index + 1}</p></div><button type="button" onClick={() => onChange(assets.filter((item) => item.id !== asset.id))} className="rounded p-1.5 text-[var(--text-tertiary)] hover:bg-[#fff1f0] hover:text-[var(--danger)]" aria-label="删除图片"><X size={16} /></button></article>)}{assets.length < maxFiles && <button type="button" onClick={() => inputRef.current?.click()} className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-[#a8c4ff] px-3 py-2.5 text-left text-sm font-medium text-[var(--primary)] hover:bg-[#f5f8ff]"><ImagePlus size={17} />继续添加图片</button>}</div>}<input ref={inputRef} id={inputId} type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { append(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></div>;
}
