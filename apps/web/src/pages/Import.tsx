import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Download, FileSpreadsheet, History, TriangleAlert, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import {
  IMPORT_MODE_LABELS,
  IMPORT_MODES,
  IMPORT_STOCK_MODE_LABELS,
  IMPORT_STOCK_MODES,
  formatCents,
  type ImportMode,
  type ImportStockMode,
} from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Checkbox, ErrorBox, Field, PageHeader, Pagination, Select, Spinner, Table, Td, Th, cx } from '../components/ui';
import { api, ApiError, download, errorMessage, saveBlob } from '../lib/api';
import { formatDateTime, formatInt } from '../lib/format';
import type { ImportJob, ImportReport, Paginated } from '../lib/types';

const FIELD_LABELS: Record<string, string> = {
  sku: 'SKU',
  barcode: 'Código de barras',
  name: 'Nome',
  description: 'Descrição',
  category: 'Categoria',
  brand: 'Marca',
  compatibleModels: 'Modelos compatíveis',
  costCents: 'Preço de custo',
  priceCents: 'Preço de venda',
  minStock: 'Estoque mínimo',
  quantity: 'Quantidade',
};

const ACTION_LABEL = { CREATE: 'Novo', UPDATE: 'Atualizar', SKIP: 'Ignorar' } as const;

