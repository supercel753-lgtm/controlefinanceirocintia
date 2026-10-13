import { supabase } from "../supabase.js";

/* =========================================================
   CONTROLE FINANCEIRO SUREGPA
   Front-end Supabase: autenticação, instituição, CRUD,
   painel, filtros, CSV, importação e exportação.
   ========================================================= */

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
  busy: false,
  editing: {
    supplier: null,
    contract: null,
    payment: null,
    pending: null
  }
};

const TABLES = {
  suppliers: "suppliers",
  contracts: "contracts",
  payments: "pagamentos",
  pending: "pendencias"
};

const money = value =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

const dateBR = value => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("pt-BR");
};

const today = () => new Date().toISOString().slice(0, 10);

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function notify(message, type = "info") {
  let toast = $("#toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.setAttribute("role", "status");
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "22px",
      right: "22px",
      zIndex: "99999",
      maxWidth: "min(440px,90vw)",
      padding: "14px 18px",
      borderRadius: "12px",
      color: "#fff",
      background: type === "error" ? "#b42318" :
        type === "success" ? "#18794e" : "#243447",
      boxShadow: "0 8px 30px #0002"
    });
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.background = type === "error" ? "#b42318" :
    type === "success" ? "#18794e" : "#243447";
  toast.hidden = false;

  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.hidden = true;
  }, 5000);
}

function showError(error, action = "Operação") {
  console.error(`[SUREGPA] ${action}:`, error);

  const detail = error?.message || error?.details || String(error);
  notify(`${action}: ${detail}`, "error");
}

function setBusy(value) {
  state.busy = value;
  document.body.classList.toggle("app-busy", value);
}

function canEdit() {
  return ["administrador", "editor"].includes(state.role);
}

function requireEdit() {
  if (canEdit()) return true;
  notify("Seu perfil permite apenas consultar os dados.", "error");
  return false;
}

function addInstitution(payload) {
  if (!state.institution?.id) {
    throw new Error("Nenhuma instituição está selecionada.");
  }

  return {
    ...payload,
    instituicao_id: state.institution.id
  };
}

/* =========================
   TELA DE AUTENTICAÇÃO
   ========================= */

function renderLogin() {
  let panel = $("#suregpaLogin");

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "suregpaLogin";

    Object.assign(panel.style, {
      position: "fixed",
      inset: "0",
      zIndex: "99990",
      background: "#f4f6fa",
      display: "grid",
      placeItems: "center",
      padding: "20px",
      overflowY: "auto"
    });

    panel.innerHTML = `
      <form id="suregpaLoginForm"
        style="width:min(440px,100%);background:white;padding:30px;
        border-radius:18px;box-shadow:0 12px 45px #15223818">
        <h1 style="margin:0 0 8px;color:#173b67">
          Controle Financeiro SUREGPA
        </h1>
        <p style="color:#65748b;margin-bottom:24px">
          Entre com sua conta autorizada para acessar o sistema.
        </p>

        <label for="suregpaEmail">E-mail</label>
        <input id="suregpaEmail" type="email" autocomplete="username"
          required placeholder="seu@email.gov.br"
          style="display:block;box-sizing:border-box;width:100%;
          padding:12px;margin:8px 0 18px;border:1px solid #ccd4df;
          border-radius:9px">

        <label for="suregpaPassword">Senha</label>
        <input id="suregpaPassword" type="password"
          autocomplete="current-password" required
          style="display:block;box-sizing:border-box;width:100%;
          padding:12px;margin:8px 0 20px;border:1px solid #ccd4df;
          border-radius:9px">

        <button type="submit"
          style="width:100%;padding:13px;border:0;border-radius:9px;
          background:#174a80;color:white;font-weight:700;cursor:pointer">
          Entrar no sistema
        </button>

        <button type="button" id="suregpaForgot"
          style="width:100%;padding:12px;margin-top:8px;border:0;
          background:transparent;color:#174a80;cursor:pointer">
          Esqueci minha senha
        </button>

        <p id="suregpaLoginMessage"
          style="color:#b42318;white-space:pre-wrap"></p>
      </form>`;

    document.body.appendChild(panel);
  }

  panel.hidden = false;

  const form = $("#suregpaLoginForm");

  if (form.dataset.bound) return;
  form.dataset.bound = "1";

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const email = $("#suregpaEmail").value.trim();
    const password = $("#suregpaPassword").value;
    const message = $("#suregpaLoginMessage");
    const button = $('button[type="submit"]', form);

    button.disabled = true;
    button.textContent = "Entrando...";
    message.textContent = "";

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await initializeApp();
    } catch (error) {
      message.textContent = error.message || "Não foi possível entrar.";
    } finally {
      button.disabled = false;
      button.textContent = "Entrar no sistema";
    }
  });

  $("#suregpaForgot").addEventListener("click", async () => {
    const email = $("#suregpaEmail").value.trim();

    if (!email) {
      $("#suregpaLoginMessage").textContent =
        "Informe seu e-mail para receber o link de recuperação.";
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });

      if (error) throw error;

      $("#suregpaLoginMessage").style.color = "#18794e";
      $("#suregpaLoginMessage").textContent =
        "Se o endereço estiver cadastrado, você receberá as instruções.";
    } catch (error) {
      $("#suregpaLoginMessage").style.color = "#b42318";
      $("#suregpaLoginMessage").textContent = error.message;
    }
  });
}

function hideLogin() {
  const panel = $("#suregpaLogin");
  if (panel) panel.hidden = true;
}

/* =========================
   INSTITUIÇÃO E PERMISSÕES
   ========================= */

