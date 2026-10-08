
"use strict";

// Protótipo demonstrativo.
// Dados armazenados somente no navegador.

const STORAGE_KEY = "sureg-pa-demo-v1";

const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  [...root.querySelectorAll(selector)];

const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]
  );

const money = (value) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value) || 0);

const integer = (value) =>
  Math.max(0, Math.floor(Number(value) || 0));

const num = (value) =>
  Math.max(0, Number(value) || 0);

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const displayDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    ? value.split("-").reverse().join("/")
    : value || "—";

const fleetTypes = [
  "veiculos",
  "motoristas",
  "agenda",
  "solicitacoes",
  "checklists",
  "manutencoes",
  "ordens",
  "infracoes",
  "templates",
];

function freshState() {
  return {
    suppliers: [],
    contracts: [],
    payments: [],
    fleet: Object.fromEntries(fleetTypes.map((t) => [t, []])),
    demo: false,
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

    if (!saved || !Array.isArray(saved.contracts)) {
      return freshState();
    }

    const base = freshState();

    return {
      ...base,
      ...saved,
      fleet: { ...base.fleet, ...saved.fleet },
    };
  } catch {
    return freshState();
  }
}

let state = loadState();
let currentPage = "dashboard";
let recordType = null;
let recordId = null;
let toastTimer;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    notify("Não foi possível gravar neste navegador.");
  }
}

function notify(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3700);
}

// ============================================
// CONTROLE FINANCEIRO
// ============================================

const contractForm = $("#contractForm");

function supplierById(id) {
  return state.suppliers.find((x) => x.id === id);
}

function contractById(id) {
  return state.contracts.find((x) => x.id === id);
}

function renderSuppliers(selected = $("#supplier").value) {
  const select = $("#supplier");

  select.replaceChildren(
    new Option("Selecione uma empresa", "")
  );

  state.suppliers
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .forEach((s) => {
      select.add(new Option(`${s.nome} — ${s.cnpj}`, s.id));
    });

  select.value = selected || "";
}

function renderContracts(selected = $("#contractPicker").value) {
  const select = $("#contractPicker");

  select.replaceChildren(
    new Option("Novo contrato / formulário vazio", "")
  );

  const paymentSelect = $("#paymentContract");

  paymentSelect.replaceChildren(
    new Option("Selecione o contrato", "")
  );

  state.contracts.forEach((c) => {
    const supplier = supplierById(c.supplier);

    const title = `${c.numero || c.processo} — ${
      supplier?.nome || "Empresa não localizada"
    }`;

    select.add(new Option(title, c.id));
    paymentSelect.add(new Option(title, c.id));
  });

  select.value = selected || "";
}

function calculateContract() {
  const f = contractForm.elements;

  const monthly =
    num(f.namedItem("salario").value) *
      (1 + num(f.namedItem("encargos").value) / 100) *
      integer(f.namedItem("postos").value) +
    num(f.namedItem("materiais").value);

  $("#totalMensal").value = money(monthly);

  const base = num(f.namedItem("gastoAnual2025").value);
  const current = num(f.namedItem("ploa2026").value);

  if (base) {
    const variation = ((current / base) - 1) * 100;

    $("#ploaVariacao").value =
      `${variation >= 0 ? "+" : ""}` +
      variation.toFixed(2).replace(".", ",") +
      "%";
  } else {
    $("#ploaVariacao").value = "Sem base para cálculo";
  }
}

function resetContract() {
  contractForm.reset();
  $("#contractPicker").value = "";

  $("#formStatus").textContent =
    "Novo contrato: preencha os dados para salvar.";

  calculateContract();
}

function loadContract(id) {
  const c = contractById(id);

  if (!c) {
    resetContract();
    return;
  }

  contractForm.reset();

  $$("[name]", contractForm).forEach((field) => {
    if (Object.hasOwn(c, field.name)) {
      field.value = c[field.name] ?? "";
    }
  });

  $("#contractPicker").value = id;

  $("#formStatus").textContent =
    `Editando contrato ${c.numero || c.processo}. ` +
    "Clique em Salvar para gravar alterações.";

  calculateContract();
}

