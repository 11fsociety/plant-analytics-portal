<script lang="ts">
  import { upload } from '@vercel/blob/client';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  type Row = {
    name: string;
    size: number;
    status: 'queued' | 'uploading' | 'parsing' | 'done' | 'error';
    progress: number;
    kind?: string;
    inserted?: number;
    skipped?: number;
    error?: string;
    file: File;
  };

  let rows: Row[] = [];
  let busy = false;

  // Plant selector state — slug is lowercase to match backend + nav + dashboard.
  // Display name is derived (Title-cased for UI).
  type PlantSlug = 'navratan' | 'uniworth';
  $: currentPlant = ($page.url.searchParams.get('plant') || 'navratan') as PlantSlug;
  const PLANT_LABEL: Record<PlantSlug, string> = { navratan: 'Navratan', uniworth: 'Uniworth' };
  const PLANT_COLOR: Record<PlantSlug, string> = { navratan: '#21b573', uniworth: '#3d7de6' };

  function setPlant(plant: PlantSlug) {
    const url = new URL($page.url);
    url.searchParams.set('plant', plant);
    goto(url.pathname + '?' + url.searchParams.toString(), { replaceState: true, noScroll: true });
  }

  function pickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next = Array.from(list).map((f) => ({
      name: f.name,
      size: f.size,
      status: 'queued' as const,
      progress: 0,
      file: f,
    }));
    rows = [...rows, ...next];
  }

  function onFileChange(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    pickFiles(target.files);
  }

  // Drag and drop handlers with folder recursion support.
  let dragging = false;

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragging = false;
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;

    if (!e.dataTransfer) return;

    const items = e.dataTransfer.items;
    const files: File[] = [];

    // If browser supports DataTransferItemList and webkitGetAsEntry, use it for folder recursion.
    if (items && items.length > 0 && 'webkitGetAsEntry' in items[0]) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
      await Promise.all(entries.map((entry) => collectFiles(entry, files)));
    } else {
      // Fallback: flat file list.
      const fileList = e.dataTransfer.files;
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (file.name.match(/\.(xlsx|xls)$/i)) files.push(file);
      }
    }

    if (files.length > 0) {
      const next = files.map((f) => ({
        name: f.name,
        size: f.size,
        status: 'queued' as const,
        progress: 0,
        file: f,
      }));
      rows = [...rows, ...next];
    }
  }

  // Recursively collect all .xlsx/.xls files from a FileSystemEntry (folder or file).
  async function collectFiles(entry: FileSystemEntry, out: File[]): Promise<void> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      if (entry.name.match(/\.(xlsx|xls)$/i)) {
        const file = await new Promise<File>((resolve) => fileEntry.file(resolve));
        out.push(file);
      }
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const entries = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve));
      await Promise.all(entries.map((e) => collectFiles(e, out)));
    }
  }

  function yyyymm(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async function fetchIngestLog(): Promise<any[]> {
    const res = await fetch(`/api/data?plant=${currentPlant}`);
    if (!res.ok) return [];
    const j = await res.json();
    return j.ingest_log || [];
  }

  async function processOne(i: number, priorLog: any[]) {
    rows[i].status = 'uploading';
    rows[i].progress = 5;
    rows = rows;
    try {
      const pathname = `raw/${currentPlant}/${yyyymm()}/${rows[i].file.name}`;
      await upload(pathname, rows[i].file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        clientPayload: JSON.stringify({ plant: currentPlant }),
        onUploadProgress: (p) => {
          rows[i].progress = Math.max(5, Math.round(p.percentage * 0.85));
          rows = rows;
        },
      });
      rows[i].status = 'parsing';
      rows[i].progress = 92;
      rows = rows;

      // Poll /api/data for a new ingest_log entry matching our filename.
      // Horizon = 5 min to match the /api/upload maxDuration=300s ceiling.
      const beforeAt = priorLog[0]?.at || '';
      const startedAt = Date.now();
      const HORIZON_MS = 5 * 60_000;
      const INTERVAL_MS = 3000;
      const maxIters = Math.ceil(HORIZON_MS / INTERVAL_MS);
      for (let k = 0; k < maxIters; k++) {
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
        const log = await fetchIngestLog();
        const latest = log.find(
          (e: any) => e.filename === rows[i].file.name || e.filename?.endsWith(rows[i].file.name),
        );
        if (latest && latest.at !== beforeAt && new Date(latest.at).getTime() > startedAt - 30_000) {
          if (latest.kind === 'unrecognized') {
            rows[i].status = 'error';
            rows[i].error = 'unrecognized schema';
          } else {
            rows[i].status = 'done';
            rows[i].progress = 100;
            rows[i].kind = latest.kind;
            rows[i].inserted = latest.inserted;
            rows[i].skipped = latest.skipped;
          }
          rows = rows;
          return;
        }
      }
      rows[i].status = 'error';
      rows[i].error = 'Upload landed in Blob but ingest did not confirm within 5 min. The server function may have timed out; retry, or check the server logs.';
      rows = rows;
    } catch (e: any) {
      rows[i].status = 'error';
      rows[i].error = e?.message || String(e);
      rows = rows;
    }
  }

  async function uploadAll() {
    if (busy || rows.length === 0) return;
    busy = true;
    const priorLog = await fetchIngestLog();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].status === 'done') continue;
      await processOne(i, priorLog);
    }
    busy = false;
  }

  function clearDone() {
    rows = rows.filter((r) => r.status !== 'done');
  }

  $: pending = rows.filter((r) => r.status === 'queued' || r.status === 'error').length;