async function loadMembership() {
  const { data, error } = await supabase
    .from("membros_instituicao")
    .select("instituicao_id, papel")
    .eq("usuario_id", state.user.id);

  if (error) throw error;

  if (!data?.length) {
    throw new Error(
      "Sua conta não está vinculada a uma instituição. " +
      "Peça ao administrador para cadastrar sua participação."
    );
  }

  let membership = data[0];

  if (data.length > 1) {
    const options = data.map((item, index) =>
      `${index + 1}. ${item.instituicao_id} (${item.papel})`
    ).join("\n");

    const chosen = prompt(
      "Escolha a instituição pelo número:\n" + options,
      "1"
    );

    const index = Number(chosen) - 1;

    if (!Number.isInteger(index) || !data[index]) {
      throw new Error("Seleção de instituição inválida.");
    }

    membership = data[index];
  }

  const { data: institution, error: institutionError } = await supabase
    .from("instituicoes")
    .select("*")
    .eq("id", membership.instituicao_id)
    .maybeSingle();

  if (institutionError) throw institutionError;
  if (!institution) throw new Error("Instituição não encontrada.");
  if (institution.ativa === false) {
    throw new Error("Esta instituição está inativa.");
  }

  state.institution = institution;
  state.role = membership.papel;
}

/* =========================
   CARREGAMENTO DE DADOS
   ========================= */

async function fetchRows(table, orderColumn = "criado_em") {
  let query = supabase.from(table).select("*");

  if (state.institution?.id) {
    query = query.eq("instituicao_id", state.institution.id);
  }

  const { data, error } = await query.order(orderColumn, {
    ascending: false
  });

  if (error) throw error;
  return data || [];
}

async function loadAllData() {
  const results = await Promise.allSettled([
    fetchRows(TABLES.suppliers),
    fetchRows(TABLES.contracts),
    fetchRows(TABLES.payments),
    fetchRows(TABLES.pending)
  ]);

  const labels = [
    "fornecedores",
    "contratos",
    "pagamentos",
    "pendências"
  ];

  const errors = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const value = result.value;

      if (index === 0) state.suppliers = value;
      if (index === 1) state.contracts = value;
      if (index === 2) state.payments = value;
      if (index === 3) state.pending = value;
    } else {
      errors.push(`${labels[index]}: ${result.reason?.message || result.reason}`);
      console.error(result.reason);
    }
  });

  renderAll();

  if (errors.length) {
    notify(
      "Alguns dados não puderam ser carregados:\n" + errors.join("\n"),
      "error"
    );
  }
}

/* =========================
   RENDERIZAÇÃO
   ========================= */

function putText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function putHTML(id, value) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = value;
}

function supplierName(id) {
  return state.suppliers.find(item => item.id === id)?.nome || "Fornecedor";
}

function contractNumber(id) {
  const contract = state.contracts.find(item => item.id === id);
  return contract?.numero || contract?.objeto || "Contrato";
}

function renderAll() {
  const institutionName = state.institution?.nome || "SUREGPA";

  putText("pageTitle", institutionName);
  putText("storageInfo", `${institutionName} · ${state.role || "consulta"}`);
  putText("storageInfoDetail", `Instituição: ${institutionName} · Perfil: ${state.role || "consulta"}`);

  renderDashboard();
  renderSuppliers();
  renderContracts();
  renderPayments();
  renderPending();
  renderBudget();
  renderPermissionState();
}

function renderPermissionState() {
  $$("button[data-action]").forEach(button => {
    if (!canEdit()) {
      button.disabled = true;
      button.title = "Seu perfil não permite alterações.";
    }
  });
}

function renderDashboard() {
  const activeContracts = state.contracts.filter(contract =>
    !["encerrado", "cancelado", "inativo"].includes(
      String(contract.status || "").toLowerCase()
    )
  );

  const paid = state.payments
    .filter(item => ["pago", "paga", "liquidado", "liquidada"].includes(
      String(item.status || "").toLowerCase()
    ))
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const unpaid = state.payments
    .filter(item => !["pago", "paga", "liquidado", "liquidada"].includes(
      String(item.status || "").toLowerCase()
    ))
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const contractValue = activeContracts.reduce(
    (sum, item) => sum + Number(item.valor || 0), 0
  );

  putText("kpiActive", String(activeContracts.length));
  putText("kpiActiveSub", `${state.contracts.length} contratos cadastrados`);
  putText("kpiPaid", money(paid));
  putText("kpiPaidSub", "Pagamentos com status de pago");
  putText("kpiPending", money(unpaid));
  putText("kpiPendingSub", `${state.pending.length} pendências registradas`);
  putText("kpiPloa", money(contractValue));
  putText("kpiPloaSub", "Valor total dos contratos ativos");

  const recent = [...state.payments]
    .sort((a, b) => String(b.competencia || b.criado_em || "")
      .localeCompare(String(a.competencia || a.criado_em || "")))
    .slice(0, 6);

  putHTML("recentPayments", recent.length
    ? recent.map(item => `
      <tr>
        <td>${escapeHTML(item.numero_documento || item.descricao || "Pagamento")}</td>
        <td>${escapeHTML(contractNumber(item.contrato_id))}</td>
        <td>${money(item.valor)}</td>
        <td>${escapeHTML(item.status || "Pendente")}</td>
      </tr>`).join("")
    : `<tr><td colspan="4">Nenhum pagamento cadastrado.</td></tr>`);

  const recentPending = [...state.pending].slice(0, 5);

  putHTML("recentPending", recentPending.length
    ? recentPending.map(item => `
      <tr>
        <td>${escapeHTML(item.titulo || item.descricao || "Pendência")}</td>
        <td>${escapeHTML(item.status || "Aberta")}</td>
        <td>${dateBR(item.prazo)}</td>
      </tr>`).join("")
    : `<tr><td colspan="3">Nenhuma pendência cadastrada.</td></tr>`);

  renderCharts();
}

