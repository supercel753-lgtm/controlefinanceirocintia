
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
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const s = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(num(value));
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

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  if (!state.user || !state.institution) {
    throw new Error('Você precisa estar autenticado e vinculado a uma instituição.');
  }

  if (!['administrador', 'editor'].includes(state.role)) {
    throw new Error('Seu perfil é somente leitura.');
  }
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

    return {
      text: value.slice(0, at).trim(),
      meta: meta && typeof meta === 'object' ? meta : {}
    };
  } catch {
    return { text: value, meta: {} };
  }
}

function packMeta(text, meta) {
  const clean = String(text ?? '').trim();

  const filtered = Object.fromEntries(
    Object.entries(meta || {}).filter(([, v]) =>
      v !== '' && v !== null && v !== undefined
    )
  );

  return Object.keys(filtered).length
    ? `${clean}${META_START}${JSON.stringify(filtered)}${META_END}`
    : clean || null;
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
    competencia: row.competencia ? String(row.competencia).slice(0, 7) : '',
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
  return {
    ...row,
    cnpj: row.documento || '',
    observacoes: row.observacoes || ''
  };
}

function supplierName(id) {
  return state.suppliers.find(x => x.id === id)?.nome || 'Fornecedor não identificado';
}

function contractLabel(id) {
  const c = state.contracts.find(x => x.id === id);

  return c
    ? `${c.numero || 'Sem número'} — ${supplierName(c.fornecedor_id)}`
    : 'Contrato não identificado';
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

  const cls = [
    'concluido',
    'concluída',
    'pago',
    'paga',
    'ativo',
    'vigente',
    'processada',
    'concluída'
  ].includes(s)
    ? 'good'
    : ['cancelado', 'rejeitada', 'encerrado', 'encerrada'].includes(s)
      ? 'bad'
      : 'warning';

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

  document.body.append(overlay);

  $('#cafAuthForm', overlay).addEventListener('submit', async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const button = $('button[type="submit"]', form);

    button.disabled = true;
    button.textContent = 'Entrando...';
    setMessage('cafAuthError', '');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value
      });

      if (error) throw error;

      form.reset();
      overlay.style.display = 'none';

      await initialize();
    } catch (error) {
      setMessage('cafAuthError', error.message || 'Não foi possível entrar.');
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });
}

function showLogin(message = '') {
  ensureLoginUI();

  const overlay = $('#cafAuthOverlay');
  overlay.style.display = 'flex';

  setMessage('cafAuthError', message);

  const app = $('.app-layout');
  if (app) app.setAttribute('aria-hidden', 'true');
}

function hideLogin() {
  const overlay = $('#cafAuthOverlay');

  if (overlay) overlay.style.display = 'none';

  const app = $('.app-layout');
  if (app) app.removeAttribute('aria-hidden');
}

async function resolveMembership() {
  const { data: memberships, error } = await supabase
    .from('membros_instituicao')
    .select('instituicao_id, papel')
    .eq('usuario_id', state.user.id);

  if (error) throw error;

  if (!memberships?.length) {
    throw new Error('Seu usuário não está vinculado a nenhuma instituição em membros_instituicao.');
  }

  const ids = memberships.map(m => m.instituicao_id);

  const { data: institutions, error: instError } = await supabase
    .from('instituicoes')
    .select('id,nome,codigo,ativa')
    .in('id', ids)
    .eq('ativa', true);

  if (instError) throw instError;

  const available = (institutions || []).map(i => ({
    ...i,
    papel: memberships.find(m => m.instituicao_id === i.id)?.papel || 'leitor'
  }));

  if (!available.length) {
    throw new Error('Há vínculo de usuário, mas nenhuma instituição ativa está acessível.');
  }

  // Seleciona a primeira instituição ativa.
  // Um seletor multi-instituição pode ser adicionado depois.
  state.institution = available[0];
  state.role = available[0].papel;
}

async function fetchTable(table, order = 'criado_em') {
  let query = supabase
    .from(table)
    .select('*')
    .eq('instituicao_id', state.institution.id);

  if (order) {
    query = query.order(order, {
      ascending: false,
      nullsFirst: false
    });
  }

  const { data, error } = await query;

  if (error) throw error;

  return data || [];
}

async function loadData() {
  const [suppliers, contracts, payments, pending, imports] = await Promise.all([
    fetchTable('suppliers'),
    fetchTable('contracts'),
    fetchTable('pagamentos'),
    fetchTable('pendencias'),
    fetchTable('importacoes')
  ]);

  state.suppliers = suppliers.map(supplierFromDb);
  state.contracts = contracts.map(contractFromDb);
  state.payments = payments.map(paymentFromDb);
  state.pending = pending.map(pendingFromDb);
  state.imports = imports;
}

async function initialize() {
  if (state.busy) return;

  state.busy = true;

  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) throw error;

    if (!data.session) {
      state.user = null;
      showLogin();
      return;
    }

    state.user = data.session.user;

    await resolveMembership();
    await loadData();

    hideLogin();
    renderAll();
    updateStorageInfo();

    notify(`Conectado: ${state.institution.nome} (${state.role}).`);
  } catch (error) {
    console.error('Inicialização do CAF falhou:', error);

    if (!state.user) {
      showLogin(error.message || 'Não foi possível validar a sessão.');
    } else {
      showFatal(error.message || 'Banco de dados indisponível.');
    }
  } finally {
    state.busy = false;
  }
}

function showFatal(message) {
  let box = $('#cafFatal');

  if (!box) {
    box = document.createElement('div');
    box.id = 'cafFatal';
    box.style.cssText = 'margin:16px;padding:14px;border:1px solid #e5b5b5;background:#fff3f3;color:#842323;border-radius:10px;white-space:pre-wrap';

    $('.main')?.prepend(box);
  }

  box.textContent = `Banco de dados indisponível — ${message}`;
}

async function reloadAndRender(successMessage) {
  await loadData();
  renderAll();
  updateStorageInfo();

  if (successMessage) notify(successMessage, 'success');
}

function updateStorageInfo() {
  const el = $('#storageInfo');

  if (el) {
    el.textContent = `Supabase conectado · ${state.institution?.nome || 'Sem instituição'} · Perfil: ${state.role || '—'} · Usuário: ${state.user?.email || state.user?.id || '—'}.`;
  }
}

function renderAll() {
  renderSuppliers();
  renderContracts();
  renderPayments();
  renderPending();
  renderDashboard();
  renderBudget();
  populateSelects();
  applyRoleUI();
}

function applyRoleUI() {
  const readOnly = !['administrador', 'editor'].includes(state.role);

  $$('button[data-action^="new-"], #confirmImport, button[data-action="delete"]').forEach(b => {
    b.disabled = readOnly;

    if (readOnly) b.title = 'Seu perfil não permite alterações.';
  });

  let account = $('#cafAccount');

  if (!account) {
    account = document.createElement('div');
    account.id = 'cafAccount';
    account.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto;font-size:12px;color:#55768c';

    $('.header-actions')?.append(account);
  }

  account.innerHTML = `<span>${esc(state.user?.email || '')} · ${esc(state.role || '')}</span><button type="button" class="btn subtle" id="cafSignOut">Sair</button>`;

  $('#cafSignOut')?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();

    if (error) return fail(error, 'Erro ao sair');

    state.user = null;
    state.institution = null;
    state.role = null;

    showLogin();
  }, { once: true });
}