contractForm.addEventListener("input", calculateContract);
contractForm.addEventListener("change", calculateContract);

contractForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!contractForm.reportValidity()) return;

  const formData = Object.fromEntries(
    new FormData(contractForm).entries()
  );

  if (formData.vigenciaFinal < formData.vigenciaInicial) {
    notify("A vigência final não pode ser anterior à inicial.");
    return;
  }

  const id = $("#contractPicker").value || uid();
  const item = { ...formData, id };

  const pos = state.contracts.findIndex((c) => c.id === id);

  if (pos < 0) {
    state.contracts.push(item);
  } else {
    state.contracts[pos] = item;
  }

  saveState();
  renderContracts(id);
  renderPayments();

  $("#formStatus").textContent =
    "Contrato salvo neste navegador.";

  notify("Contrato salvo com sucesso.");
});

$("#newContractBtn").addEventListener("click", resetContract);

$("#contractPicker").addEventListener("change", (e) =>
  loadContract(e.target.value)
);

$("#deleteContractBtn").addEventListener("click", () => {
  const id = $("#contractPicker").value;

  if (!id) {
    notify("Selecione um contrato para excluir.");
    return;
  }

  if (
    !confirm(
      "Excluir este contrato e todos os pagamentos vinculados a ele?"
    )
  ) {
    return;
  }

  state.contracts = state.contracts.filter((c) => c.id !== id);

  state.payments = state.payments.filter(
    (p) => p.contractId !== id
  );

  saveState();
  renderContracts("");
  resetContract();
  renderPayments();
  notify("Contrato excluído.");
});

// ============================================
// CADASTRO DE EMPRESAS
// ============================================

$("#addSupplierBtn").addEventListener("click", () => {
  $("#supplierForm").reset();
  $("#supplierDialog").showModal();
});

$("#supplierForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const form = event.currentTarget;

  if (!form.reportValidity()) return;

  const nome = form.elements.namedItem("nome").value.trim();

  const digits = form.elements
    .namedItem("cnpj")
    .value.replace(/\D/g, "");

  if (digits.length !== 14) {
    notify("Informe os 14 dígitos do CNPJ.");
    return;
  }

  if (
    state.suppliers.some(
      (s) => s.cnpj.replace(/\D/g, "") === digits
    )
  ) {
    notify("Este CNPJ já está cadastrado.");
    return;
  }

  const cnpj = digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );

  const id = uid();

  state.suppliers.push({ id, nome, cnpj });

  saveState();
  renderSuppliers(id);

  $("#supplierDialog").close();
  notify("Empresa cadastrada neste navegador.");
});

// ============================================
// HISTÓRICO DE PAGAMENTOS
// ============================================

function renderPayments() {
  const cnpjFilter = $("#searchCnpj")
    .value.toLowerCase()
    .replace(/\D/g, "");

  const nameFilter = $("#searchName")
    .value.toLocaleLowerCase("pt-BR")
    .trim();

  const filtered = state.payments
    .filter((payment) => {
      const contract = contractById(payment.contractId);
      const supplier = supplierById(contract?.supplier);

      return (
        (!cnpjFilter ||
          (supplier?.cnpj || "")
            .replace(/\D/g, "")
            .includes(cnpjFilter)) &&
        (!nameFilter ||
          (supplier?.nome || "")
            .toLocaleLowerCase("pt-BR")
            .includes(nameFilter))
      );
    })
    .sort((a, b) => b.data.localeCompare(a.data));

  $("#paymentsTable").innerHTML = filtered.length
    ? filtered
        .map((p) => {
          const c = contractById(p.contractId);
          const s = supplierById(c?.supplier);

          return `
            <tr>
              <td>${escapeHTML(displayDate(p.data))}</td>
              <td>
                <strong>${escapeHTML(s?.nome || "—")}</strong>
                <br>
                <span class="muted">${escapeHTML(s?.cnpj || "—")}</span>
              </td>
              <td>${escapeHTML(c?.numero || c?.processo || "—")}</td>
              <td>${escapeHTML(p.descricao || "—")}</td>
              <td>${money(p.valor)}</td>
              <td>
                <button class="table-action" type="button"
                  data-delete-payment="${escapeHTML(p.id)}">
                  Excluir
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td class="empty-table" colspan="6">
          Nenhum pagamento encontrado.
          Cadastre um contrato e registre pagamentos.
        </td>
      </tr>
    `;

  $("#paymentCount").textContent =
    `${filtered.length} pagamento(s)`;

  $("#paymentTotal").textContent =
    `Total: ${money(
      filtered.reduce((a, p) => a + num(p.valor), 0)
    )}`;
}

$("#searchCnpj").addEventListener("input", renderPayments);
$("#searchName").addEventListener("input", renderPayments);

$("#paymentsTable").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-delete-payment]");

  if (!btn) return;
  if (!confirm("Excluir este pagamento?")) return;

  state.payments = state.payments.filter(
    (p) => p.id !== btn.dataset.deletePayment
  );

  saveState();
  renderPayments();
  notify("Pagamento excluído.");
});