function renderCharts() {
  const chart = $("#monthlyChart");

  if (chart) {
    const months = [];

    for (let offset = 5; offset >= 0; offset--) {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - offset);

      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      const total = state.payments
        .filter(item => String(item.competencia || item.data_pagamento || "")
          .startsWith(key))
        .reduce((sum, item) => sum + Number(item.valor || 0), 0);

      months.push({
        label: date.toLocaleDateString("pt-BR", { month: "short" }),
        total
      });
    }

    const max = Math.max(...months.map(item => item.total), 1);

    chart.innerHTML = `
      <div style="display:flex;align-items:end;gap:12px;height:170px;padding:12px">
        ${months.map(item => `
          <div style="flex:1;min-width:0;text-align:center">
            <div title="${money(item.total)}"
              style="height:${Math.max(4, item.total / max * 125)}px;
              background:#3478c8;border-radius:6px 6px 0 0"></div>
            <small>${escapeHTML(item.label)}</small>
          </div>
        `).join("")}
      </div>`;
  }

  const donut = $("#statusDonut");
  const legend = $("#statusLegend");

  if (donut) {
    const paid = state.payments.filter(item =>
      ["pago", "paga", "liquidado", "liquidada"].includes(
        String(item.status || "").toLowerCase()
      )
    ).length;

    const unpaid = state.payments.length - paid;

    donut.innerHTML = `
      <div style="padding:24px;text-align:center">
        <strong style="font-size:30px">${state.payments.length}</strong>
        <div>pagamentos</div>
        <div style="height:10px;display:flex;margin-top:12px;border-radius:9px;overflow:hidden">
          <div style="width:${state.payments.length ? paid / state.payments.length * 100 : 0}%;background:#18865a"></div>
          <div style="flex:1;background:#e8a23a"></div>
        </div>
      </div>`;
    if (legend) {
      legend.innerHTML = `
        <p>Pagos: ${paid}</p>
        <p>Pendentes: ${unpaid}</p>`;
    }
  }
}

