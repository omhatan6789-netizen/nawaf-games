import { useState } from 'react';
import { Check, Copy, Download, FolderArchive, X } from 'lucide-react';
import {
  buildStandaloneGravityHtml,
  MINI_APP_INDEX_PATCH,
  MINI_APP_SERVER_PATCH,
  ONLINE_MODE_PY_PATCH,
} from '../game/exportMiniApp';

interface GitHubExportModalProps {
  open: boolean;
  onClose: () => void;
}

export async function downloadZipFromEndpoint(endpoint: string, filename: string) {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error('تعذر تحميل ملف ZIP');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function GitHubExportModal({ open, onClose }: GitHubExportModalProps) {
  const [tab, setTab] = useState<'html' | 'index' | 'server' | 'online'>('html');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<'project' | 'addon' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const htmlCode = buildStandaloneGravityHtml();
  const activeCode =
    tab === 'html'
      ? htmlCode
      : tab === 'index'
      ? MINI_APP_INDEX_PATCH
      : tab === 'server'
      ? MINI_APP_SERVER_PATCH
      : ONLINE_MODE_PY_PATCH;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore if clipboard unavailable
    }
  };

  const handleDownloadHtml = () => {
    const blob = new Blob([htmlCode], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gravity.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleZip = async (kind: 'project' | 'addon') => {
    setErrorMsg(null);
    setDownloading(kind);
    try {
      if (kind === 'project') {
        await downloadZipFromEndpoint('/api/export/project.zip', 'gravity-game-project.zip');
      } else {
        await downloadZipFromEndpoint('/api/export/nawaf-addon.zip', 'nawaf-bot-v2-gravity-addon.zip');
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'تعذر تحميل الملف');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-label="إضافة اللعبة لمشروع GitHub"
    >
      <div className="nawaf-panel w-full max-w-2xl p-5 flex flex-col gap-4 max-h-[90dvh]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-white m-0">
              ملفات المشروع وكود الإضافة (nawaf-bot-v2)
            </h2>
            <p className="text-xs text-white/70 m-0 mt-1">
              حمّل ملفات المشروع كاملة بصيغة ZIP أو انسخ التعديلات لمشروعك
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nawaf-pill flex items-center justify-center w-9 h-9 p-0"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ZIP Downloads */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => handleZip('project')}
            className="nawaf-primary flex items-center justify-center gap-2 !min-h-[48px] !text-sm disabled:opacity-60"
          >
            <FolderArchive className="w-4 h-4" />
            <span>
              {downloading === 'project'
                ? 'جاري ضغط المشروع...'
                : 'تحميل المشروع كامل (ZIP)'}
            </span>
          </button>
          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => handleZip('addon')}
            className="nawaf-choice flex items-center justify-center gap-2 !min-h-[48px] px-3 !text-sm disabled:opacity-60"
          >
            <Download className="w-4 h-4 text-[#ff9ba3]" />
            <span>
              {downloading === 'addon'
                ? 'جاري تجهيز الملفات...'
                : 'تحميل إضافة البوت فقط (ZIP)'}
            </span>
          </button>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-center text-xs font-extrabold text-rose-200">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab('html')}
            className={`nawaf-choice px-3 py-2 text-xs whitespace-nowrap ${
              tab === 'html' ? 'active' : ''
            }`}
          >
            1. mini_app/gravity.html
          </button>
          <button
            type="button"
            onClick={() => setTab('index')}
            className={`nawaf-choice px-3 py-2 text-xs whitespace-nowrap ${
              tab === 'index' ? 'active' : ''
            }`}
          >
            2. mini_app/index.html
          </button>
          <button
            type="button"
            onClick={() => setTab('server')}
            className={`nawaf-choice px-3 py-2 text-xs whitespace-nowrap ${
              tab === 'server' ? 'active' : ''
            }`}
          >
            3. mini_app_server.py
          </button>
          <button
            type="button"
            onClick={() => setTab('online')}
            className={`nawaf-choice px-3 py-2 text-xs whitespace-nowrap ${
              tab === 'online' ? 'active' : ''
            }`}
          >
            4. games/online_mode.py
          </button>
        </div>

        <pre
          dir="ltr"
          className="flex-1 min-h-0 overflow-auto rounded-xl border border-white/15 bg-[#0c0507] p-3 text-xs text-rose-100/90 leading-relaxed font-mono m-0"
        >
          <code>{activeCode}</code>
        </pre>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleDownloadHtml}
            className="nawaf-secondary flex items-center justify-center gap-2 !min-h-[44px] !text-sm"
          >
            <Download className="w-4 h-4" />
            <span>تحميل gravity.html فقط</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="nawaf-secondary flex items-center justify-center gap-2 !min-h-[44px] !text-sm"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'تم النسخ!' : 'نسخ الكود المحدد'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
