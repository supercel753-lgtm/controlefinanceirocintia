
"use strict";

/*
  CAF SUREG-PA — Gestão Financeira
  Armazenamento local sem dados automáticos.
  Futuramente: autenticação, Supabase e permissões.
*/

(() => {
  const STORE = "caf-suregpa-v2";
  const EXERCISE = 2026;

  const TYPES = [
    "suppliers",
    "contracts",
    "payments",
    "pendencias"
  ];

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
    globalThis.crypto?.randomUUID?.() ||
    `caf-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);

  const normalize = value =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const canonical = value =>
    normalize(value).replace(/[^a-z0-9]/g, "");

  const digits = value =>
    String(value ?? "").replace(/\D/g, "");

  const num = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const sum = (list, key = "valor") =>
    list.reduce((s, r) => s + num(r[key]), 0);

  const brl = value =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(num(value));

  const isoToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(
      d.getMonth() + 1
    ).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  };

  const showDate = value =>
    /^\d{4}-\d{2}-\d{2}$/.test(value || "")
      ? value.split("-").reverse().join("/")
      : (value || "—");

  const showMonth = value =>
    /^\d{4}-\d{2}$/.test(value || "")
      ? `${value.slice(5)}/${value.slice(0, 4)}`
      : (value || "—");

  const moneyKeys = [
    "valorGlobal",
    "custoPosto",
    "gastoAnual2025",
    "ploa2026",
    "salario",
    "encargos",
    "materiais",
    "gastoMensal2025",
    "totalGasto2025"
  ];

  const integerKeys = [
    "postos",
    "qtdAtual",
    "qtdAnalise"
  ];

  const contractFields = [
    "supplier",
    "numero",
    "processo",
    "vigenciaInicial",
    "vigenciaFinal",
    "objeto",
    "valorGlobal",
    "custoPosto",
    "gastoAnual2025",
    "ploa2026",
    "unidade",
    "tipo",
    "modalidade",
    "nd",
    "gestor",
    "fiscalAdm",
    "fiscalTecnico",
    "suplente",
    "garantia",
    "tipoCusto",
    "categoria",
    "postos",
    "salario",
    "encargos",
    "materiais",
    "gastoMensal2025",
    "totalGasto2025",
    "qtdAtual",
    "qtdAnalise",
    "observacoes"
  ];

  const columns = {
    suppliers: [
      "id", "nome", "cnpj",
      "telefone", "email", "observacoes"
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
      "referencia", "vencimento", "status",
      "observacoes"
    ]
  };

  let db = emptyDB();
  let activeEdit = { type: null, id: null };
  let staging = null;
  let storageLocked = false;
  let toastTimer;

  // =========================================
  // NOTIFICAÇÕES E ARMAZENAMENTO
  // =========================================

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("visible");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(
      () => el.classList.remove("visible"),
      4500
    );
  }

  function readDB() {
    try {
      const raw = localStorage.getItem(STORE);

      if (raw === null) return emptyDB();

      const data = JSON.parse(raw);

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        TYPES.some(t => !Array.isArray(data[t]))
      ) {
        throw Error("Estrutura de dados incompatível");
      }

      if (
        TYPES.some(t =>
          data[t].some(row =>
            !row ||
            typeof row !== "object" ||
            Array.isArray(row)
          )
        )
      ) {
        throw Error("Registros incompatíveis");
      }

      return data;

    } catch (err) {
      console.error("Falha no armazenamento", err);
      storageLocked = true;
      return emptyDB();
    }
  }

  function persist(next) {
    if (storageLocked) {
      toast("Armazenamento bloqueado. Faça uma recuperação de backup.");
      return false;
    }

    try {
      localStorage.setItem(STORE, JSON.stringify(next));
      db = next;
      renderAll();
      return true;

    } catch (err) {
      console.error("Falha ao gravar", err);
      toast("Não foi possível salvar os dados neste navegador.");
      return false;
    }
  }

  // =========================================
  // RELACIONAMENTOS
  // =========================================

  const getSupplier = (id, state = db) =>
    state.suppliers.find(s => s.id === id);

  const getContract = (id, state = db) =>
    state.contracts.find(c => c.id === id);

  const supplierName = (c, state = db) =>
    getSupplier(c?.supplier, state)?.nome ||
    "Fornecedor não identificado";

  const contractLabel = (c, state = db) =>
    `${c.numero || c.processo || "Contrato"} — ${supplierName(c, state)}`;

  const contractStatus = c => {
    if (!c.vigenciaInicial || !c.vigenciaFinal) {
      return "Sem vigência";
    }

    if (c.vigenciaInicial > isoToday()) {
      return "A iniciar";
    }

    if (c.vigenciaFinal < isoToday()) {
      return "Encerrado";
    }

    return "Vigente";
  };

  const paidFor = (year, contractId) =>
    sum(
      db.payments.filter(p =>
        p.data?.startsWith(String(year)) &&
        getContract(p.contractId) &&
        (!contractId || p.contractId === contractId)
      )
    );

  const openPending = () =>
    db.pendencias.filter(p =>
      p.status !== "concluido" &&
      getContract(p.contractId)
    );

  const tag = text => `
    <span class="pill ${
      {
        "Vigente": "green",
        "A iniciar": "blue",
        "Encerrado": "red",
        "Pendente": "orange",
        "Concluída": "green"
      }[text] || ""
    }">${escapeHTML(text)}</span>
  `;

  const emptyRows = n => `
    <tr>
      <td class="empty" colspan="${n}">
        Nenhum registro encontrado.
      </td>
    </tr>
  `;

  const emptyCards = text =>
    `<div class="empty">${escapeHTML(text)}</div>`;

  const actionButtons = (kind, id) => `
    <td class="table-actions">
      <button type="button" data-edit="${kind}"
        data-id="${escapeHTML(id)}">Editar</button>
      <button type="button" class="delete"
        data-delete="${kind}"
        data-id="${escapeHTML(id)}">Excluir</button>
    </td>
  `;

  // =========================================
  // NAVEGAÇÃO
  // =========================================

  function navigate(view) {
    const titles = {
      dashboard: "Visão geral",
      contracts: "Contratos",
      payments: "Pagamentos",
      pending: "Pendências",
      budget: "Orçamento e PLOA",
      suppliers: "Fornecedores",
      files: "Importar e exportar",
      settings: "Configurações"
    };

    if (!titles[view]) return;

    $$(".view").forEach(el => {
      el.hidden = el.id !== `view-${view}`;
    });

    $$(".nav-link").forEach(btn => {
      const selected = btn.dataset.view === view;

      btn.classList.toggle("active", selected);

      if (selected) {
        btn.setAttribute("aria-current", "page");
      } else {
        btn.removeAttribute("aria-current");
      }
    });

    $("pageTitle").textContent = titles[view];

    renderAll();
  }

  // =========================================
  // DASHBOARD
  // =========================================

  function renderDashboard() {
    const open = openPending();
    const plan = sum(db.contracts, "ploa2026");
    const paid = paidFor(EXERCISE);

    $("kpiActive").textContent = String(
      db.contracts.filter(
        c => contractStatus(c) === "Vigente"
      ).length
    );

    $("kpiActiveSub").textContent =
      `${db.contracts.length} contrato(s) cadastrado(s)`;

    $("kpiPaid").textContent = brl(paid);

    $("kpiPaidSub").textContent =
      `${db.payments.filter(p =>
        p.data?.startsWith(String(EXERCISE)) &&
        getContract(p.contractId)
      ).length} pagamento(s) em ${EXERCISE}`;

    $("kpiPending").textContent = brl(sum(open));

    $("kpiPendingSub").textContent =
      `${open.length} pendência(s) aberta(s)`;

    $("kpiPloa").textContent = brl(plan);

    $("kpiPloaSub").textContent =
      `${db.contracts.filter(
        c => num(c.ploa2026) > 0
      ).length} contrato(s) com valor informado`;

    // Gráfico mensal
    const now = new Date();

    const months = Array.from(
      { length: 6 },
      (_, i) => {
        const d = new Date(
          now.getFullYear(),
          now.getMonth() - 5 + i,
          1
        );

        return `${d.getFullYear()}-${String(
          d.getMonth() + 1
        ).padStart(2, "0")}`;
      }
    );

    const data = months.map(month => ({
      month,

      paid: sum(
        db.payments.filter(p =>
          p.data?.slice(0, 7) === month &&
          getContract(p.contractId)
        )
      ),

      open: sum(
        open.filter(
          p => p.competencia === month
        )
      )
    }));

    const maximum = Math.max(
      1,
      ...data.flatMap(m => [m.paid, m.open])
    );

    $("monthlyChart").innerHTML = data.map(m => `
      <div class="chart-month">
        <div class="chart-bars">
          <div class="chart-bar paid"
            style="height:${m.paid / maximum * 100}%"
            title="Pagos: ${escapeHTML(brl(m.paid))}">
          </div>
          <div class="chart-bar open"
            style="height:${m.open / maximum * 100}%"
            title="Pendentes: ${escapeHTML(brl(m.open))}">
          </div>
        </div>
        <small>${showMonth(m.month)}</small>
      </div>
    `).join("");

    // Gráfico de situação contratual
    const labels = [
      "Vigente",
      "A iniciar",
      "Encerrado",
      "Sem vigência"
    ];

    const colors = [
      "#169167",
      "#2b83bf",
      "#c95d64",
      "#d9e1e9"
    ];

    const counts = labels.map(label =>
      db.contracts.filter(
        c => contractStatus(c) === label
      ).length
    );

    let point = 0;

    const stops = labels.map((_, i) => {
      const start = point;

      point += db.contracts.length
        ? counts[i] / db.contracts.length * 100
        : 0;

      return `${colors[i]} ${start}% ${point}%`;
    });

    $("statusDonut").style.background =
      db.contracts.length
        ? `conic-gradient(${stops.join(",")})`
        : "#e6edf3";

    $("statusLegend").innerHTML =
      labels.map((s, i) => `
        <div class="donut-line">
          <span>
            <i style="background:${colors[i]}"></i>
            ${s}
          </span>
          <b>${counts[i]}</b>
        </div>
      `).join("");

    // Últimos pagamentos
    const recent = db.payments
      .filter(p => getContract(p.contractId))
      .slice()
      .sort((a, b) =>
        (b.data || "").localeCompare(a.data || "")
      )
      .slice(0, 5);

    $("recentPayments").innerHTML =
      recent.map(p => `
        <div class="activity-row">
          <div>
            <strong>
              ${escapeHTML(
                supplierName(getContract(p.contractId))
              )}
            </strong>
            <small>
              ${showDate(p.data)} ·
              ${escapeHTML(
                getContract(p.contractId)?.numero || "Contrato"
              )}
            </small>
          </div>
          <b>${brl(p.valor)}</b>
        </div>
      `).join("") ||
      emptyCards("Nenhum pagamento registrado.");

    // Pendências abertas
    $("recentPending").innerHTML = open
      .slice()
      .sort((a, b) =>
        (b.competencia || "").localeCompare(
          a.competencia || ""
        )
      )
      .slice(0, 5)
      .map(p => `
        <div class="activity-row">
          <div>
            <strong>
              ${escapeHTML(
                supplierName(getContract(p.contractId))
              )}
            </strong>
            <small>Competência ${showMonth(p.competencia)}</small>
          </div>
          <b>${brl(p.valor)}</b>
        </div>
      `).join("") ||
      emptyCards("Nenhuma pendência aberta.");
  }

  // =========================================
  // FORNECEDORES
  // =========================================

  function renderSuppliers() {
    const search = normalize(
      $("searchSuppliers").value
    );

    const rows = db.suppliers
      .filter(s =>
        normalize(`${s.nome} ${s.cnpj}`).includes(search)
      )
      .slice()
      .sort((a, b) =>
        (a.nome || "").localeCompare(
          b.nome || "",
          "pt-BR"
        )
      );

    $("countSuppliers").textContent =
      `${rows.length} fornecedor(es)`;

    $("rowsSuppliers").innerHTML =
      rows.map(s => `
        <tr>
          <td><strong>${escapeHTML(s.nome)}</strong></td>
          <td>${escapeHTML(s.cnpj)}</td>
          <td>${escapeHTML(s.email || s.telefone || "—")}</td>
          <td>${
            db.contracts.filter(
              c => c.supplier === s.id
            ).length
          }</td>
          ${actionButtons("suppliers", s.id)}
        </tr>
      `).join("") || emptyRows(5);
  }

  // =========================================
  // CONTRATOS
  // =========================================

  function renderContracts() {
    const search = normalize(
      $("searchContracts").value
    );

    const filter = $("filterContractStatus").value;

    const rows = db.contracts.filter(c =>
      normalize(
        `${c.numero} ${c.processo} ${c.objeto} ${supplierName(c)}`
      ).includes(search) &&
      (
        filter === "todos" ||
        contractStatus(c) === filter
      )
    );

    $("countContracts").textContent =
      `${rows.length} contrato(s)`;

    $("rowsContracts").innerHTML =
      rows.map(c => `
        <tr>
          <td>
            <strong>${escapeHTML(c.numero || "—")}</strong>
            <small>${escapeHTML(c.processo || "—")}</small>
          </td>
          <td>${escapeHTML(supplierName(c))}</td>
          <td>
            ${showDate(c.vigenciaInicial)}
            a ${showDate(c.vigenciaFinal)}
          </td>
          <td>${brl(c.valorGlobal)}</td>
          <td>${tag(contractStatus(c))}</td>
          ${actionButtons("contracts", c.id)}
        </tr>
      `).join("") || emptyRows(6);
  }

  // =========================================
  // PAGAMENTOS
  // =========================================

  function renderPayments() {
    const search = normalize(
      $("searchPayments").value
    );

    const month = $("filterPaymentMonth").value;

    const rows = db.payments
      .filter(p => {
        const c = getContract(p.contractId);

        return c &&
          (!month || p.competencia === month) &&
          normalize(
            `${supplierName(c)}
             ${c.numero}
             ${c.processo}
             ${p.notaFiscal}
             ${p.empenho}
             ${p.descricao}`
          ).includes(search);
      })
      .slice()
      .sort((a, b) =>
        (b.data || "").localeCompare(a.data || "")
      );

    $("countPayments").textContent =
      `${rows.length} pagamento(s) · ${brl(sum(rows))}`;

    $("rowsPayments").innerHTML =
      rows.map(p => {
        const c = getContract(p.contractId);

        return `
          <tr>
            <td>${showDate(p.data)}</td>
            <td>
              <strong>${escapeHTML(supplierName(c))}</strong>
              <small>
                ${escapeHTML(c.numero || c.processo || "—")}
              </small>
            </td>
            <td>${showMonth(p.competencia)}</td>
            <td>
              ${escapeHTML(
                p.notaFiscal || p.descricao || "—"
              )}
            </td>
            <td><strong>${brl(p.valor)}</strong></td>
            ${actionButtons("payments", p.id)}
          </tr>
        `;
      }).join("") || emptyRows(6);
  }

  // =========================================
  // PENDÊNCIAS
  // =========================================

  function renderPending() {
    const search = normalize(
      $("searchPending").value
    );

    const filter = $("filterPendingStatus").value;

    const rows = db.pendencias
      .filter(p => {
        const c = getContract(p.contractId);

        return c &&
          (
            filter === "todos" ||
            (
              filter === "concluido"
                ? p.status === "concluido"
                : p.status !== "concluido"
            )
          ) &&
          normalize(
            `${supplierName(c)}
             ${c.numero}
             ${c.processo}
             ${p.referencia}
             ${p.competencia}
             ${p.observacoes}`
          ).includes(search);
      })
      .slice()
      .sort((a, b) =>
        (b.competencia || "").localeCompare(
          a.competencia || ""
        )
      );

    $("countPending").textContent =
      `${rows.length} registro(s) · ${brl(sum(rows))}`;

    $("pendingCards").innerHTML =
      rows.map(p => {
        const c = getContract(p.contractId);
        const finished = p.status === "concluido";

        return `
          <article class="pending-card">
            <div class="pending-top">
              <div>
                <h3>${escapeHTML(supplierName(c))}</h3>
                <div class="pending-meta">
                  Contrato: ${escapeHTML(c.numero || "—")}
                  · Competência: ${showMonth(p.competencia)}
                  <br>
                  Processo: ${escapeHTML(c.processo || "—")}
                  <br>
                  Referência: ${escapeHTML(p.referencia || "—")}
                  ${
                    p.vencimento
                      ? `<br>Vencimento: ${showDate(p.vencimento)}`
                      : ""
                  }
                </div>
              </div>
              <div class="pending-amount">
                ${tag(finished ? "Concluída" : "Pendente")}
                <strong>${brl(p.valor)}</strong>
              </div>
            </div>

            <div class="button-row">
              <button type="button" class="btn secondary small"
                data-edit="pendencias"
                data-id="${escapeHTML(p.id)}">
                Editar
              </button>

              <button type="button" class="btn danger small"
                data-delete="pendencias"
                data-id="${escapeHTML(p.id)}">
                Excluir
              </button>

              <button type="button"
                class="btn ${finished ? "secondary" : "success"} small"
                data-toggle="${escapeHTML(p.id)}">
                ${finished ? "Reabrir" : "Marcar como concluída"}
              </button>
            </div>
          </article>
        `;
      }).join("") ||
      emptyCards("Nenhuma pendência encontrada.");
  }

  // =========================================
  // ORÇAMENTO
  // =========================================

  function renderBudget() {
    const ploa = sum(db.contracts, "ploa2026");
    const paid = paidFor(EXERCISE);
    const last = sum(db.contracts, "gastoAnual2025");

    $("budgetSummary").innerHTML = [
      ["PLOA 2026", ploa],
      ["Pagamentos 2026", paid],
      ["Gasto 2025 informado", last]
    ].map(([name, value]) => `
      <article class="summary-item">
        <small>${name}</small>
        <strong>${brl(value)}</strong>
      </article>
    `).join("");

    const ratio = ploa > 0
      ? paid / ploa * 100
      : null;

    $("budgetPercent").textContent =
      ratio === null
        ? "PLOA não informado"
        : `${ratio.toFixed(1).replace(".", ",")}%`;

    $("budgetBar").style.width =
      `${Math.min(100, Math.max(0, ratio || 0))}%`;

    $("rowsBudget").innerHTML =
      db.contracts.map(c => {
        const paidContract = paidFor(EXERCISE, c.id);
        const p = num(c.ploa2026);

        const ratioContract = p > 0
          ? `${(paidContract / p * 100)
              .toFixed(1).replace(".", ",")}%`
          : "—";

        return `
          <tr>
            <td>
              <strong>${escapeHTML(supplierName(c))}</strong>
              <small>
                ${escapeHTML(c.numero || c.processo || "—")}
              </small>
            </td>
            <td>${brl(c.gastoAnual2025)}</td>
            <td>${brl(c.ploa2026)}</td>
            <td>${brl(paidContract)}</td>
            <td>${ratioContract}</td>
            <td class="table-actions">
              <button type="button"
                data-edit="contracts"
                data-id="${escapeHTML(c.id)}">
                Editar
              </button>
            </td>
          </tr>
        `;
      }).join("") || emptyRows(6);
  }

  function renderSettings() {
    $("storageInfo").textContent =
      `${db.suppliers.length} fornecedores · ` +
      `${db.contracts.length} contratos · ` +
      `${db.payments.length} pagamentos · ` +
      `${db.pendencias.length} pendências`;
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

  // =========================================
  // FORMULÁRIOS ESPECÍFICOS
  // =========================================

  const dialogs = {
    suppliers: [
      "supplierDialog",
      "supplierForm",
      "Fornecedor"
    ],
    contracts: [
      "contractDialog",
      "contractForm",
      "Contrato"
    ],
    payments: [
      "paymentDialog",
      "paymentForm",
      "Pagamento"
    ],
    pendencias: [
      "pendingDialog",
      "pendingForm",
      "Pendência"
    ]
  };

  function optionsForContracts() {
    return [...db.contracts].sort((a, b) =>
      contractLabel(a).localeCompare(
        contractLabel(b),
        "pt-BR"
      )
    );
  }

  function rebuildSelects() {
    const supplierSelect = $("contractSupplier");

    supplierSelect.replaceChildren(
      new Option("Selecione um fornecedor", "")
    );

    [...db.suppliers]
      .sort((a, b) =>
        (a.nome || "").localeCompare(
          b.nome || "",
          "pt-BR"
        )
      )
      .forEach(s =>
        supplierSelect.add(
          new Option(`${s.nome} — ${s.cnpj}`, s.id)
        )
      );

    $$('[data-contract-select]').forEach(select => {
      select.replaceChildren(
        new Option("Selecione um contrato", "")
      );

      optionsForContracts().forEach(c =>
        select.add(
          new Option(contractLabel(c), c.id)
        )
      );
    });
  }

  function fillForm(form, record) {
    form.reset();

    $$("[name]", form).forEach(input => {
      input.value =
        Object.prototype.hasOwnProperty.call(
          record,
          "" + input.name
        )
          ? (record[input.name] ?? "")
          : "";
    });
  }

  function updateCCT() {
    const f = $("contractForm").elements;

    const salary = num(
      f.namedItem("salario").value
    );

    const charges = num(
      f.namedItem("encargos").value
    );

    const posts = num(
      f.namedItem("postos").value
    );

    const materials = num(
      f.namedItem("materiais").value
    );

    $("cctEstimate").value = brl(
      salary * (1 + charges / 100) * posts + materials
    );
  }

  function openForm(type, id = null) {
    if (type === "contracts" && !db.suppliers.length) {
      toast(
        "Cadastre um fornecedor antes de cadastrar contratos."
      );
      navigate("suppliers");
      return;
    }

    if (
      ["payments", "pendencias"].includes(type) &&
      !db.contracts.length
    ) {
      toast(
        "Cadastre um contrato antes de registrar pagamentos ou pendências."
      );
      navigate("contracts");
      return;
    }

    const [dialogId, formId, label] = dialogs[type];

    activeEdit = { type, id };
    rebuildSelects();

    const record = db[type].find(
      item => item.id === id
    ) || {};

    fillForm($(formId), record);

    if (type === "payments" && !id) {
      $(formId).elements.namedItem("data").value =
        isoToday();
    }

    if (type === "pendencias" && !id) {
      $(formId).elements.namedItem("competencia").value =
        isoToday().slice(0, 7);

      $(formId).elements.namedItem("status").value =
        "aberto";
    }

    if (type === "contracts") {
      updateCCT();
    }

    const prefix =
      type === "suppliers" ? "supplier" :
      type === "contracts" ? "contract" :
      type === "payments" ? "payment" : "pending";

    $(`${prefix}DialogTitle`).textContent =
      `${id ? "Editar" : "Cadastrar"} ${label.toLowerCase()}`;

    $(dialogId).showModal();
  }

  function formData(form) {
    return Object.fromEntries(
      new FormData(form).entries()
    );
  }

  function validISODate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) {
      return false;
    }

    const [y, m, d] = s.split("-").map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));

    return (
      check.getUTCFullYear() === y &&
      check.getUTCMonth() === m - 1 &&
      check.getUTCDate() === d
    );
  }

  const validMonth = s =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(s || "");

  function validateRecord(type, record, state, excludeId = null) {
    if (type === "suppliers") {
      if (!String(record.nome || "").trim()) {
        throw Error("Informe a razão social.");
      }

      if (digits(record.cnpj).length !== 14) {
        throw Error("O CNPJ deve conter 14 dígitos.");
      }

      if (
        state.suppliers.some(s =>
          s.id !== excludeId &&
          digits(s.cnpj) === digits(record.cnpj)
        )
      ) {
        throw Error("CNPJ já cadastrado.");
      }
    }

    if (type === "contracts") {
      if (!getSupplier(record.supplier, state)) {
        throw Error("Selecione um fornecedor válido.");
      }

      if (!String(record.processo || "").trim()) {
        throw Error("Informe o processo contratual.");
      }

      if (
        !validISODate(record.vigenciaInicial) ||
        !validISODate(record.vigenciaFinal) ||
        record.vigenciaFinal < record.vigenciaInicial
      ) {
        throw Error("Informe uma vigência inicial e final válida.");
      }

      for (const key of [...moneyKeys, ...integerKeys]) {
        if (
          record[key] === "" ||
          record[key] === undefined
        ) {
          continue;
        }

        if (
          !Number.isFinite(Number(record[key])) ||
          Number(record[key]) < 0
        ) {
          throw Error(`Valor inválido no campo ${key}.`);
        }

        if (
          integerKeys.includes(key) &&
          !Number.isInteger(Number(record[key]))
        ) {
          throw Error(`O campo ${key} deve ser inteiro.`);
        }
      }
    }

    if (type === "payments") {
      if (!getContract(record.contractId, state)) {
        throw Error("Contrato inválido.");
      }

      if (!validISODate(record.data)) {
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
        throw Error(
          "O pagamento deve ter valor maior que zero."
        );
      }
    }

    if (type === "pendencias") {
      if (!getContract(record.contractId, state)) {
        throw Error("Contrato inválido.");
      }

      if (!validMonth(record.competencia)) {
        throw Error("Competência inválida.");
      }

      if (
        !Number.isFinite(Number(record.valor)) ||
        Number(record.valor) < 0
      ) {
        throw Error("Informe um valor não negativo.");
      }

      if (
        record.vencimento &&
        !validISODate(record.vencimento)
      ) {
        throw Error("Vencimento inválido.");
      }

      if (!["aberto", "concluido"].includes(record.status)) {
        throw Error("Situação inválida.");
      }
    }
  }

  function submitRecord(e, type) {
    e.preventDefault();

    const row = formData(e.currentTarget);
    const next = clone(db);

    const editId =
      activeEdit.type === type
        ? activeEdit.id
        : null;

    const index = next[type].findIndex(
      x => x.id === editId
    );

    const record = {
      ...(index >= 0 ? next[type][index] : {}),
      ...row,
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
    } catch (err) {
      toast(err.message);
      return;
    }

    if (index >= 0) {
      next[type][index] = record;
    } else {
      next[type].push(record);
    }

    if (persist(next)) {
      $(dialogs[type][0]).close();
      toast("Registro salvo com sucesso.");
    }
  }

  // =========================================
  // EXCLUSÃO E ALTERAÇÃO DE SITUAÇÃO
  // =========================================

  function deleteRecord(type, id) {
    const next = clone(db);

    if (!next[type].some(row => row.id === id)) {
      return;
    }

    if (
      type === "suppliers" &&
      next.contracts.some(c => c.supplier === id)
    ) {
      toast(
        "Este fornecedor possui contratos. Exclua-os antes."
      );
      return;
    }

    if (type === "contracts") {
      const pay = next.payments.filter(
        p => p.contractId === id
      ).length;

      const pending = next.pendencias.filter(
        p => p.contractId === id
      ).length;

      if (
        !confirm(
          `Excluir este contrato? Também serão excluídos ` +
          `${pay} pagamento(s) e ${pending} pendência(s) ` +
          `vinculados. Esta ação não pode ser desfeita.`
        )
      ) {
        return;
      }

      next.payments = next.payments.filter(
        p => p.contractId !== id
      );

      next.pendencias = next.pendencias.filter(
        p => p.contractId !== id
      );

    } else if (
      !confirm(
        "Excluir este registro? Esta ação não pode ser desfeita."
      )
    ) {
      return;
    }

    next[type] = next[type].filter(
      row => row.id !== id
    );

    if (persist(next)) {
      toast("Registro excluído.");
    }
  }

  function togglePending(id) {
    const next = clone(db);

    const item = next.pendencias.find(
      p => p.id === id
    );

    if (!item) return;

    item.status =
      item.status === "concluido"
        ? "aberto"
        : "concluido";

    if (persist(next)) {
      toast(
        "Situação alterada. Isso não registra pagamento automaticamente."
      );
    }
  }

  // =========================================
  // DOWNLOAD DE ARQUIVOS
  // =========================================

  function download(filename, content, mime) {
    const url = URL.createObjectURL(
      new Blob([content], { type: mime })
    );

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;

    document.body.append(a);
    a.click();
    a.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      1500
    );
  }

  // Proteção contra fórmulas em planilhas
  function csvCell(value) {
    let text = String(value ?? "");

    if (
      /^[\s]*[=+@-]/.test(text) &&
      !/^-?\d+(?:[.,]\d+)?$/.test(text.trim())
    ) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function enriched(type, row) {
    if (type === "suppliers") {
      return { ...row };
    }

    const c = type === "contracts"
      ? row
      : getContract(row.contractId);

    const s = getSupplier(c?.supplier);

    return {
      ...row,
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

  // =========================================
  // EXPORTAR CSV
  // =========================================

  function exportCSV(type) {
    if (!db[type].length) {
      toast("Nenhum registro para exportar.");
      return;
    }

    const rows = db[type].map(
      row => enriched(type, row)
    );

    const headers = [
      ...new Set([
        ...columns[type],
        ...rows.flatMap(row => Object.keys(row))
      ])
    ];

    const text = "\uFEFF" + [
      headers.map(csvCell).join(";"),
      ...rows.map(row =>
        headers.map(
          key => csvCell(row[key])
        ).join(";")
      )
    ].join("\r\n");

    download(
      `CAF-${type}-${isoToday()}.csv`,
      text,
      "text/csv;charset=utf-8"
    );

    toast("CSV exportado.");
  }

  // =========================================
  // MODELOS CSV VAZIOS
  // =========================================

  function exportTemplate(type) {
    const headers = columns[type].filter(
      k => ![
        "id", "supplier", "contractId", "empresa"
      ].includes(k)
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

  // =========================================
  // BACKUP JSON
  // =========================================

  function exportBackup() {
    download(
      `CAF-backup-${isoToday()}.json`,
      JSON.stringify(db, null, 2),
      "application/json;charset=utf-8"
    );

    toast("Backup JSON exportado.");
  }

  function validateBackup(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      TYPES.some(t => !Array.isArray(value[t]))
    ) {
      throw Error("Backup sem tabelas necessárias.");
    }

    const ids = {};

    for (const type of TYPES) {
      ids[type] = new Set();

      for (const row of value[type]) {
        if (
          !row ||
          typeof row !== "object" ||
          Array.isArray(row) ||
          typeof row.id !== "string" ||
          !row.id ||
          ids[type].has(row.id)
        ) {
          throw Error(`IDs inválidos em ${type}.`);
        }

        ids[type].add(row.id);
      }
    }

    for (const c of value.contracts) {
      if (!ids.suppliers.has(c.supplier)) {
        throw Error("Contrato sem fornecedor válido.");
      }
    }

    for (const type of ["payments", "pendencias"]) {
      for (const p of value[type]) {
        if (!ids.contracts.has(p.contractId)) {
          throw Error(
            `${type} contém contrato inexistente.`
          );
        }
      }
    }
  }

  async function restoreBackup(file) {
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      toast("O backup excede 12 MB.");
      return;
    }

    try {
      const data = JSON.parse(
        await file.text()
      );

      validateBackup(data);

      if (
        !confirm(
          "Substituir todos os registros atuais deste navegador pelo backup selecionado?"
        )
      ) {
        return;
      }

      storageLocked = false;

      if (persist(data)) {
        toast("Backup restaurado com sucesso.");
      }

    } catch (err) {
      console.error(err);
      toast(`Falha na restauração: ${err.message}`);
    }
  }

  // =========================================
  // INTERPRETADOR CSV
  // =========================================

  function parseCSV(text) {
    const input = text.replace(/^\uFEFF/, "");

    const firstLine = input.split(
      /\r?\n/,
      1
    )[0];

    const countOutsideQuotes = sep => {
      let count = 0;
      let quoted = false;

      for (let i = 0; i < firstLine.length; i++) {
        if (firstLine[i] === '"') {
          if (
            quoted &&
            firstLine[i + 1] === '"'
          ) {
            i++;
          } else {
            quoted = !quoted;
          }

        } else if (
          !quoted &&
          firstLine[i] === sep
        ) {
          count++;
        }
      }

      return count;
    };

    const delimiter = [
      ";", "\t", ","
    ].sort(
      (a, b) =>
        countOutsideQuotes(b) -
        countOutsideQuotes(a)
    )[0];

    if (!countOutsideQuotes(delimiter)) {
      throw Error(
        "Cabeçalho sem separador (; , ou tabulação)."
      );
    }

    const grid = [];
    let row = [];
    let cell = "";
    let quoted = false;

    const finish = () => {
      row.push(cell);

      if (row.some(x => x.trim())) {
        grid.push(row);
      }

      row = [];
      cell = "";
    };

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];

      if (ch === '"') {
        if (
          quoted &&
          input[i + 1] === '"'
        ) {
          cell += '"';
          i++;
        } else {
          quoted = !quoted;
        }

      } else if (
        ch === delimiter &&
        !quoted
      ) {
        row.push(cell);
        cell = "";

      } else if (
        (ch === "\n" || ch === "\r") &&
        !quoted
      ) {
        if (
          ch === "\r" &&
          input[i + 1] === "\n"
        ) {
          i++;
        }

        finish();

      } else {
        cell += ch;
      }
    }

    if (quoted) {
      throw Error("Arquivo com aspas não fechadas.");
    }

    finish();

    if (grid.length < 2) {
      throw Error(
        "O arquivo não contém linhas de dados."
      );
    }

    const headers = grid.shift().map(
      x => x.trim()
    );

    if (
      headers.some(h => !h) ||
      new Set(headers.map(canonical)).size !==
        headers.length
    ) {
      throw Error(
        "Cabeçalhos vazios ou duplicados."
      );
    }

    const rows = grid.map((cells, i) => {
      if (cells.length > headers.length) {
        throw Error(
          `Linha ${i + 2}: número de colunas acima do cabeçalho.`
        );
      }

      return Object.fromEntries(
        headers.map((head, j) => [
          head,
          (cells[j] ?? "").trim()
        ])
      );
    });

    return { headers, rows };
  }

  // =========================================
  // NOMES DE COLUNAS CSV
  // =========================================

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

  const allFields = [
    ...new Set(Object.values(columns).flat())
  ];

  function normalizeImport(raw) {
    const out = {};

    for (const [name, val] of Object.entries(raw)) {
      const key = canonical(name);

      const destination =
        aliases[key] ||
        allFields.find(k =>
          canonical(k) === key
        );

      if (!destination) continue;

      if (
        Object.prototype.hasOwnProperty.call(
          out,
          destination
        )
      ) {
        throw Error(
          `Colunas correspondentes duplicadas: ${destination}.`
        );
      }

      out[destination] = val;
    }

    return out;
  }

  // =========================================
  // VALORES E DATAS DE CSV
  // =========================================

  function parseAmount(input) {
    const original = String(input ?? "").trim();

    if (!original) return null;

    let s = original
      .replace(/R\$/gi, "")
      .replace(/\s/g, "");

    if (s.startsWith("'")) {
      s = s.slice(1);
    }

    const comma = s.lastIndexOf(",");
    const dot = s.lastIndexOf(".");

    if (comma > dot) {
      s = s.replace(/\./g, "").replace(",", ".");

    } else if (
      comma >= 0 &&
      dot > comma
    ) {
      s = s.replace(/,/g, "");

    } else if (
      /^\d{1,3}(\.\d{3})+$/.test(s)
    ) {
      s = s.replace(/\./g, "");
    }

    if (!/^\d+(?:\.\d+)?$/.test(s)) {
      return null;
    }

    const n = Number(s);

    return Number.isFinite(n) && n >= 0
      ? n
      : null;
  }

  function parseDate(input, monthOnly = false) {
    const raw = String(input ?? "").trim();

    let y, m, d;

    if (
      /^\d{4}-\d{2}(?:-\d{2})?$/.test(raw)
    ) {
      [y, m, d] = raw.split("-").map(Number);

    } else if (
      /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)
    ) {
      [d, m, y] = raw.split("/").map(Number);

    } else if (
      monthOnly &&
      /^\d{1,2}\/\d{4}$/.test(raw)
    ) {
      [m, y] = raw.split("/").map(Number);

    } else {
      return null;
    }

    if (
      !Number.isInteger(y) ||
      y < 1900 ||
      y > 2100 ||
      !Number.isInteger(m) ||
      m < 1 ||
      m > 12
    ) {
      return null;
    }

    const ym = `${y}-${String(m).padStart(2, "0")}`;

    if (monthOnly) return ym;

    const iso =
      `${ym}-${String(d).padStart(2, "0")}`;

    return validISODate(iso) ? iso : null;
  }

  // =========================================
  // VÍNCULOS DA IMPORTAÇÃO
  // =========================================

  function findSupplierImport(row, state) {
    const cnpj = digits(row.cnpj);

    if (cnpj.length === 14) {
      return state.suppliers.find(s =>
        digits(s.cnpj) === cnpj
      )?.id || null;
    }

    if (
      row.supplier &&
      state.suppliers.some(
        s => s.id === row.supplier
      )
    ) {
      return row.supplier;
    }

    const name = row.empresa || row.nome;

    const matches = name
      ? state.suppliers.filter(s =>
          normalize(s.nome) === normalize(name)
        )
      : [];

    return matches.length === 1
      ? matches[0].id
      : null;
  }

  function findContractImport(row, state) {
    const supplierId = findSupplierImport(
      row,
      state
    );

    if (row.cnpj && !supplierId) {
      return null;
    }

    if (row.contractId) {
      const exact = state.contracts.find(
        c => c.id === row.contractId
      );

      if (
        exact &&
        (!supplierId || exact.supplier === supplierId) &&
        (!row.numero || row.numero === exact.numero) &&
        (!row.processo || row.processo === exact.processo)
      ) {
        return exact.id;
      }

      if (exact) return null;
    }

    if (!row.numero && !row.processo) {
      return null;
    }

    const matches = state.contracts.filter(c =>
      (!row.numero || c.numero === row.numero) &&
      (!row.processo || c.processo === row.processo) &&
      (!supplierId || c.supplier === supplierId)
    );

    return matches.length === 1
      ? matches[0].id
      : null;
  }

  // =========================================
  // PREPARAR IMPORTAÇÃO
  // =========================================

  function prepareImport(type, rows, existingDB) {
    const next = clone(existingDB);

    const report = {
      added: 0,
      updated: 0,
      rejected: 0,
      errors: []
    };

    const fail = (line, reason) => {
      report.rejected++;

      if (report.errors.length < 25) {
        report.errors.push(
          `Linha ${line}: ${reason}`
        );
      }
    };

    rows.forEach((raw, i) => {
      const line = i + 2;

      try {
        const r = normalizeImport(raw);

        let current = null;
        let item;

        // FORNECEDORES
        if (type === "suppliers") {
          const name =
            (r.nome || r.empresa || "").trim();

          const cnpj = digits(r.cnpj);

          if (
            !name ||
            cnpj.length !== 14
          ) {
            throw Error(
              "Razão social ou CNPJ inválido."
            );
          }

          current = next.suppliers.find(s =>
            digits(s.cnpj) === cnpj
          );

          item = {
            ...(current || {}),
            id: current?.id || uuid(),
            nome: name,
            cnpj: cnpj.replace(
              /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
              "$1.$2.$3/$4-$5"
            )
          };

          for (const field of [
            "telefone",
            "email",
            "observacoes"
          ]) {
            if (Object.hasOwn(r, field)) {
              item[field] = r[field];
            }
          }

        // CONTRATOS
        } else if (type === "contracts") {
          const sid = findSupplierImport(r, next);

          if (!sid) {
            throw Error(
              "Fornecedor não encontrado. Importe fornecedores primeiro."
            );
          }

          if (!r.processo) {
            throw Error(
              "Processo contratual obrigatório."
            );
          }

          const initial = parseDate(
            r.vigenciaInicial
          );

          const final = parseDate(
            r.vigenciaFinal
          );

          if (
            !initial ||
            !final ||
            final < initial
          ) {
            throw Error(
              "Vigência inicial/final inválida."
            );
          }

          current =
            (
              r.id &&
              next.contracts.find(c => c.id === r.id)
            ) ||
            next.contracts.find(c =>
              c.supplier === sid &&
              c.processo === r.processo &&
              (c.numero || "") === (r.numero || "")
            );

          if (
            current &&
            current.supplier !== sid
          ) {
            throw Error(
              "ID contratual vinculado a outro fornecedor."
            );
          }

          item = {
            ...(current || {}),
            id: current?.id || uuid(),
            supplier: sid,
            numero: r.numero || "",
            processo: r.processo,
            vigenciaInicial: initial,
            vigenciaFinal: final
          };

          for (const field of contractFields) {
            if (
              [
                "supplier",
                "numero",
                "processo",
                "vigenciaInicial",
                "vigenciaFinal"
              ].includes(field) ||
              !Object.hasOwn(r, field)
            ) {
              continue;
            }

            if (moneyKeys.includes(field)) {
              if (r[field] === "") {
                item[field] = "";
                continue;
              }

              const n = parseAmount(
                r[field]
              );

              if (n === null) {
                throw Error(
                  `Valor inválido: ${field}.`
                );
              }

              item[field] = String(n);

            } else if (
              integerKeys.includes(field)
            ) {
              if (r[field] === "") {
                item[field] = "";
                continue;
              }

              const n = Number(r[field]);

              if (
                !Number.isInteger(n) ||
                n < 0
              ) {
                throw Error(
                  `Inteiro inválido: ${field}.`
                );
              }

              item[field] = String(n);

            } else {
              item[field] = r[field];
            }
          }

        // PAGAMENTOS E PENDÊNCIAS
        } else {
          const cid = findContractImport(
            r,
            next
          );

          if (!cid) {
            throw Error(
              "Contrato não encontrado de forma única ou vínculo incompatível."
            );
          }

          const value = parseAmount(
            r.valor
          );

          if (
            value === null ||
            (
              type === "payments" &&
              value <= 0
            )
          ) {
            throw Error(
              "Valor financeiro inválido."
            );
          }

          const dateKey =
            type === "payments"
              ? "data"
              : "competencia";

          const descriptionKey =
            type === "payments"
              ? "descricao"
              : "referencia";

          const date = parseDate(
            r[dateKey],
            type === "pendencias"
          );

          if (!date) {
            throw Error(
              `Data/competência inválida: ${dateKey}.`
            );
          }

          const descriptor =
            r[descriptionKey] || "";

          current =
            (
              r.id &&
              next[type].find(p => p.id === r.id)
            ) ||
            next[type].find(p =>
              p.contractId === cid &&
              p[dateKey] === date &&
              (p[descriptionKey] || "") === descriptor &&
              num(p.valor) === value
            );

          if (
            current &&
            current.contractId !== cid
          ) {
            throw Error(
              "ID já vinculado a outro contrato."
            );
          }

          item = {
            ...(current || {}),
            id: current?.id || uuid(),
            contractId: cid,
            [dateKey]: date,
            [descriptionKey]: descriptor,
            valor: String(value)
          };

          if (type === "payments") {
            if (
              Object.hasOwn(r, "competencia")
            ) {
              if (
                r.competencia &&
                !parseDate(r.competencia, true)
              ) {
                throw Error(
                  "Competência do pagamento inválida."
                );
              }

              item.competencia = r.competencia
                ? parseDate(r.competencia, true)
                : "";
            }

            for (const key of [
              "notaFiscal",
              "empenho",
              "processoPagamento"
            ]) {
              if (Object.hasOwn(r, key)) {
                item[key] = r[key];
              }
            }

          } else {
            item.status =
              canonical(r.status || "aberto") === "concluido"
                ? "concluido"
                : "aberto";

            if (r.vencimento) {
              const expiration = parseDate(
                r.vencimento
              );

              if (!expiration) {
                throw Error(
                  "Vencimento inválido."
                );
              }

              item.vencimento = expiration;

            } else if (
              Object.hasOwn(r, "vencimento")
            ) {
              item.vencimento = "";
            }

            if (
              Object.hasOwn(r, "observacoes")
            ) {
              item.observacoes = r.observacoes;
            }
          }
        }

        validateRecord(
          type,
          item,
          next,
          item.id
        );

        const idx = next[type].findIndex(
          x => x.id === item.id
        );

        if (idx < 0) {
          next[type].push(item);
          report.added++;
        } else {
          next[type][idx] = item;
          report.updated++;
        }

      } catch (err) {
        fail(line, err.message);
      }
    });

    return { next, report };
  }

  // =========================================
  // LEITURA DE CSV E TXT
  // =========================================

  async function decodeText(file) {
    const bytes = await file.arrayBuffer();
    const view = new Uint8Array(bytes);

    if (
      view[0] === 0xFF &&
      view[1] === 0xFE
    ) {
      return new TextDecoder("utf-16le").decode(bytes);
    }

    if (
      view[0] === 0xFE &&
      view[1] === 0xFF
    ) {
      return new TextDecoder("utf-16be").decode(bytes);
    }

    try {
      return new TextDecoder(
        "utf-8",
        { fatal: true }
      ).decode(bytes);

    } catch {
      return new TextDecoder(
        "windows-1252"
      ).decode(bytes);
    }
  }

  function cancelImport() {
    staging = null;
    $("importPreview").hidden = true;
    $("confirmImport").disabled = true;
  }

  async function previewImport(file) {
    cancelImport();

    if (!file) return;

    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast(
        "Selecione um arquivo CSV ou TXT tabular."
      );
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast(
        "Tamanho máximo: 5 MB por arquivo."
      );
      return;
    }

    try {
      const parsed = parseCSV(
        await decodeText(file)
      );

      if (parsed.rows.length > 10000) {
        throw Error(
          "Máximo de 10.000 linhas por arquivo."
        );
      }

      const kind = $("importType").value;

      const { report } = prepareImport(
        kind,
        parsed.rows,
        db
      );

      staging = {
        kind,
        rows: parsed.rows,
        filename: file.name
      };

      $("importSummary").innerHTML = [
        ["Novos", report.added],
        ["Atualizações", report.updated],
        ["Rejeitados", report.rejected]
      ].map(([label, n]) => `
        <div class="summary-item">
          <small>${label}</small>
          <strong>${n}</strong>
        </div>
      `).join("");

      $("importErrors").textContent =
        report.errors.join("\n") +
        (
          report.rejected > report.errors.length
            ? `\n... e mais ${
                report.rejected - report.errors.length
              } linha(s) rejeitada(s).`
            : ""
        );

      const headers = parsed.headers.slice(0, 8);

      $("previewTable").innerHTML = `
        <thead>
          <tr>
            ${headers.map(
              h => `<th>${escapeHTML(h)}</th>`
            ).join("")}
          </tr>
        </thead>

        <tbody>
          ${parsed.rows.slice(0, 8).map(r => `
            <tr>
              ${headers.map(h =>
                `<td>${escapeHTML(r[h])}</td>`
              ).join("")}
            </tr>
          `).join("")}
        </tbody>
      `;

      $("importPreview").hidden = false;

      $("confirmImport").disabled =
        report.added + report.updated === 0;

      $("importMessage").textContent =
        `${file.name}: ${parsed.rows.length} ` +
        `linha(s) analisada(s). Confira os totais ` +
        `e os erros antes de confirmar.`;

    } catch (err) {
      console.error(err);

      $("importMessage").textContent =
        `Erro: ${err.message}`;

      toast(
        "Não foi possível preparar o CSV."
      );
    }
  }

  function confirmImport() {
    if (!staging) return;

    if (storageLocked) {
      toast(
        "Armazenamento bloqueado. Restaure um backup primeiro."
      );
      return;
    }

    try {
      const { next, report } = prepareImport(
        staging.kind,
        staging.rows,
        db
      );

      if (!report.added && !report.updated) {
        toast(
          "Nenhum registro válido para importar."
        );
        return;
      }

      const message =
        `Importar ${staging.filename}?\n\n` +
        `Incluir: ${report.added}\n` +
        `Atualizar: ${report.updated}\n` +
        `Ignorar: ${report.rejected}\n\n` +
        `Faça backup antes de continuar.`;

      if (!confirm(message)) return;

      if (persist(next)) {
        cancelImport();

        $("importMessage").textContent =
          `Importação concluída: ` +
          `${report.added} incluído(s), ` +
          `${report.updated} atualizado(s) e ` +
          `${report.rejected} rejeitado(s).`;

        toast("Importação concluída.");
      }

    } catch (err) {
      console.error(err);
      toast(`Falha na importação: ${err.message}`);
    }
  }

  // =========================================
  // EVENTOS E INICIALIZAÇÃO
  // =========================================

  function init() {
    db = readDB();
    renderAll();

    // Formulários
    $("supplierForm").addEventListener(
      "submit",
      e => submitRecord(e, "suppliers")
    );

    $("contractForm").addEventListener(
      "submit",
      e => submitRecord(e, "contracts")
    );

    $("paymentForm").addEventListener(
      "submit",
      e => submitRecord(e, "payments")
    );

    $("pendingForm").addEventListener(
      "submit",
      e => submitRecord(e, "pendencias")
    );

    $("contractForm").addEventListener(
      "input",
      updateCCT
    );

    // Filtros
    $("searchSuppliers").addEventListener(
      "input",
      renderSuppliers
    );

    $("searchContracts").addEventListener(
      "input",
      renderContracts
    );

    $("filterContractStatus").addEventListener(
      "change",
      renderContracts
    );

    $("searchPayments").addEventListener(
      "input",
      renderPayments
    );

    $("filterPaymentMonth").addEventListener(
      "change",
      renderPayments
    );

    $("clearPaymentFilters").addEventListener(
      "click",
      () => {
        $("searchPayments").value = "";
        $("filterPaymentMonth").value = "";
        renderPayments();
      }
    );

    $("searchPending").addEventListener(
      "input",
      renderPending
    );

    $("filterPendingStatus").addEventListener(
      "change",
      renderPending
    );

    // Botões gerais
    document.addEventListener("click", e => {
      const close = e.target.closest("[data-close]");

      if (close) {
        $(close.dataset.close)?.close();
        return;
      }

      const go = e.target.closest("[data-view]");

      if (go) {
        navigate(go.dataset.view);
        return;
      }

      const create = e.target.closest("[data-action]");

      if (create) {
        const map = {
          "new-supplier": "suppliers",
          "new-contract": "contracts",
          "new-payment": "payments",
          "new-pending": "pendencias"
        };

        if (map[create.dataset.action]) {
          openForm(map[create.dataset.action]);
        }

        return;
      }

      const edit = e.target.closest("[data-edit]");

      if (edit) {
        openForm(edit.dataset.edit, edit.dataset.id);
        return;
      }

      const del = e.target.closest("[data-delete]");

      if (del) {
        deleteRecord(del.dataset.delete, del.dataset.id);
        return;
      }

      const toggle = e.target.closest("[data-toggle]");

      if (toggle) {
        togglePending(toggle.dataset.toggle);
        return;
      }

      const exp = e.target.closest("[data-export]");

      if (exp) {
        exportCSV(exp.dataset.export);
        return;
      }

      const model = e.target.closest("[data-template]");

      if (model) {
        exportTemplate(model.dataset.template);
        return;
      }
    });

    // Importação CSV
    $("chooseCsv").addEventListener(
      "click",
      () => $("csvFile").click()
    );

    $("csvFile").addEventListener(
      "change",
      async e => {
        await previewImport(
          e.target.files?.[0]
        );

        e.target.value = "";
      }
    );

    $("importType").addEventListener(
      "change",
      () => {
        cancelImport();

        $("importMessage").textContent =
          "Selecione um CSV correspondente a este tipo de registro.";
      }
    );

    $("cancelImport").addEventListener(
      "click",
      cancelImport
    );

    $("confirmImport").addEventListener(
      "click",
      confirmImport
    );

    // Arrastar arquivo para importar
    const drop = $("csvDropzone");

    drop.addEventListener(
      "click",
      () => $("csvFile").click()
    );

    drop.addEventListener(
      "keydown",
      e => {
        if (
          e.key === "Enter" ||
          e.key === " "
        ) {
          e.preventDefault();
          $("csvFile").click();
        }
      }
    );

    drop.addEventListener(
      "dragover",
      e => {
        e.preventDefault();
        drop.classList.add("dragover");
      }
    );

    drop.addEventListener(
      "dragleave",
      () => drop.classList.remove("dragover")
    );

    drop.addEventListener(
      "drop",
      async e => {
        e.preventDefault();
        drop.classList.remove("dragover");

        await previewImport(
          e.dataTransfer?.files?.[0]
        );
      }
    );

    // Backup e restauração
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
      async e => {
        await restoreBackup(
          e.target.files?.[0]
        );

        e.target.value = "";
      }
    );

    // Sincronizar abas do mesmo navegador
    window.addEventListener(
      "storage",
      e => {
        if (
          e.key === STORE &&
          !storageLocked
        ) {
          db = readDB();
          renderAll();
        }
      }
    );

    navigate("dashboard");

    if (storageLocked) {
      toast(
        "Não foi possível ler o armazenamento atual. Restaure um backup antes de editar."
      );
    }
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