function renderSuppliers() {
  const search = ($("#searchSuppliers")?.value || "").toLowerCase();
  const rows = state.suppliers.filter(item =>
    `${item.nome || ""} ${item.documento || ""} ${item.email || ""}`
      .toLowerCase().includes(search)
  );

  putText("countSuppliers", `${rows.length} fornecedores`);

  putHTML("rowsSuppliers", rows.map(item => `
    <tr>
      <td>${escapeHTML(item.nome)}</td>
      <td>${escapeHTML(item.documento || item.cnpj || "—")}</td>
      <td>${escapeHTML(item.email || "—")}</td>
      <td>${escapeHTML(item.telefone || "—")}</td>
      <td>
        <button type="button" data-edit-supplier="${escapeHTML(item.id)}">Editar</button>
        <button type="button" data-delete-supplier="${escapeHTML(item.id)}">Excluir</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5">Nenhum fornecedor encontrado.</td></tr>`);
}

function renderContracts() {
  const search = ($("#searchContracts")?.value || "").toLowerCase();
  const status = $("#filterContractStatus")?.value || "";

  const rows = state.contracts.filter(item => {
    const searchable = `${item.numero || ""} ${item.objeto || ""} ${item.numero_processo || ""} ${supplierName(item.fornecedor_id)}`.toLowerCase();

    return searchable.includes(search) &&
      (!status || item.status === status);
  });

  putText("countContracts", `${rows.length} contratos`);

  putHTML("rowsContracts", rows.map(item => `
    <tr>
      <td>${escapeHTML(item.numero || "—")}</td>
      <td>${escapeHTML(item.objeto || "—")}</td>
      <td>${escapeHTML(supplierName(item.fornecedor_id))}</td>
      <td>${money(item.valor)}</td>
      <td>${dateBR(item.data_inicio)}</td>
      <td>${dateBR(item.data_fim)}</td>
      <td>${escapeHTML(item.status || "Ativo")}</td>
      <td>
        <button type="button" data-edit-contract="${escapeHTML(item.id)}">Editar</button>
        <button type="button" data-delete-contract="${escapeHTML(item.id)}">Excluir</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="8">Nenhum contrato encontrado.</td></tr>`);

  const select = $("#contractSupplier");
  if (select) {
    const current = select.value;
    select.innerHTML = `<option value="">Selecione um fornecedor</option>` +
      state.suppliers.map(item =>
        `<option value="${escapeHTML(item.id)}">${escapeHTML(item.nome)}</option>`
      ).join("");
    select.value = current;
  }

  const paymentContract = $("#paymentContract");
  if (paymentContract) {
    const current = paymentContract.value;
    paymentContract.innerHTML = `<option value="">Selecione um contrato</option>` +
      state.contracts.map(item =>
        `<option value="${escapeHTML(item.id)}">${escapeHTML(item.numero || item.objeto || "Contrato")}</option>`
      ).join("");
    paymentContract.value = current;
  }

  const pendingContract = $("#pendingContract");
  if (pendingContract) {
    const current = pendingContract.value;
    pendingContract.innerHTML = `<option value="">Nenhum contrato</option>` +
      state.contracts.map(item =>
        `<option value="${escapeHTML(item.id)}">${escapeHTML(item.numero || item.objeto || "Contrato")}</option>`
      ).join("");
    pendingContract.value = current;
  }
}

function renderPayments() {
  const search = ($("#searchPayments")?.value || "").toLowerCase();
  const month = $("#filterPaymentMonth")?.value || "";

  const rows = state.payments.filter(item => {
    const searchable = `${item.numero_documento || ""} ${item.descricao || ""} ${item.status || ""} ${contractNumber(item.contrato_id)}`.toLowerCase();
    const date = String(item.competencia || item.data_pagamento || "");

    return searchable.includes(search) && (!month || date.startsWith(month));
  });

  putText("countPayments", `${rows.length} pagamentos`);

  putHTML("rowsPayments", rows.map(item => `
    <tr>
      <td>${escapeHTML(item.numero_documento || "—")}</td>
      <td>${escapeHTML(contractNumber(item.contrato_id))}</td>
      <td>${escapeHTML(item.descricao || "—")}</td>
      <td>${money(item.valor)}</td>
      <td>${dateBR(item.competencia || item.data_pagamento)}</td>
      <td>${escapeHTML(item.status || "Pendente")}</td>
      <td>
        <button type="button" data-edit-payment="${escapeHTML(item.id)}">Editar</button>
        <button type="button" data-delete-payment="${escapeHTML(item.id)}">Excluir</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="7">Nenhum pagamento encontrado.</td></tr>`);
}

function renderPending() {
  const search = ($("#searchPending")?.value || "").toLowerCase();
  const status = $("#filterPendingStatus")?.value || "";

  const rows = state.pending.filter(item => {
    const text = `${item.titulo || ""} ${item.descricao || ""} ${item.categoria || ""}`.toLowerCase();
    return text.includes(search) && (!status || item.status === status);
  });

  putText("countPending", `${rows.length} pendências`);

  putHTML("pendingCards", rows.map(item => `
    <article style="border:1px solid #e0e5ec;border-radius:12px;padding:16px;margin:10px 0">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <strong>${escapeHTML(item.titulo || item.descricao || "Pendência")}</strong>
        <span>${escapeHTML(item.prioridade || "Normal")}</span>
      </div>
      <p>${escapeHTML(item.descricao || "")}</p>
      <p>Status: ${escapeHTML(item.status || "aberta")} · Prazo: ${dateBR(item.prazo)}</p>
      <button type="button" data-edit-pending="${escapeHTML(item.id)}">Editar</button>
      <button type="button" data-delete-pending="${escapeHTML(item.id)}">Excluir</button>
    </article>
  `).join("") || `<p>Nenhuma pendência encontrada.</p>`);
}

function renderBudget() {
  const total = state.contracts.reduce((sum, item) => sum + Number(item.valor || 0), 0);
  const paid = state.payments
    .filter(item => ["pago", "paga", "liquidado", "liquidada"].includes(String(item.status || "").toLowerCase()))
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const percent = total > 0 ? Math.min(100, paid / total * 100) : 0;

  putText("budgetSummary", `Contratos: ${money(total)} · Pagamentos realizados: ${money(paid)}`);
  putText("budgetPercent", `${percent.toFixed(1).replace(".", ",")}%`);
  const bar = $("#budgetBar");
  if (bar) bar.style.width = `${percent}%`;

  putHTML("rowsBudget", state.contracts.map(item => {
    const payments = state.payments
      .filter(payment => payment.contrato_id === item.id)
      .reduce((sum, payment) => sum + Number(payment.valor || 0), 0);

    return `<tr>
      <td>${escapeHTML(item.numero || "—")}</td>
      <td>${escapeHTML(item.objeto || "—")}</td>
      <td>${money(item.valor)}</td>
      <td>${money(payments)}</td>
      <td>${money(Math.max(0, Number(item.valor || 0) - payments))}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5">Nenhum contrato cadastrado.</td></tr>`);
}

/* =========================
   OPERAÇÕES NO SUPABASE
   ========================= */

async function insertRow(table, payload) {
  const row = addInstitution(payload);
  const { data, error } = await supabase
    .from(table)
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateRow(table, id, payload) {
  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", id)
    .eq("instituicao_id", state.institution.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deleteRow(table, id) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .eq("instituicao_id", state.institution.id);

  if (error) throw error;
}

async function saveEntity(type, payload) {
  if (!requireEdit()) return;

  const table = TABLES[type];
  const id = state.editing[type];

  if (!table) throw new Error("Tipo de registro inválido.");

  setBusy(true);

  try {
    if (id) {
      await updateRow(table, id, payload);
    } else {
      await insertRow(table, payload);
    }

    state.editing[type] = null;
    await loadAllData();
    notify("Registro salvo com sucesso.", "success");
    closeDialog(type);
  } catch (error) {
    showError(error, "Não foi possível salvar");
  } finally {
    setBusy(false);
  }
}

async function removeEntity(type, id) {
  if (!requireEdit()) return;

  const labels = {
    supplier: "fornecedor",
    contract: "contrato",
    payment: "pagamento",
    pending: "pendência"
  };

  if (!confirm(`Tem certeza que deseja excluir este registro (${labels[type]})?`)) {
    return;
  }

  setBusy(true);

  try {
    await deleteRow(TABLES[type], id);
    await loadAllData();
    notify("Registro excluído.", "success");
  } catch (error) {
    showError(error, "Não foi possível excluir");
  } finally {
    setBusy(false);
  }
}

/* =========================
   FORMULÁRIOS
   ========================= */

function openDialog(type, item = null) {
  if (!requireEdit()) return;

  const dialog = $(`#${type}Dialog`);
  const form = $(`#${type}Form`);

  if (!dialog || !form) {
    notify(`Janela de ${type} não encontrada no index.html.`, "error");
    return;
  }

  state.editing[type] = item?.id || null;
  form.reset();

  const title = $(`#${type}DialogTitle`);
  if (title) title.textContent = item ? "Editar registro" : "Novo registro";

  const values = {
    supplier: {
      supplierName: item?.nome,
      supplierCnpj: item?.documento || item?.cnpj,
      supplierEmail: item?.email,
      supplierPhone: item?.telefone,
      supplierNotes: item?.observacoes
    },
    contract: {
      contractNumber: item?.numero,
      contractProcess: item?.numero_processo,
      contractSupplier: item?.fornecedor_id,
      contractObject: item?.objeto,
      contractValue: item?.valor,
      contractStart: item?.data_inicio,
      contractEnd: item?.data_fim,
      contractSource: item?.fonte_recurso,
      contractNotes: item?.observacoes
    },
    payment: {
      paymentContract: item?.contrato_id,
      paymentDate: item?.data_pagamento || item?.vencimento,
      paymentCompetence: item?.competencia,
      paymentValue: item?.valor,
      paymentInvoice: item?.numero_documento,
      paymentDescription: item?.descricao
    },
    pending: {
      pendingContract: item?.contrato_id,
      pendingReference: item?.titulo,
      pendingCompetence: item?.competencia,
      pendingValue: item?.valor,
      pendingDue: item?.prazo,
      pendingStatus: item?.status,
      pendingNotes: item?.descricao
    }
  };

  Object.entries(values[type] || {}).forEach(([id, value]) => {
    const input = $(`#${id}`);
    if (input && value != null) input.value = value;
  });

  if (type === "contract") {
    const status = $("#contractType");
    if (status && item?.status) status.value = item.status;
  }

  if (type === "pending") {
    const status = $("#pendingStatus");
    if (status && !item) status.value = "aberta";
  }

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.style.display = "block";
  }
}

function closeDialog(type) {
  const dialog = $(`#${type}Dialog`);
  if (!dialog) return;

  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  } else {
    dialog.style.display = "none";
  }
}

function formPayload(type) {
  const value = id => $(`#${id}`)?.value?.trim() ?? "";
  const numeric = id => {
    const raw = value(id).replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    return raw ? Number(raw) : 0;
  };

  if (type === "supplier") {
    return {
      nome: value("supplierName"),
      documento: value("supplierCnpj") || null,
      email: value("supplierEmail") || null,
      telefone: value("supplierPhone") || null,
      observacoes: value("supplierNotes") || null
    };
  }

  if (type === "contract") {
    return {
      numero: value("contractNumber"),
      numero_processo: value("contractProcess") || null,
      fornecedor_id: value("contractSupplier") || null,
      objeto: value("contractObject"),
      valor: numeric("contractValue"),
      data_inicio: value("contractStart") || null,
      data_fim: value("contractEnd") || null,
      status: value("contractType") || "ativo",
      fonte_recurso: value("contractSource") || null,
      observacoes: value("contractNotes") || null
    };
  }

  if (type === "payment") {
    return {
      contrato_id: value("paymentContract") || null,
      data_pagamento: value("paymentDate") || null,
      competencia: value("paymentCompetence") || null,
      valor: numeric("paymentValue"),
      numero_documento: value("paymentInvoice") || null,
      descricao: value("paymentDescription") || null,
      status: value("paymentDate") ? "pago" : "pendente"
    };
  }

  if (type === "pending") {
    return {
      contrato_id: value("pendingContract") || null,
      titulo: value("pendingReference") || "Pendência",
      competencia: value("pendingCompetence") || null,
      valor: numeric("pendingValue"),
      prazo: value("pendingDue") || null,
      status: value("pendingStatus") || "aberta",
      descricao: value("pendingNotes") || null
    };
  }

  throw new Error("Formulário desconhecido.");
}

function bindForms() {
  ["supplier", "contract", "payment", "pending"].forEach(type => {
    const form = $(`#${type}Form`);
    if (!form || form.dataset.bound) return;

    form.dataset.bound = "1";

    form.addEventListener("submit", async event => {
      event.preventDefault();

      try {
        await saveEntity(type, formPayload(type));
      } catch (error) {
        showError(error, "Erro no formulário");
      }
    });
  });
}

/* =========================
   NAVEGAÇÃO
   ========================= */

function navigate(view) {
  if (!view) return;

  const normalized = view.replace(/^view-/, "");

  $$("[id^='view-']").forEach(section => {
    section.hidden = section.id !== `view-${normalized}`;
  });

  $$("[data-view]").forEach(button => {
    const active = button.dataset.view === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  const titles = {
    dashboard: "Painel",
    contracts: "Contratos",
    payments: "Pagamentos",
    pending: "Pendências",
    budget: "Orçamento",
    suppliers: "Fornecedores",
    files: "Importação e exportação",
    documents: "Documentos",
    settings: "Configurações"
  };

  putText("pageTitle", titles[normalized] || "Controle Financeiro SUREGPA");
}

function bindNavigation() {
  document.addEventListener("click", event => {
    const nav = event.target.closest("[data-view]");

    if (nav) {
      event.preventDefault();
      navigate(nav.dataset.view);
      return;
    }

    const close = event.target.closest("[data-close]");
    if (close) {
      const id = close.dataset.close;
      const dialog = document.getElementById(id);
      if (dialog?.close) dialog.close();
      else if (dialog) dialog.style.display = "none";
    }
  });
}

/* =========================
   CLIQUES DE EDIÇÃO / EXCLUSÃO
   ========================= */

function bindActions() {
  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;

    const actions = [
      ["edit-supplier", "supplier", state.suppliers],
      ["edit-contract", "contract", state.contracts],
      ["edit-payment", "payment", state.payments],
      ["edit-pending", "pending", state.pending]
    ];

    for (const [attribute, type, collection] of actions) {
      const id = button.dataset[attribute];

      if (id) {
        const item = collection.find(row => row.id === id);
        if (item) openDialog(type, item);
        return;
      }
    }

    const deletions = [
      ["delete-supplier", "supplier"],
      ["delete-contract", "contract"],
      ["delete-payment", "payment"],
      ["delete-pending", "pending"]
    ];

    for (const [attribute, type] of deletions) {
      const id = button.dataset[attribute];

      if (id) {
        removeEntity(type, id);
        return;
      }
    }

    const action = button.dataset.action;

    if (action === "new-supplier") openDialog("supplier");
    if (action === "new-contract") openDialog("contract");
    if (action === "new-payment") openDialog("payment");
    if (action === "new-pending") openDialog("pending");
  });

  [
    ["searchSuppliers", renderSuppliers],
    ["searchContracts", renderContracts],
    ["filterContractStatus", renderContracts],
    ["searchPayments", renderPayments],
    ["filterPaymentMonth", renderPayments],
    ["searchPending", renderPending],
    ["filterPendingStatus", renderPending]
  ].forEach(([id, handler]) => {
    const input = $(`#${id}`);
    if (input) input.addEventListener("input", handler);
    if (input && input.tagName === "SELECT") {
      input.addEventListener("change", handler);
    }
  });

  $("#clearPaymentFilters")?.addEventListener("click", () => {
    if ($("#searchPayments")) $("#searchPayments").value = "";
    if ($("#filterPaymentMonth")) $("#filterPaymentMonth").value = "";
    renderPayments();
  });

  $("#refreshDataButton")?.addEventListener("click", loadAllData);

  $$("[id='backupButton']").forEach(button => {
    button.addEventListener("click", exportBackup);
  });

  $("#restoreButton")?.addEventListener("click", () => $("#restoreFile")?.click());
  $("#restoreFile")?.addEventListener("change", restoreBackup);

  $("#cancelImport")?.addEventListener("click", () => {
    $("#csvFile").value = "";
    putText("importMessage", "Importação cancelada.");
    putHTML("previewTable", "");
  });

  $("#chooseCsv")?.addEventListener("click", () => $("#csvFile")?.click());

  $("#csvDropzone")?.addEventListener("click", event => {
    if (!event.target.closest("button")) $("#csvFile")?.click();
  });

  $("#csvFile")?.addEventListener("change", handleImportFile);

  $$("[data-template]").forEach(button => {
    button.addEventListener("click", () => downloadTemplate(button.dataset.template));
  });
}

/* =========================
   CSV: IMPORTAÇÃO E EXPORTAÇÃO
   ========================= */

function parseCSV(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ";" : ",";

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(value => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some(value => value.trim() !== "")) rows.push(row);

  if (!rows.length) return [];

  const headers = rows.shift().map(value =>
    value.replace(/^\uFEFF/, "").trim()
  );

  return rows.map(values => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = (values[index] || "").trim();
    });
    return item;
  });
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getValue(row, candidates) {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const key = normalizeHeader(candidate);
    const entry = entries.find(([header]) => normalizeHeader(header) === key);
    if (entry && entry[1] !== "") return entry[1];
  }
  return "";
}

function parseMoney(value) {
  if (typeof value === "number") return value;

  let text = String(value || "").trim().replace(/[R$\s]/g, "");
  if (!text) return 0;

  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  return null;
}

function detectImportType(rows) {
  const requested = $("#importType")?.value;
  if (requested && requested !== "auto") return requested;

  const headers = Object.keys(rows[0] || {}).map(normalizeHeader).join(" ");

  if (headers.includes("fornecedor") || headers.includes("cnpj")) {
    if (headers.includes("numero") && headers.includes("objeto")) return "contracts";
    return "suppliers";
  }

  if (headers.includes("competencia") || headers.includes("datapagamento") ||
      headers.includes("numerodocumento")) return "payments";

  if (headers.includes("pendencia") || headers.includes("prioridade")) return "pending";

  if (headers.includes("objeto") && headers.includes("valor")) return "contracts";

  return "unknown";
}

function mapImportRow(type, row) {
  if (type === "suppliers") {
    return {
      nome: getValue(row, ["nome", "fornecedor", "razao social", "empresa"]),
      documento: getValue(row, ["cnpj", "cpf", "documento"]) || null,
      email: getValue(row, ["email", "e-mail"]) || null,
      telefone: getValue(row, ["telefone", "celular", "fone"]) || null
    };
  }

  if (type === "contracts") {
    const supplierText = getValue(row, ["fornecedor", "nome fornecedor"]);
    const supplier = state.suppliers.find(item =>
      normalizeHeader(item.nome) === normalizeHeader(supplierText)
    );

    return {
      numero: getValue(row, ["numero", "numero contrato", "contrato"]),
      numero_processo: getValue(row, ["processo", "numero processo"]) || null,
      fornecedor_id: supplier?.id || null,
      objeto: getValue(row, ["objeto", "descricao", "descricao contrato"]),
      valor: parseMoney(getValue(row, ["valor", "valor contrato", "valor total"])),
      data_inicio: parseDate(getValue(row, ["data inicio", "inicio", "vigencia inicial"])),
      data_fim: parseDate(getValue(row, ["data fim", "fim", "vigencia final"])),
      status: getValue(row, ["status"]) || "ativo",
      fonte_recurso: getValue(row, ["fonte", "fonte recurso"]) || null
    };
  }

  if (type === "payments") {
    const number = getValue(row, ["numero contrato", "contrato"]);
    const contract = state.contracts.find(item =>
      normalizeHeader(item.numero) === normalizeHeader(number)
    );

    return {
      contrato_id: contract?.id || null,
      numero_documento: getValue(row, ["documento", "nota fiscal", "numero documento"]) || null,
      descricao: getValue(row, ["descricao", "historico", "objeto"]) || null,
      valor: parseMoney(getValue(row, ["valor", "valor pagamento"])),
      competencia: parseDate(getValue(row, ["competencia", "data competencia"])),
      data_pagamento: parseDate(getValue(row, ["data pagamento", "pagamento"])) || null,
      vencimento: parseDate(getValue(row, ["vencimento", "data vencimento"])) || null,
      status: getValue(row, ["status"]) || "pendente"
    };
  }

  if (type === "pending") {
    return {
      titulo: getValue(row, ["titulo", "pendencia", "assunto"]) || "Pendência importada",
      descricao: getValue(row, ["descricao", "observacoes", "detalhes"]) || null,
      categoria: getValue(row, ["categoria", "tipo"]) || null,
      prioridade: getValue(row, ["prioridade"]) || "normal",
      status: getValue(row, ["status"]) || "aberta",
      prazo: parseDate(getValue(row, ["prazo", "data limite"])) || null
    };
  }

  throw new Error("Não consegui identificar o tipo de planilha.");
}

let pendingImport = null;

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    let rows;

    if (/\.csv$/i.test(file.name)) {
      rows = parseCSV(await file.text());
    } else if (/\.xlsx?$/i.test(file.name)) {
      const XLSX = await import("https://esm.sh/xlsx@0.18.5");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: ""
      });
    } else {
      throw new Error("Formato não suportado. Use CSV, XLS ou XLSX.");
    }

    if (!rows.length) throw new Error("O arquivo não contém linhas de dados.");

    const type = detectImportType(rows);

    if (!TABLES[type]) {
      throw new Error(
        "Não consegui identificar se a planilha contém fornecedores, contratos, pagamentos ou pendências. " +
        "Selecione o tipo de importação antes de enviar."
      );
    }

    const mapped = rows.map(row => mapImportRow(type, row));

    pendingImport = {
      file,
      type,
      rows: mapped
    };

    putText("importMessage",
      `${file.name}: ${mapped.length} linhas identificadas como ${type}. Confira a prévia antes de confirmar.`
    );

    putHTML("importSummary",
      `<p>Arquivo: ${escapeHTML(file.name)}</p>
       <p>Tipo identificado: ${escapeHTML(type)}</p>
       <p>Linhas: ${mapped.length}</p>`
    );

    const preview = mapped.slice(0, 10);

    putHTML("previewTable", preview.length ? `
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>${Object.keys(preview[0]).map(key =>
          `<th style="text-align:left;padding:8px">${escapeHTML(key)}</th>`
        ).join("")}</tr></thead>
        <tbody>${preview.map(row =>
          `<tr>${Object.values(row).map(value =>
            `<td style="padding:8px;border-top:1px solid #ddd">${escapeHTML(value ?? "")}</td>`
          ).join("")}</tr>`
        ).join("")}</tbody>
      </table>` : "");

    const confirmButton = $("#confirmImport");
    if (confirmButton) confirmButton.disabled = false;
  } catch (error) {
    pendingImport = null;
    showError(error, "Falha na leitura da planilha");
    putText("importMessage", error.message || "Erro na importação.");
  }
}

