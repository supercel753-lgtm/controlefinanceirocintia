
"use strict";

(() => {
  const STORE = "sureg-pa-demo-v1";
  const ARCHIVE = "caf_suregpa_registros_antigos_arquivados_v1";
  const YEAR = 2026;

  const TYPES = [
    "suppliers",
    "contracts",
    "payments",
    "pendencias"
  ];

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) =>
    [...root.querySelectorAll(s)];

  const esc = v =>
    String(v ?? "").replace(/[&<>"']/g, x => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[x]);

  const uid = () =>
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const amount = v => {
    const s = String(v ?? "")
      .trim()
      .replace(/R\$|\s/g, "");

    const n = Number(
      s.includes(",")
        ? s.replace(/\./g, "").replace(",", ".")
        : s
    );

    return Number.isFinite(n) ? n : 0;
  };

  const positive = v => Math.max(0, amount(v));

  const brl = v =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(amount(v));

  const digits = v =>
    String(v ?? "").replace(/\D/g, "");

  const formatCNPJ = v =>
    digits(v).replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5"
    );

  const clean = v =>
    String(v ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const dateISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1)
      .padStart(2, "0")}-${String(d.getDate())
      .padStart(2, "0")}`;
  };

  const dateBR = v =>
    /^\d{4}-\d{2}-\d{2}$/.test(v || "")
      ? v.split("-").reverse().join("/")
      : (v || "—");

  const monthBR = v =>
    /^\d{4}-\d{2}$/.test(v || "")
      ? v.slice(5) + "/" + v.slice(0, 4)
      : (v || "—");

  const emptyDB = () => ({
    suppliers: [],
    contracts: [],
    payments: [],
    pendencias: []
  });

  const sum = (rows, key = "valor") =>
    rows.reduce(
      (acc, r) => acc + positive(r[key]),
      0
    );

  let db = emptyDB();
  let editing = { kind: "", id: null };
  let toastTimer;
  let locked = false;

  const supplier = id =>
    db.suppliers.find(s => s.id === id);

  const contract = id =>
    db.contracts.find(c => c.id === id);

  const company = c =>
    supplier(c?.supplier)?.nome ||
    "Fornecedor não localizado";

  const contractLabel = c =>
    `${c.numero || c.processo || "Sem identificação"} — ${company(c)}`;

  const status = c =>
    !c.vigenciaInicial || !c.vigenciaFinal
      ? "Sem vigência"
      : c.vigenciaInicial > dateISO()
        ? "A iniciar"
        : c.vigenciaFinal < dateISO()
          ? "Encerrado"
          : "Vigente";

  const emptyRows = count => `
    <tr>
      <td colspan="${count}" class="empty">
        Nenhum registro encontrado.
      </td>
    </tr>
  `;

  const pill = text => `
    <span class="pill ${
      {
        "Vigente": "green",
        "Concluído": "green",
        "A iniciar": "blue",
        "Encerrado": "red",
        "Pendente": "orange"
      }[text] || ""
    }">${esc(text)}</span>
  `;

  // ==========================================
  // NOTIFICAÇÕES E ARMAZENAMENTO
  // ==========================================

  function toast(message) {
    const box = $("#toast");

    box.textContent = message;
    box.classList.add("visible");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(
      () => box.classList.remove("visible"),
      3600
    );
  }

  function read() {
    try {
      const raw = localStorage.getItem(STORE);

      if (!raw) return emptyDB();

      const data = JSON.parse(raw);

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
      ) {
        throw Error("Dados inválidos");
      }

      return {
        ...data,
        ...Object.fromEntries(
          TYPES.map(key => [
            key,
            Array.isArray(data[key])
              ? data[key].filter(
                  x => x && typeof x === "object"
                )
              : []
          ])
        )
      };

    } catch (error) {
      console.error(error);
      locked = true;
      return emptyDB();
    }
  }

  const clone = () =>
    JSON.parse(JSON.stringify(db));

  function save(next) {
    if (locked) {
      toast(
        "Armazenamento indisponível. " +
        "Verifique o backup antes de editar."
      );
      return false;
    }

    try {
      localStorage.setItem(STORE, JSON.stringify(next));

      db = next;
      renderAll();
      return true;

    } catch (error) {
      console.error(error);
      toast("Não foi possível salvar neste navegador.");
      return false;
    }
  }

  // ==========================================
  // LIMPEZA DOS REGISTROS ARTIFICIAIS ANTIGOS
  // ==========================================

  function migrateLegacyExamples() {
    if (locked) return;

    const oldSuppliers = db.suppliers.filter(
      s =>
        s.nome === "Fornecedor Exemplo (DEMO)" &&
        digits(s.cnpj) === "12345678000190"
    );

    const idsSuppliers = new Set(
      oldSuppliers.map(s => s.id)
    );

    const oldContracts = db.contracts.filter(
      c =>
        idsSuppliers.has(c.supplier) &&
        c.numero === "DEMO-01/2026" &&
        c.processo === "00000.000000/2026-00"
    );

    const idsContracts = new Set(
      oldContracts.map(c => c.id)
    );

    const oldPayments = db.payments.filter(
      p => idsContracts.has(p.contractId)
    );

    const oldPending = db.pendencias.filter(
      p => idsContracts.has(p.contractId)
    );

    if (
      !oldContracts.length &&
      !oldSuppliers.length
    ) {
      return;
    }

    const archived = {
      suppliers: oldSuppliers,
      contracts: oldContracts,
      payments: oldPayments,
      pendencias: oldPending,
      createdAt: new Date().toISOString()
    };

    const next = clone();

    next.suppliers = next.suppliers.filter(
      s => !idsSuppliers.has(s.id)
    );

    next.contracts = next.contracts.filter(
      c => !idsContracts.has(c.id)
    );

    next.payments = next.payments.filter(
      p => !idsContracts.has(p.contractId)
    );

    next.pendencias = next.pendencias.filter(
      p => !idsContracts.has(p.contractId)
    );

    try {
      if (!localStorage.getItem(ARCHIVE)) {
        localStorage.setItem(
          ARCHIVE,
          JSON.stringify(archived)
        );
      }

      localStorage.setItem(
        STORE,
        JSON.stringify(next)
      );

      db = next;

    } catch (error) {
      console.warn(
        "Não foi possível arquivar os registros antigos",
        error
      );
    }
  }

  // ==========================================
  // SELETORES
  // ==========================================

  function refreshSelects() {
    const a = $("#contractSupplier");
    const current = a.value;

    a.replaceChildren(
      new Option("Selecione o fornecedor", "")
    );

    [...db.suppliers]
      .sort((x, y) =>
        (x.nome || "").localeCompare(
          y.nome || "",
          "pt-BR"
        )
      )
      .forEach(s => {
        a.add(
          new Option(
            `${s.nome} — ${s.cnpj}`,
            s.id
          )
        );
      });

    a.value = db.suppliers.some(
      s => s.id === current
    ) ? current : "";

    $$('[data-contract-select]').forEach(
      select => {
        const old = select.value;

        select.replaceChildren(
          new Option("Selecione o contrato", "")
        );

        [...db.contracts]
          .sort((x, y) =>
            contractLabel(x).localeCompare(
              contractLabel(y),
              "pt-BR"
            )
          )
          .forEach(c => {
            select.add(
              new Option(
                contractLabel(c),
                c.id
              )
            );
          });

        select.value = db.contracts.some(
          c => c.id === old
        ) ? old : "";
      }
    );
  }

  function paidInYear(year = YEAR) {
    return sum(
      db.payments.filter(
        p =>
          (p.data || "").startsWith(String(year)) &&
          contract(p.contractId)
      )
    );
  }

  function outstanding() {
    return db.pendencias.filter(
      p =>
        p.status !== "concluido" &&
        contract(p.contractId)
    );
  }

  // ==========================================
  // DASHBOARD
  // ==========================================

  function renderDashboard() {
    const open = outstanding();
    const paid = paidInYear();
    const planned = sum(
      db.contracts,
      "ploa2026"
    );

    const indicators = [
      [
        "Contratos vigentes",
        db.contracts.filter(
          c => status(c) === "Vigente"
        ).length,
        `${db.contracts.length} contrato(s) cadastrado(s)`,
        "",
        "▤"
      ],
      [
        `Pagamentos ${YEAR}`,
        brl(paid),
        "Pagamentos efetivamente registrados",
        "green",
        "↗"
      ],
      [
        "Pendências em aberto",
        brl(sum(open)),
        `${open.length} competência(s) em aberto`,
        "orange",
        "◷"
      ],
      [
        `PLOA ${YEAR}`,
        brl(planned),
        "Somatório do planejamento informado",
        "violet",
        "◫"
      ]
    ];

    $("#kpiGrid").innerHTML = indicators
      .map(([name, value, detail, tone, icon]) => `
        <div class="kpi ${tone}">
          <div class="kpi-name">
            ${esc(name)}
            <span>${icon}</span>
          </div>
          <strong>${esc(value)}</strong>
          <small>${esc(detail)}</small>
        </div>
      `)
      .join("");

    // GRÁFICO MENSAL

    const n = new Date();

    const months = Array.from(
      { length: 6 },
      (_, i) => {
        const d = new Date(
          n.getFullYear(),
          n.getMonth() - 5 + i,
          1
        );

        return `${d.getFullYear()}-${String(
          d.getMonth() + 1
        ).padStart(2, "0")}`;
      }
    );

    const graph = months.map(m => ({
      month: m,

      paid: sum(
        db.payments.filter(
          p =>
            (p.data || "").slice(0, 7) === m &&
            contract(p.contractId)
        )
      ),

      open: sum(
        open.filter(
          p => p.competencia === m
        )
      )
    }));

    const highest = Math.max(
      1,
      ...graph.flatMap(
        g => [g.paid, g.open]
      )
    );

    $("#monthlyChart").innerHTML = graph
      .map(g => `
        <div class="bar-group">
          <div class="bars">
            <div class="bar paid"
              style="height:${(g.paid / highest) * 100}%"
              title="Pagos: ${esc(brl(g.paid))}">
            </div>
            <div class="bar waiting"
              style="height:${(g.open / highest) * 100}%"
              title="Pendentes: ${esc(brl(g.open))}">
            </div>
          </div>
          <span>${esc(monthBR(g.month))}</span>
        </div>
      `)
      .join("");

    // GRÁFICO DE VIGÊNCIA

    const names = [
      "Vigente",
      "A iniciar",
      "Encerrado",
      "Sem vigência"
    ];

    const colors = [
      "#148c65",
      "#2c80c0",
      "#d45e66",
      "#d4dce5"
    ];

    const counts = names.map(
      name => db.contracts.filter(
        c => status(c) === name
      ).length
    );

    let start = 0;

    $("#donut").style.background =
      db.contracts.length
        ? `conic-gradient(${
            counts.map((count, i) => {
              const from = start;
              start += count / db.contracts.length * 100;
              return `${colors[i]} ${from}% ${start}%`;
            }).join(",")
          })`
        : "#e6edf3";

    $("#donutLegend").innerHTML = names
      .map((name, i) => `
        <div>
          <span>
            <i style="background:${colors[i]}"></i>
            ${name}
          </span>
          <b>${counts[i]}</b>
        </div>
      `)
      .join("");

    // PAGAMENTOS RECENTES

    const recent = db.payments
      .filter(
        p => contract(p.contractId)
      )
      .slice()
      .sort((a, b) =>
        (b.data || "").localeCompare(a.data || "")
      )
      .slice(0, 5);

    $("#recentPayments").innerHTML = recent
      .map(p => `
        <div class="activity-row">
          <div>
            <strong>
              ${esc(company(contract(p.contractId)))}
            </strong>
            <small>
              ${esc(dateBR(p.data))} ·
              ${esc(contract(p.contractId)?.numero || "Contrato")}
            </small>
          </div>
          <b>${brl(p.valor)}</b>
        </div>
      `)
      .join("") ||
      `<p class="empty-block">Nenhum pagamento cadastrado.</p>`;

    // PENDÊNCIAS RECENTES

    $("#recentPending").innerHTML = open
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
              ${esc(company(contract(p.contractId)))}
            </strong>
            <small>
              Competência ${esc(monthBR(p.competencia))}
            </small>
          </div>
          <b class="orange-text">${brl(p.valor)}</b>
        </div>
      `)
      .join("") ||
      `<p class="empty-block">Nenhuma pendência em aberto.</p>`;

    $("#dashboardNote").textContent =
      "O status 'Concluída' não registra automaticamente " +
      "um pagamento realizado.";
  }

  // ==========================================
  // FORNECEDORES
  // ==========================================

  function renderCompanies() {
    const q = clean(
      $("#filterCompanies").value
    );

    const rows = db.suppliers.filter(
      s => clean(`${s.nome} ${s.cnpj}`).includes(q)
    );

    $("#companiesRows").innerHTML = rows
      .map(s => `
        <tr>
          <td><b>${esc(s.nome)}</b></td>
          <td>${esc(s.cnpj)}</td>
          <td>
            ${
              db.contracts.filter(
                c => c.supplier === s.id
              ).length
            }
          </td>
          <td class="actions">
            <button data-action="edit-company"
              data-id="${esc(s.id)}">Editar</button>
            <button class="danger-text"
              data-action="delete-company"
              data-id="${esc(s.id)}">Excluir</button>
          </td>
        </tr>
      `)
      .join("") || emptyRows(4);

    $("#companiesTotal").textContent =
      `${rows.length} fornecedor(es)`;
  }

  // ==========================================
  // CONTRATOS
  // ==========================================

  function renderContracts() {
    const q = clean(
      $("#filterContracts").value
    );

    const rows = db.contracts.filter(
      c => clean(
        `${company(c)} ${c.numero} ${c.processo}`
      ).includes(q)
    );

    $("#contractsRows").innerHTML = rows
      .map(c => `
        <tr>
          <td>
            <b>${esc(c.numero || "—")}</b>
            <small>${esc(c.processo || "—")}</small>
          </td>
          <td>${esc(company(c))}</td>
          <td>${esc(dateBR(c.vigenciaFinal))}</td>
          <td>${brl(c.valorGlobal)}</td>
          <td>${pill(status(c))}</td>
          <td class="actions">
            <button data-action="edit-contract"
              data-id="${esc(c.id)}">Editar</button>
            <button class="danger-text"
              data-action="delete-contract"
              data-id="${esc(c.id)}">Excluir</button>
          </td>
        </tr>
      `)
      .join("") || emptyRows(6);

    $("#contractsTotal").textContent =
      `${rows.length} contrato(s)`;
  }

  // ==========================================
  // PAGAMENTOS
  // ==========================================

  function renderPayments() {
    const q = clean(
      $("#filterPayments").value
    );

    const rows = db.payments
      .filter(
        p =>
          contract(p.contractId) &&
          clean(
            `${company(contract(p.contractId))}
             ${contract(p.contractId)?.numero}
             ${p.descricao} ${p.data}`
          ).includes(q)
      )
      .slice()
      .sort((a, b) =>
        (b.data || "").localeCompare(a.data || "")
      );

    $("#paymentsRows").innerHTML = rows
      .map(p => `
        <tr>
          <td>${esc(dateBR(p.data))}</td>
          <td>
            ${esc(company(contract(p.contractId)))}
          </td>
          <td>
            ${esc(contract(p.contractId)?.numero || "—")}
          </td>
          <td>${esc(p.descricao || "—")}</td>
          <td><b>${brl(p.valor)}</b></td>
          <td class="actions">
            <button data-action="edit-payment"
              data-id="${esc(p.id)}">Editar</button>
            <button class="danger-text"
              data-action="delete-payment"
              data-id="${esc(p.id)}">Excluir</button>
          </td>
        </tr>
      `)
      .join("") || emptyRows(6);

    $("#paymentsTotal").textContent =
      `${rows.length} pagamento(s) · ${brl(sum(rows))}`;
  }

  // ==========================================
  // PENDÊNCIAS
  // ==========================================

  function renderPending() {
    const q = clean(
      $("#filterPending").value
    );

    const filter = $("#pendingStatus").value;
    const open = outstanding();

    $("#pendingTopline").textContent =
      `${open.length} pendente(s) · ${brl(sum(open))}`;

    const rows = db.pendencias
      .filter(p => {
        const c = contract(p.contractId);

        return (
          c &&
          (
            filter === "todos" ||
            (
              filter === "concluido"
                ? p.status === "concluido"
                : p.status !== "concluido"
            )
          ) &&
          clean(
            `${company(c)}
             ${supplier(c.supplier)?.cnpj}
             ${c.numero}
             ${c.processo}
             ${p.competencia}
             ${p.referencia}`
          ).includes(q)
        );
      })
      .slice()
      .sort((a, b) =>
        (b.competencia || "").localeCompare(
          a.competencia || ""
        )
      );

    $("#pendingCards").innerHTML = rows
      .map(p => {
        const c = contract(p.contractId);
        const done = p.status === "concluido";

        return `
          <article class="pending-card">
            <div class="pending-detail">
              <h3>${esc(company(c))}</h3>

              <div class="metadata">
                <span>
                  Contrato:
                  <b>${esc(c.numero || "—")}</b>
                </span>
                <span>
                  CNPJ:
                  <b>${esc(supplier(c.supplier)?.cnpj || "—")}</b>
                </span>
                <span>
                  Competência:
                  <b>${esc(monthBR(p.competencia))}</b>
                </span>
              </div>

              <p>Processo: ${esc(c.processo || "—")}</p>
            </div>

            <div class="pending-right">
              ${pill(done ? "Concluído" : "Pendente")}
              <small>
                ${esc(p.referencia || "Sem referência")}
              </small>
              <label>Valor líquido</label>
              <strong>${brl(p.valor)}</strong>
            </div>

            <div class="pending-actions">
              <button class="btn outline small"
                data-action="edit-pending"
                data-id="${esc(p.id)}">
                Editar
              </button>

              <button class="btn outline small danger"
                data-action="delete-pending"
                data-id="${esc(p.id)}">
                Excluir
              </button>

              <button class="btn ${done ? "outline" : "success"} small"
                data-action="toggle-pending"
                data-id="${esc(p.id)}">
                ${done ? "Reabrir" : "Marcar como concluída"}
              </button>
            </div>
          </article>
        `;
      })
      .join("") ||
      `<p class="empty-block">Nenhuma pendência encontrada.</p>`;
  }

  // ==========================================
  // ORÇAMENTO
  // ==========================================

  function renderBudget() {
    const plan = sum(
      db.contracts,
      "ploa2026"
    );

    const paid = paidInYear();

    const previous = sum(
      db.contracts,
      "gastoAnual2025"
    );

    const ratio = plan
      ? paid / plan * 100
      : null;

    $("#budgetSummary").innerHTML = [
      ["PLOA 2026 informado", brl(plan)],
      ["Pagamentos em 2026", brl(paid)],
      ["Gasto anual 2025 informado", brl(previous)]
    ]
      .map(([text, value]) => `
        <div class="mini-kpi">
          <small>${text}</small>
          <b>${value}</b>
        </div>
      `)
      .join("");

    $("#budgetBar").style.width =
      `${Math.min(100, Math.max(0, ratio || 0))}%`;

    $("#budgetProgress").textContent =
      ratio === null
        ? "PLOA ainda não informado"
        : `${ratio.toFixed(1).replace(".", ",")}% registrado`;

    $("#budgetRows").innerHTML = db.contracts
      .map(c => {
        const paid = sum(
          db.payments.filter(
            p =>
              p.contractId === c.id &&
              (p.data || "").startsWith(String(YEAR))
          )
        );

        const pct = positive(c.ploa2026)
          ? `${(paid / positive(c.ploa2026) * 100)
              .toFixed(1).replace(".", ",")}%`
          : "—";

        return `
          <tr>
            <td>
              ${esc(company(c))}
              <small>
                ${esc(c.numero || c.processo || "—")}
              </small>
            </td>
            <td>${brl(c.gastoAnual2025)}</td>
            <td>${brl(c.ploa2026)}</td>
            <td>${brl(paid)}</td>
            <td>${pct}</td>
            <td class="actions">
              <button data-action="edit-contract"
                data-id="${esc(c.id)}">
                Editar
              </button>
            </td>
          </tr>
        `;
      })
      .join("") || emptyRows(6);
  }

  // ==========================================
  // RELATÓRIOS
  // ==========================================

  function renderReports() {
    $("#reportStats").innerHTML = [
      ["Fornecedores", db.suppliers.length],
      ["Contratos", db.contracts.length],
      ["Pagamentos", db.payments.length],
      ["Pendências abertas", outstanding().length]
    ]
      .map(([n, v]) => `
        <div class="mini-kpi">
          <small>${n}</small>
          <b>${v}</b>
        </div>
      `)
      .join("");
  }

  function renderSettings() {
    $("#storageInfo").textContent =
      `${db.suppliers.length} fornecedores · ` +
      `${db.contracts.length} contratos · ` +
      `${db.payments.length} pagamentos · ` +
      `${db.pendencias.length} acompanhamentos`;
  }

  function renderAll() {
    refreshSelects();
    renderDashboard();
    renderContracts();
    renderPayments();
    renderPending();
    renderBudget();
    renderCompanies();
    renderReports();
    renderSettings();
  }

  // ==========================================
  // NAVEGAÇÃO
  // ==========================================

  const TITLES = {
    dashboard: "Visão geral",
    contracts: "Contratos",
    payments: "Pagamentos",
    pending: "Pendências",
    budget: "Orçamento e PLOA",
    companies: "Fornecedores",
    reports: "Importar e exportar",
    settings: "Configurações"
  };

  function navigate(to) {
    if (!TITLES[to]) return;

    $$(".view").forEach(
      v => v.hidden = v.id !== `view-${to}`
    );

    $$(".nav-item").forEach(b => {
      b.classList.toggle(
        "active",
        b.dataset.view === to
      );

      if (b.dataset.view === to) {
        b.setAttribute("aria-current", "page");
      } else {
        b.removeAttribute("aria-current");
      }
    });

    $("#pageTitle").textContent = TITLES[to];
    renderAll();
  }

  // ==========================================
  // FORMULÁRIOS
  // ==========================================

  const MODALS = {
    company: [
      "companyDialog",
      "companyForm",
      "suppliers",
      "Fornecedor"
    ],
    contract: [
      "contractDialog",
      "contractForm",
      "contracts",
      "Contrato"
    ],
    payment: [
      "paymentDialog",
      "paymentForm",
      "payments",
      "Pagamento"
    ],
    pending: [
      "pendingDialog",
      "pendingForm",
      "pendencias",
      "Pendência"
    ]
  };

  const values = form =>
    Object.fromEntries(
      new FormData(form).entries()
    );

  function calculateCCT() {
    const f = $("#contractForm").elements;

    const value =
      positive(f.namedItem("salario").value) *
      (
        1 +
        positive(f.namedItem("encargos").value) / 100
      ) *
      Math.floor(
        positive(f.namedItem("postos").value)
      ) +
      positive(f.namedItem("materiais").value);

    $("#cctTotal").value = brl(value);
  }

  function showForm(kind, id = null) {
    if (
      kind === "contract" &&
      !db.suppliers.length
    ) {
      toast(
        "Cadastre um fornecedor antes do contrato."
      );
      navigate("companies");
      return;
    }

    if (
      ["payment", "pending"].includes(kind) &&
      !db.contracts.length
    ) {
      toast("Cadastre um contrato primeiro.");
      navigate("contracts");
      return;
    }

    const [dialogId, formId, list, label] =
      MODALS[kind];

    editing = { kind, id };

    refreshSelects();

    const form = $("#" + formId);
    form.reset();

    const record = db[list].find(
      x => x.id === id
    );

    if (record) {
      $$("[name]", form).forEach(input => {
        if (
          Object.prototype.hasOwnProperty.call(
            record,
            input.name
          )
        ) {
          input.value =
            record[input.name] ?? "";
        }
      });
    }

    if (kind === "payment" && !id) {
      form.elements.namedItem("data").value =
        dateISO();
    }

    if (kind === "pending" && !id) {
      form.elements.namedItem("competencia").value =
        dateISO().slice(0, 7);
    }

    if (kind === "contract") {
      calculateCCT();
    }

    $("#" + dialogId + "Title").textContent =
      `${id ? "Editar" : "Cadastrar"} ${label.toLowerCase()}`;

    $("#" + dialogId).showModal();
  }

  function upsert(kind, row) {
    const [dialogId, , list] =
      MODALS[kind];

    const next = clone();

    const i = next[list].findIndex(
      x => x.id === editing.id
    );

    const obj = {
      ...(i >= 0 ? next[list][i] : {}),
      ...row,
      id: i >= 0 ? editing.id : uid()
    };

    if (i >= 0) {
      next[list][i] = obj;
    } else {
      next[list].push(obj);
    }

    if (save(next)) {
      $("#" + dialogId).close();
      toast("Registro salvo.");
    }
  }

  function handleCompany(e) {
    e.preventDefault();

    const data = values(e.currentTarget);
    const cnpj = digits(data.cnpj);

    if (cnpj.length !== 14) {
      toast("Informe um CNPJ com 14 dígitos.");
      return;
    }

    if (
      db.suppliers.some(
        s =>
          s.id !== editing.id &&
          digits(s.cnpj) === cnpj
      )
    ) {
      toast("CNPJ já cadastrado.");
      return;
    }

    upsert("company", {
      nome: data.nome.trim(),
      cnpj: formatCNPJ(cnpj)
    });
  }

  function handleContract(e) {
    e.preventDefault();

    const d = values(e.currentTarget);

    if (!supplier(d.supplier)) {
      toast("Selecione um fornecedor válido.");
      return;
    }

    if (d.vigenciaFinal < d.vigenciaInicial) {
      toast(
        "A vigência final deve ser posterior à inicial."
      );
      return;
    }

    upsert("contract", d);
  }

  function handlePayment(e) {
    e.preventDefault();

    const d = values(e.currentTarget);

    if (
      !contract(d.contractId) ||
      positive(d.valor) <= 0
    ) {
      toast(
        "Selecione um contrato e informe valor maior que zero."
      );
      return;
    }

    upsert("payment", d);
  }

  function handlePending(e) {
    e.preventDefault();

    const d = values(e.currentTarget);

    if (!contract(d.contractId)) {
      toast("Selecione um contrato válido.");
      return;
    }

    upsert("pending", {
      ...d,
      status: d.status === "concluido"
        ? "concluido"
        : "aberto"
    });
  }

  // ==========================================
  // EXCLUSÃO
  // ==========================================

  function remove(kind, id) {
    const next = clone();

    if (kind === "company") {
      if (
        next.contracts.some(
          c => c.supplier === id
        )
      ) {
        toast(
          "Há contratos vinculados. Exclua-os antes."
        );
        return;
      }

      if (!confirm("Excluir fornecedor?")) return;

      next.suppliers = next.suppliers.filter(
        s => s.id !== id
      );

    } else if (kind === "contract") {
      const payments = next.payments.filter(
        p => p.contractId === id
      ).length;

      const pending = next.pendencias.filter(
        p => p.contractId === id
      ).length;

      if (
        !confirm(
          `Excluir contrato e também ${payments} ` +
          `pagamento(s) e ${pending} pendência(s) vinculados?`
        )
      ) {
        return;
      }

      next.contracts = next.contracts.filter(
        c => c.id !== id
      );

      next.payments = next.payments.filter(
        p => p.contractId !== id
      );

      next.pendencias = next.pendencias.filter(
        p => p.contractId !== id
      );

    } else {
      if (!confirm("Excluir este registro?")) return;

      const table = kind === "payment"
        ? "payments"
        : "pendencias";

      next[table] = next[table].filter(
        x => x.id !== id
      );
    }

    if (save(next)) {
      toast("Registro excluído.");
    }
  }

  function togglePending(id) {
    const next = clone();

    const p = next.pendencias.find(
      x => x.id === id
    );

    if (!p) return;

    p.status =
      p.status === "concluido"
        ? "aberto"
        : "concluido";

    if (save(next)) {
      toast(
        "Situação atualizada. Nenhum pagamento foi criado."
      );
    }
  }

  // ==========================================
  // EXPORTAÇÃO CSV
  // ==========================================

  const COLUMNS = {
    suppliers: [
      "id", "nome", "cnpj"
    ],

    contracts: [
      "id", "supplier", "empresa", "cnpj",
      "numero", "processo", "vigenciaInicial",
      "vigenciaFinal", "valorGlobal", "ploa2026",
      "gastoAnual2025", "unidade", "tipo",
      "modalidade", "nd", "gestor", "fiscalAdm",
      "fiscalTecnico", "suplente", "garantia",
      "tipoCusto", "categoria", "postos",
      "salario", "encargos", "materiais",
      "custoPosto", "gastoMensal2025",
      "totalGasto2025", "qtdAtual",
      "qtdAnalise", "objeto", "observacoes"
    ],

    payments: [
      "id", "contractId", "contrato",
      "processo", "empresa", "cnpj",
      "data", "descricao", "valor"
    ],

    pendencias: [
      "id", "contractId", "contrato",
      "processo", "empresa", "cnpj",
      "competencia", "referencia",
      "valor", "status"
    ]
  };

  function enriched(type, row) {
    if (type === "suppliers") return row;

    const c = type === "contracts"
      ? row
      : contract(row.contractId);

    const s = supplier(c?.supplier);

    return {
      ...row,
      empresa: s?.nome || "",
      cnpj: s?.cnpj || "",
      ...(
        type === "contracts"
          ? {}
          : {
              contrato: c?.numero || "",
              processo: c?.processo || ""
            }
      )
    };
  }

  function download(filename, data, type) {
    const url = URL.createObjectURL(
      new Blob([data], { type })
    );

    const a = document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.append(a);
    a.click();
    a.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    );
  }

  const csvCell = v => {
    let s = String(v ?? "");

    if (
      /^[\s]*[=+@\-]/.test(s) &&
      !/^-?\d+(?:[.,]\d+)?$/.test(s.trim())
    ) {
      s = "'" + s;
    }

    return `"${s.replace(/"/g, '""')}"`;
  };

  function exportCSV(type) {
    const rows = db[type];

    if (!rows.length) {
      toast("Não existem registros para exportar.");
      return;
    }

    const cols = [
      ...new Set([
        ...COLUMNS[type],
        ...rows.flatMap(
          x => Object.keys(x)
        )
      ])
    ];

    const csv = "\uFEFF" +
      [
        cols,
        ...rows.map(r => {
          const obj = enriched(type, r);

          return cols.map(
            k => obj[k] ?? ""
          );
        })
      ]
        .map(r =>
          r.map(csvCell).join(";")
        )
        .join("\r\n");

    download(
      `CAF-${type}-${dateISO()}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );

    toast("CSV preparado.");
  }

  // ==========================================
  // BACKUP E RESTAURAÇÃO
  // ==========================================

  function backup() {
    download(
      `CAF-backup-${dateISO()}.json`,
      JSON.stringify(db, null, 2),
      "application/json"
    );

    toast("Backup gerado.");
  }

  async function restore(file) {
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      toast("Arquivo de backup muito grande.");
      return;
    }

    try {
      const next = JSON.parse(
        await file.text()
      );

      if (
        !next ||
        TYPES.some(
          k => !Array.isArray(next[k])
        )
      ) {
        throw Error("Formato inválido");
      }

      if (
        !confirm(
          "Restaurar backup e substituir TODOS os registros atuais?"
        )
      ) {
        return;
      }

      locked = false;

      if (save(next)) {
        toast("Backup restaurado.");
      }

    } catch (error) {
      console.error(error);
      toast("Backup JSON inválido.");
    }
  }

  // ==========================================
  // IMPORTAÇÃO CSV / TXT
  // ==========================================

  function parseTable(text) {
    const input = text.replace(/^\uFEFF/, "");
    const head = input.split(/\r?\n/, 1)[0];

    let delimiter = ";";
    let best = -1;

    for (const d of [";", "\t", ","]) {
      const count = head.split(d).length - 1;

      if (count > best) {
        delimiter = d;
        best = count;
      }
    }

    if (best < 1) {
      throw Error(
        "O arquivo não possui colunas separadas."
      );
    }

    const lines = [];
    let cells = [];
    let part = "";
    let quoted = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];

      if (ch === '"') {
        if (
          quoted &&
          input[i + 1] === '"'
        ) {
          part += '"';
          i++;
        } else {
          quoted = !quoted;
        }

      } else if (
        ch === delimiter &&
        !quoted
      ) {
        cells.push(part);
        part = "";

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

        cells.push(part);

        if (
          cells.some(v => v.trim())
        ) {
          lines.push(cells);
        }

        cells = [];
        part = "";

      } else {
        part += ch;
      }
    }

    if (quoted) {
      throw Error(
        "Há aspas não fechadas no arquivo."
      );
    }

    cells.push(part);

    if (
      cells.some(v => v.trim())
    ) {
      lines.push(cells);
    }

    if (lines.length < 2) {
      throw Error(
        "O arquivo não contém registros."
      );
    }

    const keys = lines.shift().map(
      k => k
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase()
    );

    if (
      new Set(keys).size !== keys.length
    ) {
      throw Error("Cabeçalhos duplicados.");
    }

    return lines.map(
      line => Object.fromEntries(
        keys.map((k, i) => [
          k,
          (line[i] || "").trim()
        ])
      )
    );
  }

  const alias = {
    razaosocial: "nome",
    nomeempresa: "empresa",
    favorecido: "empresa",
    numerocontrato: "contrato",
    numerodocontrato: "contrato",
    numeroprocesso: "processo",
    mes: "competencia",
    mescompetencia: "competencia",
    valorliquido: "valor",
    datapagamento: "data"
  };

  function normalizeImport(row) {
    const out = {};

    for (const [k, v] of Object.entries(row)) {
      out[alias[k] || k] = v;
    }

    for (const fields of Object.values(COLUMNS)) {
      for (const camel of fields) {
        const low = camel.toLowerCase();

        if (
          out[low] !== undefined &&
          camel !== low
        ) {
          out[camel] = out[low];
          delete out[low];
        }
      }
    }

    return out;
  }

  function resolveSupplier(row, next) {
    return (
      next.suppliers.find(
        s => s.id === row.supplier
      )?.id ||

      next.suppliers.find(
        s =>
          digits(s.cnpj) === digits(row.cnpj) &&
          digits(row.cnpj).length === 14
      )?.id ||

      next.suppliers.find(
        s =>
          clean(s.nome) === clean(row.empresa) &&
          row.empresa
      )?.id ||

      null
    );
  }

  function resolveContract(row, next) {
    if (
      next.contracts.some(
        c => c.id === row.contractId
      )
    ) {
      return row.contractId;
    }

    let matches = next.contracts.filter(
      c =>
        (
          row.contrato &&
          c.numero === row.contrato
        ) ||
        (
          row.processo &&
          c.processo === row.processo
        )
    );

    const supplierId = resolveSupplier(
      row,
      next
    );

    if (supplierId) {
      matches = matches.filter(
        c => c.supplier === supplierId
      );
    }

    return matches.length === 1
      ? matches[0].id
      : null;
  }

  async function importCSV(file) {
    if (!file) return;

    const out = $("#importResult");

    if (file.size > 5 * 1024 * 1024) {
      toast("Arquivo muito grande (máximo 5 MB).");
      return;
    }

    try {
      const type = $("#importKind").value;

      const rows = parseTable(
        await file.text()
      ).map(normalizeImport);

      if (rows.length > 10000) {
        throw Error(
          "Importe até 10.000 registros por vez."
        );
      }

      const next = clone();

      let added = 0;
      let updated = 0;
      let skipped = 0;

      for (const row of rows) {
        let obj;
        let existing;

        if (type === "suppliers") {
          if (
            !row.nome ||
            digits(row.cnpj).length !== 14
          ) {
            skipped++;
            continue;
          }

          existing = next.suppliers.find(
            s =>
              digits(s.cnpj) === digits(row.cnpj)
          );

          obj = {
            ...existing,
            nome: row.nome,
            cnpj: formatCNPJ(row.cnpj),
            id: existing?.id || uid()
          };

        } else if (type === "contracts") {
          const sid = resolveSupplier(
            row,
            next
          );

          if (
            !sid ||
            !row.processo
          ) {
            skipped++;
            continue;
          }

          existing =
            next.contracts.find(
              c => c.id === row.id
            ) ||
            next.contracts.find(
              c =>
                c.supplier === sid &&
                c.processo === row.processo &&
                (c.numero || "") === (row.numero || "")
            );

          obj = {
            ...existing,
            ...row,
            supplier: sid,
            id: existing?.id || uid()
          };

          delete obj.empresa;
          delete obj.cnpj;

        } else {
          const cid = resolveContract(
            row,
            next
          );

          const isPayment = type === "payments";

          const valid = isPayment
            ? /^\d{4}-\d{2}-\d{2}$/.test(row.data || "")
            : /^\d{4}-\d{2}$/.test(row.competencia || "");

          if (
            !cid ||
            !valid ||
            row.valor === "" ||
            row.valor === undefined ||
            amount(row.valor) < 0
          ) {
            skipped++;
            continue;
          }

          existing =
            next[type].find(
              p => p.id === row.id
            ) ||
            next[type].find(
              p =>
                p.contractId === cid &&
                (
                  isPayment
                    ? (
                        p.data === row.data &&
                        p.descricao === row.descricao &&
                        positive(p.valor) === positive(row.valor)
                      )
                    : (
                        p.competencia === row.competencia &&
                        p.referencia === row.referencia &&
                        positive(p.valor) === positive(row.valor)
                      )
                )
            );

          obj = {
            ...existing,
            ...row,
            contractId: cid,
            valor: String(
              positive(row.valor)
            ),
            id: existing?.id || uid()
          };

          if (!isPayment) {
            obj.status =
              row.status === "concluido"
                ? "concluido"
                : "aberto";
          }

          for (const k of [
            "empresa",
            "cnpj",
            "contrato",
            "processo"
          ]) {
            delete obj[k];
          }
        }

        const i = next[type].findIndex(
          x => x.id === obj.id
        );

        if (i < 0) {
          next[type].push(obj);
          added++;
        } else {
          next[type][i] = obj;
          updated++;
        }
      }

      if (!added && !updated) {
        throw Error(
          "Nenhum registro válido. Importe primeiro " +
          "fornecedores e contratos."
        );
      }

      if (
        !confirm(
          `Confirmar importação?\n` +
          `Novos: ${added}\n` +
          `Atualizados: ${updated}\n` +
          `Ignorados: ${skipped}\n\n` +
          `Faça backup antes de prosseguir.`
        )
      ) {
        return;
      }

      if (save(next)) {
        out.textContent =
          `Importação finalizada: ${added} novo(s), ` +
          `${updated} atualizado(s), ` +
          `${skipped} ignorado(s).`;

        toast("Importação concluída.");
      }

    } catch (error) {
      console.error(error);

      out.textContent = error.message;

      toast(
        "Falha na importação: " +
        error.message
      );
    }
  }

  // ==========================================
  // AÇÕES
  // ==========================================

  const actions = {
    "new-company": () => showForm("company"),
    "new-contract": () => showForm("contract"),
    "new-payment": () => showForm("payment"),
    "new-pending": () => showForm("pending"),

    "edit-company": id => showForm("company", id),
    "edit-contract": id => showForm("contract", id),
    "edit-payment": id => showForm("payment", id),
    "edit-pending": id => showForm("pending", id),

    "delete-company": id => remove("company", id),
    "delete-contract": id => remove("contract", id),
    "delete-payment": id => remove("payment", id),
    "delete-pending": id => remove("pending", id),

    "toggle-pending": togglePending,

    "export-companies": () => exportCSV("suppliers"),
    "export-contracts": () => exportCSV("contracts"),
    "export-payments": () => exportCSV("payments"),
    "export-pending": () => exportCSV("pendencias"),

    "backup": backup,
    "restore": () => $("#restoreFile").click(),
    "import": () => $("#importFile").click()
  };

  // ==========================================
  // INICIALIZAÇÃO
  // ==========================================

  function init() {
    db = read();

    migrateLegacyExamples();

    $("#companyForm").addEventListener(
      "submit",
      handleCompany
    );

    $("#contractForm").addEventListener(
      "submit",
      handleContract
    );

    $("#paymentForm").addEventListener(
      "submit",
      handlePayment
    );

    $("#pendingForm").addEventListener(
      "submit",
      handlePending
    );

    $("#contractForm").addEventListener(
      "input",
      calculateCCT
    );

    [
      ["#filterCompanies", renderCompanies],
      ["#filterContracts", renderContracts],
      ["#filterPayments", renderPayments],
      ["#filterPending", renderPending],
      ["#pendingStatus", renderPending]
    ].forEach(([selector, fn]) =>
      $(selector).addEventListener(
        "input",
        fn
      )
    );

    document.addEventListener(
      "click",
      event => {
        const close = event.target.closest(
          "[data-close]"
        );

        if (close) {
          $("#" + close.dataset.close)?.close();
          return;
        }

        const nav = event.target.closest(
          "[data-view]"
        );

        if (nav) {
          navigate(nav.dataset.view);
          return;
        }

        const action = event.target.closest(
          "[data-action]"
        );

        if (action) {
          actions[action.dataset.action]?.(
            action.dataset.id
          );
        }
      }
    );

    $("#restoreFile").addEventListener(
      "change",
      async event => {
        await restore(
          event.target.files?.[0]
        );

        event.target.value = "";
      }
    );

    $("#importFile").addEventListener(
      "change",
      async event => {
        await importCSV(
          event.target.files?.[0]
        );

        event.target.value = "";
      }
    );

    window.addEventListener(
      "storage",
      event => {
        if (
          event.key !== STORE ||
          locked
        ) {
          return;
        }

        db = read();
        renderAll();
      }
    );

    navigate("dashboard");

    if (locked) {
      toast(
        "Dados anteriores não puderam ser lidos. " +
        "Confira o backup antes de editar."
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