function renderSuppliers() {
  const q = ($('#searchSuppliers')?.value || '').toLowerCase();

  const rows = state.suppliers.filter(s =>
    `${s.nome} ${s.documento || s.cnpj || ''}`.toLowerCase().includes(q)
  );

  setMessage('countSuppliers', `${rows.length} fornecedor(es)`);

  const tbody = $('#rowsSuppliers');
  if (!tbody) return;

  tbody.innerHTML = rows.length
    ? rows.map(s => {
      const contracts = state.contracts.filter(c => c.fornecedor_id === s.id).length;

      return `<tr>
        <td>${esc(s.nome)}</td>
        <td>${esc(s.documento || s.cnpj || '—')}</td>
        <td>${esc(s.email || s.telefone || '—')}</td>
        <td>${contracts}</td>
        <td>
          ${actionButton('edit-supplier', s.id, 'Editar')}
          ${actionButton('delete-supplier', s.id, 'Excluir', 'danger')}
        </td>
      </tr>`;
    }).join('')
    : emptyRow(5);
}

function renderContracts() {
  const q = ($('#searchContracts')?.value || '').toLowerCase();
  const statusFilter = $('#filterContractStatus')?.value || 'todos';

  const rows = state.contracts.filter(c => {
    const status = contractStatus(c);

    return `${c.numero} ${c.numero_processo} ${c.objeto} ${supplierName(c.fornecedor_id)}`.toLowerCase().includes(q)
      && (statusFilter === 'todos' || status === statusFilter);
  });

  setMessage('countContracts', `${rows.length} contrato(s)`);

  const tbody = $('#rowsContracts');
  if (!tbody) return;

  tbody.innerHTML = rows.length
    ? rows.map(c => `<tr>
      <td>
        <strong>${esc(c.numero || 'Sem número')}</strong><br>
        <small>${esc(c.numero_processo || '')}</small>
      </td>
      <td>${esc(supplierName(c.fornecedor_id))}</td>
      <td>${dateBR(c.data_inicio)} – ${dateBR(c.data_fim)}</td>
      <td>${money(c.valor)}</td>
      <td>${statusPill(contractStatus(c))}</td>
      <td>
        ${actionButton('edit-contract', c.id, 'Editar')}
        ${actionButton('delete-contract', c.id, 'Excluir', 'danger')}
      </td>
    </tr>`).join('')
    : emptyRow(6);
}

function renderPayments() {
  const q = ($('#searchPayments')?.value || '').toLowerCase();
  const month = $('#filterPaymentMonth')?.value || '';

  const rows = state.payments.filter(p =>
    `${supplierName(state.contracts.find(c => c.id === p.contrato_id)?.fornecedor_id)} ${contractLabel(p.contrato_id)} ${p.numero_documento} ${p.descricao}`.toLowerCase().includes(q)
    && (!month || String(p.competencia || '').startsWith(month))
  );

  setMessage('countPayments', `${rows.length} pagamento(s)`);

  const tbody = $('#rowsPayments');
  if (!tbody) return;

  tbody.innerHTML = rows.length
    ? rows.map(p => `<tr>
      <td>${dateBR(p.data_pagamento)}</td>
      <td>${esc(contractLabel(p.contrato_id))}</td>
      <td>${monthBR(p.competencia)}</td>
      <td>${esc(p.numero_documento || p.descricao || '—')}</td>
      <td>${money(p.valor)}</td>
      <td>
        ${actionButton('edit-payment', p.id, 'Editar')}
        ${actionButton('delete-payment', p.id, 'Excluir', 'danger')}
      </td>
    </tr>`).join('')
    : emptyRow(6);
}

function renderPending() {
  const q = ($('#searchPending')?.value || '').toLowerCase();
  const filter = $('#filterPendingStatus')?.value || 'aberto';

  const rows = state.pending.filter(p => {
    const done = ['concluido', 'concluida', 'resolvida', 'resolvido']
      .includes(String(p.status).toLowerCase());

    return `${p.titulo} ${p.descricao} ${p.referencia} ${contractLabel(p.contrato_id)}`.toLowerCase().includes(q)
      && (filter === 'todos' || (filter === 'concluido' ? done : !done));
  });

  setMessage('countPending', `${rows.length} pendência(s)`);

  const box = $('#pendingCards');
  if (!box) return;

  box.innerHTML = rows.length
    ? rows.map(p => `<article class="pending-card">
      <div>
        <strong>${esc(p.titulo || contractLabel(p.contrato_id))}</strong>
        <p>${esc(p.descricao || p.observacoes || '')}</p>
        <small>${esc(contractLabel(p.contrato_id))} · Prazo: ${dateBR(p.prazo)}</small>
      </div>
      <div>
        <strong>${money(p.valor)}</strong><br>
        ${statusPill(p.status)}
        <div class="button-row">
          ${actionButton('edit-pending', p.id, 'Editar')}
          ${actionButton('toggle-pending', p.id, p.status === 'concluido' ? 'Reabrir' : 'Concluir')}
          ${actionButton('delete-pending', p.id, 'Excluir', 'danger')}
        </div>
      </div>
    </article>`).join('')
    : `<p class="muted">Nenhuma pendência encontrada.</p>`;
}

function renderDashboard() {
  const active = state.contracts.filter(c => contractStatus(c) === 'Vigente');

  const paid = state.payments.filter(p =>
    String(p.data_pagamento || '').startsWith('2026')
  );

  const open = state.pending.filter(p =>
    !['concluido', 'concluida', 'resolvida', 'resolvido']
      .includes(String(p.status).toLowerCase())
  );

  const ploa = state.contracts.reduce((sum, c) => sum + num(c.ploa2026), 0);
  const paidTotal = paid.reduce((sum, p) => sum + num(p.valor), 0);
  const pendingTotal = open.reduce((sum, p) => sum + num(p.valor), 0);

  setMessage('kpiActive', active.length);
  setMessage('kpiActiveSub', `${state.contracts.length} contratos cadastrados`);
  setMessage('kpiPaid', money(paidTotal));
  setMessage('kpiPaidSub', `${paid.length} pagamentos registrados em 2026`);
  setMessage('kpiPending', money(pendingTotal));
  setMessage('kpiPendingSub', `${open.length} registros pendentes`);
  setMessage('kpiPloa', money(ploa));
  setMessage('kpiPloaSub', 'Planejamento contratual informado');

  const recentPayments = $('#recentPayments');

  if (recentPayments) {
    const recent = [...state.payments]
      .sort((a, b) => String(b.data_pagamento || '').localeCompare(String(a.data_pagamento || '')))
      .slice(0, 5);

    recentPayments.innerHTML = recent.length
      ? recent.map(p => `<div class="mini-row">
          <span>${esc(contractLabel(p.contrato_id))}<small>${dateBR(p.data_pagamento)}</small></span>
          <strong>${money(p.valor)}</strong>
        </div>`).join('')
      : '<p class="muted">Nenhum pagamento cadastrado.</p>';
  }

  const recentPending = $('#recentPending');

  if (recentPending) {
    const recent = open.slice(0, 5);

    recentPending.innerHTML = recent.length
      ? recent.map(p => `<div class="mini-row">
          <span>${esc(p.titulo || contractLabel(p.contrato_id))}<small>Prazo: ${dateBR(p.prazo)}</small></span>
          <strong>${money(p.valor)}</strong>
        </div>`).join('')
      : '<p class="muted">Nenhuma pendência em aberto.</p>';
  }

  renderMonthlyChart();
  renderStatusChart();
}