$("#confirmImport")?.addEventListener("click", async () => {
  if (!pendingImport || !requireEdit()) return;

  const { file, type, rows } = pendingImport;

  if (!confirm(`Importar ${rows.length} registros para ${type}?`)) return;

  setBusy(true);
  const errors = [];
  let imported = 0;

  try {
    for (let index = 0; index < rows.length; index++) {
      try {
        const row = rows[index];

        if (type === "suppliers" && !row.nome) {
          throw new Error("Nome do fornecedor vazio.");
        }

        if (type === "contracts" && !row.numero && !row.objeto) {
          throw new Error("Contrato sem número e sem objeto.");
        }

        await insertRow(TABLES[type], row);
        imported++;
      } catch (error) {
        errors.push(`Linha ${index + 2}: ${error.message || error}`);
      }
    }

    try {
      await supabase.from("importacoes").insert(addInstitution({
        arquivo_nome: file.name,
        formato: file.name.split(".").pop().toLowerCase(),
        sistema_origem: "Importação manual",
        modulo_destino: type,
        status: errors.length ? "parcial" : "concluida",
        total_linhas: rows.length,
        linhas_importadas: imported,
        linhas_rejeitadas: errors.length,
        resumo: { tipo: type },
        erros: errors,
        finalizado_em: new Date().toISOString()
      }));
    } catch (logError) {
      console.warn("Registro de auditoria de importação não disponível:", logError);
    }

    await loadAllData();

    putText("importMessage",
      `Importação concluída: ${imported} importados, ${errors.length} rejeitados.`
    );

    putHTML("importErrors", errors.length
      ? `<h3>Linhas rejeitadas</h3><ul>${errors.map(error =>
        `<li>${escapeHTML(error)}</li>`
      ).join("")}</ul>`
      : "");

    notify(`Importação concluída: ${imported} registros inseridos.`, "success");
    pendingImport = null;
  } catch (error) {
    showError(error, "Falha na importação");
  } finally {
    setBusy(false);
  }
});

function downloadFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCSV(rows) {
  if (!rows.length) return "";

  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];

  const escapeCell = value => {
    const text = value == null ? "" :
      typeof value === "object" ? JSON.stringify(value) : String(value);

    return `"${text.replace(/"/g, '""')}"`;
  };

  return [
    headers.map(escapeCell).join(";"),
    ...rows.map(row => headers.map(header => escapeCell(row[header])).join(";"))
  ].join("\r\n");
}

function downloadTemplate(type) {
  const templates = {
    suppliers: [{ nome: "Fornecedor exemplo", cnpj: "00000000000000", email: "exemplo@email.com", telefone: "" }],
    contracts: [{ numero: "001/2026", processo: "00000.000000/2026-00", fornecedor: "Fornecedor exemplo", objeto: "Descrição do contrato", valor: "1000,00", "data inicio": "01/01/2026", "data fim": "31/12/2026", status: "ativo" }],
    payments: [{ "numero contrato": "001/2026", documento: "NF-001", descricao: "Pagamento exemplo", valor: "100,00", competencia: "01/10/2026", "data pagamento": "", status: "pendente" }],
    pending: [{ titulo: "Pendência exemplo", descricao: "Descrição", prioridade: "normal", status: "aberta", prazo: "31/10/2026" }]
  };

  const rows = templates[type];
  if (!rows) {
    notify("Modelo de planilha desconhecido.", "error");
    return;
  }

  downloadFile(`modelo-${type}.csv`, "\uFEFF" + toCSV(rows), "text/csv;charset=utf-8");
}

