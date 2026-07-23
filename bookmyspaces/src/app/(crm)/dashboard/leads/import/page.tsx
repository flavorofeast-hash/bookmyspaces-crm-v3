'use client';

// app/dashboard/leads/import/page.tsx
// Excel Lead Import UI — Phase 6.1

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface ImportError {
  row: number;
  errors: string[];
  data: Record<string, string>;
}

interface ImportSummary {
  totalRows: number;
  inserted: number;
  skipped: number;
  invalid: number;
}

interface ImportHistory {
  id: string;
  filename: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  status: string;
  created_at: string;
}

export default function LeadImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{ summary: ImportSummary; errors: ImportError[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportHistory[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  }, []);

  const handleFileSelect = (f: File) => {
    setFile(f);
    setResult(null);
    setUploadError(null);
  };

  const loadHistory = async () => {
    if (historyLoaded) return;
    const res = await fetch('/api/leads/import');
    const data = await res.json();
    if (data.imports) {
      setHistory(data.imports);
      setHistoryLoaded(true);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    setResult(null);

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/leads/import', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error || 'Upload failed');
      } else {
        setResult({ summary: data.summary, errors: data.errors || [] });
        setHistoryLoaded(false); // refresh history next time
        setFile(null);
      }
    } catch {
      setUploadError('Network error. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const downloadTemplate = () => {
    // Column order matches excel-parser.ts's valid.push() field order:
    // name, phone, email, company, source, notes, city, state, country,
    // address, date_of_visit, birthday, anniversary, preferred_channel.
    const csv = `Name,Phone,Email,Company,Source,Notes,City,State,Country,Address,Date of Visit,Birthday,Anniversary,Preferred Channel\nJohn Doe,9876543210,john@example.com,Acme Corp,referral,Interested in conference room,Mumbai,Maharashtra,India,123 MG Road,2026-08-15,1990-05-20,2015-11-10,whatsapp\nJane Smith,+919123456789,,,,Follow up next week,,,,,,,,`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white font-mono">
      {/* Header */}
      <div className="border-b border-white/10 px-8 py-5 flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push('/dashboard/leads')}
            className="text-white/40 hover:text-white/70 text-sm mb-1 block transition-colors"
          >
            ← Back to Leads
          </button>
          <h1 className="text-xl font-bold tracking-tight">
            Lead Import
            <span className="ml-3 text-xs font-normal text-emerald-400 border border-emerald-400/30 px-2 py-0.5 rounded-full">
              Phase 6.1
            </span>
          </h1>
        </div>
        <button
          onClick={downloadTemplate}
          className="text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/30 px-4 py-2 rounded-lg transition-all"
        >
          ↓ Download Template
        </button>
      </div>

      <div className="px-8 py-8 max-w-4xl">

        {/* Drop Zone */}
        <div
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer mb-6
            ${isDragging
              ? 'border-emerald-400 bg-emerald-400/5'
              : file
              ? 'border-emerald-500/50 bg-emerald-500/5'
              : 'border-white/10 hover:border-white/25 bg-white/2'
            }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
  const selected = e.target.files?.[0];

  if (selected) {
    handleFileSelect(selected);
  }

  // allow re-selecting same file
  e.currentTarget.value = '';
}}
          />

          {file ? (
            <div>
              <div className="text-3xl mb-3">📊</div>
              <div className="text-emerald-400 font-semibold">{file.name}</div>
              <div className="text-white/40 text-sm mt-1">
                {(file.size / 1024).toFixed(1)} KB · Click to change
              </div>
            </div>
          ) : (
            <div>
              <div className="text-4xl mb-4 opacity-40">⬆</div>
              <div className="text-white/60 text-sm">
                Drop your Excel or CSV file here
              </div>
              <div className="text-white/30 text-xs mt-2">
                .xlsx · .xls · .csv · Max 5MB
              </div>
            </div>
          )}
        </div>

        {/* Column Guide */}
        <div className="bg-white/3 border border-white/8 rounded-xl p-5 mb-6">
          <div className="text-xs text-white/40 uppercase tracking-widest mb-3">Expected Columns</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { col: 'Name', req: true, note: 'Full name' },
              { col: 'Phone', req: true, note: '10-digit or +91 format' },
              { col: 'Email', req: false, note: 'Optional' },
              { col: 'Company', req: false, note: 'Optional' },
              { col: 'Source', req: false, note: 'Defaults to excel_import' },
              { col: 'Notes', req: false, note: 'Optional remarks' },
              { col: 'City', req: false, note: 'Optional' },
              { col: 'State', req: false, note: 'Optional' },
              { col: 'Country', req: false, note: 'Optional' },
              { col: 'Address', req: false, note: 'Optional' },
              { col: 'Date of Visit', req: false, note: 'Optional, e.g. 2026-08-15' },
              { col: 'Birthday', req: false, note: 'Optional, e.g. 1990-05-20' },
              { col: 'Anniversary', req: false, note: 'Optional, e.g. 2015-11-10' },
              { col: 'Preferred Channel', req: false, note: 'Optional' },
            ].map(({ col, req, note }) => (
              <div key={col} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${req ? 'bg-emerald-400' : 'bg-white/20'}`} />
                <div>
                  <span className="text-white/80">{col}</span>
                  {req && <span className="text-emerald-400 ml-1">*</span>}
                  <div className="text-white/30">{note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Error Message */}
        {uploadError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4 mb-6 text-sm text-red-400">
            ⚠ {uploadError}
          </div>
        )}

        {/* Upload Button */}
        {file && !result && (
          <button
            onClick={handleUpload}
            disabled={isUploading}
            className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⟳</span> Processing...
              </span>
            ) : (
              `Upload & Import ${file.name}`
            )}
          </button>
        )}

        {/* Success Result */}
        {result && (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6">
              <div className="text-emerald-400 font-bold mb-4">✓ Import Complete</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total Rows', value: result.summary.totalRows, color: 'text-white' },
                  { label: 'Imported', value: result.summary.inserted, color: 'text-emerald-400' },
                  { label: 'Skipped (dup)', value: result.summary.skipped, color: 'text-yellow-400' },
                  { label: 'Invalid', value: result.summary.invalid, color: 'text-red-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                    <div className={`text-2xl font-bold ${color}`}>{value}</div>
                    <div className="text-white/40 text-xs mt-1">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Validation Errors */}
            {result.errors.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-5">
                <div className="text-red-400 text-sm font-semibold mb-3">
                  Invalid Rows ({result.errors.length} shown)
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <div key={i} className="text-xs bg-white/3 rounded-lg px-3 py-2">
                      <span className="text-white/40">Row {err.row}:</span>{' '}
                      <span className="text-red-300">{err.errors.join(' · ')}</span>
                      {err.data.name && <span className="text-white/30 ml-2">({err.data.name})</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setResult(null); setFile(null); }}
                className="flex-1 py-3 rounded-xl border border-white/10 hover:border-white/25 text-sm text-white/60 hover:text-white transition-all"
              >
                Import Another File
              </button>
              <button
                onClick={() => router.push('/dashboard/leads')}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium transition-all"
              >
                View All Leads →
              </button>
            </div>
          </div>
        )}

        {/* Import History */}
        <div className="mt-10">
          <button
            onClick={loadHistory}
            className="text-xs text-white/30 hover:text-white/60 transition-colors mb-4 block"
          >
            {historyLoaded ? '▼' : '▶'} Import History
          </button>

          {historyLoaded && (
            <div className="space-y-2">
              {history.length === 0 ? (
                <div className="text-white/20 text-sm text-center py-6">No imports yet</div>
              ) : (
                history.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between bg-white/3 border border-white/8 rounded-lg px-4 py-3 text-xs"
                  >
                    <div>
                      <div className="text-white/70 font-medium">{h.filename}</div>
                      <div className="text-white/30 mt-0.5">
                        {new Date(h.created_at).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="text-emerald-400">{h.valid_rows} added</div>
                        {h.invalid_rows > 0 && (
                          <div className="text-red-400">{h.invalid_rows} invalid</div>
                        )}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full border text-xs
                        ${h.status === 'completed'
                          ? 'border-emerald-500/30 text-emerald-400'
                          : h.status === 'failed'
                          ? 'border-red-500/30 text-red-400'
                          : 'border-yellow-500/30 text-yellow-400'
                        }`}>
                        {h.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