function renderMonthlyChart() {
  const box = $('#monthlyChart');
  if (!box) return;

  const now = new Date();
  const months = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    months.push({
      key,
      label: d.toLocaleDateString('pt-BR', { month: 'short' }),
      paid: 0,
      open: 0
    });
  }

  for (const p of state.payments) {
    const key = String(p.data_pagamento || '').slice(0, 7);
    const m = months.find(x => x.key === key);

    if (m) m.paid += num(p.valor);
  }

  for (const p of state.pending) {
    if (['concluido', 'concluida', 'resolvida', 'resolvido']
      .includes(String(p.status).toLowerCase())) continue;

    const key = String(p.prazo || p.competencia || '').slice(0, 7);
    const m = months.find(x => x.key === key);

    if (m) m.open += num(p.valor);
  }

  const max = Math.max(1, ...months.flatMap(m => [m.paid, m.open]));

  box.innerHTML = months.map(m => `<div class="bar-group" title="${m.key}">
    <div class="bar-pair">
      <span class="bar-paid" style="height:${Math.max(2, m.paid / max * 100)}%" title="Pagos: ${money(m.paid)}"></span>
      <span class="bar-open" style="height:${Math.max(2, m.open / max * 100)}%" title="Pendentes: ${money(m.open)}"></span>
    </div>
    <small>${esc(m.label)}</small>
  </div>`).join('');
}

function renderStatusChart() {
  const counts = {
    'Vigente': 0,
    'A iniciar': 0,
    'Encerrado': 0,
    'Sem vigência': 0
  };

  state.contracts.forEach(c => counts[contractStatus(c)]++);

  const total = state.contracts.length;
  const donut = $('#statusDonut');
  const legend = $('#statusLegend');

  if (donut) {
    const parts = Object.entries(counts).filter(([, v]) => v > 0);
    let cursor = 0;

    const colors = ['#21865a', '#df9c34', '#c64d4d', '#8b78bb'];

    const stops = parts.map(([k, v]) => {
      const start = cursor;
      cursor += total ? v / total * 100 : 0;

      return `${colors[Object.keys(counts).indexOf(k)]} ${start}% ${cursor}%`;
    });

    donut.style.background = total
      ? `conic-gradient(${stops.join(',')})`
      : '#e5edf2';

    donut.innerHTML = `<span>${total}<small>contratos</small></span>`;
  }

  if (legend) {
    legend.innerHTML = Object.entries(counts)
      .map(([k, v]) => `<div><span>${esc(k)}</span><strong>${v}</strong></div>`)
      .join('');
  }
}

function renderBudget() {
  const tbody = $('#rowsBudget');

  const totalPloa = state.contracts.reduce((s, c) => s + num(c.ploa2026), 0);

  const paid = state.payments
    .filter(p => String(p.data_pagamento || '').startsWith('2026'))
    .reduce((s, p) => s + num(p.valor), 0);

  const percent = totalPloa ? paid / totalPloa * 100 : 0;

  setMessage('budgetPercent', totalPloa
    ? `${percent.toFixed(1).replace('.', ',')}%`
    : '—');

  const bar = $('#budgetBar');

  if (bar) {
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  const summary = $('#budgetSummary');

  if (summary) {
    summary.innerHTML = `
      <article class="summary-card"><span>PLOA informado</span><strong>${money(totalPloa)}</strong></article>
      <article class="summary-card"><span>Pago em 2026</span><strong>${money(paid)}</strong></article>
      <article class="summary-card"><span>Contratos</span><strong>${state.contracts.length}</strong></article>`;
  }

  if (tbody) {
    tbody.innerHTML = state.contracts.length
      ? state.contracts.map(c => {
        const cp = state.payments
          .filter(p => p.contrato_id === c.id && String(p.data_pagamento || '').startsWith('2026'))
          .reduce((s, p) => s + num(p.valor), 0);

        return `<tr>
          <td>${esc(supplierName(c.fornecedor_id))}<br><small>${esc(c.numero || '')}</small></td>
          <td>${money(c.totalGasto2025 || 0)}</td>
          <td>${money(c.ploa2026 || 0)}</td>
          <td>${money(cp)}</td>
          <td>${num(c.ploa2026) ? (cp / num(c.ploa2026) * 100).toFixed(1).replace('.', ',') + '%' : '—'}</td>
          <td>${actionButton('edit-contract', c.id, 'Editar')}</td>
        </tr>`;
      }).join('')
      : emptyRow(6);
  }
}

function populateSelects() {
  const supplierSelect = $('#contractSupplier');

  if (supplierSelect) {
    const old = supplierSelect.value;

    supplierSelect.innerHTML = '<option value="">Selecione um fornecedor</option>' +
      state.suppliers.map(s => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join('');

    if (old) supplierSelect.value = old;
  }

  $$('[data-contract-select]').forEach(select => {
    const old = select.value;

    select.innerHTML = '<option value="">Selecione um contrato</option>' +
      state.contracts.map(c => `<option value="${esc(c.id)}">${esc(c.numero || 'Sem número')} — ${esc(supplierName(c.fornecedor_id))}</option>`).join('');

    if (old) select.value = old;
  });
}

function actionButton(action, id, label, kind = '') {
  return `<button type="button" class="btn ${kind === 'danger' ? 'subtle' : 'secondary'}" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button> `;
}

function showView(view) {
  if (!TITLES[view]) return;

  $$('.view').forEach(section => {
    section.hidden = section.id !== `view-${view}`;
  });

  $$('.nav-link').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  setMessage('pageTitle', TITLES[view]);
}

function formObject(form) {
  const fd = new FormData(form);

  return Object.fromEntries(
    [...fd.entries()].map(([k, v]) => [
      k,
      typeof v === 'string' ? v.trim() : v
    ])
  );
}

function fillForm(form, values = {}) {
  for (const element of form.elements) {
    if (!element.name) continue;

    const value = values[element.name];
    if (value === undefined || value === null) continue;

    element.value = value;
  }
}

function numericFields(obj, names) {
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== '') {
      obj[name] = num(obj[name]);
    }
  }
}

