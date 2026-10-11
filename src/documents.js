
"use strict";

/*
  CAF SUREG-PA — Central de documentos

  Pré-visualização local:
  XLSX, XLS, CSV, TXT, DOCX e PDF.

  Nenhum lançamento financeiro é criado
  automaticamente.
*/

(() => {

  const $ = id =>
    document.getElementById(id);

  const esc = value =>
    String(value ?? "").replace(
      /[&<>"']/g,
      char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]
    );

  // BIBLIOTECAS DE LEITURA

  const LIBRARIES = {
    xlsx: {
      url:
        "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
      global: "XLSX"
    },

    docx: {
      url:
        "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.9.1/mammoth.browser.min.js",
      global: "mammoth"
    },

    pdf: {
      url:
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      global: "pdfjsLib"
    }
  };

  const PDF_WORKER =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const MAX_SIZE = 12 * 1024 * 1024;
  const MAX_ROWS = 10000;
  const MAX_PAGES = 100;
  const MAX_TEXT = 150000;

  const pending = new Map();

  let current = null;
  let requestId = 0;

  // =====================================
  // MENSAGENS
  // =====================================

  function message(value) {
    $("docsMessage").textContent = value;
  }

  // =====================================
  // CARREGAR BIBLIOTECA NECESSÁRIA
  // =====================================

  function loadLibrary(name) {
    const config = LIBRARIES[name];

    if (window[config.global]) {
      return Promise.resolve(
        window[config.global]
      );
    }

    if (pending.has(name)) {
      return pending.get(name);
    }

    const promise = new Promise(
      (resolve, reject) => {

        const script =
          document.createElement("script");

        script.src = config.url;
        script.async = true;

        script.onload = () => {
          if (window[config.global]) {
            resolve(window[config.global]);

          } else {
            reject(
              Error(
                `Não foi possível iniciar o leitor ${name}.`
              )
            );
          }
        };

        script.onerror = () => {
          reject(
            Error(
              `A biblioteca para ${name} não carregou. ` +
              "Confira sua conexão de internet."
            )
          );
        };

        document.head.appendChild(script);
      }
    );

    pending.set(name, promise);

    promise.catch(
      () => pending.delete(name)
    );

    return promise;
  }

  // =====================================
  // DECODIFICAR TXT / CSV
  // =====================================

  function decodeText(buffer) {
    const bytes = new Uint8Array(buffer);

    if (
      bytes[0] === 0xff &&
      bytes[1] === 0xfe
    ) {
      return new TextDecoder(
        "utf-16le"
      ).decode(buffer);
    }

    if (
      bytes[0] === 0xfe &&
      bytes[1] === 0xff
    ) {
      return new TextDecoder(
        "utf-16be"
      ).decode(buffer);
    }

    try {
      return new TextDecoder(
        "utf-8",
        { fatal: true }
      ).decode(buffer);

    } catch {
      return new TextDecoder(
        "windows-1252"
      ).decode(buffer);
    }
  }

  // =====================================
  // IDENTIFICAR TXT TABULAR
  // =====================================

  function looksTabular(text) {
    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(line => line.trim())
      .slice(0, 4);

    if (lines.length < 2) {
      return false;
    }

    return [";", "\t", ","].some(
      separator =>
        lines.every(
          line =>
            line.split(separator).length >= 2
        ) &&
        lines[0].split(separator).length ===
        lines[1].split(separator).length
    );
  }

  // =====================================
  // LIMPAR A VISUALIZAÇÃO
  // =====================================

  function reset() {
    requestId++;

    current = null;

    $("docsResult").hidden = true;
    $("docsSpreadsheet").hidden = true;
    $("docsTextResult").hidden = true;

    $("docsTable").replaceChildren();
    $("docsDetected").replaceChildren();

    $("docsText").value = "";
    $("docsFile").value = "";

    message(
      "Selecione um documento para começar. " +
      "Nenhum arquivo original será salvo."
    );
  }

  // =====================================
  // DETECTAR INFORMAÇÕES NO TEXTO
  // =====================================

  function displayDetected(text) {
    const unique = arr =>
      [...new Set(arr)];

    const patterns = [
      [
        "CNPJ",
        /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g
      ],

      [
        "Processo",
        /\b\d{5}\.\d{6}\/\d{4}-\d{2}\b/g
      ],

      [
        "Valores mencionados",
        /\bR\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?\b/g
      ],

      [
        "Datas",
        /\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/\d{4}\b/g
      ]
    ];

    const found = patterns
      .map(([label, regex]) => ({
        label,

        values: unique(
          (text.match(regex) || [])
            .slice(0, 30)
        ).slice(0, 8)
      }))
      .filter(
        item => item.values.length
      );

    $("docsDetected").innerHTML =
      found.length
        ? found.map(item => `
            <div class="docs-found-item">

              <strong>
                ${esc(item.label)}
              </strong>

              <span>
                ${esc(item.values.join(" · "))}
              </span>

            </div>
          `).join("")

        : `
          <p class="muted">
            Nenhum CNPJ, processo, valor ou data
            reconhecido pelos padrões simples.
            Confira o texto manualmente.
          </p>
        `;
  }

  // =====================================
  // MOSTRAR TEXTO EXTRAÍDO
  // =====================================

  function showText(text, note) {
    current = {
      kind: "text",
      text
    };

    $("docsResult").hidden = false;
    $("docsSpreadsheet").hidden = true;
    $("docsTextResult").hidden = false;

    $("docsText").value =
      text.slice(0, MAX_TEXT);

    $("docsTextNote").textContent =
      note +
      (
        text.length > MAX_TEXT
          ? (
              " Prévia limitada a " +
              MAX_TEXT.toLocaleString("pt-BR") +
              " caracteres. A exportação inclui " +
              "o texto completo."
            )
          : ""
      );

    displayDetected(text);

    message(
      "Texto extraído. Revise o conteúdo " +
      "antes de utilizar as informações."
    );
  }

  // =====================================
  // MOSTRAR ABA DE PLANILHA
  // =====================================

  function renderSheet() {
    if (current?.kind !== "sheet") {
      return;
    }

    const sheet =
      $("docsSheetSelect").value;

    const matrix =
      current.sheets[sheet] || [];

    const rows = matrix.slice(0, 11);

    const maxCols = Math.min(
      20,
      Math.max(
        0,
        ...rows.map(row => row.length)
      )
    );

    $("docsSheetInfo").textContent =
      `${sheet} · ` +
      `${Math.max(0, matrix.length - 1)} ` +
      "linha(s) de dados. " +
      "Prévia das 10 primeiras linhas " +
      "e até 20 colunas.";

    $("docsTable").innerHTML = rows.length
      ? `
        <thead>
          <tr>
            ${
              Array.from(
                { length: maxCols },
                (_, i) => `
                  <th>
                    ${esc(rows[0][i] ?? "")}
                  </th>
                `
              ).join("")
            }
          </tr>
        </thead>

        <tbody>
          ${
            rows.slice(1).map(row => `
              <tr>
                ${
                  Array.from(
                    { length: maxCols },
                    (_, i) => `
                      <td>
                        ${esc(row[i] ?? "")}
                      </td>
                    `
                  ).join("")
                }
              </tr>
            `).join("")
          }
        </tbody>
      `
      : `
        <tbody>
          <tr>
            <td>Esta aba está vazia.</td>
          </tr>
        </tbody>
      `;

    $("docsToImporter").disabled =
      matrix.length < 2;
  }

  // =====================================
  // MOSTRAR PLANILHAS
  // =====================================

  function showSheets(sheets) {
    current = {
      kind: "sheet",
      sheets
    };

    const names =
      Object.keys(sheets);

    if (!names.length) {
      throw Error(
        "Nenhuma aba foi encontrada na planilha."
      );
    }

    const select = $("docsSheetSelect");

    select.replaceChildren(
      ...names.map(
        name => new Option(name, name)
      )
    );

    $("docsResult").hidden = false;
    $("docsSpreadsheet").hidden = false;
    $("docsTextResult").hidden = true;

    renderSheet();

    message(
      "Tabela lida. Escolha a aba e o tipo " +
      "de cadastro para revisar a importação."
    );
  }

  // =====================================
  // LEITURA DE EXCEL / CSV
  // =====================================

  async function readSpreadsheet(
    buffer,
    isText = false
  ) {
    const XLSX = await loadLibrary(
      "xlsx"
    );

    const book = XLSX.read(
      isText
        ? decodeText(buffer)
        : buffer,

      isText
        ? { type: "string" }
        : {
            type: "array",
            cellDates: false
          }
    );

    const sheets = {};

    for (const name of book.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(
        book.Sheets[name],
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
          `A aba "${name}" supera ` +
          `${MAX_ROWS.toLocaleString("pt-BR")} ` +
          "registros."
        );
      }

      if (
        rows.some(row => row.length > 80)
      ) {
        throw Error(
          `A aba "${name}" tem mais de 80 colunas.`
        );
      }

      sheets[name] = rows.map(
        row => row.map(
          cell => String(cell ?? "")
        )
      );
    }

    showSheets(sheets);
  }

  // =====================================
  // LEITURA DE PDF
  // =====================================

  async function readPDF(buffer) {
    const pdfjsLib =
      await loadLibrary("pdf");

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      PDF_WORKER;

    const loading =
      pdfjsLib.getDocument({
        data: new Uint8Array(buffer)
      });

    let pdf;

    try {
      pdf = await loading.promise;

      const pages = Math.min(
        pdf.numPages,
        MAX_PAGES
      );

      const output = [];

      for (
        let number = 1;
        number <= pages;
        number++
      ) {
        const page =
          await pdf.getPage(number);

        const data =
          await page.getTextContent();

        output.push(
          `PÁGINA ${number}\n` +
          data.items
            .map(item => item.str || "")
            .join(" ")
        );

        page.cleanup();
      }

      const text =
        output.join("\n\n");

      showText(
        text,

        `PDF: ${pdf.numPages} página(s). ` +

        (
          pdf.numPages > MAX_PAGES
            ? `Foram lidas apenas ${MAX_PAGES}. `
            : ""
        ) +

        (
          !text.trim()
            ? (
                "Sem texto extraível — pode ser um " +
                "PDF digitalizado que requer OCR."
              )
            : (
                "Documentos digitalizados podem " +
                "não conter texto pesquisável."
              )
        )
      );

    } finally {
      try {
        await loading.destroy();
      } catch {}
    }
  }

  // =====================================
  // LEITURA DE WORD DOCX
  // =====================================

  async function readDOCX(buffer) {
    const mammoth =
      await loadLibrary("docx");

    const result =
      await mammoth.extractRawText({
        arrayBuffer: buffer
      });

    showText(
      result.value || "",

      "Word DOCX: texto extraído. " +
      "Tabelas e formatação podem perder estrutura."
    );
  }

  // =====================================
  // ESCOLHER ARQUIVO
  // =====================================

  async function selectFile(file) {
    if (!file) return;

    const extension =
      (file.name.split(".").pop() || "")
        .toLowerCase();

    const allowed = [
      "xlsx",
      "xls",
      "csv",
      "txt",
      "pdf",
      "docx"
    ];

    if (!allowed.includes(extension)) {
      message(
        "Formato inválido. Selecione XLSX, " +
        "XLS, CSV, TXT, DOCX ou PDF."
      );
      return;
    }

    if (file.size > MAX_SIZE) {
      message(
        "Arquivo maior que o limite de 12 MB."
      );
      return;
    }

    const ticket = ++requestId;

    current = null;
    $("docsResult").hidden = true;

    message(
      `Lendo ${file.name}...`
    );

    try {
      const buffer =
        await file.arrayBuffer();

      if (ticket !== requestId) {
        return;
      }

      $("docsFilename").textContent =
        file.name;

      $("docsMetadata").textContent =
        `${(file.size / 1024).toFixed(1)} KB · ` +
        extension.toUpperCase();

      if (
        ["xlsx", "xls", "csv"].includes(
          extension
        )
      ) {
        await readSpreadsheet(
          buffer,
          extension === "csv"
        );

      } else if (
        extension === "txt"
      ) {
        const text = decodeText(buffer);

        if (looksTabular(text)) {
          await readSpreadsheet(
            buffer,
            true
          );

        } else {
          showText(
            text,
            "Texto simples: revise as informações " +
            "antes de qualquer cadastro."
          );
        }

      } else if (
        extension === "pdf"
      ) {
        await readPDF(buffer);

      } else {
        await readDOCX(buffer);
      }

      if (ticket !== requestId) {
        reset();
      }

    } catch (error) {
      console.error(
        "Falha na leitura documental",
        error
      );

      if (ticket === requestId) {
        $("docsResult").hidden = true;

        message(
          "Não foi possível ler o arquivo: " +
          error.message
        );
      }
    }
  }

  // =====================================
  // CONVERTER PLANILHA EM CSV
  // =====================================

  function sheetAsCSV(rows) {
    const escapeCell = value =>
      `"${String(value ?? "")
        .replace(/"/g, '""')}"`;

    return "\uFEFF" +
      rows.map(
        row => row.map(
          escapeCell
        ).join(";")
      ).join("\r\n");
  }

  // =====================================
  // ENVIAR PARA O IMPORTADOR EXISTENTE
  // =====================================

  function moveToImporter() {
    if (
      current?.kind !== "sheet"
    ) {
      return;
    }

    const rows =
      current.sheets[
        $("docsSheetSelect").value
      ];

    if (!rows || rows.length < 2) {
      return;
    }

    if (
      typeof DataTransfer !== "function"
    ) {
      message(
        "Este navegador não permite " +
        "transferência automática. Exporte " +
        "a planilha como CSV e importe na " +
        "aba de cadastros."
      );

      return;
    }

    const csv =
      sheetAsCSV(rows);

    const file = new File(
      [csv],
      "documentos-para-revisao.csv",
      {
        type: "text/csv;charset=utf-8"
      }
    );

    const dt = new DataTransfer();

    dt.items.add(file);

    const target =
      $("csvFile");

    $("importType").value =
      $("docsTarget").value;

    target.files = dt.files;

    const nav = document.querySelector(
      '[data-view="files"]'
    );

    nav?.click();

    target.dispatchEvent(
      new Event(
        "change",
        { bubbles: true }
      )
    );
  }

  // =====================================
  // EXPORTAR TEXTO EXTRAÍDO
  // =====================================

  function downloadText(text, filename) {
    const blob = new Blob(
      ["\uFEFF", text],
      {
        type: "text/plain;charset=utf-8"
      }
    );

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      2000
    );
  }

  // =====================================
  // INICIALIZAÇÃO
  // =====================================

  function init() {
    if (!$("docsFile")) return;

    $("docsChoose").addEventListener(
      "click",
      () => $("docsFile").click()
    );

    $("docsClear").addEventListener(
      "click",
      reset
    );

    $("docsFile").addEventListener(
      "change",
      async event => {
        await selectFile(
          event.target.files?.[0]
        );

        event.target.value = "";
      }
    );

    $("docsSheetSelect").addEventListener(
      "change",
      renderSheet
    );

    $("docsToImporter").addEventListener(
      "click",
      moveToImporter
    );

    $("docsCopy").addEventListener(
      "click",
      () => {
        if (
          current?.kind !== "text"
        ) {
          return;
        }

        navigator.clipboard
          ?.writeText(current.text)
          .then(
            () => message(
              "Texto copiado."
            ),

            () => message(
              "Não foi possível copiar " +
              "automaticamente. Selecione o " +
              "texto para copiar."
            )
          );
      }
    );

    $("docsExportText").addEventListener(
      "click",
      () => {
        if (
          current?.kind === "text"
        ) {
          downloadText(
            current.text,
            "texto-extraido.txt"
          );
        }
      }
    );

    // ARRASTAR E SOLTAR

    const zone =
      $("docsDropzone");

    zone.addEventListener(
      "click",
      () => $("docsFile").click()
    );

    zone.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Enter" ||
          event.key === " "
        ) {
          event.preventDefault();
          $("docsFile").click();
        }
      }
    );

    zone.addEventListener(
      "dragover",
      event => {
        event.preventDefault();
        zone.classList.add("dragover");
      }
    );

    zone.addEventListener(
      "dragleave",
      () => zone.classList.remove(
        "dragover"
      )
    );

    zone.addEventListener(
      "drop",
      async event => {
        event.preventDefault();

        zone.classList.remove(
          "dragover"
        );

        await selectFile(
          event.dataTransfer?.files?.[0]
        );
      }
    );
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );

  } else {
    init();
  }

})();
