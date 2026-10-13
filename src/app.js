"use strict";

/*
  CAF SUREG-PA — Gestão Financeira
  
*/

(() => {
  const YEAR = 2026;
  const TYPES = ["suppliers", "contracts", "payments", "pendencias"];

  const $ = id => document.getElementById(id);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const emptyDB = () => ({
    suppliers: [],
    contracts: [],
    payments: [],
    pendencias: []
  });

  const clone = obj => JSON.parse(JSON.stringify(obj));

  const uuid = () =>
    crypto.randomUUID?.() ||
    `caf-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  const norm = value =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const canon = value =>
    norm(value).replace(/[^a-z0-9]/g, "");

  const digits = value =>
    String(value ?? "").replace(/\D/g, "");

  const number = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const total = (rows, key = "valor") =>
    rows.reduce((sum, row) => sum + number(row[key]), 0);

  const brl = value =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(number(value));

  const today = () => {
    const date = new Date();

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  };

  const displayDate = value =>
    /^\d{4}-\d{2}-\d{2}$/.test(value || "")
      ? value.split("-").reverse().join("/")
      : value || "—";

  const displayMonth = value =>
    /^\d{4}-\d{2}$/.test(value || "")
      ? `${value.slice(5)}/${value.slice(0, 4)}`
      : value || "—";

  const moneyFields = [
    "valorGlobal", "custoPosto", "gastoAnual2025",
    "ploa2026", "salario", "encargos", "materiais",
    "gastoMensal2025", "totalGasto2025"
  ];

  const integerFields = [
    "postos", "qtdAtual", "qtdAnalise"
  ];

  const contractFields = [
    "supplier", "numero", "processo",
    "vigenciaInicial", "vigenciaFinal", "objeto",
    "valorGlobal", "custoPosto", "gastoAnual2025",
    "ploa2026", "unidade", "tipo", "modalidade",
    "nd", "gestor", "fiscalAdm", "fiscalTecnico",
    "suplente", "garantia", "tipoCusto", "categoria",
    "postos", "salario", "encargos", "materiais",
    "gastoMensal2025", "totalGasto2025",
    "qtdAtual", "qtdAnalise", "observacoes"
  ];

  const columns = {
    suppliers: [
      "id", "nome", "cnpj", "telefone",
      "email", "observacoes"
    ],

    contracts: [
      "id", "supplier", "empresa", "cnpj",
      ...contractFields.filter(k => k !== "supplier")
    ],

    payments: [
      "id", "contractId", "numero", "processo",
      "empresa", "cnpj", "data", "competencia",
      "valor", "notaFiscal", "empenho",
      "processoPagamento", "descricao"
    ],

    pendencias: [
      "id", "contractId", "numero", "processo",
      "empresa", "cnpj", "competencia", "valor",
      "referencia", "vencimento", "status", "observacoes"
    ]
  };

  let db = emptyDB();
  let editing = { type: null, id: null };
  let staged = null;
  let storageLocked = false;
  let toastTimer;

  // ========================================
  // ARMAZENAMENTO
  // ========================================

  function toast(message) {
    const element = $("toast");

    element.textContent = message;
    element.classList.add("visible");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      element.classList.remove("visible");
    }, 4000);
  }

  // ========================================
  // SUPABASE REST / POSTGREST
  // ========================================
  // Chave PUBLICÁVEL. Nunca inclua uma chave secreta neste arquivo.
  // Os nomes e colunas reais são descobertos via API, sem DDL e sem
  // desativar RLS. Se o esquema for incompatível, a gravação é bloqueada.
  const SB_URL = "https://bnzkgyymwlulsobbcdpp.supabase.co";
  const SB_KEY = "sb_publishable_i3JcVDLPefiXQUDwOZZQWA_6_R9m2Wx";
  const SB_REST = `${SB_URL}/rest/v1`;
  // Edite apenas se houver mais de uma tabela compatível por cadastro.
  // null = detectar automaticamente dentre os nomes indicados.
  const TABLE_MAP = {
    suppliers: null,
    contracts: null,
    payments: null,
    pendencias: null
  };
  const TABLE_CANDIDATES = {
    suppliers: ["suppliers", "fornecedores"],
    contracts: ["contracts", "contratos"],
    payments: ["payments", "pagamentos"],
    pendencias: ["pendencias", "pending", "pendings"]
  };
  const JSON_FIELDS = ["dados", "payload", "registro", "record", "conteudo"];
  const AUTO_FIELDS = new Set([
    "created_at", "updated_at", "created_by", "updated_by", "user_id"
  ]);
  const FIELD_ALIASES = {
    supplier: ["supplier", "supplier_id", "fornecedor_id", "id_fornecedor", "fornecedor"],
    contractId: ["contractId", "contract_id", "contrato_id", "id_contrato", "contrato"],
    nome: ["nome", "razao_social", "nome_fornecedor"],
    numero: ["numero", "numero_contrato", "n_contrato"],
    processo: ["processo", "processo_sei", "numero_processo"],
    vigenciaInicial: ["vigenciaInicial", "vigencia_inicial", "inicio_vigencia", "data_inicio"],
    vigenciaFinal: ["vigenciaFinal", "vigencia_final", "fim_vigencia", "data_fim"],
    valorGlobal: ["valorGlobal", "valor_global", "valor_total_contrato"],
    custoPosto: ["custoPosto", "custo_posto"],
    ploa2026: ["ploa2026", "ploa_2026"],
    gastoAnual2025: ["gastoAnual2025", "gasto_anual_2025"],
    gastoMensal2025: ["gastoMensal2025", "gasto_mensal_2025"],
    totalGasto2025: ["totalGasto2025", "total_gasto_2025"],
    fiscalAdm: ["fiscalAdm", "fiscal_adm", "fiscal_administrativo"],
    fiscalTecnico: ["fiscalTecnico", "fiscal_tecnico"],
    tipoCusto: ["tipoCusto", "tipo_custo"],
    qtdAtual: ["qtdAtual", "qtd_atual"],
    qtdAnalise: ["qtdAnalise", "qtd_analise"],
    notaFiscal: ["notaFiscal", "nota_fiscal"],
    processoPagamento: ["processoPagamento", "processo_pagamento"],
    nd: ["nd", "natureza_despesa"],
    cnpj: ["cnpj", "cnpj_fornecedor"],
    competencia: ["competencia", "mes_competencia"]
  };
  const adapters = {};
  let busy = false;
  let remoteLoaded = false;

  function snake(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  }

  function namesFor(field) {
    return [...new Set([field, snake(field), ...(FIELD_ALIASES[field] || [])])];
  }

  function explainError(error) {
    const msg = error?.message || String(error);
    if (/row.level.security|violates row.level|permission denied|not authorized|unauthorized|jwt/i.test(msg)) {
      return "Permissão negada pelo Supabase (Auth/RLS). Não é seguro desativar a proteção: " + msg;
    }
    return msg;
  }

  async function request(table, query = {}, options = {}) {
    const url = new URL(table ? `${SB_REST}/${encodeURIComponent(table)}` : `${SB_REST}/`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
    const headers = {
      apikey: SB_KEY,
      Accept: options.openApi ? "application/openapi+json" : "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.prefer ? { Prefer: options.prefer } : {})
    };
    // Ao implantar login, utilize o JWT da sessão; a chave publicável NÃO é JWT.
    const jwt = window.SUREGPA_ACCESS_TOKEN;
    if (typeof jwt === "string" && jwt.trim()) {
      headers.Authorization = `Bearer ${jwt.trim()}`;
    }
    let response;
    try {
      response = await fetch(url.href, {
        method: options.method || "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        cache: "no-store"
      });
    } catch (error) {
      throw Error(`Falha de conexão com Supabase: ${error.message}`);
    }
    const text = await response.text();
    let content = null;
    if (text) {
      try { content = JSON.parse(text); }
      catch { content = text; }
    }
    if (!response.ok) {
      const message = content?.message || content?.error_description || content?.error || text || response.statusText;
      const error = Error(`[${response.status}] ${message}`);
      error.status = response.status;
      error.code = content?.code || "";
      throw error;
    }
    return content;
  }

  function missingTable(error) {
    return error?.code === "PGRST205" ||
      (error?.status === 404 && /table|relation|schema cache/i.test(error.message));
  }

  function missingColumn(error) {
    return /column .*does not exist|could not find.*column|unknown column|column .*not found|PGRST200|PGRST204|42703/i.test(
      `${error?.message || ""} ${error?.code || ""}`
    );
  }

  async function specMetadata() {
    try {
      const spec = await request(null, {}, { openApi: true });
      return spec && typeof spec === "object" ? spec : null;
    } catch (error) {
      console.info("Metadados OpenAPI indisponíveis; usando inspeção não destrutiva.", error);
      return null;
    }
  }

  function schemaProperties(spec, table) {
    const shape = spec?.definitions?.[table] || spec?.components?.schemas?.[table];
    return shape?.properties && Object.keys(shape.properties).length
      ? Object.keys(shape.properties)
      : null;
  }

  async function probeColumns(table, type) {
    const possible = new Set(["id", ...JSON_FIELDS, ...AUTO_FIELDS]);
    for (const field of columns[type]) {
      for (const name of namesFor(field)) possible.add(name);
    }
    // Verifica nomes de colunas por SELECT ... LIMIT 0, sem alterar registros.
    async function group(list) {
      if (!list.length) return [];
      try {
        await request(table, { select: list.join(","), limit: 0 });
        return list;
      } catch (error) {
        if (!missingColumn(error)) throw error;
        if (list.length === 1) return [];
        const half = Math.floor(list.length / 2);
        const left = await group(list.slice(0, half));
        const right = await group(list.slice(half));
        return left.concat(right);
      }
    }
    return await group([...possible]);
  }

  function createAdapter(type, table, cols) {
    const names = new Set(cols);
    if (!names.has("id")) {
      throw Error(`Tabela ${table} sem coluna id acessível.`);
    }
    const json = JSON_FIELDS.find(name => names.has(name)) || null;
    const fields = {};
    for (const field of columns[type]) {
      const match = namesFor(field).find(name => names.has(name));
      if (match) fields[field] = match;
    }
    const essential = {
      suppliers: ["nome", "cnpj"],
      contracts: ["supplier", "processo", "vigenciaInicial", "vigenciaFinal"],
      payments: ["contractId", "data", "valor"],
      pendencias: ["contractId", "competencia", "valor", "status"]
    }[type];
    if (!json && essential.some(field => !fields[field])) {
      throw Error(`Tabela ${table} não possui as colunas essenciais de ${type} nem campo JSONB compatível.`);
    }
    // Se houver coluna externa de relacionamento, sempre a preenche, mesmo com JSONB.
    return { table, names, fields, json };
  }

  async function fetchTableRows(table) {
    const all = [];
    const size = 500;
    for (let offset = 0; ; offset += size) {
      const batch = await request(table, {
        select: "*", order: "id.asc", limit: size, offset
      });
      if (!Array.isArray(batch)) throw Error(`Resposta inválida da tabela ${table}.`);
      all.push(...batch);
      if (batch.length < size) break;
      if (offset >= 200000) throw Error(`Tabela ${table} excede o limite de leitura segura.`);
    }
    return all;
  }

  async function detectAdapter(type, spec) {
    const candidates = TABLE_MAP[type]
      ? [TABLE_MAP[type]]
      : TABLE_CANDIDATES[type];
    const failures = [];
    for (const table of candidates) {
      let rows;
      try {
        rows = await fetchTableRows(table);
      } catch (error) {
        if (missingTable(error)) continue;
        throw Error(`Erro ao consultar ${table}: ${explainError(error)}`);
      }
      try {
        const cols = schemaProperties(spec, table) ||
          (rows.length ? Object.keys(rows[0]) : await probeColumns(table, type));
        const adapter = createAdapter(type, table, cols);
        return { adapter, rows };
      } catch (error) {
        failures.push(`${table}: ${error.message}`);
        if (TABLE_MAP[type]) throw error;
      }
    }
    throw Error(
      `Não foi possível identificar a tabela de ${type}. ` +
      (failures.join(" | ") || `Nomes tentados: ${candidates.join(", ")}`) +
      " Confira o esquema e as políticas de leitura no Supabase."
    );
  }

  function fromRemote(type, raw) {
    const adapter = adapters[type];
    const data = adapter.json && raw[adapter.json] &&
      typeof raw[adapter.json] === "object" && !Array.isArray(raw[adapter.json])
      ? clone(raw[adapter.json]) : {};
    const known = new Set(["id", adapter.json, ...Object.values(adapter.fields)]);
    for (const [field, col] of Object.entries(adapter.fields)) {
      if (field !== "id" && Object.hasOwn(raw, col)) {
        // Colunas normais sobrepõem dados do JSON para manter FKs atuais.
        data[field] = raw[col] ?? "";
      }
    }
    for (const [key, value] of Object.entries(raw)) {
      if (!known.has(key) && !AUTO_FIELDS.has(key)) {
        data[key] = value;
      }
    }
    data.id = String(raw.id);
    return data;
  }

  function toRemote(type, row) {
    const adapter = adapters[type];
    if (!adapter) throw Error(`Tabela de ${type} não configurada.`);
    if (!row || typeof row.id !== "string" || !row.id) {
      throw Error(`ID inválido em ${type}.`);
    }
    const output = { id: row.id };
    const payload = {};
    const derived = type === "contracts"
      ? new Set(["empresa", "cnpj"])
      : ["payments", "pendencias"].includes(type)
        ? new Set(["empresa", "cnpj", "numero", "processo"])
        : new Set();
    for (const [field, value] of Object.entries(row)) {
      if (field === "id" || AUTO_FIELDS.has(field)) continue;
      if (derived.has(field) && !adapter.fields[field] && !adapter.json) continue;
      const col = adapter.fields[field] || (adapter.names.has(field) ? field : null);
      if (adapter.json) payload[field] = value;
      if (!col) {
        if (!adapter.json && value !== "" && value !== null && value !== undefined) {
          throw Error(`Campo "${field}" em ${type} não existe na tabela ${adapter.table}. Nenhum dado foi descartado.`);
        }
        continue;
      }
      let valueToSave = value;
      if (value === "" && [
        "valor", ...moneyFields, ...integerFields,
        "vigenciaInicial", "vigenciaFinal", "data", "vencimento"
      ].includes(field)) valueToSave = null;
      if (Object.hasOwn(output, col) && output[col] !== valueToSave) {
        throw Error(`Campos incompatíveis compartilham a coluna ${col}.`);
      }
      output[col] = valueToSave;
    }
    if (adapter.json) output[adapter.json] = payload;
    return output;
  }

  async function loadDB(first = false) {
    const state = emptyDB();
    if (first) {
      // O endpoint OpenAPI da raiz pode responder 403 para chaves publicáveis.
      // Não o utilizamos como teste de conexão ou pré-requisito do cadastro.
      const temp = {};
      const raw = {};
      for (const type of TYPES) {
        const found = await detectAdapter(type, null);
        temp[type] = found.adapter;
        raw[type] = found.rows;
      }
      Object.assign(adapters, temp);
      for (const type of TYPES) state[type] = raw[type].map(row => fromRemote(type, row));
    } else {
      for (const type of TYPES) {
        state[type] = (await fetchTableRows(adapters[type].table))
          .map(row => fromRemote(type, row));
      }
    }
    return state;
  }

  function changesBetween(previous, next) {
    const actions = [];
    for (const type of TYPES) {
      const oldRows = new Map(previous[type].map(row => [row.id, row]));
      const newRows = new Map(next[type].map(row => [row.id, row]));
      for (const [id, row] of newRows) {
        const old = oldRows.get(id);
        if (!old) actions.push({ kind: "insert", type, row });
        else if (JSON.stringify(old) !== JSON.stringify(row)) {
          actions.push({ kind: "update", type, row, old });
        }
      }
      for (const [id, row] of oldRows) {
        if (!newRows.has(id)) actions.push({ kind: "delete", type, row });
      }
    }
    const rank = { suppliers: 0, contracts: 1, payments: 2, pendencias: 3 };
    return actions.sort((a, b) =>
      (a.kind === "delete" ? 1 : 0) - (b.kind === "delete" ? 1 : 0) ||
      (a.kind === "delete" ? -rank[a.type] : rank[a.type]) -
      (b.kind === "delete" ? -rank[b.type] : rank[b.type])
    );
  }

  async function runAction(action) {
    const adapter = adapters[action.type];
    const id = action.row.id;
    const query = action.kind === "insert" ? {} : { id: `eq.${id}` };
    const body = action.kind === "delete" ? undefined : toRemote(action.type, action.row);
    if (action.kind === "update") {
      const previous = toRemote(action.type, action.old || action.row);
      for (const col of Object.keys(previous)) {
        if (col !== "id" && !Object.hasOwn(body, col)) body[col] = null;
      }
    }
    const result = await request(adapter.table, query, {
      method: action.kind === "insert" ? "POST" :
        action.kind === "update" ? "PATCH" : "DELETE",
      ...(body === undefined ? {} : { body }),
      prefer: "return=representation"
    });
    if (!Array.isArray(result) || result.length !== 1 || String(result[0]?.id) !== id) {
      throw Error(`A operação ${action.kind} em ${adapter.table} não confirmou 1 registro (ID ${id}). Verifique RLS/SELECT.`);
    }
  }

  function inverseAction(action) {
    if (action.kind === "insert") return { kind: "delete", type: action.type, row: action.row };
    if (action.kind === "delete") return { kind: "insert", type: action.type, row: action.row };
    return { kind: "update", type: action.type, row: action.old, old: action.row };
  }

  async function saveDB(next) {
    if (storageLocked || !remoteLoaded) {
      toast("Banco indisponível. Operação não realizada.");
      return false;
    }
    if (busy) {
      toast("Uma gravação está em andamento. Tente novamente.");
      return false;
    }
    busy = true;
    const operations = changesBetween(db, next);
    const applied = [];
    try {
      // Evita sobrescrever mudanças feitas em outra aba/dispositivo.
      const fresh = await loadDB();
      const snapshot = state => TYPES.map(type => JSON.stringify(
        state[type].map(row => Object.keys(row).sort().map(key => [key, row[key]]))
          .sort((a, b) => String(a.find(p => p[0] === "id")?.[1] || "")
            .localeCompare(String(b.find(p => p[0] === "id")?.[1] || "")))
      )).join("|");
      if (snapshot(fresh) !== snapshot(db)) {
        db = fresh;
        renderAll();
        throw Error("Os dados mudaram no Supabase desde a última leitura. Tela atualizada; revise a operação.");
      }
      // Antes de qualquer gravação, confirme que TODOS os campos podem ser persistidos.
      for (const op of operations) {
        if (op.kind !== "delete") toRemote(op.type, op.row);
      }
      for (const op of operations) {
        await runAction(op);
        applied.push(op);
      }
      db = await loadDB();
      renderAll();
      return true;
    } catch (error) {
      console.error("Falha de persistência no Supabase", error);
      let rollbackError = null;
      for (const op of applied.reverse()) {
        try { await runAction(inverseAction(op)); }
        catch (err) { rollbackError = err; console.error("Falha ao reverter alteração", err); }
      }
      try {
        db = await loadDB();
        renderAll();
      } catch (err) { rollbackError = err; }
      if (rollbackError) {
        storageLocked = true;
        toast("Falha parcial: banco requer conferência manual. Gravações bloqueadas.");
      } else {
        toast(`Não foi possível salvar: ${explainError(error)}`);
      }
      return false;
    } finally {
      busy = false;
    }
  }

  // ========================================
  // RELACIONAMENTOS E CÁLCULOS
  // ========================================

  const supplier = (id, state = db) =>
    state.suppliers.find(row => row.id === id);

  const contract = (id, state = db) =>
    state.contracts.find(row => row.id === id);

  const supplierName = (item, state = db) =>
    supplier(item?.supplier, state)?.nome ||
    "Fornecedor não identificado";

  const contractName = (item, state = db) =>
    `${item.numero || item.processo || "Contrato"} — ${
      supplierName(item, state)
    }`;

  function contractStatus(item) {
    if (!item.vigenciaInicial || !item.vigenciaFinal) {
      return "Sem vigência";
    }

    if (item.vigenciaInicial > today()) {
      return "A iniciar";
    }

    if (item.vigenciaFinal < today()) {
      return "Encerrado";
    }

    return "Vigente";
  }

  function paymentsFor(year, contractId = null) {
    return total(
      db.payments.filter(row =>
        row.data?.startsWith(String(year)) &&
        contract(row.contractId) &&
        (!contractId || row.contractId === contractId)
      )
    );
  }

  function openPending() {
    return db.pendencias.filter(row =>
      row.status !== "concluido" &&
      contract(row.contractId)
    );
  }

  function pill(text) {
    const color = {
      "Vigente": "green",
      "A iniciar": "blue",
      "Encerrado": "red",
      "Concluída": "green",
      "Pendente": "orange"
    }[text] || "";

    return `<span class="pill ${color}">${esc(text)}</span>`;
  }

  const emptyTable = cols =>
    `<tr><td class="empty" colspan="${cols}">
      Nenhum registro encontrado.
    </td></tr>`;

  const emptyCards = message =>
    `<div class="empty">${esc(message)}</div>`;

  function tableActions(type, id) {
    return `
      <td class="table-actions">
        <button type="button"
          data-edit="${type}" data-id="${esc(id)}">
          Editar
        </button>
        <button type="button" class="delete"
          data-delete="${type}" data-id="${esc(id)}">
          Excluir
        </button>
      </td>
    `;
  }

  // ========================================
  // NAVEGAÇÃO
  // ========================================

  function navigate(view) {
    const titles = {
      dashboard: "Visão geral",
      contracts: "Contratos",
      payments: "Pagamentos",
      pending: "Pendências",
      budget: "Orçamento e PLOA",
      suppliers: "Fornecedores",
      files: "Importar e exportar",
      documents: "Central de Documentos",
      settings: "Configurações"
    };

    if (!titles[view]) return;

    $$(".view").forEach(section => {
      section.hidden = section.id !== `view-${view}`;
    });

    $$(".nav-link").forEach(button => {
      const active = button.dataset.view === view;

      button.classList.toggle("active", active);

      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    $("pageTitle").textContent = titles[view];
    renderAll();
  }

  // ========================================
  // DASHBOARD
  // ========================================

  function renderDashboard() {
    const pending = openPending();
    const planned = total(db.contracts, "ploa2026");
    const paid = paymentsFor(YEAR);

    $("kpiActive").textContent =
      db.contracts.filter(
        item => contractStatus(item) === "Vigente"
      ).length;

    $("kpiActiveSub").textContent =
      `${db.contracts.length} contrato(s) cadastrado(s)`;

    $("kpiPaid").textContent = brl(paid);

    $("kpiPaidSub").textContent =
      `${
        db.payments.filter(
          row => row.data?.startsWith(String(YEAR)) &&
          contract(row.contractId)
        ).length
      } pagamento(s) em ${YEAR}`;

    $("kpiPending").textContent = brl(total(pending));

    $("kpiPendingSub").textContent =
      `${pending.length} pendência(s) aberta(s)`;

    $("kpiPloa").textContent = brl(planned);

    $("kpiPloaSub").textContent =
      `${
        db.contracts.filter(row => number(row.ploa2026) > 0).length
      } contrato(s) com PLOA informado`;

    // Pagamentos e pendências mensais
    const now = new Date();

    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(
        now.getFullYear(),
        now.getMonth() - 5 + index,
        1
      );

      return `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;
    });

    const graph = months.map(month => ({
      month,
      paid: total(
        db.payments.filter(row =>
          row.data?.slice(0, 7) === month &&
          contract(row.contractId)
        )
      ),
      open: total(
        pending.filter(row => row.competencia === month)
      )
    }));

    const max = Math.max(
      1,
      ...graph.flatMap(item => [item.paid, item.open])
    );

    $("monthlyChart").innerHTML = graph.map(item => `
      <div class="chart-month">
        <div class="chart-bars">

          <div class="chart-bar paid"
            style="height:${item.paid / max * 100}%"
            title="Pagos: ${esc(brl(item.paid))}">
          </div>

          <div class="chart-bar open"
            style="height:${item.open / max * 100}%"
            title="Pendentes: ${esc(brl(item.open))}">
          </div>

        </div>
        <small>${displayMonth(item.month)}</small>
      </div>
    `).join("");

    // Situação dos contratos
    const statuses = [
      "Vigente",
      "A iniciar",
      "Encerrado",
      "Sem vigência"
    ];

    const colors = [
      "#169167", "#2b83bf", "#c95d64", "#d9e1e9"
    ];

    const counts = statuses.map(status =>
      db.contracts.filter(
        item => contractStatus(item) === status
      ).length
    );

    let progress = 0;

    const stops = statuses.map((_, index) => {
      const start = progress;

      if (db.contracts.length) {
        progress += counts[index] / db.contracts.length * 100;
      }

      return `${colors[index]} ${start}% ${progress}%`;
    });

    $("statusDonut").style.background =
      db.contracts.length
        ? `conic-gradient(${stops.join(",")})`
        : "#e6edf3";

    $("statusLegend").innerHTML = statuses.map(
      (status, index) => `
        <div class="donut-line">
          <span>
            <i style="background:${colors[index]}"></i>
            ${status}
          </span>
          <b>${counts[index]}</b>
        </div>
      `
    ).join("");

    // Últimos pagamentos
    const recentPayments = db.payments
      .filter(item => contract(item.contractId))
      .slice()
      .sort((a, b) =>
        (b.data || "").localeCompare(a.data || "")
      )
      .slice(0, 5);

    $("recentPayments").innerHTML =
      recentPayments.map(item => {
        const c = contract(item.contractId);

        return `
          <div class="activity-row">
            <div>
              <strong>${esc(supplierName(c))}</strong>
              <small>
                ${displayDate(item.data)} ·
                ${esc(c?.numero || "Contrato")}
              </small>
            </div>
            <b>${brl(item.valor)}</b>
          </div>
        `;
      }).join("") ||
      emptyCards("Nenhum pagamento cadastrado.");

    $("recentPending").innerHTML = pending
      .slice()
      .sort((a, b) =>
        (b.competencia || "").localeCompare(a.competencia || "")
      )
      .slice(0, 5)
      .map(item => `
        <div class="activity-row">
          <div>
            <strong>
              ${esc(supplierName(contract(item.contractId)))}
            </strong>
            <small>Competência ${displayMonth(item.competencia)}</small>
          </div>
          <b>${brl(item.valor)}</b>
        </div>
      `).join("") ||
      emptyCards("Nenhuma pendência aberta.");
  }

  // ========================================
  // FORNECEDORES
  // ========================================

  function renderSuppliers() {
    const search = norm($("searchSuppliers").value);

    const rows = db.suppliers.filter(item =>
      norm(`${item.nome} ${item.cnpj}`).includes(search)
    );

    $("countSuppliers").textContent =
      `${rows.length} fornecedor(es)`;

    $("rowsSuppliers").innerHTML = rows.map(item => `
      <tr>
        <td><strong>${esc(item.nome)}</strong></td>
        <td>${esc(item.cnpj)}</td>
        <td>${esc(item.email || item.telefone || "—")}</td>
        <td>
          ${
            db.contracts.filter(
              c => c.supplier === item.id
            ).length
          }
        </td>
        ${tableActions("suppliers", item.id)}
      </tr>
    `).join("") || emptyTable(5);
  }

  // ========================================
  // CONTRATOS
  // ========================================

  function renderContracts() {
    const search = norm($("searchContracts").value);
    const statusFilter = $("filterContractStatus").value;

    const rows = db.contracts.filter(item =>
      norm(
        `${item.numero} ${item.processo} ${item.objeto} ${
          supplierName(item)
        }`
      ).includes(search) &&
      (
        statusFilter === "todos" ||
        contractStatus(item) === statusFilter
      )
    );

    $("countContracts").textContent =
      `${rows.length} contrato(s)`;

    $("rowsContracts").innerHTML = rows.map(item => `
      <tr>
        <td>
          <strong>${esc(item.numero || "—")}</strong>
          <small>${esc(item.processo || "—")}</small>
        </td>

        <td>${esc(supplierName(item))}</td>

        <td>
          ${displayDate(item.vigenciaInicial)}
          a ${displayDate(item.vigenciaFinal)}
        </td>

        <td>${brl(item.valorGlobal)}</td>
        <td>${pill(contractStatus(item))}</td>

        ${tableActions("contracts", item.id)}
      </tr>
    `).join("") || emptyTable(6);
  }

  // ========================================
  // PAGAMENTOS
  // ========================================

  function renderPayments() {
    const search = norm($("searchPayments").value);
    const month = $("filterPaymentMonth").value;

    const rows = db.payments
      .filter(item => {
        const c = contract(item.contractId);

        return c &&
          (!month || item.competencia === month) &&
          norm(
            `${supplierName(c)} ${c.numero} ${c.processo} ${
              item.notaFiscal
            } ${item.empenho} ${item.descricao}`
          ).includes(search);
      })
      .slice()
      .sort((a, b) =>
        (b.data || "").localeCompare(a.data || "")
      );

    $("countPayments").textContent =
      `${rows.length} pagamento(s) · ${brl(total(rows))}`;

    $("rowsPayments").innerHTML = rows.map(item => {
      const c = contract(item.contractId);

      return `
        <tr>
          <td>${displayDate(item.data)}</td>

          <td>
            <strong>${esc(supplierName(c))}</strong>
            <small>${esc(c.numero || c.processo || "—")}</small>
          </td>

          <td>${displayMonth(item.competencia)}</td>
          <td>${esc(item.notaFiscal || item.descricao || "—")}</td>
          <td><strong>${brl(item.valor)}</strong></td>

          ${tableActions("payments", item.id)}
        </tr>
      `;
    }).join("") || emptyTable(6);
  }

  // ========================================
  // PENDÊNCIAS
  // ========================================

  function renderPending() {
    const search = norm($("searchPending").value);
    const filter = $("filterPendingStatus").value;

    const rows = db.pendencias
      .filter(item => {
        const c = contract(item.contractId);

        return c &&
          (
            filter === "todos" ||
            (
              filter === "concluido"
                ? item.status === "concluido"
                : item.status !== "concluido"
            )
          ) &&
          norm(
            `${supplierName(c)} ${c.numero} ${c.processo} ${
              item.referencia
            } ${item.competencia} ${item.observacoes}`
          ).includes(search);
      })
      .slice()
      .sort((a, b) =>
        (b.competencia || "").localeCompare(
          a.competencia || ""
        )
      );

    $("countPending").textContent =
      `${rows.length} registro(s) · ${brl(total(rows))}`;

    $("pendingCards").innerHTML = rows.map(item => {
      const c = contract(item.contractId);
      const done = item.status === "concluido";

      return `
        <article class="pending-card">

          <div class="pending-top">
            <div>
              <h3>${esc(supplierName(c))}</h3>

              <div class="pending-meta">
                Contrato: ${esc(c.numero || "—")}
                · Competência: ${displayMonth(item.competencia)}
                <br>
                Processo: ${esc(c.processo || "—")}
                <br>
                Referência: ${esc(item.referencia || "—")}
                ${
                  item.vencimento
                    ? `<br>Vencimento: ${displayDate(item.vencimento)}`
                    : ""
                }
              </div>
            </div>

            <div class="pending-amount">
              ${pill(done ? "Concluída" : "Pendente")}
              <strong>${brl(item.valor)}</strong>
            </div>
          </div>

          <div class="button-row">
            <button type="button" class="btn secondary small"
              data-edit="pendencias" data-id="${esc(item.id)}">
              Editar
            </button>

            <button type="button" class="btn danger small"
              data-delete="pendencias" data-id="${esc(item.id)}">
              Excluir
            </button>

            <button type="button"
              class="btn ${done ? "secondary" : "success"} small"
              data-toggle="${esc(item.id)}">
              ${done ? "Reabrir" : "Marcar como concluída"}
            </button>
          </div>

        </article>
      `;
    }).join("") || emptyCards("Nenhuma pendência encontrada.");
  }

  // ========================================
  // ORÇAMENTO
  // ========================================

  function renderBudget() {
    const planned = total(db.contracts, "ploa2026");
    const paid = paymentsFor(YEAR);
    const previous = total(db.contracts, "gastoAnual2025");

    $("budgetSummary").innerHTML = [
      ["PLOA 2026", planned],
      ["Pagamentos 2026", paid],
      ["Gasto 2025 informado", previous]
    ].map(([label, value]) => `
      <article class="summary-item">
        <small>${label}</small>
        <strong>${brl(value)}</strong>
      </article>
    `).join("");

    const ratio = planned > 0
      ? paid / planned * 100
      : null;

    $("budgetPercent").textContent =
      ratio === null
        ? "PLOA não informado"
        : `${ratio.toFixed(1).replace(".", ",")}%`;

    $("budgetBar").style.width =
      `${Math.min(100, Math.max(0, ratio || 0))}%`;

    $("rowsBudget").innerHTML = db.contracts.map(item => {
      const paidContract = paymentsFor(YEAR, item.id);
      const plan = number(item.ploa2026);

      const percent = plan > 0
        ? `${(paidContract / plan * 100)
            .toFixed(1).replace(".", ",")}%`
        : "—";

      return `
        <tr>
          <td>
            <strong>${esc(supplierName(item))}</strong>
            <small>
              ${esc(item.numero || item.processo || "—")}
            </small>
          </td>
          <td>${brl(item.gastoAnual2025)}</td>
          <td>${brl(item.ploa2026)}</td>
          <td>${brl(paidContract)}</td>
          <td>${percent}</td>

          <td class="table-actions">
            <button type="button" data-edit="contracts"
              data-id="${esc(item.id)}">
              Editar
            </button>
          </td>
        </tr>
      `;
    }).join("") || emptyTable(6);
  }

  function renderSettings() {
    $("storageInfo").textContent =
      `${db.suppliers.length} fornecedor(es) · ` +
      `${db.contracts.length} contrato(s) · ` +
      `${db.payments.length} pagamento(s) · ` +
      `${db.pendencias.length} pendência(s)`;
  }

  function renderAll() {
    renderDashboard();
    renderSuppliers();
    renderContracts();
    renderPayments();
    renderPending();
    renderBudget();
    renderSettings();
  }

  // ========================================
  // FORMULÁRIOS
  // ========================================

  const dialogs = {
    suppliers: ["supplierDialog", "supplierForm", "Fornecedor"],
    contracts: ["contractDialog", "contractForm", "Contrato"],
    payments: ["paymentDialog", "paymentForm", "Pagamento"],
    pendencias: ["pendingDialog", "pendingForm", "Pendência"]
  };

  function refreshSelects() {
    const supplierSelect = $("contractSupplier");

    supplierSelect.replaceChildren(
      new Option("Selecione um fornecedor", "")
    );

    [...db.suppliers]
      .sort((a, b) =>
        (a.nome || "").localeCompare(
          b.nome || "", "pt-BR"
        )
      )
      .forEach(item => {
        supplierSelect.add(
          new Option(
            `${item.nome} — ${item.cnpj}`,
            item.id
          )
        );
      });

    $$("[data-contract-select]").forEach(select => {
      select.replaceChildren(
        new Option("Selecione um contrato", "")
      );

      [...db.contracts]
        .sort((a, b) =>
          contractName(a).localeCompare(
            contractName(b), "pt-BR"
          )
        )
        .forEach(item => {
          select.add(
            new Option(contractName(item), item.id)
          );
        });
    });
  }

  function fillForm(form, record) {
    form.reset();

    $$("[name]", form).forEach(input => {
      input.value =
        Object.prototype.hasOwnProperty.call(
          record, input.name
        )
          ? record[input.name] ?? ""
          : "";
    });
  }

  function updateCCT() {
    const fields = $("contractForm").elements;

    const salary = number(
      fields.namedItem("salario").value
    );

    const charges = number(
      fields.namedItem("encargos").value
    );

    const posts = number(
      fields.namedItem("postos").value
    );

    const materials = number(
      fields.namedItem("materiais").value
    );

    $("cctEstimate").value = brl(
      salary * (1 + charges / 100) * posts + materials
    );
  }

  function openForm(type, id = null) {
    if (storageLocked || !remoteLoaded || busy) {
      toast("Aguarde a conexão com o Supabase.");
      return;
    }
    if (type === "contracts" && !db.suppliers.length) {
      toast("Cadastre um fornecedor primeiro.");
      navigate("suppliers");
      return;
    }

    if (
      ["payments", "pendencias"].includes(type) &&
      !db.contracts.length
    ) {
      toast("Cadastre um contrato primeiro.");
      navigate("contracts");
      return;
    }

    const [dialogId, formId, label] = dialogs[type];

    editing = { type, id };
    refreshSelects();

    const record =
      db[type].find(item => item.id === id) || {};

    const form = $(formId);
    fillForm(form, record);

    if (type === "payments" && !id) {
      form.elements.namedItem("data").value = today();
    }

    if (type === "pendencias" && !id) {
      form.elements.namedItem("competencia").value =
        today().slice(0, 7);

      form.elements.namedItem("status").value =
        "aberto";
    }

    if (type === "contracts") updateCCT();

    const prefix = {
      suppliers: "supplier",
      contracts: "contract",
      payments: "payment",
      pendencias: "pending"
    }[type];

    $(`${prefix}DialogTitle`).textContent =
      `${id ? "Editar" : "Cadastrar"} ${label.toLowerCase()}`;

    $(dialogId).showModal();
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
      return false;
    }

    const [y, m, d] = value.split("-").map(Number);
    const test = new Date(Date.UTC(y, m - 1, d));

    return (
      test.getUTCFullYear() === y &&
      test.getUTCMonth() === m - 1 &&
      test.getUTCDate() === d
    );
  }

  function validMonth(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || "");
  }

  function validateRecord(type, record, state, excludeId = null) {
    if (type === "suppliers") {
      if (!String(record.nome || "").trim()) {
        throw Error("Informe a razão social.");
      }

      if (digits(record.cnpj).length !== 14) {
        throw Error("CNPJ deve conter 14 dígitos.");
      }

      if (
        state.suppliers.some(item =>
          item.id !== excludeId &&
          digits(item.cnpj) === digits(record.cnpj)
        )
      ) {
        throw Error("CNPJ já cadastrado.");
      }
    }

    if (type === "contracts") {
      if (!supplier(record.supplier, state)) {
        throw Error("Selecione um fornecedor válido.");
      }

      if (!String(record.processo || "").trim()) {
        throw Error("Processo contratual obrigatório.");
      }

      if (
        !validDate(record.vigenciaInicial) ||
        !validDate(record.vigenciaFinal) ||
        record.vigenciaFinal < record.vigenciaInicial
      ) {
        throw Error("Vigência inválida.");
      }

      for (const key of [...moneyFields, ...integerFields]) {
        if (
          record[key] === "" ||
          record[key] === undefined
        ) continue;

        const value = Number(record[key]);

        if (!Number.isFinite(value) || value < 0) {
          throw Error(`Valor inválido: ${key}.`);
        }

        if (
          integerFields.includes(key) &&
          !Number.isInteger(value)
        ) {
          throw Error(`${key} deve ser inteiro.`);
        }
      }
    }

    if (type === "payments") {
      if (!contract(record.contractId, state)) {
        throw Error("Contrato inválido.");
      }

      if (!validDate(record.data)) {
        throw Error("Data do pagamento inválida.");
      }

      if (
        record.competencia &&
        !validMonth(record.competencia)
      ) {
        throw Error("Competência inválida.");
      }

      if (
        !Number.isFinite(Number(record.valor)) ||
        Number(record.valor) <= 0
      ) {
        throw Error("Valor do pagamento inválido.");
      }
    }

    if (type === "pendencias") {
      if (!contract(record.contractId, state)) {
        throw Error("Contrato inválido.");
      }

      if (!validMonth(record.competencia)) {
        throw Error("Competência inválida.");
      }

      if (
        !Number.isFinite(Number(record.valor)) ||
        Number(record.valor) < 0
      ) {
        throw Error("Valor da pendência inválido.");
      }

      if (
        record.vencimento &&
        !validDate(record.vencimento)
      ) {
        throw Error("Vencimento inválido.");
      }

      if (
        !["aberto", "concluido"].includes(record.status)
      ) {
        throw Error("Situação inválida.");
      }
    }
  }

  async function submitRecord(event, type) {
    event.preventDefault();

    const form = event.currentTarget;
    const values = Object.fromEntries(
      new FormData(form).entries()
    );

    const next = clone(db);

    const editId =
      editing.type === type
        ? editing.id
        : null;

    const index = next[type].findIndex(
      item => item.id === editId
    );

    const record = {
      ...(index >= 0 ? next[type][index] : {}),
      ...values,
      id: index >= 0 ? editId : uuid()
    };

    if (type === "suppliers") {
      record.nome = record.nome.trim();

      const cnpj = digits(record.cnpj);

      record.cnpj = cnpj.replace(
        /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
        "$1.$2.$3/$4-$5"
      );
    }

    try {
      validateRecord(type, record, next, editId);
    } catch (error) {
      toast(error.message);
      return;
    }

    if (index >= 0) {
      next[type][index] = record;
    } else {
      next[type].push(record);
    }

    if (await saveDB(next)) {
      $(dialogs[type][0]).close();
      toast("Registro salvo.");
    }
  }

  // ========================================
  // EXCLUIR E CONCLUIR
  // ========================================

  async function deleteRecord(type, id) {
    const next = clone(db);

    if (!next[type].some(item => item.id === id)) {
      return;
    }

    if (
      type === "suppliers" &&
      next.contracts.some(item => item.supplier === id)
    ) {
      toast("Fornecedor possui contratos vinculados.");
      return;
    }

    if (type === "contracts") {
      const payments = next.payments.filter(
        item => item.contractId === id
      ).length;

      const pending = next.pendencias.filter(
        item => item.contractId === id
      ).length;

      if (
        !confirm(
          `Excluir contrato e também ${payments} ` +
          `pagamento(s) e ${pending} pendência(s)?`
        )
      ) return;

      next.payments = next.payments.filter(
        item => item.contractId !== id
      );

      next.pendencias = next.pendencias.filter(
        item => item.contractId !== id
      );

    } else if (!confirm("Excluir este registro?")) {
      return;
    }

    next[type] = next[type].filter(
      item => item.id !== id
    );

    if (await saveDB(next)) {
      toast("Registro excluído.");
    }
  }

  async function togglePending(id) {
    const next = clone(db);
    const item = next.pendencias.find(
      row => row.id === id
    );

    if (!item) return;

    item.status =
      item.status === "concluido"
        ? "aberto"
        : "concluido";

    if (await saveDB(next)) {
      toast(
        "Situação atualizada. Nenhum pagamento foi criado."
      );
    }
  }

  // ========================================
  // DOWNLOADS
  // ========================================

  function download(filename, text, mime) {
    const url = URL.createObjectURL(
      new Blob([text], { type: mime })
    );

    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function csvCell(value) {
    let text = String(value ?? "");

    if (
      /^\s*[=+@-]/.test(text) &&
      !/^-?\d+(?:[.,]\d+)?$/.test(text.trim())
    ) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportRow(type, item) {
    if (type === "suppliers") {
      return { ...item };
    }

    const c = type === "contracts"
      ? item
      : contract(item.contractId);

    const s = supplier(c?.supplier);

    return {
      ...item,
      empresa: s?.nome || "",
      cnpj: s?.cnpj || "",
      ...(
        type === "contracts"
          ? {}
          : {
              numero: c?.numero || "",
              processo: c?.processo || ""
            }
      )
    };
  }

  function exportCSV(type) {
    if (!remoteLoaded || storageLocked) { toast("Banco indisponível para exportar."); return; }
    const rows = db[type];

    if (!rows.length) {
      toast("Nenhum registro para exportar.");
      return;
    }

    const enriched = rows.map(
      item => exportRow(type, item)
    );

    const headers = [
      ...new Set([
        ...columns[type],
        ...enriched.flatMap(item => Object.keys(item))
      ])
    ];

    const csv = "\uFEFF" + [
      headers.map(csvCell).join(";"),
      ...enriched.map(item =>
        headers.map(
          key => csvCell(item[key])
        ).join(";")
      )
    ].join("\r\n");

    download(
      `CAF-${type}-${today()}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );

    toast("CSV exportado.");
  }

  function exportTemplate(type) {
    const headers = columns[type].filter(
      key => ![
        "id", "supplier", "contractId", "empresa"
      ].includes(key)
    );

    if (
      type !== "suppliers" &&
      !headers.includes("cnpj")
    ) {
      headers.unshift("cnpj");
    }

    download(
      `CAF-modelo-${type}.csv`,
      "\uFEFF" + headers.map(csvCell).join(";") + "\r\n",
      "text/csv;charset=utf-8"
    );
  }

  function exportBackup() {
    if (!remoteLoaded || storageLocked) { toast("Banco indisponível para backup."); return; }
    download(
      `CAF-backup-${today()}.json`,
      JSON.stringify(db, null, 2),
      "application/json;charset=utf-8"
    );

    toast("Backup exportado.");
  }

  // ========================================
  // RESTAURAR BACKUP
  // ========================================

  function validateBackup(data) {
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      TYPES.some(type => !Array.isArray(data[type]))
    ) {
      throw Error("Backup incompatível.");
    }

    const ids = {};

    for (const type of TYPES) {
      ids[type] = new Set();

      for (const item of data[type]) {
        if (
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          typeof item.id !== "string" ||
          !item.id ||
          ids[type].has(item.id)
        ) {
          throw Error(`IDs inválidos em ${type}.`);
        }

        ids[type].add(item.id);
      }
    }

    for (const item of data.contracts) {
      if (!ids.suppliers.has(item.supplier)) {
        throw Error("Contrato sem fornecedor válido.");
      }
    }

    for (const type of ["payments", "pendencias"]) {
      for (const item of data[type]) {
        if (!ids.contracts.has(item.contractId)) {
          throw Error(`Vínculo inválido em ${type}.`);
        }
      }
    }
  }

  async function restoreBackup(file) {
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      toast("Backup excede o limite de 12 MB.");
      return;
    }

    try {
      const parsed = JSON.parse(await file.text());

      validateBackup(parsed);

      if (
        !confirm(
          "Substituir todos os registros atuais pelo backup selecionado?"
        )
      ) return;

      if (await saveDB(parsed)) {
        toast("Backup restaurado.");
      }

    } catch (error) {
      console.error(error);
      toast(`Erro no backup: ${error.message}`);
    }
  }

  // ========================================
  // IMPORTAÇÃO CSV: INTERPRETADOR
  // ========================================

  function parseCSV(text) {
    const input = text.replace(/^\uFEFF/, "");
    const headerLine = input.split(/\r?\n/, 1)[0];

    function separatorCount(separator) {
      let count = 0;
      let quoted = false;

      for (let i = 0; i < headerLine.length; i++) {
        const ch = headerLine[i];

        if (ch === '"') {
          if (quoted && headerLine[i + 1] === '"') {
            i++;
          } else {
            quoted = !quoted;
          }

        } else if (!quoted && ch === separator) {
          count++;
        }
      }

      return count;
    }

    const delimiter = [";", "\t", ","].sort(
      (a, b) => separatorCount(b) - separatorCount(a)
    )[0];

    if (!separatorCount(delimiter)) {
      throw Error("Não foi encontrado um separador de colunas.");
    }

    const matrix = [];
    let row = [];
    let cell = "";
    let quoted = false;

    function completeRow() {
      row.push(cell);

      if (row.some(value => value.trim())) {
        matrix.push(row);
      }

      row = [];
      cell = "";
    }

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];

      if (ch === '"') {
        if (quoted && input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = !quoted;
        }

      } else if (ch === delimiter && !quoted) {
        row.push(cell);
        cell = "";

      } else if (
        (ch === "\r" || ch === "\n") &&
        !quoted
      ) {
        if (ch === "\r" && input[i + 1] === "\n") {
          i++;
        }

        completeRow();

      } else {
        cell += ch;
      }
    }

    if (quoted) {
      throw Error("Há aspas não fechadas no CSV.");
    }

    completeRow();

    if (matrix.length < 2) {
      throw Error("Arquivo sem linhas de dados.");
    }

    const headers = matrix.shift().map(
      value => value.trim()
    );

    if (
      headers.some(value => !value) ||
      new Set(headers.map(canon)).size !== headers.length
    ) {
      throw Error("Cabeçalhos vazios ou duplicados.");
    }

    const rows = matrix.map((cells, index) => {
      if (cells.length > headers.length) {
        throw Error(
          `Linha ${index + 2}: colunas acima do cabeçalho.`
        );
      }

      return Object.fromEntries(
        headers.map((header, i) => [
          header,
          (cells[i] ?? "").trim()
        ])
      );
    });

    return { headers, rows };
  }

  // ========================================
  // COMPATIBILIDADE COM CABEÇALHOS DO EXCEL
  // ========================================

  const aliases = {
    razaosocial: "nome",
    nomefornecedor: "nome",
    nomeempresa: "empresa",
    favorecido: "empresa",
    fornecedor: "empresa",
    cnpjempresa: "cnpj",
    cnpjfornecedor: "cnpj",
    numerocontrato: "numero",
    numerodocontrato: "numero",
    contrato: "numero",
    numeroprocesso: "processo",
    numerodoprocesso: "processo",
    processosei: "processo",
    processocontratual: "processo",
    inicio: "vigenciaInicial",
    datainicio: "vigenciaInicial",
    fim: "vigenciaFinal",
    datafim: "vigenciaFinal",
    valorliquido: "valor",
    valorpago: "valor",
    valordopagamento: "valor",
    datapagamento: "data",
    mes: "competencia",
    mescompetencia: "competencia",
    mesdereferencia: "competencia",
    situacao: "status",
    numeronf: "notaFiscal",
    notafiscal: "notaFiscal",
    numeroempenho: "empenho",
    supplierid: "supplier",
    contractid: "contractId"
  };

  const knownFields = [
    ...new Set(Object.values(columns).flat())
  ];

  function normalizeImport(raw) {
    const out = {};

    for (const [header, value] of Object.entries(raw)) {
      const key = canon(header);

      const destination =
        aliases[key] ||
        knownFields.find(field => canon(field) === key);

      if (!destination) continue;

      if (Object.prototype.hasOwnProperty.call(out, destination)) {
        throw Error(
          `Colunas repetidas: ${destination}.`
        );
      }

      out[destination] = value;
    }

    return out;
  }

  // ========================================
  // NÚMEROS E DATAS BRASILEIRAS
  // ========================================

  function parseAmount(value) {
    let text = String(value ?? "")
      .replace(/R\$/gi, "")
      .replace(/\s/g, "");

    if (!text) return null;

    if (text.startsWith("'")) {
      text = text.slice(1);
    }

    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");

    if (comma > dot) {
      text = text.replace(/\./g, "").replace(",", ".");

    } else if (comma !== -1 && dot > comma) {
      text = text.replace(/,/g, "");

    } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
      text = text.replace(/\./g, "");
    }

    if (!/^\d+(?:\.\d+)?$/.test(text)) {
      return null;
    }

    const valueNumber = Number(text);

    return Number.isFinite(valueNumber) && valueNumber >= 0
      ? valueNumber
      : null;
  }

  function parseDate(value, monthOnly = false) {
    const raw = String(value ?? "").trim();

    let year, month, day;

    if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(raw)) {
      [year, month, day] = raw.split("-").map(Number);

    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
      [day, month, year] = raw.split("/").map(Number);

    } else if (
      monthOnly &&
      /^\d{1,2}\/\d{4}$/.test(raw)
    ) {
      [month, year] = raw.split("/").map(Number);

    } else {
      return null;
    }

    if (
      !Number.isInteger(year) ||
      year < 1900 ||
      year > 2100 ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      return null;
    }

    const ym = `${year}-${String(month).padStart(2, "0")}`;

    if (monthOnly) return ym;

    const fullDate =
      `${ym}-${String(day).padStart(2, "0")}`;

    return validDate(fullDate) ? fullDate : null;
  }

  // ========================================
  // IDENTIFICAR VÍNCULOS
  // ========================================

  function findSupplier(row, state) {
    const cnpj = digits(row.cnpj);

    if (cnpj.length === 14) {
      return state.suppliers.find(
        item => digits(item.cnpj) === cnpj
      )?.id || null;
    }

    if (
      row.supplier &&
      state.suppliers.some(item => item.id === row.supplier)
    ) {
      return row.supplier;
    }

    const name = row.empresa || row.nome;

    const matches = name
      ? state.suppliers.filter(
          item => norm(item.nome) === norm(name)
        )
      : [];

    return matches.length === 1
      ? matches[0].id
      : null;
  }

  function findContract(row, state) {
    const supplierId = findSupplier(row, state);

    if (row.cnpj && !supplierId) {
      return null;
    }

    if (row.contractId) {
      const exact = state.contracts.find(
        item => item.id === row.contractId
      );

      if (
        exact &&
        (!supplierId || exact.supplier === supplierId) &&
        (!row.numero || exact.numero === row.numero) &&
        (!row.processo || exact.processo === row.processo)
      ) {
        return exact.id;
      }

      if (exact) return null;
    }

    if (!row.numero && !row.processo) {
      return null;
    }

    const matches = state.contracts.filter(item =>
      (!row.numero || item.numero === row.numero) &&
      (!row.processo || item.processo === row.processo) &&
      (!supplierId || item.supplier === supplierId)
    );

    return matches.length === 1
      ? matches[0].id
      : null;
  }

  // ========================================
  // VALIDAR E PREPARAR IMPORTAÇÃO
  // ========================================

  function prepareImport(type, rows, currentDB) {
    const next = clone(currentDB);

    const result = {
      added: 0,
      updated: 0,
      rejected: 0,
      errors: []
    };

    rows.forEach((raw, index) => {
      try {
        const row = normalizeImport(raw);
        let existing = null;
        let item;

        // FORNECEDORES
        if (type === "suppliers") {
          const name = (row.nome || row.empresa || "").trim();
          const cnpj = digits(row.cnpj);

          if (!name || cnpj.length !== 14) {
            throw Error("Razão social ou CNPJ inválido.");
          }

          existing = next.suppliers.find(
            s => digits(s.cnpj) === cnpj
          );

          item = {
            ...(existing || {}),
            id: existing?.id || uuid(),
            nome: name,
            cnpj: cnpj.replace(
              /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
              "$1.$2.$3/$4-$5"
            )
          };

          for (const field of [
            "telefone", "email", "observacoes"
          ]) {
            if (Object.hasOwn(row, field)) {
              item[field] = row[field];
            }
          }

        // CONTRATOS
        } else if (type === "contracts") {
          const supplierId = findSupplier(row, next);

          if (!supplierId) {
            throw Error("Fornecedor não encontrado.");
          }

          if (!row.processo) {
            throw Error("Processo contratual obrigatório.");
          }

          const start = parseDate(row.vigenciaInicial);
          const finish = parseDate(row.vigenciaFinal);

          if (!start || !finish || finish < start) {
            throw Error("Vigência contratual inválida.");
          }

          existing =
            (row.id && next.contracts.find(
              c => c.id === row.id
            )) ||
            next.contracts.find(c =>
              c.supplier === supplierId &&
              c.processo === row.processo &&
              (c.numero || "") === (row.numero || "")
            );

          if (existing && existing.supplier !== supplierId) {
            throw Error("Contrato pertence a outro fornecedor.");
          }

          item = {
            ...(existing || {}),
            id: existing?.id || uuid(),
            supplier: supplierId,
            numero: row.numero || "",
            processo: row.processo,
            vigenciaInicial: start,
            vigenciaFinal: finish
          };

          for (const field of contractFields) {
            if (
              [
                "supplier", "numero", "processo",
                "vigenciaInicial", "vigenciaFinal"
              ].includes(field) ||
              !Object.hasOwn(row, field)
            ) continue;

            if (moneyFields.includes(field)) {
              if (row[field] === "") {
                item[field] = "";
                continue;
              }

              const value = parseAmount(row[field]);

              if (value === null) {
                throw Error(`Valor inválido: ${field}.`);
              }

              item[field] = String(value);

            } else if (integerFields.includes(field)) {
              if (row[field] === "") {
                item[field] = "";
                continue;
              }

              const value = Number(row[field]);

              if (
                !Number.isInteger(value) ||
                value < 0
              ) {
                throw Error(`Inteiro inválido: ${field}.`);
              }

              item[field] = String(value);

            } else {
              item[field] = row[field];
            }
          }

        // PAGAMENTOS E PENDÊNCIAS
        } else {
          const contractId = findContract(row, next);

          if (!contractId) {
            throw Error(
              "Contrato não identificado de forma única."
            );
          }

          const value = parseAmount(row.valor);

          if (
            value === null ||
            (type === "payments" && value <= 0)
          ) {
            throw Error("Valor financeiro inválido.");
          }

          const dateKey = type === "payments"
            ? "data"
            : "competencia";

          const descriptorKey = type === "payments"
            ? "descricao"
            : "referencia";

          const date = parseDate(
            row[dateKey],
            type === "pendencias"
          );

          if (!date) {
            throw Error("Data ou competência inválida.");
          }

          const descriptor = row[descriptorKey] || "";

          existing =
            (row.id && next[type].find(
              p => p.id === row.id
            )) ||
            next[type].find(p =>
              p.contractId === contractId &&
              p[dateKey] === date &&
              (p[descriptorKey] || "") === descriptor &&
              number(p.valor) === value
            );

          if (
            existing &&
            existing.contractId !== contractId
          ) {
            throw Error("ID vinculado a outro contrato.");
          }

          item = {
            ...(existing || {}),
            id: existing?.id || uuid(),
            contractId,
            [dateKey]: date,
            [descriptorKey]: descriptor,
            valor: String(value)
          };

          if (type === "payments") {
            if (Object.hasOwn(row, "competencia")) {
              if (
                row.competencia &&
                !parseDate(row.competencia, true)
              ) {
                throw Error("Competência inválida.");
              }

              item.competencia = row.competencia
                ? parseDate(row.competencia, true)
                : "";
            }

            for (const key of [
              "notaFiscal", "empenho", "processoPagamento"
            ]) {
              if (Object.hasOwn(row, key)) {
                item[key] = row[key];
              }
            }

          } else {
            item.status =
              canon(row.status || "aberto") === "concluido"
                ? "concluido"
                : "aberto";

            if (row.vencimento) {
              const expiration = parseDate(row.vencimento);

              if (!expiration) {
                throw Error("Vencimento inválido.");
              }

              item.vencimento = expiration;

            } else if (Object.hasOwn(row, "vencimento")) {
              item.vencimento = "";
            }

            if (Object.hasOwn(row, "observacoes")) {
              item.observacoes = row.observacoes;
            }
          }
        }

        validateRecord(type, item, next, item.id);

        const position = next[type].findIndex(
          row => row.id === item.id
        );

        if (position < 0) {
          next[type].push(item);
          result.added++;
        } else {
          next[type][position] = item;
          result.updated++;
        }

      } catch (error) {
        result.rejected++;

        if (result.errors.length < 25) {
          result.errors.push(
            `Linha ${index + 2}: ${error.message}`
          );
        }
      }
    });

    return { next, result };
  }

  // ========================================
  // LER ARQUIVOS CSV EM UTF-8/UTF-16/ANSI
  // ========================================

  function decodeBuffer(buffer) {
    const bytes = new Uint8Array(buffer);

    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le").decode(buffer);
    }

    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder("utf-16be").decode(buffer);
    }

    try {
      return new TextDecoder(
        "utf-8",
        { fatal: true }
      ).decode(buffer);

    } catch {
      return new TextDecoder("windows-1252").decode(buffer);
    }
  }

  function resetImport() {
    staged = null;
    $("importPreview").hidden = true;
    $("confirmImport").disabled = true;
  }

  async function previewImport(file) {
    resetImport();
    if (!remoteLoaded || storageLocked) { toast("Banco indisponível para importação."); return; }

    if (!file) return;

    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast("Selecione um arquivo CSV ou TXT.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast("Arquivo excede 5 MB.");
      return;
    }

    try {
      const text = decodeBuffer(await file.arrayBuffer());
      const parsed = parseCSV(text);

      if (parsed.rows.length > 10000) {
        throw Error("Máximo de 10.000 registros.");
      }

      const type = $("importType").value;

      const { result } = prepareImport(
        type,
        parsed.rows,
        db
      );

      staged = {
        type,
        rows: parsed.rows,
        filename: file.name
      };

      $("importSummary").innerHTML = [
        ["Novos", result.added],
        ["Atualizações", result.updated],
        ["Rejeitados", result.rejected]
      ].map(([label, value]) => `
        <article class="summary-item">
          <small>${label}</small>
          <strong>${value}</strong>
        </article>
      `).join("");

      $("importErrors").textContent =
        result.errors.join("\n") +
        (
          result.rejected > result.errors.length
            ? `\n... e mais ${
                result.rejected - result.errors.length
              } linhas rejeitadas.`
            : ""
        );

      const headers = parsed.headers.slice(0, 8);

      $("previewTable").innerHTML = `
        <thead>
          <tr>
            ${headers.map(h =>
              `<th>${esc(h)}</th>`
            ).join("")}
          </tr>
        </thead>

        <tbody>
          ${parsed.rows.slice(0, 8).map(row => `
            <tr>
              ${headers.map(header =>
                `<td>${esc(row[header])}</td>`
              ).join("")}
            </tr>
          `).join("")}
        </tbody>
      `;

      $("importPreview").hidden = false;

      $("confirmImport").disabled =
        result.added + result.updated === 0;

      $("importMessage").textContent =
        `${file.name}: ${parsed.rows.length} linha(s) ` +
        "analisada(s). Confira antes de confirmar.";

    } catch (error) {
      console.error(error);
      $("importMessage").textContent =
        `Erro: ${error.message}`;

      toast("Não foi possível preparar a importação.");
    }
  }

  async function confirmImport() {
    if (!staged || storageLocked) return;

    try {
      const { next, result } = prepareImport(
        staged.type,
        staged.rows,
        db
      );

      if (!result.added && !result.updated) {
        toast("Nenhum registro válido.");
        return;
      }

      if (
        !confirm(
          `Importar ${staged.filename}?\n\n` +
          `Novos: ${result.added}\n` +
          `Atualizados: ${result.updated}\n` +
          `Rejeitados: ${result.rejected}\n\n` +
          "Confirme para gravar no Supabase."
        )
      ) return;

      if (await saveDB(next)) {
        resetImport();

        $("importMessage").textContent =
          `Importação concluída: ${result.added} novo(s), ` +
          `${result.updated} atualizado(s) e ` +
          `${result.rejected} rejeitado(s).`;

        toast("CSV importado.");
      }

    } catch (error) {
      console.error(error);
      toast(`Falha na importação: ${error.message}`);
    }
  }

  // ========================================
  // EVENTOS DO SISTEMA
  // ========================================

  function showConnectionError(error) {
    // Um aviso persistente evita que um toast genérico esconda o diagnóstico.
    const detail = explainError(error);
    const message = /Falha de conexão|Failed to fetch|NetworkError|Load failed|fetch failed/i.test(detail)
      ? "O navegador não conseguiu alcançar a API. Verifique o endereço do projeto, a conexão e possíveis bloqueios de rede ou CORS."
      : /401|403|permission|polític|rls|jwt|auth/i.test(detail)
        ? "A API respondeu, mas a chave ou as permissões não permitem a operação. Verifique Auth, GRANT e RLS sem desativar a proteção."
        : /identificar a tabela|schema|coluna|column|PGRST205|PGRST204/i.test(detail)
          ? "A API pode estar acessível, mas a estrutura/nome da tabela não corresponde ao que o aplicativo espera."
          : "O banco não pôde ser inicializado. Confira o código e a resposta da API.";
    let panel = document.getElementById("cafSupabaseError");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "cafSupabaseError";
      panel.setAttribute("role", "alert");
      panel.style.cssText =
        "position:fixed;z-index:2147483647;bottom:16px;right:16px;" +
        "box-sizing:border-box;max-width:min(580px,calc(100vw - 32px));" +
        "max-height:80vh;overflow:auto;padding:16px 18px;border-radius:10px;" +
        "border:1px solid #d97706;background:#fff7ed;color:#7c2d12;" +
        "box-shadow:0 12px 32px rgba(0,0,0,.18);" +
        "font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif";
      document.body.append(panel);
    }
    panel.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = "Banco de dados indisponível — gravações bloqueadas";
    const intro = document.createElement("p");
    intro.textContent = message;
    const technical = document.createElement("pre");
    technical.style.cssText =
      "white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;" +
      "padding:9px;border-radius:5px;border:1px solid #fed7aa";
    technical.textContent = detail;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Tentar novamente";
    retry.style.cssText =
      "padding:8px 12px;cursor:pointer;border-radius:6px;border:1px solid #c2410c;" +
      "background:#fff;color:#9a3412;font-weight:600";
    retry.addEventListener("click", () => window.location.reload());
    panel.append(title, intro, technical, retry);
    console.error("[CAF] Erro original do Supabase:", error);
  }

  async function init() {
    try {
      db = await loadDB(true);
      remoteLoaded = true;
      storageLocked = false;
      document.getElementById("cafSupabaseError")?.remove();
    } catch (error) {
      storageLocked = true;
      showConnectionError(error);
    }
    renderAll();

    const forms = {
      supplierForm: "suppliers",
      contractForm: "contracts",
      paymentForm: "payments",
      pendingForm: "pendencias"
    };

    for (const [id, type] of Object.entries(forms)) {
      $(id).addEventListener(
        "submit",
        event => submitRecord(event, type)
      );
    }

    $("contractForm").addEventListener("input", updateCCT);

    const filters = {
      searchSuppliers: renderSuppliers,
      searchContracts: renderContracts,
      filterContractStatus: renderContracts,
      searchPayments: renderPayments,
      filterPaymentMonth: renderPayments,
      searchPending: renderPending,
      filterPendingStatus: renderPending
    };

    for (const [id, handler] of Object.entries(filters)) {
      $(id).addEventListener("input", handler);
      $(id).addEventListener("change", handler);
    }

    $("clearPaymentFilters").addEventListener("click", () => {
      $("searchPayments").value = "";
      $("filterPaymentMonth").value = "";
      renderPayments();
    });

    document.addEventListener("click", event => {
      const close = event.target.closest("[data-close]");

      if (close) {
        $(close.dataset.close)?.close();
        return;
      }

      const nav = event.target.closest("[data-view]");

      if (nav) {
        navigate(nav.dataset.view);
        return;
      }

      const create = event.target.closest("[data-action]");

      if (create) {
        const types = {
          "new-supplier": "suppliers",
          "new-contract": "contracts",
          "new-payment": "payments",
          "new-pending": "pendencias"
        };

        if (types[create.dataset.action]) {
          openForm(types[create.dataset.action]);
        }
        return;
      }

      const edit = event.target.closest("[data-edit]");

      if (edit) {
        openForm(edit.dataset.edit, edit.dataset.id);
        return;
      }

      const remove = event.target.closest("[data-delete]");

      if (remove) {
        deleteRecord(
          remove.dataset.delete,
          remove.dataset.id
        );
        return;
      }

      const toggle = event.target.closest("[data-toggle]");

      if (toggle) {
        togglePending(toggle.dataset.toggle);
        return;
      }

      const exportButton = event.target.closest("[data-export]");

      if (exportButton) {
        exportCSV(exportButton.dataset.export);
        return;
      }

      const template = event.target.closest("[data-template]");

      if (template) {
        exportTemplate(template.dataset.template);
      }
    });

    // Importação CSV
    $("chooseCsv").addEventListener(
      "click",
      () => $("csvFile").click()
    );

    $("csvFile").addEventListener(
      "change",
      async event => {
        await previewImport(event.target.files?.[0]);
        event.target.value = "";
      }
    );

    $("importType").addEventListener("change", () => {
      resetImport();
      $("importMessage").textContent =
        "Selecione um CSV correspondente ao cadastro.";
    });

    $("cancelImport").addEventListener("click", resetImport);
    $("confirmImport").addEventListener("click", confirmImport);

    const drop = $("csvDropzone");

    drop.addEventListener(
      "click",
      () => $("csvFile").click()
    );

    drop.addEventListener("keydown", event => {
      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        $("csvFile").click();
      }
    });

    drop.addEventListener("dragover", event => {
      event.preventDefault();
      drop.classList.add("dragover");
    });

    drop.addEventListener("dragleave", () => {
      drop.classList.remove("dragover");
    });

    drop.addEventListener("drop", async event => {
      event.preventDefault();
      drop.classList.remove("dragover");

      await previewImport(
        event.dataTransfer?.files?.[0]
      );
    });

    // Backup
    $("backupButton").addEventListener(
      "click",
      exportBackup
    );

    $("restoreButton").addEventListener(
      "click",
      () => $("restoreFile").click()
    );

    $("restoreFile").addEventListener(
      "change",
      async event => {
        await restoreBackup(event.target.files?.[0]);
        event.target.value = "";
      }
    );

    // Sincroniza a visualização quando a aba volta a receber foco.
    window.addEventListener("focus", async () => {
      if (!remoteLoaded || storageLocked || busy || document.querySelector("dialog[open]")) return;
      try {
        db = await loadDB();
        storageLocked = false;
        renderAll();
      } catch (error) {
        console.error(error);
        storageLocked = true;
        toast(`Falha ao sincronizar: ${explainError(error)}`);
      }
    });

    navigate("dashboard");

  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();

/* ==========================================
   CENTRAL DE DOCUMENTOS
   Excel / CSV / TXT / DOCX / PDF
   ========================================== */

(() => {
  const $ = id => document.getElementById(id);

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  // Bibliotecas carregadas apenas quando necessário
  const libraries = {
    xlsx: {
      url: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
      global: "XLSX"
    },
    docx: {
      url: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.9.1/mammoth.browser.min.js",
      global: "mammoth"
    },
    pdf: {
      url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      global: "pdfjsLib"
    }
  };

  const PDF_WORKER =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const MAX_FILE = 12 * 1024 * 1024;
  const MAX_ROWS = 10000;
  const MAX_PAGES = 100;
  const MAX_PREVIEW = 150000;

  const loadingLibraries = new Map();

  let documentState = null;
  let requestId = 0;

  function message(text) {
    $("docsMessage").textContent = text;
  }

  // ========================================
  // CARREGAMENTO DAS BIBLIOTECAS
  // ========================================

  function loadLibrary(name) {
    const config = libraries[name];

    if (window[config.global]) {
      return Promise.resolve(window[config.global]);
    }

    if (loadingLibraries.has(name)) {
      return loadingLibraries.get(name);
    }

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");

      script.src = config.url;
      script.async = true;

      script.onload = () => {
        if (window[config.global]) {
          resolve(window[config.global]);
        } else {
          reject(
            Error(`Não foi possível iniciar o leitor ${name}.`)
          );
        }
      };

      script.onerror = () => {
        reject(
          Error(
            `A biblioteca de ${name} não carregou. ` +
            "Verifique sua conexão com a internet."
          )
        );
      };

      document.head.appendChild(script);
    });

    loadingLibraries.set(name, promise);

    promise.catch(() => {
      loadingLibraries.delete(name);
    });

    return promise;
  }

  // ========================================
  // DECODIFICAR TEXTO
  // ========================================

  function decodeText(buffer) {
    const bytes = new Uint8Array(buffer);

    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le").decode(buffer);
    }

    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder("utf-16be").decode(buffer);
    }

    try {
      return new TextDecoder(
        "utf-8",
        { fatal: true }
      ).decode(buffer);
    } catch {
      return new TextDecoder("windows-1252").decode(buffer);
    }
  }

  function looksTabular(text) {
    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(line => line.trim())
      .slice(0, 4);

    if (lines.length < 2) return false;

    return [";", "\t", ","].some(separator => {
      const counts = lines.map(
        line => line.split(separator).length
      );

      return counts.every(
        count => count >= 2 && count === counts[0]
      );
    });
  }

  // ========================================
  // LIMPAR
  // ========================================

  function clearDocument() {
    requestId++;
    documentState = null;

    $("docsResult").hidden = true;
    $("docsSpreadsheet").hidden = true;
    $("docsTextResult").hidden = true;

    $("docsTable").replaceChildren();
    $("docsDetected").replaceChildren();

    $("docsText").value = "";
    $("docsFile").value = "";

    message("Selecione um documento para iniciar a leitura.");
  }

  // ========================================
  // DETECÇÃO DE INFORMAÇÕES
  // ========================================

  function detectInformation(text) {
    const patterns = [
      [
        "CNPJ",
        /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g
      ],
      [
        "Processos",
        /\b\d{5}\.\d{6}\/\d{4}-\d{2}\b/g
      ],
      [
        "Valores",
        /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g
      ],
      [
        "Datas",
        /\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/\d{4}\b/g
      ]
    ];

    const results = patterns
      .map(([label, regex]) => ({
        label,
        values: [
          ...new Set((text.match(regex) || []).slice(0, 30))
        ].slice(0, 8)
      }))
      .filter(item => item.values.length);

    $("docsDetected").innerHTML = results.length
      ? results.map(item => `
          <div class="docs-found-item">
            <strong>${esc(item.label)}</strong>
            <span>${esc(item.values.join(" · "))}</span>
          </div>
        `).join("")
      : `<p class="muted">
           Nenhuma informação reconhecida pelos padrões simples.
           Revise o texto manualmente.
         </p>`;
  }

  // ========================================
  // MOSTRAR TEXTO
  // ========================================

  function showText(text, note) {
    documentState = { kind: "text", text };

    $("docsResult").hidden = false;
    $("docsSpreadsheet").hidden = true;
    $("docsTextResult").hidden = false;

    $("docsText").value = text.slice(0, MAX_PREVIEW);

    $("docsTextNote").textContent =
      note +
      (
        text.length > MAX_PREVIEW
          ? " A prévia foi limitada, mas a exportação inclui o texto completo."
          : ""
      );

    detectInformation(text);

    message(
      "Texto extraído. Confira as informações antes de utilizá-las."
    );
  }

  // ========================================
  // MOSTRAR PLANILHAS
  // ========================================

  function renderSheet() {
    if (documentState?.kind !== "sheet") return;

    const name = $("docsSheetSelect").value;
    const matrix = documentState.sheets[name] || [];

    const previewRows = matrix.slice(0, 11);
    const maxCols = Math.min(
      20,
      Math.max(0, ...previewRows.map(row => row.length))
    );

    $("docsSheetInfo").textContent =
      `${name}: ${Math.max(0, matrix.length - 1)} linha(s). ` +
      "Prévia das primeiras dez linhas.";

    $("docsTable").innerHTML = matrix.length
      ? `
        <thead>
          <tr>
            ${Array.from(
              { length: maxCols },
              (_, index) =>
                `<th>${esc(previewRows[0][index] ?? "")}</th>`
            ).join("")}
          </tr>
        </thead>

        <tbody>
          ${previewRows.slice(1).map(row => `
            <tr>
              ${Array.from(
                { length: maxCols },
                (_, index) =>
                  `<td>${esc(row[index] ?? "")}</td>`
              ).join("")}
            </tr>
          `).join("")}
        </tbody>
      `
      : `<tbody><tr><td>Aba vazia.</td></tr></tbody>`;

    $("docsToImporter").disabled = matrix.length < 2;
  }

  function showSheets(sheets) {
    const names = Object.keys(sheets);

    if (!names.length) {
      throw Error("Nenhuma aba encontrada.");
    }

    documentState = { kind: "sheet", sheets };

    $("docsSheetSelect").replaceChildren(
      ...names.map(name => new Option(name, name))
    );

    $("docsResult").hidden = false;
    $("docsSpreadsheet").hidden = false;
    $("docsTextResult").hidden = true;

    renderSheet();

    message("Planilha lida. Escolha a aba para revisar os registros.");
  }

  // ========================================
  // EXCEL E CSV
  // ========================================

  async function readSpreadsheet(buffer, textMode = false) {
    const XLSX = await loadLibrary("xlsx");

    const workbook = XLSX.read(
      textMode ? decodeText(buffer) : buffer,
      textMode
        ? { type: "string" }
        : { type: "array", cellDates: false }
    );

    const sheets = {};

    for (const name of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(
        workbook.Sheets[name],
        {
          header: 1,
          defval: "",
          blankrows: false,
          raw: false,
          dateNF: "dd/mm/yyyy"
        }
      );

      if (rows.length > MAX_ROWS + 1) {
        throw Error(
          `A aba ${name} tem mais de ${MAX_ROWS} linhas.`
        );
      }

      if (rows.some(row => row.length > 80)) {
        throw Error("A planilha tem mais de 80 colunas.");
      }

      sheets[name] = rows.map(row =>
        row.map(cell => String(cell ?? ""))
      );
    }

    showSheets(sheets);
  }

  // ========================================
  // WORD DOCX
  // ========================================

  async function readDOCX(buffer) {
    const mammoth = await loadLibrary("docx");

    const result = await mammoth.extractRawText({
      arrayBuffer: buffer
    });

    showText(
      result.value || "",
      "Texto extraído do Word. Tabelas e formatação podem perder a estrutura."
    );
  }

  // ========================================
  // PDF
  // ========================================

  async function readPDF(buffer) {
    const pdfjs = await loadLibrary("pdf");

    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;

    const loading = pdfjs.getDocument({
      data: new Uint8Array(buffer)
    });

    try {
      const documentPDF = await loading.promise;
      const max = Math.min(documentPDF.numPages, MAX_PAGES);
      const pages = [];

      for (let i = 1; i <= max; i++) {
        const page = await documentPDF.getPage(i);
        const content = await page.getTextContent();

        pages.push(
          `PÁGINA ${i}\n` +
          content.items
            .map(item => item.str || "")
            .join(" ")
        );

        page.cleanup();
      }

      const text = pages.join("\n\n");

      showText(
        text,
        text.trim()
          ? `PDF com ${documentPDF.numPages} página(s). ` +
            "A extração preserva o texto, não necessariamente a formatação."
          : "PDF sem texto extraível. Pode ser necessário OCR."
      );

    } finally {
      await loading.destroy().catch(() => {});
    }
  }

  // ========================================
  // SELECIONAR DOCUMENTO
  // ========================================

  async function readDocument(file) {
    if (!file) return;

    const extension =
      file.name.split(".").pop().toLowerCase();

    if (
      !["xlsx", "xls", "csv", "txt", "docx", "pdf"]
        .includes(extension)
    ) {
      message("Formato não suportado.");
      return;
    }

    if (file.size > MAX_FILE) {
      message("Arquivo maior que 12 MB.");
      return;
    }

    const ticket = ++requestId;

    documentState = null;
    $("docsResult").hidden = true;

    message(`Lendo ${file.name}...`);

    try {
      const buffer = await file.arrayBuffer();

      if (ticket !== requestId) return;

      $("docsFilename").textContent = file.name;

      $("docsMetadata").textContent =
        `${(file.size / 1024).toFixed(1)} KB · ` +
        extension.toUpperCase();

      if (["xlsx", "xls", "csv"].includes(extension)) {
        await readSpreadsheet(
          buffer,
          extension === "csv"
        );

      } else if (extension === "txt") {
        const text = decodeText(buffer);

        if (looksTabular(text)) {
          await readSpreadsheet(buffer, true);
        } else {
          showText(text, "Arquivo de texto simples.");
        }

      } else if (extension === "docx") {
        await readDOCX(buffer);

      } else if (extension === "pdf") {
        await readPDF(buffer);
      }

    } catch (error) {
      console.error(error);

      if (ticket === requestId) {
        $("docsResult").hidden = true;
        message(`Falha na leitura: ${error.message}`);
      }
    }
  }

  // ========================================
  // ENVIAR PLANILHA AO IMPORTADOR CSV
  // ========================================

  function convertSheetToCSV(rows) {
    return "\uFEFF" + rows.map(row =>
      row.map(cell =>
        `"${String(cell ?? "").replace(/"/g, '""')}"`
      ).join(";")
    ).join("\r\n");
  }

  function sendToImporter() {
    if (documentState?.kind !== "sheet") return;

    const rows = documentState.sheets[
      $("docsSheetSelect").value
    ];

    if (!rows || rows.length < 2) return;

    if (typeof DataTransfer !== "function") {
      message(
        "Transferência não suportada. Salve a tabela como CSV."
      );
      return;
    }

    const csv = convertSheetToCSV(rows);

    const file = new File(
      [csv],
      "documento-para-importacao.csv",
      { type: "text/csv;charset=utf-8" }
    );

    const transfer = new DataTransfer();
    transfer.items.add(file);

    $("importType").value = $("docsTarget").value;

    const input = $("csvFile");
    input.files = transfer.files;

    document.querySelector(
      '[data-view="files"]'
    )?.click();

    input.dispatchEvent(
      new Event("change", { bubbles: true })
    );
  }

  // ========================================
  // COPIAR E EXPORTAR TEXTO
  // ========================================

  function downloadText(text) {
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF", text],
        { type: "text/plain;charset=utf-8" }
      )
    );

    const link = document.createElement("a");

    link.href = url;
    link.download = "texto-extraido.txt";

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function init() {
    if (!$("docsFile")) return;

    $("docsChoose").addEventListener(
      "click",
      () => $("docsFile").click()
    );

    $("docsClear").addEventListener(
      "click",
      clearDocument
    );

    $("docsFile").addEventListener(
      "change",
      async event => {
        await readDocument(event.target.files?.[0]);
        event.target.value = "";
      }
    );

    $("docsSheetSelect").addEventListener(
      "change",
      renderSheet
    );

    $("docsToImporter").addEventListener(
      "click",
      sendToImporter
    );

    $("docsCopy").addEventListener(
      "click",
      async () => {
        if (documentState?.kind !== "text") return;

        try {
          await navigator.clipboard.writeText(
            documentState.text
          );
          message("Texto copiado.");
        } catch {
          message("Não foi possível copiar automaticamente.");
        }
      }
    );

    $("docsExportText").addEventListener(
      "click",
      () => {
        if (documentState?.kind === "text") {
          downloadText(documentState.text);
        }
      }
    );

    const zone = $("docsDropzone");

    zone.addEventListener(
      "click",
      () => $("docsFile").click()
    );

    zone.addEventListener("keydown", event => {
      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        $("docsFile").click();
      }
    });

    zone.addEventListener("dragover", event => {
      event.preventDefault();
      zone.classList.add("dragover");
    });

    zone.addEventListener("dragleave", () => {
      zone.classList.remove("dragover");
    });

    zone.addEventListener("drop", async event => {
      event.preventDefault();
      zone.classList.remove("dragover");

      await readDocument(
        event.dataTransfer?.files?.[0]
      );
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