function exportBackup() {
  const backup = {
    application: "Controle Financeiro SUREGPA",
    exportedAt: new Date().toISOString(),
    institution: state.institution?.id,
    data: {
      suppliers: state.suppliers,
      contracts: state.contracts,
      payments: state.payments,
      pending: state.pending
    }
  };

  downloadFile(
    `suregpa-backup-${today()}.json`,
    JSON.stringify(backup, null, 2),
    "application/json"
  );
}

async function restoreBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!requireEdit()) return;

  try {
    const backup = JSON.parse(await file.text());
    const data = backup.data;

    if (!data || !confirm(
      "A restauração vai INSERIR os registros do backup na instituição atual. " +
      "Ela não apagará automaticamente os dados existentes. Continuar?"
    )) return;

    const mapping = [
      ["suppliers", TABLES.suppliers],
      ["contracts", TABLES.contracts],
      ["payments", TABLES.payments],
      ["pending", TABLES.pending]
    ];

    let count = 0;

    for (const [key, table] of mapping) {
      for (const original of data[key] || []) {
        const row = { ...original };
        delete row.id;
        delete row.criado_em;
        delete row.atualizado_em;
        delete row.criado_por;

        await insertRow(table, row);
        count++;
      }
    }

    await loadAllData();
    notify(`Restauração concluída: ${count} registros inseridos.`, "success");
  } catch (error) {
    showError(error, "Falha ao restaurar backup");
  } finally {
    event.target.value = "";
  }
}