function openDialog(type, id = null) {
  requireWrite();

  const form = $(`#${type}Form`);
  const dialog = $(`#${type}Dialog`);

  if (!form || !dialog) return;

  state.editing[type] = id;

  form.reset();
  populateSelects();

  const record = id ? ({
    supplier: state.suppliers.find(x => x.id === id),
    contract: state.contracts.find(x => x.id === id),
    payment: state.payments.find(x => x.id === id),
    pending: state.pending.find(x => x.id === id)
  })[type] : null;

  if (record) {
    let values = { ...record };

    if (type === 'supplier') {
      values = { ...record, cnpj: record.documento || record.cnpj };
    }

    if (type === 'contract') {
      values = {
        ...record,
        supplier: record.fornecedor_id,
        processo: record.numero_processo,
        vigenciaInicial: record.data_inicio,
        vigenciaFinal: record.data_fim,
        valorGlobal: record.valor
      };
    }

    if (type === 'payment') {
      values = {
        ...record,
        contractId: record.contrato_id,
        data: record.data_pagamento,
        competencia: record.competencia ? String(record.competencia).slice(0, 7) : '',
        notaFiscal: record.numero_documento
      };
    }

    if (type === 'pending') {
      values = {
        ...record,
        contractId: record.contrato_id,
        vencimento: record.prazo,
        competencia: record.competencia || '',
        status: record.status === 'concluida' ? 'concluido' : record.status
      };
    }

    fillForm(form, values);
  } else {
    if (type === 'payment') form.elements.data.value = isoToday();

    if (type === 'pending') {
      form.elements.competencia.value = isoToday().slice(0, 7);
      form.elements.status.value = 'aberto';
    }
  }

  setMessage(
    `${type}DialogTitle`,
    `${record ? 'Editar' : 'Novo'} ${{ supplier: 'fornecedor', contract: 'contrato', payment: 'pagamento', pending: 'pendência' }[type]}`
  );

  dialog.showModal();
}

async function saveSupplier(form) {
  requireWrite();

  const v = formObject(form);
  const id = state.editing.supplier;

  const row = attachInstitution({
    nome: v.nome,
    documento: v.cnpj.replace(/\D/g, '') || null,
    tipo_documento: 'CNPJ',
    telefone: v.telefone || null,
    email: v.email || null,
    observacoes: v.observacoes || null,
    ...(id ? {} : { criado_por: state.user.id })
  });

  delete row.instituicao_id;
  row.instituicao_id = state.institution.id;

  const result = id
    ? await supabase.from('suppliers').update(row)
      .eq('id', id)
      .eq('instituicao_id', state.institution.id)
      .select()
      .single()
    : await supabase.from('suppliers').insert(row).select().single();

  if (result.error) throw result.error;

  $('#supplierDialog').close();

  await reloadAndRender('Fornecedor salvo com sucesso.');
}

async function saveContract(form) {
  requireWrite();

  const v = formObject(form);

  numericFields(v, [
    'valorGlobal',
    'custoPosto',
    'gastoAnual2025',
    'ploa2026',
    'postos',
    'salario',
    'encargos',
    'materiais',
    'gastoMensal2025',
    'totalGasto2025',
    'qtdAtual',
    'qtdAnalise'
  ]);

  const meta = {};

  for (const key of [
    'custoPosto',
    'gastoAnual2025',
    'ploa2026',
    'unidade',
    'tipo',
    'modalidade',
    'nd',
    'gestor',
    'fiscalAdm',
    'fiscalTecnico',
    'suplente',
    'garantia',
    'tipoCusto',
    'categoria',
    'postos',
    'salario',
    'encargos',
    'materiais',
    'gastoMensal2025',
    'totalGasto2025',
    'qtdAtual',
    'qtdAnalise'
  ]) {
    if (v[key] !== undefined && v[key] !== '') meta[key] = v[key];
  }

  const id = state.editing.contract;

  const row = {
    instituicao_id: state.institution.id,
    fornecedor_id: v.supplier || null,
    numero: v.numero || '',
    numero_processo: v.processo || null,
    objeto: v.objeto || null,
    valor: num(v.valorGlobal),
    data_inicio: v.vigenciaInicial || null,
    data_fim: v.vigenciaFinal || null,
    status: 'ativo',
    observacoes: packMeta(v.observacoes, meta),
    ...(id ? {} : { criado_por: state.user.id })
  };

  const result = id
    ? await supabase.from('contracts').update(row)
      .eq('id', id)
      .eq('instituicao_id', state.institution.id)
      .select()
      .single()
    : await supabase.from('contracts').insert(row).select().single();

  if (result.error) throw result.error;

  $('#contractDialog').close();

  await reloadAndRender('Contrato salvo com sucesso.');
}

async function savePayment(form) {
  requireWrite();

  const v = formObject(form);

  const meta = {
    empenho: v.empenho || '',
    processoPagamento: v.processoPagamento || ''
  };

  const id = state.editing.payment;

  const row = {
    instituicao_id: state.institution.id,
    contrato_id: v.contractId,
    numero_documento: v.notaFiscal || null,
    descricao: packMeta(v.descricao, meta) || '',
    valor: num(v.valor),
    competencia: isoMonth(v.competencia),
    data_pagamento: v.data || null,
    status: 'pago',
    criado_por: state.user.id
  };

  const result = id
    ? await supabase.from('pagamentos').update(row)
      .eq('id', id)
      .eq('instituicao_id', state.institution.id)
      .select()
      .single()
    : await supabase.from('pagamentos').insert(row).select().single();

  if (result.error) throw result.error;

  $('#paymentDialog').close();

  await reloadAndRender('Pagamento salvo com sucesso.');
}

async function savePending(form) {
  requireWrite();

  const v = formObject(form);
  const id = state.editing.pending;
  const contract = state.contracts.find(c => c.id === v.contractId);

  const meta = {
    competencia: v.competencia || '',
    valor: num(v.valor),
    referencia: v.referencia || ''
  };

  const row = {
    instituicao_id: state.institution.id,
    contrato_id: v.contractId || null,
    fornecedor_id: contract?.fornecedor_id || null,
    titulo: `Pendência — ${contract?.numero || 'Contrato'}`,
    descricao: packMeta(v.observacoes, meta),
    categoria: 'financeira',
    prioridade: 'normal',
    status: v.status === 'concluido' ? 'concluida' : 'aberta',
    prazo: v.vencimento || null,
    resolvida_em: v.status === 'concluido' ? new Date().toISOString() : null,
    criado_por: state.user.id
  };

  const result = id
    ? await supabase.from('pendencias').update(row)
      .eq('id', id)
      .eq('instituicao_id', state.institution.id)
      .select()
      .single()
    : await supabase.from('pendencias').insert(row).select().single();

  if (result.error) throw result.error;

  $('#pendingDialog').close();

  await reloadAndRender('Pendência salva com sucesso.');
}

async function deleteRecord(type, id) {
  requireWrite();

  const config = {
    supplier: { table: 'suppliers', label: 'fornecedor' },
    contract: { table: 'contracts', label: 'contrato' },
    payment: { table: 'pagamentos', label: 'pagamento' },
    pending: { table: 'pendencias', label: 'pendência' }
  }[type];

  if (!config || !confirm(`Excluir este ${config.label}? Esta ação não pode ser desfeita.`)) {
    return;
  }

  const { error } = await supabase
    .from(config.table)
    .delete()
    .eq('id', id)
    .eq('instituicao_id', state.institution.id);

  if (error) throw error;

  await reloadAndRender(`${config.label[0].toUpperCase() + config.label.slice(1)} excluído.`);
}