</script>

<svelte:head>
  <title>Upload · Plant Analytics Portal</title>
</svelte:head>

<h1>Upload XLSX</h1>
<p class="page-subtitle">
  Drop production, downtime or scrap workbooks. Kind is auto-detected.
  Files stream <strong>directly to Blob storage</strong> (no 4.5 MB server body cap).
  Row-hash dedup makes re-uploads safe. Raw XLSX auto-delete from <code>raw/</code> after 7 days.
</p>

<!-- Plant selector -->
<div class="plant-selector">
  <button
    class="plant-btn"
    class:active={currentPlant === 'navratan'}
    on:click={() => setPlant('navratan')}
  >
    <span class="plant-dot" style="background: {PLANT_COLOR.navratan};"></span>
    {PLANT_LABEL.navratan}
  </button>
  <button
    class="plant-btn"
    class:active={currentPlant === 'uniworth'}
    on:click={() => setPlant('uniworth')}
  >
    <span class="plant-dot" style="background: {PLANT_COLOR.uniworth};"></span>
    {PLANT_LABEL.uniworth}
  </button>
</div>

<label
  class="drop-zone"
  class:dragging
  on:dragover={onDragOver}
  on:dragleave={onDragLeave}
  on:drop={onDrop}
>
  <input
    type="file"
    accept=".xlsx,.xls"
    multiple
    on:change={onFileChange}
  />
  <div class="drop-inner">
    <div class="drop-icon">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    </div>
    <div class="drop-title">Choose XLSX / XLS files</div>
    <div class="drop-sub">or drag & drop (Ctrl/⌘-click for multiple)</div>
  </div>
</label>

{#if rows.length > 0}
  <div class="action-row">
    <button class="btn" on:click={uploadAll} disabled={busy || pending === 0}>
      {busy ? 'Working…' : `Upload ${pending} file${pending === 1 ? '' : 's'}`}
    </button>
    {#if rows.some((r) => r.status === 'done')}
      <button class="btn secondary" on:click={clearDone} disabled={busy}>Clear done</button>
    {/if}
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>File</th>
          <th class="num">Size</th>
          <th style="width:26%">Progress</th>
          <th>Status</th>
          <th>Kind</th>
          <th class="num">Inserted</th>
          <th class="num">Dedup</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r}
          <tr>
            <td>{r.name}</td>
            <td class="num">{(r.size / 1024).toFixed(0)} KB</td>
            <td>
              <div class="progress-bar"><div class="progress-fill" style="width: {r.progress}%"></div></div>
            </td>
            <td>
              {#if r.status === 'done'}
                <span class="badge ok">Done</span>
              {:else if r.status === 'error'}
                <span class="badge err" title={r.error}>{r.error || 'error'}</span>
              {:else if r.status === 'uploading'}
                <span class="badge run"><span class="spinner"></span> Uploading</span>
              {:else if r.status === 'parsing'}
                <span class="badge run"><span class="spinner"></span> Parsing on server</span>
              {:else}
                <span class="badge muted">Queued</span>
              {/if}
            </td>
            <td>{r.kind ?? '-'}</td>
            <td class="num">{r.inserted ?? '-'}</td>
            <td class="num">{r.skipped ?? '-'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .plant-selector {
    display: flex;
    gap: 8px;
    margin: 20px 0;
    padding: 4px;
    background: var(--panel);
    border-radius: 12px;
    border: 1px solid var(--panel-border);
    width: fit-content;
  }
  .plant-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .plant-btn:hover { background: var(--panel-2); color: var(--highlight); }
  .plant-btn.active { background: var(--accent); color: white; }
  .plant-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .drop-zone {
    display: block;
    background: var(--panel);
    border: 2px dashed var(--accent);
    border-radius: 16px;
    padding: 36px;
    text-align: center;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.15s;
  }
  .drop-zone:hover { background: var(--panel-2); transform: translateY(-1px); }
  .drop-zone.dragging {
    border-color: var(--success);
    background: var(--success-bg);
  }
  .drop-zone input[type='file'] { display: none; }
  .drop-icon {
    width: 60px; height: 60px;
    margin: 0 auto 10px;
    display: flex; align-items: center; justify-content: center;
    color: var(--accent);
    background: var(--success-bg);
    border-radius: 14px;
  }
  .drop-title { color: var(--highlight); font-weight: 600; font-size: 15px; }
  .drop-sub { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .progress-bar { background: var(--panel-2); height: 8px; border-radius: 999px; overflow: hidden; border: 1px solid var(--panel-border); }
  .progress-fill { background: linear-gradient(90deg, var(--accent), var(--success)); height: 100%; transition: width 0.3s ease-out; }

  .action-row { display: flex; gap: 10px; margin: 20px 0 12px; }
  .table-wrap { overflow-x: auto; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; }
  .badge.ok { color: var(--success); background: var(--success-bg); }
  .badge.err { color: var(--danger); background: var(--danger-bg); }
  .badge.run { color: var(--info); background: var(--info-bg); }
  .badge.muted { color: var(--muted); background: var(--panel-2); border: 1px solid var(--panel-border); }
</style>