$("#addPaymentBtn").addEventListener("click", () => {
  if (!state.contracts.length) {
    notify("Salve um contrato antes de registrar pagamentos.");
    return;
  }

  $("#paymentForm").reset();

  $("#paymentContract").value =
    $("#contractPicker").value || "";

  $("#paymentForm").elements.namedItem("data").value =
    localDate();

  $("#paymentDialog").showModal();
});

$("#paymentForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const form = event.currentTarget;

  if (!form.reportValidity()) return;

  state.payments.push({
    ...Object.fromEntries(new FormData(form).entries()),
    id: uid(),
  });

  saveState();
  renderPayments();
  $("#paymentDialog").close();
  notify("Pagamento registrado.");
});

$$("[data-close]").forEach((b) =>
  b.addEventListener("click", () =>
    document.getElementById(b.dataset.close).close()
  )
);

// ============================================
// GESTÃO DE FROTAS
// ============================================

const S = (name, label, options, required = false) => ({
  name,
  label,
  options,
  required,
  type: "select",
});

const F = (name, label, type = "text", required = false) => ({
  name,
  label,
  type,
  required,
});

const modules = {
  veiculos: {
    title: "Veículos",
    one: "veículo",
    fields: [
      F("placa", "Placa / Identificação", "text", true),
      F("modelo", "Modelo", "text", true),
      F("unidade", "Unidade"),
      S("status", "Status", [
        "Disponível",
        "Em uso",
        "Manutenção",
        "Indisponível",
      ], true),
      F("motorista", "Responsável"),
    ],
  },

  motoristas: {
    title: "Motoristas",
    one: "motorista",
    fields: [
      F("nome", "Nome", "text", true),
      F("matricula", "Matrícula"),
      F("cnh", "Validade da CNH", "date"),
      F("contato", "Contato"),
    ],
  },

  agenda: {
    title: "Agenda",
    one: "compromisso",
    fields: [
      F("titulo", "Atividade", "text", true),
      F("data", "Data", "date", true),
      F("veiculo", "Veículo"),
      S("status", "Status", [
        "Pendente",
        "Concluído",
        "Cancelado",
      ]),
    ],
  },

  solicitacoes: {
    title: "Solicitações",
    one: "solicitação",
    fields: [
      F("descricao", "Solicitação", "text", true),
      F("solicitante", "Solicitante"),
      F("data", "Data", "date"),
      S("status", "Status", [
        "Pendente",
        "Em andamento",
        "Concluído",
      ]),
    ],
  },

  checklists: {
    title: "Checklists",
    one: "checklist",
    fields: [
      F("veiculo", "Veículo / Placa", "text", true),
      F("data", "Data", "date", true),
      S("status", "Situação", ["Concluído", "Pendente"]),
      F("observacoes", "Observações"),
    ],
  },

  manutencoes: {
    title: "Plano de Manutenção",
    one: "manutenção",
    fields: [
      F("veiculo", "Veículo / Placa", "text", true),
      F("servico", "Serviço previsto", "text", true),
      F("data", "Data prevista", "date"),
      S("status", "Status", [
        "Pendente",
        "Em andamento",
        "Concluído",
        "Crítico",
      ]),
      F("custo", "Custo estimado (R$)", "number"),
    ],
  },

  ordens: {
    title: "Ordens de Serviço",
    one: "ordem de serviço",
    fields: [
      F("numero", "Número da OS", "text", true),
      F("veiculo", "Veículo"),
      F("servico", "Serviço", "text", true),
      S("status", "Status", [
        "Pendente",
        "Em andamento",
        "Concluído",
      ]),
    ],
  },

  infracoes: {
    title: "Infrações",
    one: "infração",
    fields: [
      F("veiculo", "Veículo / Placa", "text", true),
      F("auto", "Auto de infração", "text", true),
      F("valor", "Valor (R$)", "number"),
      S("status", "Status", [
        "Pendente",
        "Em recurso",
        "Concluído",
      ]),
    ],
  },

  templates: {
    title: "Templates de Manutenção",
    one: "template",
    fields: [
      F("nome", "Nome do modelo", "text", true),
      F("categoria", "Categoria"),
      F("intervalo", "Intervalo (km ou meses)"),
      F("descricao", "Descrição"),
    ],
  },
};