async function togglePending(id) {
  requireWrite();

  const p = state.pending.find(x => x.id === id);
  if (!p) return;

  const done = p.status !== 'concluido';

  const { error } = await supabase
    .from('pendencias')
    .update({
      status: done ? 'concluida' : 'aberta',
      resolvida_em: done ? new Date().toISOString() : null
    })
    .eq('id', id)
    .eq('instituicao_id', state.institution.id);

  if (error) throw error;

  await reloadAndRender(done ? 'Pendência concluída.' : 'Pendência reaberta.');
}

function csvParse(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';

  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length
    ? ';'
    : ((first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',');

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === sep && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;

      row.push(cell);

      if (row.some(v => String(v).trim() !== '')) rows.push(row);

      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);

    if (row.some(v => String(v).trim() !== '')) rows.push(row);
  }

  return rows;
}

function normHeader(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getCell(row, headers, ...names) {
  const indexes = new Map(headers.map((h, i) => [normHeader(h), i]));

  for (const name of names) {
    const index = indexes.get(normHeader(name));

    if (index !== undefined) return String(row[index] ?? '').trim();
  }

  return '';
}

function parseCsvFile(file) {
  return file.text().then(text => {
    const all = csvParse(text);

    if (all.length < 2) {
      throw new Error('O arquivo precisa ter cabeçalho e pelo menos uma linha.');
    }

    state.importHeaders = all[0].map(v => String(v).replace(/^\uFEFF/, '').trim());

    state.importRows = all.slice(1).map(values =>
      Object.fromEntries(state.importHeaders.map((h, i) => [h, values[i] ?? '']))
    );

    state.importFilename = file.name;

    renderImportPreview();
  });
}

function renderImportPreview() {
  const preview = $('#importPreview');
  if (!preview) return;

  preview.hidden = false;

  const summary = $('#importSummary');

  if (summary) {
    summary.innerHTML = `
      <article class="summary-card"><span>Arquivo</span><strong>${esc(state.importFilename)}</strong></article>
      <article class="summary-card"><span>Linhas</span><strong>${state.importRows.length}</strong></article>
      <article class="summary-card"><span>Destino</span><strong>${esc($('#importType')?.value || '')}</strong></article>`;
  }

  const table = $('#previewTable');

  if (table) {
    const headers = state.importHeaders.slice(0, 8);

    table.innerHTML = `
      <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${state.importRows.slice(0, 12).map(row =>
        `<tr>${headers.map(h => `<td>${esc(row[h])}</td>`).join('')}</tr>`
      ).join('')}</tbody>`;
  }

  setMessage(
    'importErrors',
    state.importRows.length > 12
      ? `Prévia das primeiras 12 linhas de ${state.importRows.length}.`
      : ''
  );

  setMessage('importMessage', 'Confira os dados antes de confirmar. A gravação será feita no Supabase.');
}

async function importRecords() {
  requireWrite();

  if (!state.importRows.length) {
    throw new Error('Nenhum registro para importar.');
  }

  const type = $('#importType').value;
  const now = new Date().toISOString();

  const importRow = {
    instituicao_id: state.institution.id,
    arquivo_nome: state.importFilename || 'importacao.csv',
    formato: (state.importFilename.split('.').pop() || 'csv').toLowerCase(),
    sistema_origem: 'Importação manual',
    modulo_destino: type,
    status: 'processando',
    total_linhas: state.importRows.length,
    criado_por: state.user.id,
    iniciado_em: now
  };

  const created = await supabase
    .from('importacoes')
    .insert(importRow)
    .select()
    .single();

  if (created.error) throw created.error;

  let inserted = 0;
  let rejected = 0;

  const errors = [];

  for (let index = 0; index < state.importRows.length; index++) {
    const raw = state.importRows[index];

    try {
      const h = Object.keys(raw);
      let row;

      if (type === 'suppliers') {
        const values = h.map(k => raw[k]);

        const nome = getCell(values, h, 'nome', 'razao social', 'fornecedor', 'empresa');

        if (!nome) throw new Error('Nome/razão social ausente');

        row = {
          instituicao_id: state.institution.id,
          nome,
          documento: getCell(values, h, 'cnpj', 'documento').replace(/\D/g, '') || null,
          tipo_documento: 'CNPJ',
          email: getCell(values, h, 'email') || null,
          telefone: getCell(values, h, 'telefone', 'contato') || null,
          observacoes: getCell(values, h, 'observacoes', 'observações') || null,
          criado_por: state.user.id
        };
      } else if (type === 'contracts') {
        const values = h.map(k => raw[k]);

        const numero = getCell(values, h, 'numero', 'numero contrato', 'contrato');
        const processo = getCell(values, h, 'processo', 'numero processo');

        const nomeFornecedor = getCell(
          values, h, 'fornecedor', 'empresa', 'razao social', 'nome fornecedor'
        );

        const supplier = state.suppliers.find(s =>
          normHeader(s.nome) === normHeader(nomeFornecedor)
          || normHeader(s.documento) === normHeader(getCell(values, h, 'cnpj'))
        );

        if (!numero && !processo) {
          throw new Error('Número do contrato ou processo ausente');
        }

        row = {
          instituicao_id: state.institution.id,
          fornecedor_id: supplier?.id || null,
          numero: numero || processo,
          numero_processo: processo || null,
          objeto: getCell(values, h, 'objeto') || null,
          valor: num(getCell(values, h, 'valor', 'valor global', 'valorglobal')),
          data_inicio: getCell(values, h, 'vigencia inicial', 'data inicio', 'inicio') || null,
          data_fim: getCell(values, h, 'vigencia final', 'data fim', 'fim') || null,
          status: 'ativo',
          observacoes: getCell(values, h, 'observacoes', 'observações') || null,
          criado_por: state.user.id
        };
      } else if (type === 'payments') {
        const values = h.map(k => raw[k]);

        const proc = getCell(values, h, 'processo', 'numero processo');
        const numContrato = getCell(values, h, 'contrato', 'numero contrato', 'numero');

        const contract = state.contracts.find(c =>
          (proc && normHeader(c.numero_processo) === normHeader(proc))
          || (numContrato && normHeader(c.numero) === normHeader(numContrato))
        );

        if (!contract) {
          throw new Error('Contrato não localizado pelo número/processo');
        }

        const date = getCell(values, h, 'data', 'data pagamento', 'datapagamento');

        row = {
          instituicao_id: state.institution.id,
          contrato_id: contract.id,
          numero_documento: getCell(values, h, 'nota fiscal', 'nf', 'notafiscal') || null,
          descricao: getCell(values, h, 'descricao', 'descrição', 'referencia') || '',
          valor: num(getCell(values, h, 'valor', 'valor pago')),
          competencia: isoMonth(getCell(values, h, 'competencia')),
          data_pagamento: date || null,
          status: 'pago',
          criado_por: state.user.id
        };
      } else {
        const values = h.map(k => raw[k]);

        const proc = getCell(values, h, 'processo', 'numero processo');
        const numContrato = getCell(values, h, 'contrato', 'numero contrato', 'numero');

        const contract = state.contracts.find(c =>
          (proc && normHeader(c.numero_processo) === normHeader(proc))
          || (numContrato && normHeader(c.numero) === normHeader(numContrato))
        );

        const title = getCell(values, h, 'titulo', 'pendencia', 'pendência', 'descricao', 'descrição');

        if (!title && !contract) {
          throw new Error('Título ou contrato ausente');
        }

        row = {
          instituicao_id: state.institution.id,
          contrato_id: contract?.id || null,
          fornecedor_id: contract?.fornecedor_id || null,
          titulo: title || `Pendência — ${contract?.numero || 'Contrato'}`,
          descricao: getCell(values, h, 'observacoes', 'observações')
            || getCell(values, h, 'descricao', 'descrição')
            || null,
          categoria: getCell(values, h, 'categoria') || 'financeira',
          prioridade: getCell(values, h, 'prioridade') || 'normal',
          status: getCell(values, h, 'status') || 'aberta',
          prazo: getCell(values, h, 'prazo', 'vencimento') || null,
          criado_por: state.user.id
        };
      }

      const result = await supabase.from(TABLES[type]).insert(row);

      if (result.error) throw result.error;

      inserted++;
    } catch (error) {
      rejected++;

      errors.push({
        linha: index + 2,
        erro: error.message || String(error)
      });
    }
  }

  const status = rejected
    ? (inserted ? 'parcial' : 'falhou')
    : 'concluida';

  const update = await supabase
    .from('importacoes')
    .update({
      status,
      total_linhas: state.importRows.length,
      linhas_importadas: inserted,
      linhas_rejeitadas: rejected,
      resumo: {
        destino: type,
        arquivo: state.importFilename
      },
      erros: errors,
      finalizado_em: new Date().toISOString()
    })
    .eq('id', created.data.id)
    .eq('instituicao_id', state.institution.id);

  if (update.error) throw update.error;

  await reloadAndRender(`Importação concluída: ${inserted} gravados, ${rejected} rejeitados.`);

  setMessage(
    'importErrors',
    errors.slice(0, 30).map(e => `Linha ${e.linha}: ${e.erro}`).join('\n') || 'Nenhum erro.'
  );

  setMessage('importMessage', `Importação: ${inserted} gravados e ${rejected} rejeitados.`);

  $('#importPreview').hidden = true;

  state.importRows = [];
  state.importHeaders = [];
}

function downloadText(name, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob(['\ufeff', text], { type });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');

  a.href = url;
  a.download = name;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv(type) {
  const rows = ({
    suppliers: state.suppliers.map(s => ({
      nome: s.nome,
      cnpj: s.documento || s.cnpj,
      email: s.email,
      telefone: s.telefone,
      observacoes: s.observacoes
    })),

    contracts: state.contracts.map(c => ({
      numero: c.numero,
      processo: c.numero_processo,
      fornecedor: supplierName(c.fornecedor_id),
      objeto: c.objeto,
      valor: c.valor,
      data_inicio: c.data_inicio,
      data_fim: c.data_fim,
      observacoes: c.observacoes
    })),

    payments: state.payments.map(p => ({
      contrato: contractLabel(p.contrato_id),
      data: p.data_pagamento,
      competencia: p.competencia,
      notaFiscal: p.numero_documento,
      valor: p.valor,
      descricao: p.descricao
    })),

    pendencias: state.pending.map(p => ({
      titulo: p.titulo,
      contrato: contractLabel(p.contrato_id),
      prazo: p.prazo,
      status: p.status,
      valor: p.valor,
      observacoes: p.observacoes
    }))
  })[type] || [];

  const headers = rows.length
    ? Object.keys(rows[0])
    : ({
      suppliers: ['nome', 'cnpj', 'email', 'telefone', 'observacoes'],
      contracts: ['numero', 'processo', 'fornecedor', 'objeto', 'valor', 'data_inicio', 'data_fim'],
      payments: ['contrato', 'data', 'competencia', 'notaFiscal', 'valor', 'descricao'],
      pendencias: ['titulo', 'contrato', 'prazo', 'status', 'valor', 'observacoes']
    })[type];

  const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const text = [
    headers.map(csvCell).join(';'),
    ...rows.map(r => headers.map(h => csvCell(r[h])).join(';'))
  ].join('\r\n');

  downloadText(
    `caf-suregpa-${type}-${isoToday()}.csv`,
    text,
    'text/csv;charset=utf-8'
  );
}

function downloadTemplate(type) {
  const templates = {
    suppliers: 'nome;cnpj;email;telefone;observacoes\nEmpresa Exemplo;00000000000100;contato@example.com;51999999999;',
    contracts: 'numero;processo;fornecedor;objeto;valor;data_inicio;data_fim;observacoes\n001/2026;00000.000000/2026-00;Empresa Exemplo;Serviço de exemplo;1000;2026-01-01;2026-12-31;',
    payments: 'contrato;data;competencia;notaFiscal;valor;descricao\n001/2026;2026-02-10;2026-01;NF-001;100;Pagamento exemplo',
    pendencias: 'titulo;contrato;prazo;status;observacoes\nConferir documento;001/2026;2026-03-10;aberta;Exemplo'
  };

  downloadText(
    `modelo-${type}.csv`,
    templates[type] || '',
    'text/csv;charset=utf-8'
  );
}

async function restoreBackup(file) {
  requireWrite();

  const data = JSON.parse(await file.text());

  if (!data || typeof data !== 'object') {
    throw new Error('Backup inválido.');
  }

  if (!confirm('Restaurar este backup? Registros com o mesmo ID serão atualizados; outros serão adicionados.')) {
    return;
  }

  const mapping = [
    [
      'suppliers',
      data.suppliers,
      items => items.map(s => ({
        id: s.id,
        instituicao_id: state.institution.id,
        nome: s.nome,
        documento: s.documento || s.cnpj || null,
        tipo_documento: s.tipo_documento || 'CNPJ',
        email: s.email || null,
        telefone: s.telefone || null,
        observacoes: s.observacoes || null
      }))
    ],
    [
      'contracts',
      data.contracts,
      items => items.map(c => ({
        id: c.id,
        instituicao_id: state.institution.id,
        fornecedor_id: c.fornecedor_id || c.supplier || null,
        numero: c.numero || '',
        numero_processo: c.numero_processo || c.processo || null,
        objeto: c.objeto || null,
        valor: num(c.valor ?? c.valorGlobal),
        data_inicio: c.data_inicio || c.vigenciaInicial || null,
        data_fim: c.data_fim || c.vigenciaFinal || null,
        status: 'ativo',
        observacoes: c.observacoes || null
      }))
    ],
    [
      'pagamentos',
      data.payments,
      items => items.map(p => ({
        id: p.id,
        instituicao_id: state.institution.id,
        contrato_id: p.contrato_id || p.contractId,
        numero_documento: p.numero_documento || p.notaFiscal || null,
        descricao: p.descricao || '',
        valor: num(p.valor),
        competencia: isoMonth(p.competencia),
        data_pagamento: p.data_pagamento || p.data || null,
        status: 'pago'
      }))
    ],
    [
      'pendencias',
      data.pending || data.pendencias,
      items => items.map(p => ({
        id: p.id,
        instituicao_id: state.institution.id,
        contrato_id: p.contrato_id || p.contractId || null,
        titulo: p.titulo || 'Pendência importada',
        descricao: p.descricao || p.observacoes || null,
        categoria: p.categoria || 'financeira',
        prioridade: p.prioridade || 'normal',
        status: p.status || 'aberta',
        prazo: p.prazo || p.vencimento || null
      }))
    ]
  ];

  for (const [table, source, mapper] of mapping) {
    if (!Array.isArray(source) || !source.length) continue;

    const rows = mapper(source).filter(r => r.id);

    if (!rows.length) continue;

    const { error } = await supabase
      .from(table)
      .upsert(rows, { onConflict: 'id' });

    if (error) throw error;
  }

  await reloadAndRender('Backup restaurado.');
}

function updateCct() {
  const form = $('#contractForm');
  if (!form) return;

  const salary = num(form.elements.salario?.value);
  const charges = num(form.elements.encargos?.value);
  const posts = num(form.elements.postos?.value);
  const materials = num(form.elements.materiais?.value);

  const estimate = salary * (1 + charges / 100) * posts + materials;

  const el = $('#cctEstimate');
  if (el) el.value = money(estimate);
}

async function handleAction(button) {
  const { action, id } = button.dataset;

  if (action === 'new-supplier') return openDialog('supplier');
  if (action === 'new-contract') return openDialog('contract');
  if (action === 'new-payment') return openDialog('payment');
  if (action === 'new-pending') return openDialog('pending');

  if (action === 'edit-supplier') return openDialog('supplier', id);
  if (action === 'edit-contract') return openDialog('contract', id);
  if (action === 'edit-payment') return openDialog('payment', id);
  if (action === 'edit-pending') return openDialog('pending', id);

  if (action === 'delete-supplier') return deleteRecord('supplier', id);
  if (action === 'delete-contract') return deleteRecord('contract', id);
  if (action === 'delete-payment') return deleteRecord('payment', id);
  if (action === 'delete-pending') return deleteRecord('pending', id);

  if (action === 'toggle-pending') return togglePending(id);
}

function wireEvents() {
  document.addEventListener('click', async event => {
    const viewBtn = event.target.closest('[data-view]');

    if (viewBtn) {
      showView(viewBtn.dataset.view);
      return;
    }

    const close = event.target.closest('[data-close]');

    if (close) {
      document.getElementById(close.dataset.close)?.close();
      return;
    }

    const action = event.target.closest('[data-action]');

    if (action) {
      try {
        await handleAction(action);
      } catch (error) {
        fail(error, 'Não foi possível executar a ação');
      }

      return;
    }

    const exportBtn = event.target.closest('[data-export]');

    if (exportBtn) {
      exportCsv(exportBtn.dataset.export);
      return;
    }

    const templateBtn = event.target.closest('[data-template]');

    if (templateBtn) {
      downloadTemplate(templateBtn.dataset.template);
      return;
    }
  });

  $('#supplierForm')?.addEventListener('submit', async e => {
    e.preventDefault();

    try {
      await saveSupplier(e.currentTarget);
    } catch (err) {
      fail(err, 'Erro ao salvar fornecedor');
    }
  });

  $('#contractForm')?.addEventListener('submit', async e => {
    e.preventDefault();

    try {
      await saveContract(e.currentTarget);
    } catch (err) {
      fail(err, 'Erro ao salvar contrato');
    }
  });

  $('#paymentForm')?.addEventListener('submit', async e => {
    e.preventDefault();

    try {
      await savePayment(e.currentTarget);
    } catch (err) {
      fail(err, 'Erro ao salvar pagamento');
    }
  });

  $('#pendingForm')?.addEventListener('submit', async e => {
    e.preventDefault();

    try {
      await savePending(e.currentTarget);
    } catch (err) {
      fail(err, 'Erro ao salvar pendência');
    }
  });

  [
    'searchSuppliers',
    'searchContracts',
    'searchPayments',
    'searchPending',
    'filterContractStatus',
    'filterPaymentMonth',
    'filterPendingStatus'
  ].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderAll);
    document.getElementById(id)?.addEventListener('change', renderAll);
  });

  $('#clearPaymentFilters')?.addEventListener('click', () => {
    $('#searchPayments').value = '';
    $('#filterPaymentMonth').value = '';
    renderPayments();
  });

  $('#contractForm')?.addEventListener('input', updateCct);

  $('#chooseCsv')?.addEventListener('click', () => $('#csvFile')?.click());
  $('#csvDropzone')?.addEventListener('click', () => $('#csvFile')?.click());

  $('#csvDropzone')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('#csvFile')?.click();
    }
  });

  $('#csvDropzone')?.addEventListener('dragover', e => {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
  });

  $('#csvDropzone')?.addEventListener('dragleave', e => {
    e.currentTarget.classList.remove('dragover');
  });

  $('#csvDropzone')?.addEventListener('drop', e => {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');

    const f = e.dataTransfer.files[0];
    if (f) handleCsv(f);
  });

  $('#csvFile')?.addEventListener('change', e => {
    if (e.target.files[0]) handleCsv(e.target.files[0]);
  });

  $('#cancelImport')?.addEventListener('click', () => {
    $('#importPreview').hidden = true;
    state.importRows = [];
  });

  $('#confirmImport')?.addEventListener('click', async () => {
    const b = $('#confirmImport');
    b.disabled = true;

    try {
      await importRecords();
    } catch (e) {
      fail(e, 'Falha na importação');
    } finally {
      b.disabled = false;
    }
  });

  $('#backupButton')?.addEventListener('click', () => {
    downloadText(
      `backup-caf-suregpa-${isoToday()}.json`,
      JSON.stringify({
        exportadoEm: new Date().toISOString(),
        instituicao: state.institution,
        suppliers: state.suppliers,
        contracts: state.contracts,
        payments: state.payments,
        pending: state.pending
      }, null, 2),
      'application/json'
    );
  });

  $('#restoreButton')?.addEventListener('click', () => $('#restoreFile')?.click());

  $('#restoreFile')?.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;

    try {
      await restoreBackup(f);
    } catch (err) {
      fail(err, 'Falha ao restaurar backup');
    } finally {
      e.target.value = '';
    }
  });

  $('#docsChoose')?.addEventListener('click', () => $('#docsFile')?.click());
  $('#docsDropzone')?.addEventListener('click', () => $('#docsFile')?.click());

  $('#docsDropzone')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('#docsFile')?.click();
    }
  });

  $('#docsDropzone')?.addEventListener('dragover', e => {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
  });

  $('#docsDropzone')?.addEventListener('dragleave', e => {
    e.currentTarget.classList.remove('dragover');
  });

  $('#docsDropzone')?.addEventListener('drop', e => {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');

    const f = e.dataTransfer.files[0];
    if (f) handleDocument(f);
  });

  $('#docsFile')?.addEventListener('change', e => {
    if (e.target.files[0]) handleDocument(e.target.files[0]);
  });

  $('#docsClear')?.addEventListener('click', clearDocument);

  $('#docsToImporter')?.addEventListener('click', () => {
    const rows = state.docsWorkbook?.rows;

    if (!rows?.length) return notify('Não há tabela para importar.');

    const headers = rows[0].map((v, i) => String(v || `coluna_${i + 1}`));

    state.importHeaders = headers;

    state.importRows = rows
      .slice(1)
      .filter(r => r.some(v => String(v ?? '').trim()))
      .map(r => Object.fromEntries(
        headers.map((h, i) => [h, String(r[i] ?? '')])
      ));

    state.importFilename = state.docsWorkbook.filename;
    $('#importType').value = $('#docsTarget').value;

    renderImportPreview();
    showView('files');
  });

  $('#docsCopy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#docsText').value);
      notify('Texto copiado.');
    } catch (e) {
      fail(e, 'Não foi possível copiar');
    }
  });

  $('#docsExportText')?.addEventListener('click', () => {
    downloadText('texto-extraido.txt', $('#docsText').value);
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      state.user = null;
      state.institution = null;
      state.role = null;
      showLogin();
    }

    if (event === 'SIGNED_IN' && session?.user) {
      state.user = session.user;
      initialize();
    }
  });
}

