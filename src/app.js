
import { supabase } from '../supabase.js';

/*
 * CAF SUREG-PA — app.js
 * Integração com Supabase para a estrutura:
 * instituicoes, membros_instituicao, suppliers, contracts,
 * pagamentos, pendencias e importacoes.
 *
 * Importante:
 * - Requer uma sessão autenticada do Supabase.
 * - Respeita RLS; não usa service_role nem desativa políticas.
 * - Campos avançados que ainda não existem em colunas próprias
 *   são preservados em metadados dentro de colunas de texto.
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  user: null,
  institution: null,
  role: null,
  suppliers: [],
  contracts: [],
  payments: [],
  pending: [],
  imports: [],
  importRows: [],
  importHeaders: [],
  importFilename: '',
  docsWorkbook: null,
  editing: { supplier: null, contract: null, payment: null, pending: null },
  busy: false
};

const TABLES = {
  suppliers: 'suppliers',
  contracts: 'contracts',
  payments: 'pagamentos',
  pendencias: 'pendencias',
  importacoes: 'importacoes'
};

const TITLES = {
  dashboard: 'Visão geral',
  contracts: 'Contratos',
  payments: 'Pagamentos',
  pending: 'Pendências',
  budget: 'Orçamento e PLOA',
  suppliers: 'Fornecedores',
  files: 'Importar e exportar',
  documents: 'Central de Documentos',
  settings: 'Configurações'
};

const META_START = '\n\n<!--CAF_META:';
const META_END = '-->';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num(value));
}
function dateBR(value) {
  if (!value) return '—';
  const s = String(value).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(value);
}
function monthBR(value) {
  if (!value) return '—';
  const m = String(value).match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : esc(value);
}
function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isoMonth(value) {
  if (!value) return null;
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
}
function notify(message, kind = 'info') {
  const toast = $('#toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.add('show');
    toast.dataset.kind = kind;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4500);
  } else {
    alert(message);
  }
}
function setMessage(id, message) {
  const el = document.getElementById(id);
  if (el) el.textContent = message;
}
function fail(error, prefix = 'Operação não concluída') {
  console.error(prefix, error);
  const detail = error?.message || error?.details || String(error);
  notify(`${prefix}: ${detail}`, 'error');
}
function requireWrite() {
  if (!state.user || !state.institution) throw new Error('Você precisa estar autenticado e vinculado a uma instituição.');
  if (!['administrador', 'editor'].includes(state.role)) throw new Error('Seu perfil é somente leitura.');
}
function attachInstitution(row) {
  return { ...row, instituicao_id: state.institution.id };
}
function splitMeta(text) {
  const value = String(text ?? '');
  const at = value.lastIndexOf(META_START);
  if (at < 0) return { text: value, meta: {} };
  const end = value.indexOf(META_END, at);
  if (end < 0) return { text: value, meta: {} };
  try {
    const meta = JSON.parse(value.slice(at + META_START.length, end));
    return { text: value.slice(0, at).trim(), meta: meta && typeof meta === 'object' ? meta : {} };
  } catch {
    return { text: value, meta: {} };
  }
}
function packMeta(text, meta) {
  const clean = String(text ?? '').trim();
  const filtered = Object.fromEntries(Object.entries(meta || {}).filter(([,v]) => v !== '' && v !== null && v !== undefined));
  return Object.keys(filtered).length ? `${clean}${META_START}${JSON.stringify(filtered)}${META_END}` : clean || null;
}
function contractFromDb(row) {
  const parsed = splitMeta(row.observacoes);
  return {
    ...row,
    supplier: row.fornecedor_id || '',
    processo: row.numero_processo || '',
    vigenciaInicial: row.data_inicio || '',
    vigenciaFinal: row.data_fim || '',
    valorGlobal: num(row.valor),
    observacoes: parsed.text,
    ...parsed.meta
  };
}
function paymentFromDb(row) {
  const parsed = splitMeta(row.descricao);
  return {
    ...row,
    contractId: row.contrato_id || '',
    data: row.data_pagamento || '',
    competencia: row.competencia ? String(row.competencia).slice(0,7) : '',
    valor: num(row.valor),
    notaFiscal: row.numero_documento || '',
    descricao: parsed.text,
    ...parsed.meta
  };
}
function pendingFromDb(row) {
  const parsed = splitMeta(row.descricao);
  return {
    ...row,
    contractId: row.contrato_id || '',
    competencia: parsed.meta.competencia || '',
    valor: num(parsed.meta.valor),
    referencia: parsed.meta.referencia || '',
    vencimento: row.prazo || '',
    status: row.status === 'concluida' ? 'concluido' : row.status,
    observacoes: parsed.text,
    ...parsed.meta
  };
}
function supplierFromDb(row) {
  return { ...row, cnpj: row.documento || '', observacoes: row.observacoes || '' };
}
function supplierName(id) {
  return state.suppliers.find(x => x.id === id)?.nome || 'Fornecedor não identificado';
}
function contractLabel(id) {
  const c = state.contracts.find(x => x.id === id);
  return c ? `${c.numero || 'Sem número'} — ${supplierName(c.fornecedor_id)}` : 'Contrato não identificado';
}
function contractStatus(c) {
  if (!c.data_inicio || !c.data_fim) return 'Sem vigência';
  const today = isoToday();
  if (c.data_inicio > today) return 'A iniciar';
  if (c.data_fim < today) return 'Encerrado';
  return 'Vigente';
}
function statusPill(status) {
  const s = String(status || '').toLowerCase();
  const cls = ['concluido','concluída','pago','paga','ativo','vigente','processada','concluída'].includes(s)
    ? 'good' : ['cancelado','rejeitada','encerrado','encerrada'].includes(s)
      ? 'bad' : 'warning';
  return `<span class="status-pill ${cls}">${esc(status || '—')}</span>`;
}
function emptyRow(cols, message = 'Nenhum registro encontrado.') {
  return `<tr><td colspan="${cols}" class="muted">${esc(message)}</td></tr>`;
}
function ensureLoginUI() {
  if ($('#cafAuthOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'cafAuthOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(9,28,43,.78);display:none;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <form id="cafAuthForm" style="background:#fff;color:#17384c;width:min(430px,100%);padding:28px;border-radius:16px;box-shadow:0 20px 70px #0004;font:inherit">
      <h2 style="margin:0 0 8px">Acesso ao CAF SUREG-PA</h2>
      <p style="margin:0 0 18px;color:#587184">Entre com sua conta autorizada do sistema.</p>
      <label style="display:block;margin:12px 0 5px;font-weight:700">E-mail</label>
      <input name="email" type="email" autocomplete="username" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #ccd9e2;border-radius:8px">
      <label style="display:block;margin:12px 0 5px;font-weight:700">Senha</label>
      <input name="password" type="password" autocomplete="current-password" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #ccd9e2;border-radius:8px">
      <p id="cafAuthError" role="alert" style="color:#a32626;min-height:1.3em"></p>
      <button type="submit" style="width:100%;padding:12px;border:0;border-radius:8px;background:#126da1;color:#fff;font-weight:800;cursor:pointer">Entrar</button>
      <p style="font-size:12px;color:#60798a;margin-bottom:0">Não compartilhe sua senha. O acesso depende das permissões cadastradas no Supabase.</p>
    </form>`;