const titles = {
  dashboard: "Dashboard",
  painel: "Painel da Frota",
  mapa: "Mapa em Tempo Real",
  relatorios: "Relatórios",
  configuracoes: "Configurações",
};

function fleetRows(type) {
  return state.fleet[type] || [];
}

function getFleetStats() {
  const data = fleetRows("veiculos");

  const count = (status) =>
    data.filter((v) => v.status === status).length;

  const alerts =
    fleetRows("infracoes").filter(
      (r) => r.status === "Pendente"
    ).length +
    fleetRows("manutencoes").filter(
      (r) => ["Pendente", "Crítico"].includes(r.status)
    ).length;

  return {
    total: data.length,
    available: count("Disponível"),
    used: count("Em uso"),
    maintenance: count("Manutenção"),
    unavailable: count("Indisponível"),
    alerts,
  };
}

function fleetHeader() {
  $("#fleetStatus").textContent =
    `Frota: ${fleetRows("veiculos").length} veículos cadastrados`;

  $("#syncInfo").textContent =
    "Salvo localmente • sem sincronização";
}

function statCard(title, count, subtitle, color) {
  return `
    <article class="stat-card" style="--accent:${color}">
      <span class="stat-title">${title}</span>
      <strong>${count}</strong>
      <small>${subtitle}</small>
    </article>
  `;
}

function statusBadge(value) {
  const label = escapeHTML(value || "—");

  const cl = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");

  return `<span class="pill ${cl}">${label}</span>`;
}

// ============================================
// DASHBOARD DA FROTA
// ============================================