function exportIssues(report: ImportReport) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['linha', 'campo', 'valor', 'mensagem', 'tipo'],
    ...report.errors.map((e) => [e.row, FIELD_LABELS[e.field ?? ''] ?? e.field, e.value, e.message, 'erro']),
    ...report.warnings.map((w) => [w.row, FIELD_LABELS[w.field ?? ''] ?? w.field, w.value, w.message, 'aviso']),
  ];
  const csv = `﻿${rows.map((r) => r.map(esc).join(';')).join('\r\n')}`;
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `erros-${report.fileName.replace(/\.[^.]+$/, '')}.csv`);
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'critical' | 'muted' }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-xs text-ink-2">{label}</div>
      <div
        className={cx(
          'tabular text-xl font-semibold',
          tone === 'critical' && value > 0 ? 'text-critical-ink' : tone === 'good' && value > 0 ? 'text-good-ink' : 'text-ink',
        )}
      >
        {formatInt(value)}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: ImportReport }) {
  const [showWarnings, setShowWarnings] = useState(false);
  const stores = report.columns.stores.map((s) => s.storeCode);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Linhas no arquivo" value={report.totalRows} />
        <Stat label={report.dryRun ? 'Serão criados' : 'Criados'} value={report.createdCount} tone="good" />
        <Stat label={report.dryRun ? 'Serão atualizados' : 'Atualizados'} value={report.updatedCount} />
        <Stat label="Ignorados" value={report.skippedCount} />
        <Stat label="Linhas com erro" value={report.errorCount} tone="critical" />
        <Stat label="Saldos por loja" value={report.stockEntries} />
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-ink-2">Colunas reconhecidas:</span>
          {Object.entries(report.columns.mapped).map(([field, header]) => (
            <Badge key={field} tone="accent">
              {FIELD_LABELS[field] ?? field} ← “{header}”
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-ink-2">Estoque por loja:</span>
          {report.columns.stores.length ? (
            report.columns.stores.map((s) => (
              <Badge key={s.storeCode} tone="good">
                {s.storeCode} ← “{s.header}”
              </Badge>
            ))
          ) : (
            <span className="text-muted">nenhuma coluna de loja</span>
          )}
          {report.columns.ignored.length > 0 && <span className="text-muted">· ignoradas: {report.columns.ignored.join(', ')}</span>}
        </div>
        <div className="text-xs text-muted">
          {report.fileType.toUpperCase()}
          {Object.entries(report.meta).map(([k, v]) => ` · ${k}: ${v}`)} · {IMPORT_MODE_LABELS[report.mode]} · {IMPORT_STOCK_MODE_LABELS[report.stockMode]} ·{' '}
          {report.durationMs} ms
        </div>
      </div>

      {report.errors.length > 0 && (
        <Card
          title={
            <span className="flex items-center gap-1.5 text-critical-ink">
              <CircleAlert className="size-4" aria-hidden /> {report.errorCount} linha(s) com erro — não serão importadas
            </span>
          }
          actions={
            <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => exportIssues(report)}>
              Baixar relatório
            </Button>
          }
        >
          <Table className="max-h-80 overflow-y-auto">
            <thead>
              <tr>
                <Th>Linha</Th>
                <Th>Campo</Th>
                <Th>Valor</Th>
                <Th>Problema</Th>
              </tr>
            </thead>
            <tbody>
              {report.errors.map((e, i) => (
                <tr key={i}>
                  <Td className="tabular">{e.row}</Td>
                  <Td className="whitespace-nowrap">{FIELD_LABELS[e.field ?? ''] ?? e.field ?? '—'}</Td>
                  <Td className="max-w-40 truncate font-mono text-xs">{e.value ?? ''}</Td>
                  <Td>{e.message}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {report.errorsTruncated && <p className="px-4 py-2 text-xs text-muted">Lista truncada — baixe o relatório completo após corrigir os primeiros.</p>}
        </Card>
      )}

      {report.warnings.length > 0 && (
        <div className="rounded-lg border border-line bg-surface">
          <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm" onClick={() => setShowWarnings((v) => !v)} aria-expanded={showWarnings}>
            <TriangleAlert className="size-4 text-warning-ink" aria-hidden />
            <span className="font-medium text-ink">{report.warnings.length} aviso(s)</span>
            <span className="text-ink-2">— não impedem a importação</span>
          </button>
          {showWarnings && (
            <ul className="max-h-60 overflow-y-auto border-t border-line px-4 py-2 text-sm">
              {report.warnings.map((w, i) => (
                <li key={i} className="py-1 text-ink-2">
                  <span className="tabular text-muted">Linha {w.row}:</span> {w.message}
                  {w.value && <span className="font-mono text-xs"> ({w.value})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {report.preview.length > 0 && (
        <Card title={`Pré-visualização (primeiras ${report.preview.length} linhas válidas)`}>
          <Table>
            <thead>
              <tr>
                <Th>Linha</Th>
                <Th>Ação</Th>
                <Th>SKU</Th>
                <Th>Nome</Th>
                <Th className="text-right">Preço</Th>
                {stores.map((code) => (
                  <Th key={code} className="text-right">
                    {code}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.preview.map((p) => (
                <tr key={p.row}>
                  <Td className="tabular text-muted">{p.row}</Td>
                  <Td>
                    <Badge tone={p.action === 'CREATE' ? 'good' : p.action === 'UPDATE' ? 'accent' : 'neutral'}>{ACTION_LABEL[p.action]}</Badge>
                  </Td>
                  <Td className="font-mono text-xs">{p.sku}</Td>
                  <Td className="max-w-72 truncate">{p.name}</Td>
                  <Td className="tabular text-right">{p.priceCents !== undefined ? formatCents(p.priceCents) : '—'}</Td>
                  {stores.map((code) => (
                    <Td key={code} className="tabular text-right">
                      {p.stock[code] ?? '—'}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function ImportHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['imports', page],
    queryFn: () => api<Paginated<ImportJob>>('/imports', { query: { page, pageSize: 10 } }),
  });
  return (
    <Card title={<span className="flex items-center gap-1.5"><History className="size-4" aria-hidden /> Histórico de importações</span>}>
      {isLoading ? (
        <Spinner />
      ) : !data?.data.length ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma importação realizada ainda</p>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Arquivo</Th>
                <Th>Usuário</Th>
                <Th className="text-right">Linhas</Th>
                <Th className="text-right">Criados</Th>
                <Th className="text-right">Atualiz.</Th>
                <Th className="text-right">Erros</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((j) => (
                <tr key={j.id}>
                  <Td className="whitespace-nowrap text-ink-2">{formatDateTime(j.createdAt)}</Td>
                  <Td className="max-w-56 truncate">{j.fileName}</Td>
                  <Td className="text-ink-2">{j.userName ?? 'CLI / sistema'}</Td>
                  <Td className="tabular text-right">{formatInt(j.totalRows)}</Td>
                  <Td className="tabular text-right">{formatInt(j.createdCount)}</Td>
                  <Td className="tabular text-right">{formatInt(j.updatedCount)}</Td>
                  <Td className="tabular text-right">{formatInt(j.errorCount)}</Td>
                  <Td>{j.status === 'COMPLETED' ? <Badge tone="good">Concluída</Badge> : <Badge tone="critical">Falhou</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

export function ImportPage() {
  const { can, stores, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<ImportMode>('UPSERT');
  const [stockMode, setStockMode] = useState<ImportStockMode>('SET');
  const [defaultStoreId, setDefaultStoreId] = useState('');
  const [strict, setStrict] = useState(false);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const form = new FormData();
      form.append('file', file!);
      form.append('mode', mode);
      form.append('stockMode', stockMode);
      form.append('dryRun', String(dryRun));
      form.append('strict', String(strict));
      if (defaultStoreId) form.append('defaultStoreId', defaultStoreId);
      try {
        return await api<ImportReport>('/imports/products', { method: 'POST', body: form });
      } catch (err) {
        // Modo estrito devolve o relatório com 422
        if (err instanceof ApiError && err.status === 422 && (err.body as ImportReport)?.totalRows !== undefined) {
          return err.body as ImportReport;
        }
        throw err;
      }
    },
    onSuccess: (report) => {
      setError(null);
      if (report.dryRun) {
        setPreview(report);
        setResult(null);
      } else {
        setResult(report);
        setPreview(null);
        qc.invalidateQueries({ queryKey: ['imports'] });
        qc.invalidateQueries({ queryKey: ['products'] });
        if (report.status === 'COMPLETED') toast(`Importação concluída: ${report.createdCount} novos, ${report.updatedCount} atualizados`);
      }
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setResult(null);
    setError(null);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  const importable = preview ? preview.createdCount + preview.updatedCount : 0;
  const canExecute = can('imports.execute');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Importação em massa de produtos"
        subtitle="Setup inicial do inventário: cadastre milhares de peças e distribua o saldo por loja a partir de CSV ou Excel"
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => download('/imports/products/template?format=xlsx', 'modelo.xlsx').catch((e) => toast(errorMessage(e), 'error'))}>
              Modelo Excel
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => download('/imports/products/template?format=csv', 'modelo.csv').catch((e) => toast(errorMessage(e), 'error'))}>
              Modelo CSV
            </Button>
          </>
        }
      />

      {canExecute && (
        <Card>
          <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cx(
                'flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
                dragging ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2',
              )}
            >
              <input ref={inputRef} type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              {file ? (
                <>
                  <FileSpreadsheet className="size-8 text-accent-ink" aria-hidden />
                  <div className="font-medium text-ink">{file.name}</div>
                  <div className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB · clique para trocar</div>
                </>
              ) : (
                <>
                  <Upload className="size-8 text-muted" aria-hidden />
                  <div className="font-medium text-ink">Arraste a planilha aqui ou clique para escolher</div>
                  <div className="text-xs text-muted">.xlsx ou .csv (separador ; ou ,) · até 15 MB</div>
                </>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <Field label="Produtos já cadastrados (mesmo SKU)">
                {(id) => (
                  <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
                    {IMPORT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {IMPORT_MODE_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Quantidades da planilha" hint={stockMode === 'SET' ? 'Reimportar o mesmo arquivo não duplica estoque' : 'Use para entrada de mercadoria'}>
                {(id) => (
                  <Select id={id} value={stockMode} onChange={(e) => setStockMode(e.target.value as ImportStockMode)}>
                    {IMPORT_STOCK_MODES.map((m) => (
                      <option key={m} value={m}>
                        {IMPORT_STOCK_MODE_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Loja para coluna única “quantidade”" hint="Só se a planilha não tiver colunas estoque_<LOJA>">
                {(id) => (
                  <Select id={id} value={defaultStoreId} onChange={(e) => setDefaultStoreId(e.target.value)}>
                    <option value="">— planilha com colunas por loja —</option>
                    {(me?.hasGlobalAccess ? stores : stores.filter((s) => s.id === me?.storeId)).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Checkbox label="Modo estrito: qualquer erro cancela a importação inteira" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
              <div className="mt-1 flex flex-wrap gap-2">
                <Button variant="primary" disabled={!file} loading={run.isPending && run.variables === true} onClick={() => run.mutate(true)}>
                  Validar planilha
                </Button>
                {preview && importable > 0 && preview.status === 'COMPLETED' && (
                  <Button variant="primary" loading={run.isPending && run.variables === false} onClick={() => run.mutate(false)}>
                    Importar {formatInt(importable)} produto(s){preview.errorCount ? ' válidos' : ''}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <details className="border-t border-line px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-ink-2">Como montar a planilha</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
              <li>
                Obrigatórias: <strong>sku</strong> e <strong>nome</strong>. Opcionais: codigo_barras, descricao, categoria, marca, modelos_compativeis, preco_custo,
                preco_venda, estoque_minimo.
              </li>
              <li>
                Uma coluna de estoque por loja: {stores.map((s) => `estoque_${s.code}`).join(', ')} (também aceita o nome da loja, ex.: “Qtd Loja Centro”). Célula
                vazia = não altera o saldo daquela loja.
              </li>
              <li>SKU ou código de barras repetido no arquivo invalida todas as ocorrências; código de barras de outro SKU já cadastrado é rejeitado.</li>
              <li>No Excel, formate a coluna de código de barras como Texto para evitar notação científica (7,89E+12).</li>
              <li>Preços aceitam 1.234,56 · 1234,56 · 1234.56 · R$ 12,50.</li>
            </ul>
          </details>
        </Card>
      )}

      {error && <ErrorBox message={error} />}
      {run.isPending && <Spinner label={run.variables ? 'Validando planilha...' : 'Importando em lote...'} />}

      {preview && !run.isPending && (
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            {preview.status === 'FAILED' ? (
              <>
                <CircleAlert className="size-5 text-critical" aria-hidden /> Modo estrito: corrija os erros antes de importar
              </>
            ) : (
              <>Pré-visualização — nada foi gravado ainda</>
            )}
          </h2>
          <ReportView report={preview} />
        </section>
      )}

      {result && !run.isPending && (
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            {result.status === 'COMPLETED' ? (
              <>
                <CheckCircle2 className="size-5 text-good" aria-hidden /> Importação concluída
              </>
            ) : (
              <>
                <CircleAlert className="size-5 text-critical" aria-hidden /> Importação não realizada (modo estrito)
              </>
            )}
          </h2>
          <ReportView report={result} />
        </section>
      )}

      {can('imports.view') && <ImportHistory />}
    </div>
  );
}