async function handleCsv(file) {
  try {
    if (!/\.(csv|txt)$/i.test(file.name)) {
      throw new Error('Selecione um arquivo CSV ou TXT tabular.');
    }

    await parseCsvFile(file);
  } catch (error) {
    fail(error, 'Não foi possível ler o arquivo');
  }
}

function clearDocument() {
  state.docsWorkbook = null;
  $('#docsResult').hidden = true;
  $('#docsFile').value = '';

  setMessage('docsMessage', 'Selecione um documento para visualizar o conteúdo.');
}

async function handleDocument(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  setMessage('docsMessage', `Lendo ${file.name}...`);

  $('#docsResult').hidden = false;
  $('#docsFilename').textContent = file.name;
  $('#docsMetadata').textContent = `${ext.toUpperCase()} · ${(file.size / 1024).toFixed(1)} KB`;
  $('#docsSpreadsheet').hidden = true;
  $('#docsTextResult').hidden = true;

  try {
    if (['csv', 'txt'].includes(ext)) {
      const text = await file.text();

      if (
        ext === 'csv'
        || text.split(/\r?\n/)[0].includes(';')
        || text.split(/\r?\n/)[0].includes('\t')
      ) {
        const rows = csvParse(text);
        showSpreadsheet(rows, file.name);
      } else {
        showExtractedText(text, file.name);
      }
    } else if (['xlsx', 'xls'].includes(ext)) {
      const XLSX = await import('https://esm.sh/xlsx@0.18.5');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });

      state.docsWorkbook = {
        filename: file.name,
        sheets: wb.SheetNames,
        book: wb
      };

      const select = $('#docsSheetSelect');

      select.innerHTML = wb.SheetNames
        .map((n, i) => `<option value="${i}">${esc(n)}</option>`)
        .join('');

      select.onchange = () => renderWorkbookSheet(Number(select.value));

      renderWorkbookSheet(0);

      $('#docsSpreadsheet').hidden = false;

      setMessage(
        'docsMessage',
        'Planilha carregada. Confira a aba e envie ao importador quando estiver pronta.'
      );
    } else if (ext === 'pdf') {
      const pdfjs = await import('https://esm.sh/pdfjs-dist@4.4.168/legacy/build/pdf.mjs');

      const pdf = await pdfjs.getDocument({
        data: await file.arrayBuffer()
      }).promise;

      let text = '';

      for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();

        text += `\n--- Página ${i} ---\n`
          + content.items.map(x => x.str || '').join(' ')
          + '\n';
      }

      showExtractedText(text, file.name);

      setMessage(
        'docsMessage',
        pdf.numPages > 50
          ? 'PDF lido parcialmente (limite de 50 páginas).'
          : 'PDF lido no navegador; documentos digitalizados podem exigir OCR.'
      );
    } else if (ext === 'docx') {
      const mammoth = await import('https://esm.sh/mammoth@1.8.0');

      const result = await mammoth.extractRawText({
        arrayBuffer: await file.arrayBuffer()
      });

      showExtractedText(result.value, file.name);

      setMessage('docsMessage', 'Texto do Word extraído no navegador.');
    } else {
      throw new Error('Formato não suportado.');
    }
  } catch (error) {
    setMessage('docsMessage', `Erro ao ler documento: ${error.message || error}`);
    console.error(error);
  }
}

