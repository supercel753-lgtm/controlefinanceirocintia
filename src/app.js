
"use strict";

/*
  CAF SUREG-PA — Gestão Financeira
  Versão local completa.

  Compatível com:
  index.html
  src/style.css

  Preparado para futura integração Supabase.
*/

(() => {

  // ========================================
  // CONFIGURAÇÕES
  // ========================================

  const KEY = "sureg-pa-demo-v1";
  const YEAR = 2026;

  const TYPES = [
    "suppliers",
    "contracts",
    "payments",
    "pendencias"
  ];

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);

  const digits = value =>
    String(value ?? "").replace(/\D/g, "");

  const dateNow = () => {
    const d = new Date();

    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
  };

  const dateBR = value =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
      ? value.split("-").reverse().join("/")
      : (value || "—");

  const monthBR = value =>
    /^\d{4}-\d{2}$/.test(String(value || ""))
      ? `${value.slice(5)}/${value.slice(0, 4)}`
      : (value || "—");

  const uid = () =>
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const number = value => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    let s = String(value ?? "")
      .trim()
      .replace(/\s|R\$/g, "");

    if (s.includes(",")) {
      s = s.replace(/\./g, "").replace(",", ".");
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };

  const positive = value =>
    Math.max(0, number(value));

  const brl = value =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(number(value));

  const total = (array, field) =>
    array.reduce(
      (sum, row) => sum + positive(row[field]),
      0
    );

  const formatCnpj = value =>
    digits(value).replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5"
    );

  const keyName = value =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const cleanQuery = value =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const field = (form, name) =>
    form.elements.namedItem(name);

  const emptyDB = () => ({
    suppliers: [],
    contracts: [],
    payments: [],
    pendencias: []
  });

  let db;
  let editing = { kind: null, id: null };
  let toastTimer;
  let blockedStorage = false;

  // ========================================
  // ARMAZENAMENTO
  // ========================================

  function readDB() {
    try {
      const raw = localStorage.getItem(KEY);

      if (!raw) return emptyDB();

      const data = JSON.parse(raw);

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
      ) {
        throw Error("Formato inválido");
      }

      return {
        ...data,
        ...Object.fromEntries(
          TYPES.map(k => [
            k,
            Array.isArray(data[k])
              ? data[k].filter(
                  v => v && typeof v === "object"
                )
              : []
          ])
        )
      };

    } catch (error) {
      blockedStorage = true;

      console.error(
        "CAF: não foi possível ler dados salvos",
        error
      );

      return emptyDB();
    }
  }

  function toast(message) {
    const box = $("#toast");

    box.textContent = message;
    box.classList.add("visible");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      box.classList.remove("visible");
    }, 4200);
  }

  function persist(next) {
    if (blockedStorage) {
      toast(
        "Armazenamento inválido ou indisponível. " +
        "Recupere os dados antes de continuar."
      );
      return false;
    }

    try {
      localStorage.setItem(KEY, JSON.stringify(next));

      db = next;
      renderAll();

      return true;

    } catch (error) {
      console.error("CAF: erro ao gravar", error);

      toast(
        "Não foi possível salvar. Verifique o " +
        "armazenamento do navegador."
      );

      return false;
    }
  }

  const clone = () =>
    JSON.parse(JSON.stringify(db));

  // ========================================
  // RELACIONAMENTOS
  // ========================================

  const supplier = id =>
    db.suppliers.find(s => s.id === id);

  const contract = id =>
    db.contracts.find(c => c.id === id);

  const companyName = c =>
    supplier(c?.supplier)?.nome ||
    "Empresa não identificada";

  const contractName = c =>
    `${c?.numero || c?.processo || "Sem número"} — ${companyName(c)}`;

  function contractStatus(c) {
    const today = dateNow();

    if (
      c.vigenciaFinal &&
      c.vigenciaFinal < today
    ) {
      return "Encerrado";
    }

    if (
      c.vigenciaInicial &&
      c.vigenciaInicial > today
    ) {
      return "A iniciar";
    }

    return "Vigente";
  }

  function sumYear(year) {
    return db.payments
      .filter(p =>
        String(p.data || "").startsWith(String(year)) &&
        contract(p.contractId)
      )
      .reduce(
        (sum, p) => sum + positive(p.valor),
        0
      );
  }

  const statusTag = label => {
    const colors = {
      "Vigente": "green",
      "Concluído": "green",
      "A iniciar": "blue",
      "Encerrado": "red",
      "Pendente": "orange"
    };

    return `
      <span class="pill ${colors[label] || ""}">
        ${esc(label)}
      </span>
    `;
  };

  const noRows = count => `
    <tr>
      <td class="empty" colspan="${count}">
        Nenhum registro encontrado.
      </td>
    </tr>
  `;

  // ========================================
  // SELETORES
  // ========================================

  function refreshSelectors() {
    const companySelect = $("#contractSupplier");
    const oldCompany = companySelect.value;

    companySelect.replaceChildren(
      new Option("Selecione uma empresa", "")
    );

    [...db.suppliers]
      .sort((a, b) =>
        String(a.nome).localeCompare(
          String(b.nome),
          "pt-BR"
        )
      )
      .forEach(s => {
        companySelect.add(
          new Option(
            `${s.nome} — ${s.cnpj}`,
            s.id
          )
        );
      });

    companySelect.value =
      db.suppliers.some(s => s.id === oldCompany)
        ? oldCompany
        : "";

    for (const select of $$('[data-contract-select]')) {
      const old = select.value;

      select.replaceChildren(
        new Option("Selecione um contrato", "")
      );

      [...db.contracts]
        .sort((a, b) =>
          contractName(a).localeCompare(
            contractName(b),
            "pt-BR"
          )
        )
        .forEach(c => {
          select.add(
            new Option(contractName(c), c.id)
          );
        });

      select.value =
        db.contracts.some(c => c.id === old)
          ? old
          : "";
    }
  }

  // ========================================
  // DASHBOARD FINANCEIRO
  // ========================================

  function renderDashboard() {
    const open = db.pendencias.filter(p =>
      p.status !== "concluido" &&
      contract(p.contractId)
    );

    const planned = total(
      db.contracts,
      "ploa2026"
    );

    const paid = sumYear(YEAR);

    const countActive = db.contracts.filter(
      c => contractStatus(c) === "Vigente"
    ).length;

    const pendingTotal = total(open, "valor");

    const ratio = planned
      ? paid / planned * 100
      : null;

    // DESTAQUE PRINCIPAL

    $("#heroValue").textContent = brl(paid);

    $("#heroRatio").textContent =
      ratio === null
        ? "Sem PLOA"
        : `${ratio.toFixed(1).replace(".", ",")}%`;

    $("#heroBar").style.width =
      `${Math.min(100, Math.max(0, ratio || 0))}%`;

    $("#heroBalance").textContent = planned
      ? `PLOA: ${brl(planned)} · Diferença de referência: ${brl(planned - paid)}`
      : "Cadastre os valores de PLOA para calcular a proporção.";

    // QUATRO INDICADORES

    const indicators = [
      [
        "Contratos vigentes",
        countActive,
        `${db.contracts.length} contratos cadastrados`,
        "",
        "▤"
      ],
      [
        `Pagamentos ${YEAR}`,
        brl(paid),
        "Pagamentos efetivamente lançados",
        "green",
        "↗"
      ],
      [
        "Pendências em aberto",
        brl(pendingTotal),
        `${open.length} registro(s) pendente(s)`,
        "orange",
        "◷"
      ],
      [
        `PLOA ${YEAR}`,
        brl(planned),
        "Somatório informado nos contratos",
        "violet",
        "◉"
      ]
    ];

    $("#kpiGrid").innerHTML = indicators
      .map(([label, value, note, tone, icon]) => `
        <article class="kpi ${tone}">
          <div class="kpi-name">
            ${esc(label)}
            <span>${icon}</span>
          </div>
          <strong>${esc(value)}</strong>
          <small>${esc(note)}</small>
        </article>
      `)
      .join("");

    // GRÁFICO MENSAL

    const now = new Date();

    const months = Array.from(
      { length: 6 },
      (_, i) => {
        const d = new Date(
          now.getFullYear(),
          now.getMonth() - 5 + i,
          1
        );

        return (
          d.getFullYear() +
          "-" +
          String(d.getMonth() + 1).padStart(2, "0")
        );
      }
    );

    const series = months.map(month => ({
      month,

      paid: db.payments
        .filter(p =>
          (p.data || "").slice(0, 7) === month &&
          contract(p.contractId)
        )
        .reduce(
          (sum, p) => sum + positive(p.valor),
          0
        ),

      open: open
        .filter(p => p.competencia === month)
        .reduce(
          (sum, p) => sum + positive(p.valor),
          0
        )
    }));

    const max = Math.max(
      1,
      ...series.flatMap(
        x => [x.paid, x.open]
      )
    );

    $("#monthlyChart").innerHTML = series
      .map(x => `
        <div class="bar-group">

          <div class="bars">

            <div
              class="bar paid"
              style="height:${x.paid / max * 100}%"
              title="Pagos: ${esc(brl(x.paid))}">
            </div>

            <div
              class="bar waiting"
              style="height:${x.open / max * 100}%"
              title="Pendentes: ${esc(brl(x.open))}">
            </div>

          </div>

          <span>${esc(monthBR(x.month))}</span>

        </div>
      `)
      .join("");

    // GRÁFICO DE VIGÊNCIA

    const statuses = [
      "Vigente",
      "A iniciar",
      "Encerrado"
    ];

    const colors = [
      "#248c75",
      "#478da0",
      "#d98e69"
    ];

    const counts = statuses.map(s =>
      db.contracts.filter(
        c => contractStatus(c) === s
      ).length
    );

    let pos = 0;

    $("#donut").style.background =
      db.contracts.length
        ? `conic-gradient(${
            counts.map((n, i) => {
              const start = pos;

              pos += n / db.contracts.length * 100;

              return `${colors[i]} ${start}% ${pos}%`;
            }).join(", ")
          })`
        : "#e6ece9";

    $("#donutLegend").innerHTML =
      statuses.map((s, i) => `
        <div>
          <span>
            <i style="background:${colors[i]}"></i>
            ${s}
          </span>
          <b>${counts[i]}</b>
        </div>
      `).join("");

    // ÚLTIMOS PAGAMENTOS

    const recent = db.payments
      .filter(p => contract(p.contractId))
      .slice()
      .sort((a, b) =>
        (b.data || "").localeCompare(a.data || "")
      )
      .slice(0, 5);

    $("#recentPayments").innerHTML =
      recent.map(p => `
        <div class="activity-row">
          <div>
            <strong>
              ${esc(companyName(contract(p.contractId)))}
            </strong>

            <small>
              ${esc(dateBR(p.data))} ·
              ${esc(contract(p.contractId)?.numero || "Contrato")}
            </small>
          </div>

          <b>${brl(p.valor)}</b>
        </div>
      `).join("") ||
      `<p class="empty-block">
        Nenhum pagamento registrado.
      </p>`;

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
              ${esc(companyName(contract(p.contractId)))}
            </strong>

            <small>
              Competência ${esc(monthBR(p.competencia))}
            </small>
          </div>

          <b class="orange-text">
            ${brl(p.valor)}
          </b>
        </div>
      `)
      .join("") ||
      `<p class="empty-block">
        Nenhuma pendência em aberto.
      </p>`;

    $("#dashboardNote").textContent =
      "Concluído não significa pago: somente registros " +
      "em Pagamentos integram os valores realizados.";
  }

  // ========================================
  // FORNECEDORES
  // ========================================

  function renderCompanies() {
    const query = cleanQuery(
      $("#filterCompanies").value
    );

    const rows = db.suppliers.filter(s =>
      cleanQuery(`${s.nome} ${s.cnpj}`).includes(query)
    );

    $("#companiesRows").innerHTML =
      rows.map(s => `
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
            <button
              data-action="edit-company"
              data-id="${esc(s.id)}">
              Editar
            </button>

            <button
              class="danger-text"
              data-action="delete-company"
              data-id="${esc(s.id)}">
              Excluir
            </button>
          </td>
        </tr>
      `).join("") || noRows(4);

    $("#companiesTotal").textContent =
      `${rows.length} empresa(s)`;
  }

  // ========================================
  // CONTRATOS
  // ========================================

  function renderContracts() {
    const query = cleanQuery(
      $("#filterContracts").value
    );

    const rows = db.contracts.filter(c =>
      cleanQuery(
        `${companyName(c)} ${c.numero} ${c.processo}`
      ).includes(query)
    );

    $("#contractsRows").innerHTML =
      rows.map(c => `
        <tr>
          <td>
            <b>${esc(c.numero || "—")}</b>
            <small>${esc(c.processo || "—")}</small>
          </td>

          <td>${esc(companyName(c))}</td>
          <td>${esc(dateBR(c.vigenciaFinal))}</td>
          <td>${brl(c.valorGlobal)}</td>
          <td>${statusTag(contractStatus(c))}</td>

          <td class="actions">
            <button
              data-action="edit-contract"
              data-id="${esc(c.id)}">
              Editar
            </button>

            <button
              class="danger-text"
              data-action="delete-contract"
              data-id="${esc(c.id)}">
              Excluir
            </button>
          </td>
        </tr>
      `).join("") || noRows(6);

    $("#contractsTotal").textContent =
      `${rows.length} contrato(s)`;
  }

  // ========================================
  // PAGAMENTOS
  // ========================================

  function renderPayments() {
    const query = cleanQuery(
      $("#filterPayments").value
    );

    const rows = db.payments
      .filter(p =>
        contract(p.contractId) &&
        cleanQuery(
          `${companyName(contract(p.contractId))}
           ${contract(p.contractId)?.numero}
           ${p.descricao} ${p.data}`
        ).includes(query)
      )
      .slice()
      .sort((a, b) =>
        (b.data || "").localeCompare(a.data || "")
      );

    $("#paymentsRows").innerHTML =
      rows.map(p => `
        <tr>
          <td>${esc(dateBR(p.data))}</td>

          <td>
            ${esc(companyName(contract(p.contractId)))}
          </td>

          <td>
            ${esc(contract(p.contractId)?.numero || "—")}
          </td>

          <td>${esc(p.descricao || "—")}</td>

          <td>
            <b>${brl(p.valor)}</b>
          </td>

          <td class="actions">
            <button
              data-action="edit-payment"
              data-id="${esc(p.id)}">
              Editar
            </button>

            <button
              class="danger-text"
              data-action="delete-payment"
              data-id="${esc(p.id)}">
              Excluir
            </button>
          </td>
        </tr>
      `).join("") || noRows(6);

    $("#paymentsTotal").textContent =
      `${rows.length} pagamento(s) · ${brl(total(rows, "valor"))}`;
  }

  // ========================================
  // PAGAMENTOS PENDENTES
  // ========================================

  function renderPending() {
    const query = cleanQuery(
      $("#filterPending").value
    );

    const choice = $("#pendingStatus").value;

    const open = db.pendencias.filter(p =>
      p.status !== "concluido" &&
      contract(p.contractId)
    );

    $("#pendingTopline").textContent =
      `${open.length} pagamento(s) pendente(s) · ` +
      `Total: ${brl(total(open, "valor"))}`;

    const rows = db.pendencias
      .filter(p => {
        const c = contract(p.contractId);

        const statusOK =
          choice === "todos" ||
          (
            choice === "concluido"
              ? p.status === "concluido"
              : p.status !== "concluido"
          );

        return (
          c &&
          statusOK &&
          cleanQuery(
            `${companyName(c)}
             ${supplier(c.supplier)?.cnpj}
             ${c.numero}
             ${c.processo}
             ${p.competencia}
             ${p.referencia}`
          ).includes(query)
        );
      })
      .slice()
      .sort((a, b) =>
        (b.competencia || "").localeCompare(
          a.competencia || ""
        )
      );

    $("#pendingCards").innerHTML =
      rows.map(p => {
        const c = contract(p.contractId);
        const done = p.status === "concluido";

        return `
          <article class="pending-card">

            <div class="pending-detail">
              <h3>${esc(companyName(c))}</h3>

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
                  Mês:
                  <b>${esc(monthBR(p.competencia))}</b>
                </span>
              </div>

              <p>
                Processo: ${esc(c.processo || "—")}
              </p>
            </div>

            <div class="pending-right">
              ${
                statusTag(
                  done ? "Concluído" : "Pendente"
                )
              }

              <small>
                ${esc(p.referencia || "Sem referência")}
              </small>

              <label>Valor líquido</label>

              <strong>${brl(p.valor)}</strong>
            </div>

            <div class="pending-actions">

              <button
                class="btn light small"
                data-action="edit-pending"
                data-id="${esc(p.id)}">
                Editar
              </button>

              <button
                class="btn light small danger-text"
                data-action="delete-pending"
                data-id="${esc(p.id)}">
                Excluir
              </button>

              <button
                class="btn ${done ? "light" : "success"} small"
                data-action="toggle-pending"
                data-id="${esc(p.id)}">
                ${
                  done
                    ? "Reabrir"
                    : "✓ Marcar como concluído"
                }
              </button>

            </div>

          </article>
        `;
      }).join("") ||
      `<p class="empty-block">
        Nenhuma pendência encontrada.
      </p>`;
  }

  // ========================================
  // ORÇAMENTO E PLOA
  // ========================================

  function renderBudget() {
    const planned = total(
      db.contracts,
      "ploa2026"
    );

    const paid = sumYear(YEAR);

    const past = total(
      db.contracts,
      "gastoAnual2025"
    );

    const ratio = planned
      ? paid / planned * 100
      : null;

    $("#budgetSummary").innerHTML = [
      [
        "PLOA 2026 (cadastrado)",
        brl(planned)
      ],
      [
        "Pagamentos registrados em 2026",
        brl(paid)
      ],
      [
        "Gasto anual 2025 (informado)",
        brl(past)
      ]
    ].map(([label, value]) => `
      <div class="mini-kpi">
        <small>${label}</small>
        <b>${value}</b>
      </div>
    `).join("");

    $("#budgetBar").style.width =
      `${Math.min(100, Math.max(0, ratio || 0))}%`;

    $("#budgetProgress").textContent =
      ratio === null
        ? "Sem PLOA informado"
        : `Pagamentos / PLOA: ${
            ratio.toFixed(1).replace(".", ",")
          }%`;

    $("#budgetRows").innerHTML =
      db.contracts.map(c => {
        const paidContract = db.payments
          .filter(p =>
            p.contractId === c.id &&
            (p.data || "").startsWith(String(YEAR))
          )
          .reduce(
            (sum, p) => sum + positive(p.valor),
            0
          );

        const percent = positive(c.ploa2026)
          ? `${
              (
                paidContract /
                positive(c.ploa2026) *
                100
              ).toFixed(1).replace(".", ",")
            }%`
          : "—";

        return `
          <tr>
            <td>
              ${esc(companyName(c))}
              <small>
                ${esc(c.numero || c.processo || "—")}
              </small>
            </td>

            <td>${brl(c.gastoAnual2025)}</td>
            <td>${brl(c.ploa2026)}</td>
            <td>${brl(paidContract)}</td>
            <td>${percent}</td>

            <td class="actions">
              <button
                data-action="edit-contract"
                data-id="${esc(c.id)}">
                Editar
              </button>
            </td>
          </tr>
        `;
      }).join("") || noRows(6);
  }

  // ========================================
  // RELATÓRIOS E CONFIGURAÇÕES
  // ========================================

  function renderReports() {
    const open = db.pendencias.filter(p =>
      p.status !== "concluido" &&
      contract(p.contractId)
    );

    $("#reportStats").innerHTML = [
      ["Fornecedores", db.suppliers.length],
      ["Contratos", db.contracts.length],
      ["Pagamentos registrados", db.payments.length],
      ["Pendências abertas", open.length]
    ].map(([label, value]) => `
      <div class="mini-kpi">
        <small>${label}</small>
        <b>${value}</b>
      </div>
    `).join("");
  }

  function renderSettings() {
    $("#storageInfo").textContent =
      `${db.suppliers.length} empresas · ` +
      `${db.contracts.length} contratos · ` +
      `${db.payments.length} pagamentos · ` +
      `${db.pendencias.length} acompanhamentos`;
  }

  function renderAll() {
    refreshSelectors();
    renderDashboard();
    renderCompanies();
    renderContracts();
    renderPayments();
    renderPending();
    renderBudget();
    renderReports();
    renderSettings();
  }

  // ========================================
  // NAVEGAÇÃO
  // ========================================

  const titles = {
    dashboard: "Dashboard Financeiro",
    contracts: "Gestão de Contratos",
    payments: "Histórico de Pagamentos",
    pending: "Pagamentos Pendentes",
    budget: "Orçamento e PLOA",
    companies: "Fornecedores",
    reports: "Relatórios",
    settings: "Configurações"
  };

  function navigate(view) {
    if (!titles[view]) return;

    $$(".view").forEach(section => {
      section.hidden =
        section.id !== `view-${view}`;
    });

    $$(".nav-link[data-view]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.view === view
      );

      if (button.dataset.view === view) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    $("#pageTitle").textContent = titles[view];

    renderAll();
  }

  // ========================================
  // FORMULÁRIOS
  // ========================================

  function formObject(form) {
    return Object.fromEntries(
      new FormData(form).entries()
    );
  }

  function fillForm(form, row = {}) {
    form.reset();

    $$("[name]", form).forEach(el => {
      if (
        Object.prototype.hasOwnProperty.call(
          row,
          el.name
        )
      ) {
        el.value = row[el.name] ?? "";
      }
    });
  }

  // CÁLCULO DE SERVIÇOS COM PESSOAS

  function calculateCCT() {
    const form = $("#contractForm");

    const totalValue =
      positive(field(form, "salario").value) *
      (
        1 +
        positive(field(form, "encargos").value) / 100
      ) *
      Math.floor(
        positive(field(form, "postos").value)
      ) +
      positive(field(form, "materiais").value);

    $("#cctTotal").value = brl(totalValue);
  }

  const dialogs = {
    company: [
      "companyDialog",
      "companyForm",
      "suppliers",
      "empresa"
    ],

    contract: [
      "contractDialog",
      "contractForm",
      "contracts",
      "contrato"
    ],

    payment: [
      "paymentDialog",
      "paymentForm",
      "payments",
      "pagamento"
    ],

    pending: [
      "pendingDialog",
      "pendingForm",
      "pendencias",
      "pendência"
    ]
  };

  function openDialog(kind, id = null) {
    const [
      dialogId,
      formId,
      collection,
      label
    ] = dialogs[kind];

    if (
      kind === "contract" &&
      !db.suppliers.length
    ) {
      toast(
        "Cadastre um fornecedor antes dos contratos."
      );

      navigate("companies");
      return;
    }

    if (
      ["payment", "pending"].includes(kind) &&
      !db.contracts.length
    ) {
      toast(
        "Cadastre um contrato antes de registrar pagamentos ou pendências."
      );

      navigate("contracts");
      return;
    }

    editing = { kind, id };

    refreshSelectors();

    const form = $(`#${formId}`);

    fillForm(
      form,
      db[collection].find(row => row.id === id)
    );

    if (kind === "payment" && !id) {
      field(form, "data").value = dateNow();
    }

    if (kind === "pending" && !id) {
      field(form, "competencia").value =
        dateNow().slice(0, 7);
    }

    if (kind === "contract") {
      calculateCCT();
    }

    $(`#${dialogId}Title`).textContent =
      `${id ? "Editar" : "Cadastrar"} ${label}`;

    $(`#${dialogId}`).showModal();
  }

  // CRIAR OU ATUALIZAR

  function upsert(kind, data) {
    const [
      dialogId,
      ,
      collection,
      label
    ] = dialogs[kind];

    const next = clone();

    const index = next[collection].findIndex(
      x => x.id === editing.id
    );

    const item = {
      ...(
        index >= 0
          ? next[collection][index]
          : {}
      ),

      ...data,

      id: index >= 0
        ? editing.id
        : uid()
    };

    if (index >= 0) {
      next[collection][index] = item;
    } else {
      next[collection].push(item);
    }

    if (persist(next)) {
      $(`#${dialogId}`).close();

      toast(
        `${
          label[0].toUpperCase() +
          label.slice(1)
        } salvo(a) com sucesso.`
      );
    }
  }

  // ========================================
  // SALVAR FORNECEDOR
  // ========================================

  function handleCompany(event) {
    event.preventDefault();

    const data = formObject(
      event.currentTarget
    );

    const cnpj = digits(data.cnpj);

    if (cnpj.length !== 14) {
      toast("O CNPJ precisa ter 14 dígitos.");
      return;
    }

    if (!data.nome.trim()) {
      toast("Informe a razão social.");
      return;
    }

    if (
      db.suppliers.some(s =>
        s.id !== editing.id &&
        digits(s.cnpj) === cnpj
      )
    ) {
      toast("Este CNPJ já está cadastrado.");
      return;
    }

    upsert("company", {
      nome: data.nome.trim(),
      cnpj: formatCnpj(cnpj)
    });
  }

  // ========================================
  // SALVAR CONTRATO
  // ========================================

  function handleContract(event) {
    event.preventDefault();

    const data = formObject(
      event.currentTarget
    );

    if (!supplier(data.supplier)) {
      toast("Selecione um fornecedor válido.");
      return;
    }

    if (!data.processo.trim()) {
      toast("Informe o número do processo.");
      return;
    }

    if (
      data.vigenciaFinal <
      data.vigenciaInicial
    ) {
      toast(
        "A vigência final não pode anteceder a inicial."
      );
      return;
    }

    const numericFields = [
      "valorGlobal",
      "custoPosto",
      "gastoAnual2025",
      "ploa2026",
      "salario",
      "encargos",
      "materiais",
      "gastoMensal2025",
      "totalGasto2025",
      "postos",
      "qtdAtual",
      "qtdAnalise"
    ];

    for (const name of numericFields) {
      if (
        data[name] !== "" &&
        number(data[name]) < 0
      ) {
        toast(
          "Existem valores numéricos inválidos."
        );
        return;
      }
    }

    upsert("contract", data);
  }

  // ========================================
  // SALVAR PAGAMENTO
  // ========================================

  function handlePayment(event) {
    event.preventDefault();

    const data = formObject(
      event.currentTarget
    );

    if (
      !contract(data.contractId) ||
      positive(data.valor) <= 0
    ) {
      toast(
        "Selecione um contrato e valor maior que zero."
      );
      return;
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(data.data)
    ) {
      toast("Informe uma data válida.");
      return;
    }

    upsert("payment", data);
  }

  // ========================================
  // SALVAR PENDÊNCIA
  // ========================================

  function handlePending(event) {
    event.preventDefault();

    const data = formObject(
      event.currentTarget
    );

    if (
      !contract(data.contractId) ||
      !/^\d{4}-\d{2}$/.test(data.competencia)
    ) {
      toast(
        "Selecione contrato e competência válidos."
      );
      return;
    }

    upsert("pending", {
      ...data,
      status:
        data.status === "concluido"
          ? "concluido"
          : "aberto"
    });
  }

  // ========================================
  // EXCLUSÃO E SITUAÇÃO
  // ========================================

  function remove(kind, id) {
    const next = clone();

    if (kind === "company") {
      if (
        next.contracts.some(
          c => c.supplier === id
        )
      ) {
        toast(
          "Esta empresa possui contratos vinculados."
        );
        return;
      }

      if (!confirm("Excluir esta empresa?")) {
        return;
      }

      next.suppliers = next.suppliers.filter(
        s => s.id !== id
      );

    } else if (kind === "contract") {
      const paid = next.payments.filter(
        p => p.contractId === id
      ).length;

      const pending = next.pendencias.filter(
        p => p.contractId === id
      ).length;

      if (!confirm(
        `Excluir este contrato? Também serão excluídos ` +
        `${paid} pagamento(s) e ${pending} pendência(s). ` +
        `Esta operação não pode ser desfeita.`
      )) {
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
      if (!confirm(
        `Excluir este registro de ${
          kind === "payment"
            ? "pagamento"
            : "pendência"
        }?`
      )) {
        return;
      }

      const key = kind === "payment"
        ? "payments"
        : "pendencias";

      next[key] = next[key].filter(
        row => row.id !== id
      );
    }

    if (persist(next)) {
      toast("Registro excluído.");
    }
  }

  function changePending(id) {
    const next = clone();

    const row = next.pendencias.find(
      p => p.id === id
    );

    if (!row) return;

    row.status =
      row.status === "concluido"
        ? "aberto"
        : "concluido";

    if (persist(next)) {
      toast(
        "Situação alterada. Concluído não cria pagamento realizado."
      );
    }
  }

  // ========================================
  // EXPORTAÇÃO DE ARQUIVOS
  // ========================================

  function download(name, text, type) {
    const blob = new Blob(
      [text],
      { type }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = name;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // COLUNAS CSV

  const CSV_COLS = {
    suppliers: [
      "id",
      "nome",
      "cnpj"
    ],

    contracts: [
      "id",
      "supplier",
      "empresa",
      "cnpj",
      "numero",
      "processo",
      "vigenciaInicial",
      "vigenciaFinal",
      "valorGlobal",
      "ploa2026",
      "gastoAnual2025",
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
      "custoPosto",
      "gastoMensal2025",
      "totalGasto2025",
      "qtdAtual",
      "qtdAnalise",
      "objeto",
      "observacoes"
    ],

    payments: [
      "id",
      "contractId",
      "contrato",
      "processo",
      "empresa",
      "cnpj",
      "data",
      "descricao",
      "valor"
    ],

    pendencias: [
      "id",
      "contractId",
      "contrato",
      "processo",
      "empresa",
      "cnpj",
      "competencia",
      "referencia",
      "valor",
      "status"
    ]
  };

  function augmented(kind, row) {
    if (kind === "suppliers") {
      return { ...row };
    }

    const c = kind === "contracts"
      ? row
      : contract(row.contractId);

    const s = supplier(c?.supplier);

    return {
      ...row,

      empresa: s?.nome || "",
      cnpj: s?.cnpj || "",

      ...(
        kind !== "contracts"
          ? {
              contrato: c?.numero || "",
              processo: c?.processo || ""
            }
          : {}
      )
    };
  }

  // PROTEÇÃO CONTRA FÓRMULAS EM CSV

  const csvSafe = value => {
    let text = String(value ?? "");

    if (
      /^[\s]*[=+@\-]/.test(text) &&
      !/^-\d+(?:\.\d+)?$/.test(text.trim())
    ) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  };

  // EXPORTAR TABELA CSV

  function exportCSV(kind) {
    const rows = db[kind];

    if (!rows?.length) {
      toast(
        "Nenhum registro disponível para exportar."
      );
      return;
    }

    const cols = [
      ...new Set([
        ...CSV_COLS[kind],
        ...rows.flatMap(
          r => Object.keys(r)
        )
      ])
    ];

    const csv = "\uFEFF" +
      [
        cols,

        ...rows.map(r => {
          const record = augmented(kind, r);

          return cols.map(
            col => record[col] ?? ""
          );
        })
      ]
        .map(row =>
          row.map(csvSafe).join(";")
        )
        .join("\r\n");

    download(
      `CAF-SUREGPA-${kind}-${dateNow()}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );

    toast("Exportação CSV iniciada.");
  }

  // ========================================
  // BACKUP JSON
  // ========================================

  function downloadBackup() {
    download(
      `CAF-SUREGPA-backup-${dateNow()}.json`,
      JSON.stringify(db, null, 2),
      "application/json;charset=utf-8"
    );

    toast("Backup JSON gerado.");
  }

  async function restoreBackup(file) {
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast(
        "Arquivo muito grande para backup local."
      );
      return;
    }

    try {
      const data = JSON.parse(
        await file.text()
      );

      if (
        !data ||
        typeof data !== "object" ||
        TYPES.some(
          k => !Array.isArray(data[k])
        )
      ) {
        throw Error("Formato JSON incompatível");
      }

      if (!confirm(
        "Restaurar o backup? Todos os registros atuais " +
        "deste navegador serão substituídos."
      )) {
        return;
      }

      if (blockedStorage) {
        blockedStorage = false;
      }

      if (persist(data)) {
        toast("Backup restaurado.");
      }

    } catch (error) {
      console.error(
        "Erro ao restaurar backup",
        error
      );

      toast(
        "Backup inválido. Use um JSON do CAF SUREG-PA."
      );
    }
  }

  // ========================================
  // IMPORTAÇÃO CSV E TXT TABULAR
  // ========================================

  function setupImport() {
    const reportCard = $(
      "#view-reports .export-grid"
    );

    reportCard.insertAdjacentHTML(
      "afterend",
      `
      <div
        id="csvImportBox"
        style="
          margin-top:22px;
          border-top:1px solid #e2e7e3;
          padding-top:18px;
        "
      >

        <h3 style="font-size:14px;margin:0 0 8px">
          Importar CSV ou TXT tabulado
        </h3>

        <p class="muted">
          Escolha a tabela. Os registros usam
          identificadores, CNPJ ou números de contrato
          para vincular os dados. Faça backup antes.
        </p>

        <div class="export-grid">

          <select
            id="csvImportKind"
            aria-label="Tipo de cadastro"
            style="
              padding:10px;
              border:1px solid #dbe7df;
              border-radius:8px;
            "
          >
            <option value="suppliers">
              Fornecedores
            </option>

            <option value="contracts">
              Contratos
            </option>

            <option value="payments">
              Pagamentos
            </option>

            <option value="pendencias">
              Pendências
            </option>
          </select>

          <button
            type="button"
            class="btn light"
            data-action="import-csv"
          >
            Importar arquivo .csv/.txt
          </button>

          <input
            id="csvImportFile"
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            hidden
          >

        </div>

        <p
          id="csvImportResult"
          class="footnote"
          aria-live="polite"
        ></p>

      </div>
      `
    );
  }

  // LEITOR DE CSV COM ASPAS E QUEBRAS DE LINHA

  function parseDelimited(text) {
    const body = text.replace(/^\uFEFF/, "");

    const header = body.split(/\r?\n/, 1)[0];

    const separator = [
      ";",
      "\t",
      ","
    ]
      .map(ch => ({
        ch,

        count: (
          header.match(
            new RegExp(
              ch === "\t"
                ? "\\t"
                : ch === ","
                  ? ","
                  : ";",
              "g"
            )
          ) || []
        ).length
      }))
      .sort(
        (a, b) => b.count - a.count
      )[0];

    if (!separator || !separator.count) {
      throw Error(
        "Separador de colunas não encontrado."
      );
    }

    const delim = separator.ch;

    const lines = [];

    let cells = [];
    let content = "";
    let quoted = false;

    for (let i = 0; i < body.length; i++) {
      const ch = body[i];

      if (ch === '"') {
        if (
          quoted &&
          body[i + 1] === '"'
        ) {
          content += '"';
          i++;

        } else {
          quoted = !quoted;
        }

      } else if (
        ch === delim &&
        !quoted
      ) {
        cells.push(content);
        content = "";

      } else if (
        (ch === "\n" || ch === "\r") &&
        !quoted
      ) {
        if (
          ch === "\r" &&
          body[i + 1] === "\n"
        ) {
          i++;
        }

        cells.push(content);
        content = "";

        if (
          cells.some(c => c.trim())
        ) {
          lines.push(cells);
        }

        cells = [];

      } else {
        content += ch;
      }
    }

    if (quoted) {
      throw Error(
        "CSV com aspas não fechadas."
      );
    }

    cells.push(content);

    if (
      cells.some(c => c.trim())
    ) {
      lines.push(cells);
    }

    if (lines.length < 2) {
      throw Error(
        "CSV sem linhas de dados."
      );
    }

    const names = lines[0].map(keyName);

    if (
      new Set(names).size !== names.length
    ) {
      throw Error(
        "O CSV possui cabeçalhos duplicados."
      );
    }

    return lines.slice(1).map(cells =>
      Object.fromEntries(
        names.map((name, i) => [
          name,
          (cells[i] || "").trim()
        ])
      )
    );
  }

  // TRADUÇÃO DE CABEÇALHOS COMUNS

  function normalizedRecord(raw) {
    const aliases = {
      razaosocial: "nome",
      favorecido: "empresa",
      nomeempresa: "empresa",
      numerocontrato: "contrato",
      numerodocontrato: "contrato",
      numeroprocesso: "processo",
      processocontratual: "processo",
      mes: "competencia",
      mescompetencia: "competencia",
      mesdereferencia: "competencia",
      valorliquido: "valor",
      datapagamento: "data"
    };

    const result = {};

    for (
      const [key, value] of Object.entries(raw)
    ) {
      result[aliases[key] || key] = value;
    }

    return result;
  }

  function resolveSupplier(row, state) {
    const known = state.suppliers.find(
      s => s.id === row.supplier
    );

    if (known) return known.id;

    if (row.cnpj) {
      return state.suppliers.find(
        s => digits(s.cnpj) === digits(row.cnpj)
      )?.id;
    }

    if (row.empresa) {
      return state.suppliers.find(
        s =>
          cleanQuery(s.nome) ===
          cleanQuery(row.empresa)
      )?.id;
    }

    return null;
  }

  function resolveContract(row, state) {
    if (
      state.contracts.some(
        c => c.id === row.contractid
      )
    ) {
      return row.contractid;
    }

    const matches = state.contracts.filter(c =>
      (
        row.contrato &&
        String(c.numero || "").trim() ===
        row.contrato
      ) ||
      (
        row.processo &&
        String(c.processo || "").trim() ===
        row.processo
      )
    );

    const supplierId = resolveSupplier(
      row,
      state
    );

    const narrowed = supplierId
      ? matches.filter(
          c => c.supplier === supplierId
        )
      : matches;

    return narrowed.length === 1
      ? narrowed[0].id
      : null;
  }

  // EXECUTAR IMPORTAÇÃO

  async function importDelimited(file) {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast(
        "CSV/TXT deve ter até 5 MB por importação."
      );
      return;
    }

    const kind = $("#csvImportKind").value;
    const report = $("#csvImportResult");

    try {
      const parsed = parseDelimited(
        await file.text()
      ).map(normalizedRecord);

      if (parsed.length > 10000) {
        throw Error(
          "Importe no máximo 10.000 linhas por vez."
        );
      }

      const next = clone();

      let added = 0;
      let updated = 0;
      let ignored = 0;

      for (const row of parsed) {
        let record = null;

        // IMPORTAÇÃO DE FORNECEDORES

        if (kind === "suppliers") {
          if (
            !row.nome ||
            digits(row.cnpj).length !== 14
          ) {
            ignored++;
            continue;
          }

          const found = next.suppliers.find(
            s =>
              digits(s.cnpj) ===
              digits(row.cnpj)
          );

          record = {
            ...found,

            id: found?.id || uid(),

            nome: row.nome,

            cnpj: formatCnpj(
              row.cnpj
            )
          };

        // IMPORTAÇÃO DE CONTRATOS

        } else if (kind === "contracts") {
          const supplierId = resolveSupplier(
            row,
            next
          );

          if (
            !supplierId ||
            !row.processo
          ) {
            ignored++;
            continue;
          }

          const found =
            next.contracts.find(
              c => c.id === row.id
            ) ||
            next.contracts.find(c =>
              c.supplier === supplierId &&
              c.processo === row.processo &&
              (c.numero || "") ===
              (row.numero || "")
            );

          record = {
            ...found,
            ...row,

            id: found?.id || uid(),

            supplier: supplierId
          };

          delete record.empresa;
          delete record.cnpj;

          // Reconstruir nomes originais em camelCase.

          for (const column of CSV_COLS.contracts) {
            if (
              column !== keyName(column) &&
              row[keyName(column)] !== undefined
            ) {
              record[column] =
                row[keyName(column)];

              delete record[keyName(column)];
            }
          }

          const moneyFields = [
            "valorGlobal",
            "ploa2026",
            "gastoAnual2025",
            "custoPosto",
            "salario",
            "encargos",
            "materiais",
            "gastoMensal2025",
            "totalGasto2025"
          ];

          for (const col of moneyFields) {
            if (
              record[col] !== undefined &&
              record[col] !== ""
            ) {
              record[col] =
                String(positive(record[col]));
            }
          }

        // IMPORTAÇÃO DE PAGAMENTOS E PENDÊNCIAS

        } else {
          const contractId = resolveContract(
            row,
            next
          );

          const validDate = kind === "payments"
            ? /^\d{4}-\d{2}-\d{2}$/.test(
                row.data || ""
              )
            : /^\d{4}-\d{2}$/.test(
                row.competencia || ""
              );

          if (
            !contractId ||
            !row.valor ||
            !validDate
          ) {
            ignored++;
            continue;
          }

          const key = kind === "payments"
            ? "payments"
            : "pendencias";

          const found =
            next[key].find(
              p => p.id === row.id
            ) ||
            next[key].find(p =>
              p.contractId === contractId &&
              (
                kind === "payments"
                  ? (
                      p.data === row.data &&
                      (p.descricao || "") ===
                      (row.descricao || "") &&
                      positive(p.valor) ===
                      positive(row.valor)
                    )
                  : (
                      p.competencia ===
                      row.competencia &&
                      (p.referencia || "") ===
                      (row.referencia || "") &&
                      positive(p.valor) ===
                      positive(row.valor)
                    )
              )
            );

          record = {
            ...found,
            ...row,

            id: found?.id || uid(),

            contractId,

            valor: String(
              positive(row.valor)
            )
          };

          if (kind === "pendencias") {
            record.status =
              row.status === "concluido"
                ? "concluido"
                : "aberto";
          }

          for (const col of [
            "empresa",
            "cnpj",
            "contrato",
            "processo",
            "contractid"
          ]) {
            delete record[col];
          }
        }

        const index = next[kind].findIndex(
          x => x.id === record.id
        );

        if (index >= 0) {
          next[kind][index] = record;
          updated++;

        } else {
          next[kind].push(record);
          added++;
        }
      }

      if (!added && !updated) {
        throw Error(
          "Nenhuma linha válida. Verifique as colunas, " +
          "datas e vínculos de empresa/contrato."
        );
      }

      const confirmation =
        `Importar ${added} novo(s), ` +
        `atualizar ${updated} e ` +
        `ignorar ${ignored} registro(s)?\n\n` +
        "Faça backup antes de confirmar.";

      if (!confirm(confirmation)) {
        return;
      }

      if (persist(next)) {
        report.textContent =
          `Importação concluída: ` +
          `${added} incluído(s), ` +
          `${updated} atualizado(s), ` +
          `${ignored} ignorado(s).`;

        toast("CSV/TXT importado.");
      }

    } catch (error) {
      console.error(
        "CAF: erro na importação",
        error
      );

      report.textContent =
        error.message;

      toast(
        `Importação não realizada: ${error.message}`
      );
    }
  }

  // ========================================
  // AÇÕES DO SISTEMA
  // ========================================

  const actions = {
    "new-company": () =>
      openDialog("company"),

    "new-contract": () =>
      openDialog("contract"),

    "new-payment": () =>
      openDialog("payment"),

    "new-pending": () =>
      openDialog("pending"),

    "edit-company": id =>
      openDialog("company", id),

    "edit-contract": id =>
      openDialog("contract", id),

    "edit-payment": id =>
      openDialog("payment", id),

    "edit-pending": id =>
      openDialog("pending", id),

    "delete-company": id =>
      remove("company", id),

    "delete-contract": id =>
      remove("contract", id),

    "delete-payment": id =>
      remove("payment", id),

    "delete-pending": id =>
      remove("pending", id),

    "toggle-pending": id =>
      changePending(id),

    "export-companies": () =>
      exportCSV("suppliers"),

    "export-contracts": () =>
      exportCSV("contracts"),

    "export-payments": () =>
      exportCSV("payments"),

    "export-pending": () =>
      exportCSV("pendencias"),

    "backup": downloadBackup,

    "restore": () =>
      $("#restoreFile").click(),

    "import-csv": () =>
      $("#csvImportFile").click()
  };

  // ========================================
  // INICIALIZAÇÃO
  // ========================================

  function init() {
    db = readDB();

    setupImport();

    // FORMULÁRIOS

    $("#contractForm").addEventListener(
      "input",
      calculateCCT
    );

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

    // FILTROS

    const filters = [
      [
        "#filterCompanies",
        renderCompanies
      ],
      [
        "#filterContracts",
        renderContracts
      ],
      [
        "#filterPayments",
        renderPayments
      ],
      [
        "#filterPending",
        renderPending
      ],
      [
        "#pendingStatus",
        renderPending
      ]
    ];

    for (const [selector, fn] of filters) {
      $(selector).addEventListener(
        "input",
        fn
      );
    }

    // CLIQUES E NAVEGAÇÃO

    document.addEventListener(
      "click",
      event => {
        const close = event.target.closest(
          "[data-close]"
        );

        if (close) {
          document.getElementById(
            close.dataset.close
          )?.close();

          return;
        }

        const nav = event.target.closest(
          "[data-view]"
        );

        if (nav) {
          navigate(nav.dataset.view);
          return;
        }

        const button = event.target.closest(
          "[data-action]"
        );

        if (button) {
          actions[button.dataset.action]?.(
            button.dataset.id
          );
        }
      }
    );

    // RESTAURAÇÃO JSON

    $("#restoreFile").addEventListener(
      "change",
      async event => {
        await restoreBackup(
          event.target.files?.[0]
        );

        event.target.value = "";
      }
    );

    // IMPORTAÇÃO CSV/TXT

    $("#csvImportFile").addEventListener(
      "change",
      async event => {
        await importDelimited(
          event.target.files?.[0]
        );

        event.target.value = "";
      }
    );

    // ALTERAÇÕES EM OUTRAS ABAS

    window.addEventListener(
      "storage",
      event => {
        if (
          event.key !== KEY ||
          blockedStorage
        ) {
          return;
        }

        db = readDB();
        renderAll();

        toast(
          "Dados atualizados por outra aba deste navegador."
        );
      }
    );

    navigate("dashboard");

    if (blockedStorage) {
      toast(
        "Os dados salvos não puderam ser lidos. " +
        "Recupere um backup antes de fazer alterações."
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