function dashboardHTML() {
  const s = getFleetStats();

  const counts = [
    s.available,
    s.used,
    s.maintenance,
    s.unavailable,
  ];

  const colors = [
    "#12a65a",
    "#3068e7",
    "#d78b00",
    "#de3436",
  ];

  let acc = 0;

  const gradient = s.total
    ? `conic-gradient(${counts
        .map((n, i) => {
          const start = acc;
          acc += (n / s.total) * 100;
          return `${colors[i]} ${start}% ${acc}%`;
        })
        .join(",")})`
    : "#e4eaf1";

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));

    return `${String(d.getDate()).padStart(2, "0")}/${String(
      d.getMonth() + 1
    ).padStart(2, "0")}`;
  });

  const demoBlue = [7, 8, 5, 4, 9, 10, 5];
  const demoGreen = [5, 4, 7, 8, 3, 2, 7];

  const showBars = state.demo;

  const bars = days
    .map(
      (day, i) => `
        <div class="bar-group">
          <div class="bar blue"
            style="height:${showBars ? (demoBlue[i] / 12) * 85 : 0}%"
            title="Exemplo: ${demoBlue[i]} em uso"></div>
          <div class="bar green"
            style="height:${showBars ? (demoGreen[i] / 12) * 85 : 0}%"
            title="Exemplo: ${demoGreen[i]} disponíveis"></div>
          <span class="bar-label">${day}</span>
        </div>
      `
    )
    .join("");

  return `
    <div class="stats-grid">
      ${statCard("Total da frota", s.total, "Veículos registrados", "#0b88dd")}
      ${statCard(
        "Em uso (cadastro)",
        s.used,
        s.total ? `${Math.round((s.used / s.total) * 100)}% do cadastro` : "Nenhum veículo",
        "#3665fd"
      )}
      ${statCard("Em manutenção", s.maintenance, "Situação cadastrada", "#dc9200")}
      ${statCard(
        "Alertas pendentes",
        s.alerts,
        "Infrações e manutenções pendentes",
        "#ef3e46"
      )}
    </div>

    <div class="chart-layout">
      <section class="chart-card">
        <h2>Utilização da Frota — últimos 7 dias</h2>
        <p>
          ${
            showBars
              ? "Dados fictícios para ilustrar a aparência do gráfico"
              : "Nenhum histórico disponível: a integração com GPS não está conectada"
          }
        </p>
        <div class="bar-chart">${bars}</div>
        <div class="legend">
          <span><i style="background:#3167e9"></i>Em uso</span>
          <span><i style="background:#10a853"></i>Disponível</span>
        </div>
      </section>

      <section class="chart-card">
        <h2>Distribuição por Status</h2>
        <p>Dados dos veículos cadastrados neste navegador</p>
        <div class="donut" style="background:${gradient}"></div>
        <div class="donut-legend">
          ${["Disponível", "Em uso", "Manutenção", "Indisponível"]
            .map(
              (key, i) => `
                <div>
                  <span>
                    <i style="background:${colors[i]}"></i>${key}
                  </span>
                  <strong>${counts[i]}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    </div>

    <div class="fleet-card" style="margin-top:16px">
      <h2>Informação sobre os dados</h2>
      <p>
        Cadastros e totais funcionam localmente.
        O gráfico de sete dias é exclusivamente ilustrativo
        e não apresenta rastreamento real.
      </p>
    </div>
  `;
}

// ============================================
// CADASTROS GENÉRICOS DA FROTA
// ============================================

function showGeneric(type) {
  const mod = modules[type];
  const rows = fleetRows(type);

  $("#fleetContent").innerHTML = `
    <section class="fleet-card">
      <div class="section-heading">
        <div>
          <h2>${mod.title}</h2>
          <p>${rows.length} registro(s) salvo(s) neste navegador</p>
        </div>
        <button class="btn btn-blue" id="createRecord" type="button">
          ＋ Novo registro
        </button>
      </div>

      <div class="toolbar">
        <input
          type="search"
          id="moduleSearch"
          aria-label="Pesquisar registros"
          placeholder="Pesquisar nesta lista..."
        >
        <button class="btn btn-ghost" id="moduleExport">
          Exportar CSV
        </button>
      </div>

      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              ${mod.fields
                .map((f) => `<th>${escapeHTML(f.label)}</th>`)
                .join("")}
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="moduleTable"></tbody>
        </table>
      </div>
    </section>
  `;

  $("#createRecord").addEventListener("click", () =>
    openRecord(type)
  );

  $("#moduleExport").addEventListener("click", () =>
    exportCSV(type)
  );

  $("#moduleSearch").addEventListener(
    "input",
    renderModuleTable
  );

  renderModuleTable();
}

function renderModuleTable() {
  const mod = modules[currentPage];
  if (!mod) return;

  const query = ($("#moduleSearch")?.value || "")
    .toLocaleLowerCase("pt-BR");

  const rows = fleetRows(currentPage).filter((row) =>
    Object.values(row).some((value) =>
      String(value)
        .toLocaleLowerCase("pt-BR")
        .includes(query)
    )
  );

  $("#moduleTable").innerHTML = rows.length
    ? rows
        .map(
          (row) => `
          <tr>
            ${mod.fields
              .map(
                (f) => `
                <td>
                  ${
                    f.name === "status"
                      ? statusBadge(row[f.name])
                      : escapeHTML(
                          f.type === "date"
                            ? displayDate(row[f.name])
                            : f.type === "number"
                              ? money(row[f.name])
                              : row[f.name] || "—"
                        )
                  }
                </td>
              `
              )
              .join("")}
            <td>
              <button class="btn btn-ghost btn-small"
                data-edit="${escapeHTML(row.id)}">
                Editar
              </button>
              <button class="table-action"
                data-delete="${escapeHTML(row.id)}">
                Excluir
              </button>
            </td>
          </tr>
        `
        )
        .join("")
    : `
      <tr>
        <td colspan="${mod.fields.length + 1}" class="empty-table">
          Sem registros. Use "Novo registro" para começar.
        </td>
      </tr>
    `;

  $$("[data-edit]", $("#moduleTable")).forEach((button) =>
    button.addEventListener("click", () =>
      openRecord(currentPage, button.dataset.edit)
    )
  );

  $$("[data-delete]", $("#moduleTable")).forEach((button) =>
    button.addEventListener("click", () =>
      deleteRecord(currentPage, button.dataset.delete)
    )
  );
}

function deleteRecord(type, id) {
  if (!confirm("Excluir este registro?")) return;

  state.fleet[type] = fleetRows(type).filter(
    (r) => r.id !== id
  );

  saveState();
  renderFleet();
  notify("Registro excluído.");
}

function openRecord(type, id = null) {
  recordType = type;
  recordId = id;

  const mod = modules[type];

  const row =
    fleetRows(type).find((x) => x.id === id) || {};

  $("#recordTitle").textContent =
    `${id ? "Editar" : "Cadastrar"} ${mod.one}`;

  $("#recordFields").innerHTML = mod.fields
    .map(
      (field) => `
      <label>
        ${escapeHTML(field.label)}${field.required ? " *" : ""}
        ${
          field.type === "select"
            ? `
              <select name="${field.name}"
                ${field.required ? "required" : ""}>
                ${field.options
                  .map(
                    (value) => `
                    <option value="${escapeHTML(value)}">
                      ${escapeHTML(value)}
                    </option>
                  `
                  )
                  .join("")}
              </select>
            `
            : `
              <input
                name="${field.name}"
                type="${field.type}"
                ${
                  field.type === "number"
                    ? 'min="0" step="0.01"'
                    : ""
                }
                ${field.required ? "required" : ""}
              >
            `
        }
      </label>
    `
    )
    .join("");

  mod.fields.forEach((f) => {
    const element = $("#recordForm").elements.namedItem(f.name);

    if (row[f.name] !== undefined) {
      element.value = row[f.name];
    } else if (f.type === "date") {
      element.value = localDate();
    }
  });

  $("#recordDialog").showModal();
}

$("#recordForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const form = event.currentTarget;

  if (!form.reportValidity()) return;

  const item = {
    ...Object.fromEntries(new FormData(form).entries()),
    id: recordId || uid(),
  };

  const rows = fleetRows(recordType);
  const pos = rows.findIndex((x) => x.id === item.id);

  if (pos >= 0) {
    rows[pos] = item;
  } else {
    rows.push(item);
  }

  saveState();
  $("#recordDialog").close();
  renderFleet();
  notify("Registro salvo neste navegador.");
});

// ============================================
// EXPORTAÇÃO CSV
// ============================================

function exportCSV(type) {
  const types = type === "todos" ? fleetTypes : [type];

  const columns = ["modulo", "id", "campo", "valor"];

  const data = types.flatMap((module) =>
    fleetRows(module).flatMap((row) =>
      Object.entries(row)
        .filter(([key]) => key !== "id")
        .map(([key, value]) => [
          module,
          row.id,
          key,
          value,
        ])
    )
  );

  if (!data.length) {
    notify("Não há registros para exportar.");
    return;
  }

  const cell = (value) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csv =
    "\uFEFF" +
    [columns, ...data]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n");

  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );

  const a = document.createElement("a");
  a.href = url;
  a.download = `sureg-pa-${type}-${localDate()}.csv`;

  document.body.append(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  notify("CSV gerado para download.");
}

$("#fleetExportBtn").addEventListener("click", () =>
  exportCSV(modules[currentPage] ? currentPage : "todos")
);

// ============================================
// NAVEGAÇÃO E TELAS DA FROTA
// ============================================

function renderFleet() {
  const title =
    modules[currentPage]?.title ||
    titles[currentPage] ||
    "Dashboard";

  $("#fleetTitle").textContent = title;

  $$(".fleet-nav").forEach((btn) =>
    btn.classList.toggle(
      "active",
      btn.dataset.page === currentPage
    )
  );

  fleetHeader();

  if (currentPage === "dashboard") {
    $("#fleetContent").innerHTML = dashboardHTML();
    return;
  }

  if (modules[currentPage]) {
    showGeneric(currentPage);
    return;
  }

  if (currentPage === "painel") {
    const vehicles = fleetRows("veiculos");
    const stats = getFleetStats();

    $("#fleetContent").innerHTML = `
      <section class="fleet-card">
        <h2>Situação atual do cadastro</h2>
        <p>
          Esta tela apresenta dados inseridos manualmente.
          Não reflete telemetria ao vivo.
        </p>
        <div class="metric-line">
          <span>Total: ${vehicles.length}</span>
          <span>Em uso: ${stats.used}</span>
          <span>Disponíveis: ${stats.available}</span>
        </div>

        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Identificação</th>
                <th>Modelo</th>
                <th>Unidade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${
                vehicles.length
                  ? vehicles
                      .map(
                        (v) => `
                        <tr>
                          <td>${escapeHTML(v.placa)}</td>
                          <td>${escapeHTML(v.modelo)}</td>
                          <td>${escapeHTML(v.unidade)}</td>
                          <td>${statusBadge(v.status)}</td>
                        </tr>
                      `
                      )
                      .join("")
                  : `
                    <tr>
                      <td colspan="4" class="empty-table">
                        Nenhum veículo cadastrado.
                      </td>
                    </tr>
                  `
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
    return;
  }

  if (currentPage === "mapa") {
    $("#fleetContent").innerHTML = `
      <section class="fleet-card">
        <h2>Rastreamento em tempo real</h2>
        <div class="info-banner">
          Nenhuma API de rastreamento está configurada.
          A interface não inventa posições ou coordenadas.
        </div>
        <p>
          Para habilitar esta função, será necessário integrar
          um serviço autorizado de telemetria, com autenticação
          e permissões apropriadas.
        </p>
      </section>
    `;
    return;
  }

  if (currentPage === "relatorios") {
    const s = getFleetStats();

    $("#fleetContent").innerHTML = `
      <section class="fleet-card">
        <h2>Relatório resumido</h2>
        <div class="metric-line">
          <span>Veículos: ${s.total}</span>
          <span>Motoristas: ${fleetRows("motoristas").length}</span>
          <span>Manutenções: ${fleetRows("manutencoes").length}</span>
          <span>Alertas: ${s.alerts}</span>
        </div>
        <p>
          Exporte os cadastros em CSV para abrir no Excel
          ou em outra ferramenta de análise.
        </p>
        <div style="margin-top:18px">
          <button class="btn btn-blue" id="downloadReport">
            Exportar todos os cadastros
          </button>
        </div>
      </section>
    `;

    $("#downloadReport").addEventListener("click", () =>
      exportCSV("todos")
    );

    return;
  }

  if (currentPage === "configuracoes") {
    $("#fleetContent").innerHTML = `
      <section class="fleet-card">
        <h2>Armazenamento local</h2>
        <p>
          Os registros ficam no armazenamento local do navegador.
          Limpar os dados do site também pode apagá-los.
        </p>
        <div class="info-banner">
          Não armazene dados pessoais, senhas, contratos sigilosos
          ou dados institucionais reais neste protótipo.
        </div>
        <button type="button" class="btn btn-red" id="clearData">
          Apagar todos os dados locais
        </button>
      </section>
    `;

    $("#clearData").addEventListener("click", () => {
      if (
        !confirm(
          "Apagar TODOS os cadastros, contratos e pagamentos?"
        )
      ) {
        return;
      }

      state = freshState();
      saveState();
      renderSuppliers("");
      renderContracts("");
      resetContract();
      renderPayments();
      renderFleet();

      notify("Dados locais apagados.");
    });
  }
}