/* =========================
   SESSÃO E INICIALIZAÇÃO
   ========================= */

async function initializeApp() {
  try {
    setBusy(true);

    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;

    if (!data.user) {
      renderLogin();
      return;
    }

    state.user = data.user;

    await loadMembership();
    hideLogin();
    await loadAllData();

    const logoutButton = $("#logoutButton");

    if (logoutButton && !logoutButton.dataset.bound) {
      logoutButton.dataset.bound = "1";
      logoutButton.addEventListener("click", async () => {
        if (!confirm("Deseja sair do sistema?")) return;

        const { error: logoutError } = await supabase.auth.signOut();
        if (logoutError) {
          showError(logoutError, "Não foi possível sair");
          return;
        }

        location.reload();
      });
    }

    if (!$("#logoutButton")) {
      let button = $("#suregpaLogout");

      if (!button) {
        button = document.createElement("button");
        button.id = "suregpaLogout";
        button.type = "button";
        button.textContent = "Sair";
        Object.assign(button.style, {
          position: "fixed",
          right: "18px",
          bottom: "18px",
          zIndex: "9990",
          padding: "10px 16px",
          border: "0",
          borderRadius: "9px",
          background: "#173b67",
          color: "#fff",
          cursor: "pointer"
        });
        document.body.appendChild(button);
      }

      if (!button.dataset.bound) {
        button.dataset.bound = "1";
        button.addEventListener("click", async () => {
          if (!confirm("Deseja sair do sistema?")) return;
          const { error: logoutError } = await supabase.auth.signOut();
          if (logoutError) showError(logoutError, "Erro ao sair");
          else location.reload();
        });
      }
    }
  } catch (error) {
    console.error("[SUREGPA] Inicialização:", error);
    renderLogin();

    const message = $("#suregpaLoginMessage");
    if (message) {
      message.textContent = error.message ||
        "Não foi possível iniciar o sistema. Verifique sua conta e permissões.";
    } else {
      notify(error.message || "Erro ao iniciar o sistema.", "error");
    }
  } finally {
    setBusy(false);
  }
}

function start() {
  bindForms();
  bindNavigation();
  bindActions();

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      state.user = null;
      state.institution = null;
      state.role = null;
      renderLogin();
    }
  });

  initializeApp();
}

start();