function renderWorkbookSheet(index) {
  if (!state.docsWorkbook?.book) return;

  const XLSXPromise = import('https://esm.sh/xlsx@0.18.5');

  XLSXPromise.then(XLSX => {
    const name = state.docsWorkbook.book.SheetNames[index];

    const rows = XLSX.utils.sheet_to_json(
      state.docsWorkbook.book.Sheets[name],
      { header: 1, defval: '' }
    );

    state.docsWorkbook.rows = rows;

    showSpreadsheet(rows, state.docsWorkbook.filename);

    $('#docsSpreadsheet').hidden = false;

    setMessage(
      'docsSheetInfo',
      `${name} · ${Math.max(0, rows.length - 1)} linha(s) aproximadas`
    );
  }).catch(error => {
    setMessage('docsMessage', `Erro ao mostrar aba: ${error.message}`);
  });
}

function showSpreadsheet(rows, filename) {
  state.docsWorkbook = {
    ...(state.docsWorkbook || {}),
    filename,
    rows
  };

  const table = $('#docsTable');
  const headers = rows[0] || [];

  table.innerHTML = `
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(1, 101).map(row =>
      `<tr>${headers.map((_, i) => `<td>${esc(row[i] ?? '')}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;

  $('#docsSpreadsheet').hidden = false;
  $('#docsTextResult').hidden = true;
  $('#docsResult').hidden = false;

  const sheet = $('#docsSheetSelect');

  if (sheet && !sheet.options.length) {
    sheet.innerHTML = '<option value="0">Planilha</option>';
  }

  setMessage(
    'docsSheetInfo',
    `${Math.max(0, rows.length - 1)} linha(s); prévia limitada a 100 linhas.`
  );
}

function showExtractedText(text, filename) {
  $('#docsSpreadsheet').hidden = true;
  $('#docsTextResult').hidden = false;
  $('#docsText').value = text;

  const cnpj = [...text.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)]
    .map(m => m[0]);

  const processes = [...text.matchAll(/\b\d{5,}\.\d{6}\/\d{4}-\d{2}\b/g)]
    .map(m => m[0]);

  const values = [...text.matchAll(/R\$\s?[\d.]+,\d{2}/g)]
    .map(m => m[0]);

  const dates = [...text.matchAll(/\b\d{2}\/\d{2}\/\d{4}\b/g)]
    .map(m => m[0]);

  const groups = [
    ['CNPJs', cnpj],
    ['Processos', processes],
    ['Datas', dates],
    ['Valores', values]
  ];

  $('#docsDetected').innerHTML = groups.map(([label, items]) => `
    <div class="docs-found-item">
      <strong>${label} (${items.length})</strong>
      <span>${esc([...new Set(items)].slice(0, 10).join(', ') || 'Nenhum identificado')}</span>
    </div>`).join('');

  setMessage(
    'docsTextNote',
    'Extração automática simples; confira os dados antes de utilizá-los.'
  );

  setMessage('docsMessage', `Texto extraído de ${filename}.`);
}

function start() {
  wireEvents();
  showView('dashboard');
  ensureLoginUI();
  initialize();
}

start();