// ============================================
// EVENTOS DE NAVEGAÇÃO
// ============================================

$$(".fleet-nav").forEach((button) =>
  button.addEventListener("click", () => {
    currentPage = button.dataset.page;
    renderFleet();
  })
);

$$(".mode-tab").forEach((button) =>
  button.addEventListener("click", () => {
    $$(".mode-tab").forEach((b) =>
      b.classList.toggle("active", b === button)
    );

    $$(".mode-view").forEach((section) => {
      section.hidden = section.id !== button.dataset.mode;
    });

    if (button.dataset.mode === "frota") {
      renderFleet();
    }
  })
);

// ============================================
// DADOS FICTÍCIOS PARA DEMONSTRAÇÃO
// ============================================

$("#demoBtn").addEventListener("click", () => {
  if (
    !confirm(
      "Adicionar registros FICTÍCIOS para testar as telas? " +
      "Os registros atuais serão preservados."
    )
  ) {
    return;
  }

  const demoSupplier = uid();
  const demoContract = uid();

  state.suppliers.push({
    id: demoSupplier,
    nome: "Fornecedor Exemplo (DEMO)",
    cnpj: "12.345.678/0001-90",
  });

  state.contracts.push({
    id: demoContract,
    supplier: demoSupplier,
    unidade: "SUREG-PA",
    tipo: "Serviço contínuo",
    processo: "00000.000000/2026-00",
    numero: "DEMO-01/2026",
    modalidade: "Pregão",
    gestor: "Gestor demonstrativo",
    fiscalAdm: "Fiscal demonstrativo",
    fiscalTecnico: "",
    suplente: "",
    garantia: "",
    vigenciaInicial: "2026-01-01",
    vigenciaFinal: "2026-12-31",
    objeto: "Contrato FICTÍCIO para teste de interface",
    observacoes: "NÃO representa contrato verdadeiro.",
    tipoCusto: "Fixo",
    nd: "339039",
    valorGlobal: "300000",
    custoPosto: "5000",
    categoria: "Apoio administrativo",
    postos: "5",
    salario: "3000",
    encargos: "90",
    materiais: "2000",
    gastoMensal2025: "24000",
    gastoAnual2025: "288000",
    totalGasto2025: "280000",
    ploa2026: "300000",
    qtdAtual: "5",
    qtdAnalise: "5",
  });

  state.payments.push({
    id: uid(),
    contractId: demoContract,
    data: "2026-07-10",
    descricao: "Pagamento demonstrativo julho",
    valor: "25000",
  });

  state.payments.push({
    id: uid(),
    contractId: demoContract,
    data: "2026-08-10",
    descricao: "Pagamento demonstrativo agosto",
    valor: "25000",
  });

  if (!fleetRows("veiculos").length) {
    const statuses = [
      "Disponível",
      "Disponível",
      "Disponível",
      "Disponível",
      "Disponível",
      "Em uso",
      "Em uso",
      "Em uso",
      "Em uso",
      "Manutenção",
      "Manutenção",
      "Indisponível",
    ];

    state.fleet.veiculos = statuses.map((status, i) => ({
      id: uid(),
      placa: `DEMO-${String(i + 1).padStart(3, "0")}`,
      modelo: `Veículo fictício ${i + 1}`,
      unidade: "SUREG-PA",
      status,
      motorista: "",
    }));

    state.fleet.manutencoes.push({
      id: uid(),
      veiculo: "DEMO-010",
      servico: "Revisão demonstrativa",
      data: "2026-10-20",
      status: "Pendente",
      custo: "1800",
    });

    state.fleet.infracoes.push({
      id: uid(),
      veiculo: "DEMO-011",
      auto: "AUTO-DEMO",
      valor: "150",
      status: "Pendente",
    });
  }

  state.demo = true;
  saveState();

  renderSuppliers(demoSupplier);
  renderContracts(demoContract);
  loadContract(demoContract);
  renderPayments();
  renderFleet();

  notify("Dados fictícios adicionados.");
});

// ============================================
// INICIALIZAÇÃO
// ============================================

renderSuppliers();
renderContracts();
renderPayments();
calculateContract();
renderFleet();
