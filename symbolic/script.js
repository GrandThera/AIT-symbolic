const API_BASE = 'https://thera-os-public-6d5652bhhq-uc.a.run.app';
const state = {
  rows: [],
  columns: [],
  numericColumns: [],
  dependent: "",
  independent: [],
  profiles: {},
  model: null,
  scenario: {},
  forecastSteps: 12,
  rangeStart: 0,
  rangeEnd: 0,
  hover: null,
  scatterHover: null,
  residualHover: null,
  paletteOpen: false
};

const el = (id) => document.getElementById(id);
const fmt = (value, digits = 3) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "--";
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function generateSampleRows() {
  const rows = [];
  for (let i = 0; i < 180; i += 1) {
    const seasonality = Math.sin(i / 13);
    const adSpend = 55 + 18 * Math.sin(i / 17) + (i % 9) * 1.7;
    const price = 18 + 2.5 * Math.cos(i / 23) + (i % 11) * 0.08;
    const inventory = 92 + 22 * Math.sin(i / 31) + (i % 7) * 2.1;
    const rate = 5.2 + 1.4 * Math.cos(i / 37);
    const noise = Math.sin(i * 1.91) * 1.8 + Math.cos(i * 0.43) * 0.9;
    const demand = 28 + 7.8 * Math.sqrt(Math.max(adSpend, 0)) - 1.55 * price + 0.045 * price * price + 14 * seasonality + 0.38 * inventory / Math.max(rate, 0.3) + noise;
    rows.push({
      observation: i + 1,
      ad_spend: adSpend,
      price,
      seasonality,
      inventory,
      interest_rate: rate,
      demand
    });
  }
  return rows;
}

function setStatus(text, strong) {
  el("statusLine").innerHTML = strong ? `<strong>${escapeHtml(strong)}</strong>&nbsp;${escapeHtml(text)}` : escapeHtml(text);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (value == null) return NaN;
  let text = String(value).trim();
  if (!text) return NaN;
  const percent = text.endsWith("%");
  text = text.replace(/[%$R\s]/g, "").replace(/[^\d,.\-+eE]/g, "");
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma > -1 && dot > -1) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma > -1) {
    text = text.replace(",", ".");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? (percent ? parsed / 100 : parsed) : NaN;
}

function quantile(values, q) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function std(values, mu = mean(values)) {
  const variance = values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / Math.max(values.length - 1, 1);
  return Math.sqrt(Math.max(variance, 1e-12));
}

function loadRows(rows, sourceName = "dataset") {
  state.rows = rows.filter(Boolean);
  state.columns = Array.from(new Set(state.rows.flatMap((row) => Object.keys(row))));
  state.numericColumns = detectNumericColumns(state.rows, state.columns);
  if (!state.numericColumns.length) {
    setStatus("No numeric columns were detected.", "Parse failed");
    return;
  }
  state.dependent = state.numericColumns.includes("demand") ? "demand" : state.numericColumns[state.numericColumns.length - 1];
  state.independent = state.numericColumns.filter((col) => col !== state.dependent).slice(0, 8);
  buildProfiles();
  resetScenario();
  resetObservationRange();
  renderSelectors();
  fitModel();
  renderPreview();
  setStatus(`${state.rows.length} rows loaded from ${sourceName}.`, "Ready");
}

function resetObservationRange() {
  state.rangeStart = 0;
  state.rangeEnd = Math.max(state.rows.length - 1, 0);
  updateRangeControls();
}

function detectNumericColumns(rows, columns) {
  return columns.filter((col) => {
    const values = rows.map((row) => parseNumber(row[col])).filter(Number.isFinite);
    return values.length >= Math.max(4, rows.length * 0.55);
  });
}

function buildProfiles() {
  state.profiles = {};
  for (const col of state.numericColumns) {
    const values = state.rows.map((row) => parseNumber(row[col])).filter(Number.isFinite);
    const p01 = quantile(values, 0.01);
    const p99 = quantile(values, 0.99);
    const winsor = values.map((value) => clamp(value, p01, p99));
    const mu = mean(winsor);
    const sigma = std(winsor, mu);
    state.profiles[col] = {
      min: Math.min(...values),
      max: Math.max(...values),
      p01,
      p99,
      median: quantile(values, 0.5),
      mean: mu,
      std: sigma
    };
  }
}

function cleanValue(row, col) {
  const profile = state.profiles[col];
  const parsed = parseNumber(row[col]);
  const value = Number.isFinite(parsed) ? parsed : profile.median;
  return clamp(value, profile.p01, profile.p99);
}

function zValue(rowOrScenario, col) {
  const profile = state.profiles[col];
  const raw = cleanScenarioValue(rowOrScenario, col);
  return (clamp(raw, profile.p01, profile.p99) - profile.mean) / profile.std;
}

function cleanScenarioValue(rowOrScenario, col) {
  const profile = state.profiles[col];
  const parsed = parseNumber(rowOrScenario[col]);
  return Number.isFinite(parsed) ? parsed : profile.median;
}

function renderSelectors() {
  el("dependentSelect").innerHTML = state.numericColumns.map((col) => `<option value="${escapeHtml(col)}"${col === state.dependent ? " selected" : ""}>${escapeHtml(col)}</option>`).join("");
  el("independentList").innerHTML = state.numericColumns
    .filter((col) => col !== state.dependent)
    .map((col) => `<label class="check"><input type="checkbox" value="${escapeHtml(col)}"${state.independent.includes(col) ? " checked" : ""}>${escapeHtml(col)}</label>`)
    .join("");
  el("independentList").querySelectorAll("input").forEach((box) => {
    box.addEventListener("change", () => {
      state.independent = Array.from(el("independentList").querySelectorAll("input:checked")).map((node) => node.value);
      resetScenario();
      fitModel();
    });
  });
  el("dependentSelect").value = state.dependent;
}

function resetScenario() {
  state.scenario = {};
  for (const col of state.independent) state.scenario[col] = state.profiles[col].median;
}

function renderScenario() {
  if (!state.model) {
    el("scenarioList").innerHTML = '<div class="empty">Fit a model to activate scenario controls.</div>';
    return;
  }
  el("scenarioList").innerHTML = state.independent.map((col, index) => {
    const p = state.profiles[col];
    const step = Math.max((p.p99 - p.p01) / 250, 0.0001);
    const color = variableColor(index);
    const pct = sliderPercent(state.scenario[col], p);
    return `<div class="slider-row">
      <label title="${escapeHtml(col)}">${escapeHtml(col)}</label>
      <input class="scenario-slider" type="range" data-scenario="${escapeHtml(col)}" min="${p.p01}" max="${p.p99}" step="${step}" value="${state.scenario[col]}" style="--slider-color:${color};--slider-pct:${pct}%">
      <output class="scenario-value" data-scenario-value="${escapeHtml(col)}">${fmt(state.scenario[col], 4)}</output>
    </div>`;
  }).join("");
  el("scenarioList").querySelectorAll("[data-scenario]").forEach((input) => {
    input.addEventListener("input", () => updateScenario(input.dataset.scenario, Number(input.value)));
  });
  updateScenarioPrediction();
}

function updateScenario(col, value) {
  if (!Number.isFinite(value)) return;
  state.scenario[col] = value;
  el("scenarioList").querySelectorAll(`[data-scenario="${CSS.escape(col)}"]`).forEach((node) => {
    node.value = value;
    node.style.setProperty("--slider-pct", `${sliderPercent(value, state.profiles[col])}%`);
  });
  el("scenarioList").querySelectorAll(`[data-scenario-value="${CSS.escape(col)}"]`).forEach((node) => { node.textContent = fmt(value, 4); });
  updateScenarioPrediction();
}

function sliderPercent(value, profile) {
  return clamp((value - profile.p01) / Math.max(profile.p99 - profile.p01, 1e-9) * 100, 0, 100);
}

function variableColor(index) {
  const colors = ["#7fba2f", "#3f6fc4", "#2aa198", "#c06f3d", "#b45b91", "#2dd4bf", "#9ee830", "#6ac6e8"];
  return colors[index % colors.length];
}

function dot(a, b) {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

function latexName(name) {
  return String(name).replace(/[^a-zA-Z0-9]+/g, "\\_");
}

function buildLatex(dep, terms, coefficients) {
  let latex = `\\hat{${latexName(dep)}} = ${formatCoef(coefficients[0])}`;
  terms.forEach((term, i) => {
    const coef = coefficients[i + 1];
    if (Math.abs(coef) < 1e-9) return;
    latex += coef >= 0 ? " + " : " - ";
    latex += `${formatCoef(Math.abs(coef))}\\,${term.latex}`;
  });
  return latex;
}

function formatCoef(value) {
  const abs = Math.abs(value);
  if (abs >= 1000 || abs < 0.001) return value.toExponential(3);
  return Number(value.toFixed(4)).toString();
}

function evalExpression(expr, row) {
  const zval = (col) => {
    const p = state.profiles[col];
    if (!p) return 0;
    return (cleanValue(row, col) - p.mean) / (p.std || 1);
  };
  let e = expr;
  for (const col of state.independent) {
    e = e.replaceAll(`z(${col})`, String(zval(col)));
  }
  e = e.replace(/\|([^|]+)\|/g, 'Math.abs($1)');
  e = e.replace(/\^/g, '**');
  e = e.replace(/\bsqrt\b/g, 'Math.sqrt');
  e = e.replace(/\blog\b/g, 'Math.log');
  e = e.replace(/\bsin\b/g, 'Math.sin');
  e = e.replace(/\bcos\b/g, 'Math.cos');
  try { return Function('"use strict"; return (' + e + ')')(); }
  catch { return 0; }
}

async function fitModel() {
  if (!state.rows.length || !state.dependent || !state.independent.length) return;
  const maxTerms = Number(el('maxTerms')?.value || 5);
  setStatus('Fitting model via API…', 'Working');
  try {
    const res = await fetch(`${API_BASE}/api/v1/symbolic/fit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: state.rows.map(row => {
          const obj = {};
          [state.dependent, ...state.independent].forEach(col => {
            const v = parseNumber(row[col]);
            obj[col] = Number.isFinite(v) ? v : null;
          });
          return obj;
        }),
        dependent: state.dependent,
        independents: state.independent,
        max_terms: maxTerms
      })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.message || `HTTP ${res.status}`); }
    const data = await res.json();
    const evalFn = (row) => {
      let pred = data.intercept;
      data.terms.forEach(t => { pred += t.coefficient * evalExpression(t.expression, row); });
      return pred;
    };
    const predictions = state.rows.map(row => evalFn(row));
    const actuals = state.rows.map(row => cleanValue(row, state.dependent));
    const residuals = actuals.map((a, i) => a - predictions[i]);
    state.model = {
      dependent: state.dependent,
      independent: state.independent,
      terms: data.terms.map(t => ({ id: t.expression, latex: t.latex, coefficient: t.coefficient, eval: (row) => t.coefficient * evalExpression(t.expression, row) })),
      coefficients: [data.intercept, ...data.terms.map(t => t.coefficient)],
      predictions,
      residuals,
      stats: {
        n: data.metrics.observations, p: data.metrics.parameters,
        rss: data.metrics.rss, rmse: data.metrics.rmse, mae: data.metrics.mae,
        r2: data.metrics.r2, adjR2: data.metrics.adjusted_r2,
        aic: data.metrics.aic, bic: data.metrics.bic, mape: data.metrics.mape,
        tss: actuals.reduce((s, a) => s + (a - actuals.reduce((x,y)=>x+y,0)/actuals.length)**2, 0),
        condition: 1
      },
      latex: data.formula_latex,
      dependence: data.dependence_diagnostics.map(d => ({
        variable: d.variable, pearsonR: d.pearson_r, absPearson: d.abs_pearson,
        mi: d.mutual_information, normalizedMi: d.normalized_mi, bins: d.bins
      }))
    };
    resetScenario();
    renderAll();
  } catch (err) {
    setStatus(`API error: ${err.message}`, 'Error');
  }
}

function predictScenario(scenario) {
  if (!state.model) return NaN;
  let pred = state.model.coefficients[0];
  state.model.terms.forEach(t => { pred += t.coefficient * evalExpression(t.id, scenario); });
  return pred;
}

function updateScenarioPrediction() {
  if (!state.model) return;
  const pred = predictScenario(state.scenario);
  const baseline = {};
  for (const col of state.independent) baseline[col] = state.profiles[col].median;
  const basePred = predictScenario(baseline);
  el("scenarioPred").textContent = fmt(pred, 3);
  el("baselinePred").textContent = fmt(basePred, 3);
  el("mPred").textContent = fmt(pred, 3);
  el("mPredSub").textContent = `baseline ${fmt(basePred, 2)}`;
  renderFitFormulaSummary();
  drawFitChart();
}

function renderFitFormulaSummary() {
  if (!state.model) {
    if (el("fitFormulaPng")) el("fitFormulaPng").removeAttribute("src");
    if (el("fitFormulaLatex")) el("fitFormulaLatex").textContent = "--";
    if (el("fitFormulaTerms")) el("fitFormulaTerms").innerHTML = '<div class="empty">No symbolic terms selected yet.</div>';
    return;
  }
  renderFormulaPng();
  el("fitFormulaPng").src = el("formulaPng").src;
  el("fitFormulaLatex").textContent = state.model.latex;
  el("fitFormulaTerms").innerHTML = state.model.terms.map((term, i) => {
    const coef = state.model.coefficients[i + 1];
    return `<div class="fit-term"><strong>${formatCoef(coef)}</strong><code>${escapeHtml(term.latex)}</code></div>`;
  }).join("") || '<div class="empty">Intercept-only model selected by BIC.</div>';
  el("fitFormulaSub").textContent = `${state.model.terms.length} terms | R2 ${fmt(state.model.stats.r2, 4)} | BIC ${fmt(state.model.stats.bic, 2)}`;
}

function forecastSeries() {
  if (!state.model || !state.forecastSteps) return [];
  const steps = clamp(Math.round(state.forecastSteps), 0, 120);
  return Array.from({ length: steps }, (_, index) => predictScenario(forecastScenarioRow(index + 1)));
}

function forecastScenarioRow(step) {
  const row = { ...state.scenario };
  for (const col of state.model.independent) {
    if (isTimeLikeColumn(col)) {
      row[col] = cleanScenarioValue(state.scenario, col) + estimateStepSize(col) * step;
    } else {
      row[col] = cleanScenarioValue(state.scenario, col);
    }
  }
  return row;
}

function isTimeLikeColumn(col) {
  return /^(observation|obs|index|idx|step|time|t|period|date)$/i.test(col);
}

function estimateStepSize(col) {
  const values = state.rows.map((row) => cleanValue(row, col));
  const diffs = [];
  for (let i = 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (Number.isFinite(diff) && Math.abs(diff) > 1e-12) diffs.push(diff);
  }
  return diffs.length ? quantile(diffs, 0.5) : 1;
}

function visibleRange() {
  const max = Math.max(state.rows.length - 1, 0);
  const start = clamp(Math.min(state.rangeStart, state.rangeEnd), 0, max);
  const end = clamp(Math.max(state.rangeStart, state.rangeEnd), start, max);
  return { start, end };
}

function updateRangeControls() {
  const max = Math.max(state.rows.length - 1, 0);
  const { start, end } = visibleRange();
  for (const id of ["rangeStart", "rangeEnd"]) {
    if (!el(id)) continue;
    el(id).max = String(max);
  }
  if (el("rangeStart")) {
    el("rangeStart").value = String(start);
    el("rangeStart").style.setProperty("--slider-color", "#7dd3fc");
    el("rangeStart").style.setProperty("--slider-pct", `${max ? start / max * 100 : 0}%`);
    el("rangeStartLabel").textContent = `${start}`;
  }
  if (el("rangeEnd")) {
    el("rangeEnd").value = String(end);
    el("rangeEnd").style.setProperty("--slider-color", "#7dd3fc");
    el("rangeEnd").style.setProperty("--slider-pct", `${max ? end / max * 100 : 0}%`);
    el("rangeEndLabel").textContent = `${end}`;
  }
}

function setObservationRange(start, end) {
  const max = Math.max(state.rows.length - 1, 0);
  state.rangeStart = clamp(Math.round(start), 0, max);
  state.rangeEnd = clamp(Math.round(end), 0, max);
  if (state.rangeEnd < state.rangeStart) {
    [state.rangeStart, state.rangeEnd] = [state.rangeEnd, state.rangeStart];
  }
  updateRangeControls();
  renderFitFormulaSummary();
  drawFitChart();
}

function zoomObservationRange(anchorRatio, zoomIn) {
  const { start, end } = visibleRange();
  const max = Math.max(state.rows.length - 1, 0);
  const current = Math.max(end - start + 1, 2);
  const next = clamp(Math.round(current * (zoomIn ? 0.82 : 1.22)), 8, max + 1);
  const anchor = start + anchorRatio * (current - 1);
  const nextStart = clamp(Math.round(anchor - anchorRatio * (next - 1)), 0, Math.max(max - next + 1, 0));
  setObservationRange(nextStart, nextStart + next - 1);
}

function renderAll() {
  renderMetrics();
  renderFormula();
  renderScenario();
  renderStats();
  renderDependence();
  renderFitFormulaSummary();
  drawAllCharts();
}

function renderMetrics() {
  el("mRows").textContent = fmt(state.rows.length, 0);
  el("mVars").textContent = fmt(state.numericColumns.length, 0);
  el("mRowsSub").textContent = state.dependent ? `target ${state.dependent}` : "ready";
  el("mVarsSub").textContent = `${state.independent.length} selected`;
  if (!state.model) {
    ["mR2", "mRmse", "mBic", "mPred"].forEach((id) => { el(id).textContent = "--"; });
    el("mAdjR2").textContent = "adj --";
    el("mMae").textContent = "mae --";
    el("mAic").textContent = "aic --";
    el("fitBadge").textContent = "no model";
    return;
  }
  const s = state.model.stats;
  el("mR2").textContent = fmt(s.r2, 4);
  el("mAdjR2").textContent = `adj ${fmt(s.adjR2, 4)}`;
  el("mRmse").textContent = fmt(s.rmse, 3);
  el("mMae").textContent = `mae ${fmt(s.mae, 3)}`;
  el("mBic").textContent = fmt(s.bic, 2);
  el("mAic").textContent = `aic ${fmt(s.aic, 2)}`;
  el("fitBadge").textContent = `${state.model.terms.length} terms`;
}

function renderFormula() {
  if (!state.model) {
    el("latexFormula").textContent = "y = --";
    el("formulaPng").removeAttribute("src");
    el("termList").innerHTML = '<div class="empty">No symbolic terms selected yet.</div>';
    return;
  }
  el("latexFormula").textContent = state.model.latex;
  renderFormulaPng();
  el("termList").innerHTML = state.model.terms.map((term, i) => {
    const coef = state.model.coefficients[i + 1];
    return `<div class="term"><strong>${formatCoef(coef)}</strong><code>${escapeHtml(term.latex)}</code><span>${escapeHtml(term.id)}</span></div>`;
  }).join("") || '<div class="empty">Intercept-only model selected by BIC.</div>';
}

function renderFormulaPng() {
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  const lines = formulaLinesForCanvas();
  const width = 1280;
  const height = 96 + lines.length * 44;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssVar("--panel");
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = cssVar("--line");
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.fillStyle = cssVar("--accent");
  lines.forEach((line, index) => drawFormulaLine(ctx, line, index));
  ctx.fillStyle = cssVar("--muted");
  ctx.font = "13px Inter, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("PNG render of final mathematical expression", 34, height - 28);
  el("formulaPng").src = canvas.toDataURL("image/png");
}

function formulaLinesForCanvas() {
  const terms = state.model.terms.map((term, i) => {
    const coef = state.model.coefficients[i + 1];
    return {
      sign: coef >= 0 ? "+" : "-",
      coef: formatCoef(Math.abs(coef)),
      expr: mathExpressionForTerm(term)
    };
  }).filter((term) => Number(term.coef) !== 0);
  const lines = [];
  let current = [{ kind: "hat", text: state.model.dependent }, { text: "=" }, { text: formatCoef(state.model.coefficients[0]) }];
  for (const term of terms) {
    const part = [{ text: term.sign }, { text: term.coef }, ...term.expr];
    if (lineWeight([...current, ...part]) > 82 && current.length > 3) {
      lines.push(current);
      current = part;
    } else {
      current = [...current, ...part];
    }
  }
  if (current) lines.push(current);
  return lines;
}

function lineWeight(parts) {
  return parts.reduce((sum, part) => {
    if (part.kind === "frac") return sum + plainPartsText(part.num).length + plainPartsText(part.den).length + 4;
    return sum + String(part.text || "").length + (part.kind === "hat" ? 3 : 1);
  }, 0);
}

function mathExpressionForTerm(term) {
  const pieces = term.id.split(":");
  const kind = pieces[0];
  const a = cleanMathName(pieces[1]);
  const b = cleanMathName(pieces[2]);
  if (kind === "z") return [{ text: `z(${a})` }];
  if (kind === "sq") return [{ text: `z(${a})` }, { kind: "sup", text: "2" }];
  if (kind === "cube") return [{ text: `z(${a})` }, { kind: "sup", text: "3" }];
  if (kind === "sqrt") return [{ text: `\u221A|z(${a})|` }];
  if (kind === "log") return [{ kind: "func", text: "log" }, { text: `(1 + |z(${a})|)` }];
  if (kind === "sin") return [{ kind: "func", text: "sin" }, { text: `(z(${a}))` }];
  if (kind === "cos") return [{ kind: "func", text: "cos" }, { text: `(z(${a}))` }];
  if (kind === "mul") return [{ text: `z(${a}) z(${b})` }];
  if (kind === "ratio") return [{ kind: "frac", num: [{ text: `z(${a})` }], den: [{ text: `1 + |z(${b})|` }] }];
  return [{ text: term.id.replace(/:/g, " ") }];
}

function mathExpressionPlain(term) {
  const parts = mathExpressionForTerm(term);
  return plainPartsText(parts);
}

function plainPartsText(parts) {
  return parts.map((part) => {
    if (part.kind === "sup") return `^${part.text}`;
    if (part.kind === "func") return part.text;
    if (part.kind === "frac") return `(${plainPartsText(part.num)}) / (${plainPartsText(part.den)})`;
    return part.text || "";
  }).join("");
}

function cleanMathName(name) {
  return String(name || "").replace(/_/g, " ");
}

function drawFormulaLine(ctx, parts, index) {
  let x = 34;
  const baseline = 50 + index * 44;
  ctx.textBaseline = "alphabetic";
  parts.forEach((part, partIndex) => {
    if (partIndex > 0) x += 10;
    if (part.kind === "hat") {
      ctx.font = "29px Cambria Math, Times New Roman, serif";
      ctx.fillStyle = cssVar("--accent");
      const text = cleanMathName(part.text);
      const width = ctx.measureText(text).width;
      ctx.fillText(text, x, baseline);
      ctx.strokeStyle = cssVar("--accent");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + width * 0.18, baseline - 30);
      ctx.lineTo(x + width * 0.50, baseline - 39);
      ctx.lineTo(x + width * 0.82, baseline - 30);
      ctx.stroke();
      x += width;
    } else if (part.kind === "sup") {
      ctx.font = "17px Cambria Math, Times New Roman, serif";
      ctx.fillStyle = cssVar("--accent");
      ctx.fillText(part.text, x - 6, baseline - 17);
      x += ctx.measureText(part.text).width - 4;
    } else if (part.kind === "frac") {
      const num = plainPartsText(part.num);
      const den = plainPartsText(part.den);
      ctx.font = "21px Cambria Math, Times New Roman, serif";
      ctx.fillStyle = cssVar("--accent");
      const numWidth = ctx.measureText(num).width;
      const denWidth = ctx.measureText(den).width;
      const fracWidth = Math.max(numWidth, denWidth) + 14;
      ctx.fillText(num, x + (fracWidth - numWidth) / 2, baseline - 13);
      ctx.strokeStyle = cssVar("--accent");
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, baseline - 5);
      ctx.lineTo(x + fracWidth, baseline - 5);
      ctx.stroke();
      ctx.fillText(den, x + (fracWidth - denWidth) / 2, baseline + 18);
      x += fracWidth;
    } else {
      ctx.font = "29px Cambria Math, Times New Roman, serif";
      ctx.fillStyle = part.kind === "func" ? cssVar("--accent-2") : (part.text === "+" || part.text === "-" || part.text === "=" ? cssVar("--muted") : cssVar("--accent"));
      ctx.fillText(part.text, x, baseline);
      x += ctx.measureText(part.text).width;
    }
  });
}

function renderStats() {
  if (!state.model) {
    el("statsTable").innerHTML = "<tbody><tr><td>No model</td></tr></tbody>";
    return;
  }
  const s = state.model.stats;
  const rows = [
    ["Observations", s.n],
    ["Parameters", s.p],
    ["R2", s.r2],
    ["Adjusted R2", s.adjR2],
    ["RMSE", s.rmse],
    ["MAE", s.mae],
    ["MAPE", s.mape],
    ["RSS", s.rss],
    ["AIC", s.aic],
    ["BIC", s.bic]
  ];
  el("statsTable").innerHTML = `<thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>${rows.map(([name, value]) => `<tr><td>${name}</td><td>${fmt(value, name.includes("R2") || name === "MAPE" ? 4 : 3)}</td></tr>`).join("")}</tbody>`;
}

function renderDependence() {
  if (!state.dependent || !state.independent.length) {
    el("dependenceTable").innerHTML = "<tbody><tr><td>No independent variables selected</td></tr></tbody>";
    return;
  }
  const rows = (state.model?.dependence || []).map(d => ({ variable: d.variable, pearson: d.pearsonR, absPearson: d.absPearson, mutualInformation: d.mi, normalizedMi: d.normalizedMi, bins: d.bins ?? '--' }));
  el("dependenceTable").innerHTML = `<thead><tr><th>Variable</th><th>Pearson r</th><th>|r|</th><th>Mutual Info</th><th>Norm. MI</th><th>Bins</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.variable)}</td><td>${fmt(row.pearson, 4)}</td><td>${fmt(row.absPearson, 4)}</td><td>${fmt(row.mutualInformation, 4)}</td><td>${fmt(row.normalizedMi, 4)}</td><td>${fmt(row.bins, 0)}</td></tr>`).join("")}</tbody>`;
}

function renderPreview() {
  const cols = state.columns.slice(0, 9);
  const body = state.rows.slice(0, 80).map((row) => `<tr>${cols.map((col) => `<td>${escapeHtml(formatCell(row[col]))}</td>`).join("")}</tr>`).join("");
  el("previewTable").innerHTML = `<thead><tr>${cols.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr></thead><tbody>${body}</tbody>`;
}

function formatCell(value) {
  const numeric = parseNumber(value);
  return Number.isFinite(numeric) ? fmt(numeric, 4) : String(value ?? "");
}

function drawAllCharts() {
  drawFitChart();
  drawScatterChart();
  drawResidualChart();
}

function chartSetup(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function colorMix(color, alpha) {
  const hex = color.trim();
  if (!hex.startsWith("#")) return `rgba(125, 211, 252, ${alpha})`;
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const value = Number.parseInt(full.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawAxes(ctx, width, height, pad) {
  ctx.strokeStyle = cssVar("--line");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, height - pad.bottom);
  ctx.lineTo(width - pad.right, height - pad.bottom);
  ctx.stroke();
}

function drawFitChart() {
  const canvas = el("fitCanvas");
  const { ctx, width, height } = chartSetup(canvas);
  ctx.clearRect(0, 0, width, height);
  if (!state.model) return drawEmpty(ctx, width, height, "Load data and fit a symbolic model");
  const { start, end } = visibleRange();
  const fullY = state.rows.map((row) => cleanValue(row, state.dependent));
  const fullPred = state.model.predictions;
  const y = fullY.slice(start, end + 1);
  const pred = fullPred.slice(start, end + 1);
  const forecast = forecastSeries();
  const values = [...y, ...pred, ...forecast];
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const pad = { left: 48, right: 18, top: 18, bottom: 34 };
  drawGrid(ctx, width, height, pad, minY, maxY);
  const totalPoints = y.length + forecast.length;
  const x = (i) => pad.left + i * (width - pad.left - pad.right) / Math.max(totalPoints - 1, 1);
  const yy = (v) => height - pad.bottom - (v - minY) * (height - pad.top - pad.bottom) / Math.max(maxY - minY, 1e-9);
  if (forecast.length) {
    ctx.fillStyle = colorMix(cssVar("--accent-2"), 0.10);
    ctx.fillRect(x(y.length - 1), pad.top, width - pad.right - x(y.length - 1), height - pad.top - pad.bottom);
    ctx.strokeStyle = cssVar("--line");
    ctx.beginPath();
    ctx.moveTo(x(y.length - 1), pad.top);
    ctx.lineTo(x(y.length - 1), height - pad.bottom);
    ctx.stroke();
  }
  drawLine(ctx, y.map((v, i) => [x(i), yy(v)]), cssVar("--accent"), 2);
  drawLine(ctx, pred.map((v, i) => [x(i), yy(v)]), cssVar("--accent-2"), 2);
  if (forecast.length) {
    const forecastPoints = [[x(y.length - 1), yy(pred[pred.length - 1])], ...forecast.map((v, i) => [x(y.length + i), yy(v)])];
    drawLine(ctx, forecastPoints, cssVar("--warn"), 2.5);
  }
  drawLegend(ctx, [["Actual", cssVar("--accent")], ["Formula", cssVar("--accent-2")], ["Forecast", cssVar("--warn")]], width - 188, 18);
  drawFitHover(ctx, height, pad, y, pred, forecast, x, yy);
}

function drawScatterChart() {
  const canvas = el("scatterCanvas");
  const { ctx, width, height } = chartSetup(canvas);
  ctx.clearRect(0, 0, width, height);
  if (!state.model) return drawEmpty(ctx, width, height, "No model");
  const y = state.rows.map((row) => cleanValue(row, state.dependent));
  const pred = state.model.predictions;
  const min = Math.min(...y, ...pred);
  const max = Math.max(...y, ...pred);
  const pad = { left: 64, right: 22, top: 18, bottom: 50 };
  drawAxes(ctx, width, height, pad);
  const sx = (v) => pad.left + (v - min) * (width - pad.left - pad.right) / Math.max(max - min, 1e-9);
  const sy = (v) => height - pad.bottom - (v - min) * (height - pad.top - pad.bottom) / Math.max(max - min, 1e-9);
  drawLine(ctx, [[sx(min), sy(min)], [sx(max), sy(max)]], cssVar("--line"), 1);
  drawAxisLabels(ctx, width, height, pad, "Observed", "Predicted");
  ctx.fillStyle = cssVar("--accent");
  y.forEach((value, i) => {
    ctx.globalAlpha = state.scatterHover === i ? 1 : 0.68;
    ctx.beginPath();
    ctx.arc(sx(value), sy(pred[i]), state.scatterHover === i ? 6 : 2.8, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  if (state.scatterHover != null) {
    const i = state.scatterHover;
    ctx.strokeStyle = cssVar("--accent-2");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx(y[i]), sy(pred[i]), 8, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawResidualChart() {
  const canvas = el("residualCanvas");
  const { ctx, width, height } = chartSetup(canvas);
  ctx.clearRect(0, 0, width, height);
  if (!state.model) return drawEmpty(ctx, width, height, "No residuals");
  const values = state.model.residuals;
  const maxAbs = Math.max(...values.map(Math.abs), 1e-9);
  const pad = { left: 64, right: 22, top: 18, bottom: 50 };
  const x = (i) => pad.left + i * (width - pad.left - pad.right) / Math.max(values.length - 1, 1);
  const y = (v) => pad.top + (maxAbs - v) * (height - pad.top - pad.bottom) / (maxAbs * 2);
  drawAxes(ctx, width, height, pad);
  drawLine(ctx, [[pad.left, y(0)], [width - pad.right, y(0)]], cssVar("--line"), 1);
  drawAxisLabels(ctx, width, height, pad, "Observation", "Residual");
  ctx.strokeStyle = cssVar("--warn");
  ctx.beginPath();
  values.forEach((value, i) => {
    ctx.moveTo(x(i), y(0));
    ctx.lineTo(x(i), y(value));
  });
  ctx.stroke();
  if (state.residualHover != null) {
    const i = state.residualHover;
    ctx.fillStyle = Math.abs(values[i]) > maxAbs * 0.66 ? cssVar("--danger") : cssVar("--warn");
    ctx.beginPath();
    ctx.arc(x(i), y(values[i]), 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = cssVar("--line");
    ctx.beginPath();
    ctx.moveTo(x(i), pad.top);
    ctx.lineTo(x(i), height - pad.bottom);
    ctx.stroke();
  }
}

function drawAxisLabels(ctx, width, height, pad, xLabel, yLabel) {
  ctx.fillStyle = cssVar("--muted");
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(xLabel, pad.left + (width - pad.left - pad.right) / 2, height - 16);
  ctx.save();
  ctx.translate(18, pad.top + (height - pad.top - pad.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function drawGrid(ctx, width, height, pad, minY, maxY) {
  drawAxes(ctx, width, height, pad);
  ctx.fillStyle = cssVar("--muted");
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const t = i / 4;
    const y = pad.top + t * (height - pad.top - pad.bottom);
    const value = maxY - t * (maxY - minY);
    ctx.strokeStyle = cssVar("--line");
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(fmt(value, 1), pad.left - 8, y);
  }
}

function drawLine(ctx, points, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
}

function drawLegend(ctx, items, x, y) {
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  items.forEach(([label, color], index) => {
    const yy = y + index * 20;
    ctx.fillStyle = color;
    ctx.fillRect(x, yy - 4, 18, 3);
    ctx.fillStyle = cssVar("--muted");
    ctx.fillText(label, x + 26, yy);
  });
}

function drawEmpty(ctx, width, height, text) {
  ctx.fillStyle = cssVar("--muted");
  ctx.font = "13px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
}

function drawHoverPoint(canvas, ctx, width, height, pad, y, pred, xScale, yScale) {
  if (state.hover == null) return;
  const i = clamp(state.hover, 0, y.length - 1);
  const x = xScale(i);
  ctx.strokeStyle = cssVar("--line");
  ctx.beginPath();
  ctx.moveTo(x, pad.top);
  ctx.lineTo(x, height - pad.bottom);
  ctx.stroke();
  ctx.fillStyle = cssVar("--accent");
  ctx.beginPath();
  ctx.arc(x, yScale(y[i]), 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cssVar("--accent-2");
  ctx.beginPath();
  ctx.arc(x, yScale(pred[i]), 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawFitHover(ctx, height, pad, y, pred, forecast, xScale, yScale) {
  if (state.hover == null) return;
  const historyLength = y.length;
  const total = historyLength + forecast.length;
  const i = clamp(state.hover, 0, total - 1);
  const x = xScale(i);
  ctx.strokeStyle = cssVar("--line");
  ctx.beginPath();
  ctx.moveTo(x, pad.top);
  ctx.lineTo(x, height - pad.bottom);
  ctx.stroke();
  if (i < historyLength) {
    ctx.fillStyle = cssVar("--accent");
    ctx.beginPath();
    ctx.arc(x, yScale(y[i]), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cssVar("--accent-2");
    ctx.beginPath();
    ctx.arc(x, yScale(pred[i]), 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const forecastIndex = i - historyLength;
    ctx.fillStyle = cssVar("--warn");
    ctx.beginPath();
    ctx.arc(x, yScale(forecast[forecastIndex]), 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function parseDelimited(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => String(value).trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const first = rows[0];
  const headerScore = first.filter((value) => !Number.isFinite(parseNumber(value))).length;
  const hasHeader = headerScore >= Math.ceil(first.length / 2);
  const headers = hasHeader ? first.map(cleanHeader) : first.map((_, i) => `col_${i + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""])));
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 8).join("\n");
  const options = [",", ";", "\t", "|"];
  return options.map((delimiter) => [delimiter, sample.split(delimiter).length - 1]).sort((a, b) => b[1] - a[1])[0][0];
}

function cleanHeader(value, index) {
  const header = String(value ?? "").trim().replace(/^\uFEFF/, "").replace(/\s+/g, "_").replace(/[^\w.-]/g, "_");
  return header || `col_${index + 1}`;
}

function parseApiPayload(text, contentType = "") {
  const trimmed = text.trim();
  if (contentType.includes("json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const data = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : parsed.rows);
    if (!Array.isArray(data)) throw new Error("JSON API must return an array, data array, or rows array.");
    if (Array.isArray(data[0])) {
      const headers = data[0].map(cleanHeader);
      return data.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i]])));
    }
    return data;
  }
  if (trimmed.startsWith("<")) return parseHtmlOrXmlTable(trimmed);
  return parseDelimited(trimmed);
}

function parseHtmlOrXmlTable(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const table = doc.querySelector("table");
  if (table) {
    const rows = Array.from(table.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((cell) => cell.textContent.trim()));
    if (!rows.length) return [];
    const headers = rows[0].map(cleanHeader);
    return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""])));
  }
  const xml = new DOMParser().parseFromString(text, "text/xml");
  const xmlRows = Array.from(xml.getElementsByTagName("Row")).map((row) => Array.from(row.getElementsByTagName("Cell")).map((cell) => cell.textContent.trim()));
  if (xmlRows.length) {
    const headers = xmlRows[0].map(cleanHeader);
    return xmlRows.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""])));
  }
  throw new Error("No table found in XLS/HTML/XML content.");
}

async function parseXlsx(arrayBuffer) {
  if (!("DecompressionStream" in window)) throw new Error("This browser cannot decompress XLSX without external libraries.");
  const entries = readZipCentralDirectory(arrayBuffer);
  const files = {};
  for (const name of ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"]) {
    if (entries[name]) files[name] = await unzipEntry(arrayBuffer, entries[name]);
  }
  if (!files["xl/worksheets/sheet1.xml"]) throw new Error("XLSX sheet1.xml not found.");
  const shared = files["xl/sharedStrings.xml"] ? parseSharedStrings(files["xl/sharedStrings.xml"]) : [];
  const matrix = parseSheet(files["xl/worksheets/sheet1.xml"], shared);
  const headers = matrix[0].map(cleanHeader);
  return matrix.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""])));
}

function readZipCentralDirectory(buffer) {
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Invalid XLSX ZIP structure.");
  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = {};
  for (let i = 0; i < total; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, nameLen));
    entries[name] = { method, compressedSize, localOffset };
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function unzipEntry(buffer, entry) {
  const view = new DataView(buffer);
  const offset = entry.localOffset;
  const nameLen = view.getUint16(offset + 26, true);
  const extraLen = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLen + extraLen;
  const data = new Uint8Array(buffer, dataStart, entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("Unsupported XLSX compression method.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(inflated);
}

function parseSharedStrings(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  return Array.from(doc.getElementsByTagName("si")).map((si) => si.textContent);
}

function parseSheet(xmlText, sharedStrings) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  return Array.from(doc.getElementsByTagName("row")).map((row) => {
    const values = [];
    Array.from(row.getElementsByTagName("c")).forEach((cell) => {
      const ref = cell.getAttribute("r") || "";
      const col = columnIndex(ref.replace(/\d/g, ""));
      const type = cell.getAttribute("t");
      const v = cell.getElementsByTagName("v")[0];
      let value = v ? v.textContent : cell.textContent;
      if (type === "s") value = sharedStrings[Number(value)] ?? "";
      if (type === "inlineStr") value = cell.textContent;
      values[col] = value;
    });
    return values;
  }).filter((row) => row.some((value) => value != null && String(value).trim() !== ""));
}

function columnIndex(name) {
  let index = 0;
  for (const char of name) index = index * 26 + char.charCodeAt(0) - 64;
  return Math.max(index - 1, 0);
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function showTooltip(event, html) {
  const tooltip = el("tooltip");
  tooltip.innerHTML = html;
  tooltip.style.left = `${event.clientX + 12}px`;
  tooltip.style.top = `${event.clientY + 12}px`;
  tooltip.style.display = "block";
}

function hideTooltip() {
  el("tooltip").style.display = "none";
}

function wireEvents() {
  el("sampleBtn").addEventListener("click", () => loadSampleCsv());
  el("themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    updateThemeButton();
    drawAllCharts();
  });
  el("dependentSelect").addEventListener("change", () => {
    state.dependent = el("dependentSelect").value;
    state.independent = state.numericColumns.filter((col) => col !== state.dependent).slice(0, 8);
    resetScenario();
    renderSelectors();
    fitModel();
  });
  el("maxTerms").addEventListener("change", fitModel);
  el("fitBtn").addEventListener("click", fitModel);
  el("forecastSteps").addEventListener("input", () => {
    state.forecastSteps = clamp(Number(el("forecastSteps").value || 0), 0, 120);
    drawFitChart();
  });
  el("rangeStart").addEventListener("input", () => {
    setObservationRange(Number(el("rangeStart").value), state.rangeEnd);
  });
  el("rangeEnd").addEventListener("input", () => {
    setObservationRange(state.rangeStart, Number(el("rangeEnd").value));
  });
  el("fileInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      setStatus(`Parsing ${file.name}...`, "Working");
      const ext = file.name.split(".").pop().toLowerCase();
      let rows;
      if (ext === "xlsx") {
        rows = await parseXlsx(await file.arrayBuffer());
      } else {
        const text = await file.text();
        rows = ext === "xls" || text.trim().startsWith("<") ? parseHtmlOrXmlTable(text) : parseApiPayload(text, file.type);
      }
      loadRows(rows, file.name);
    } catch (error) {
      setStatus(error.message, "Upload error");
    }
  });
  el("fetchApiBtn").addEventListener("click", async () => {
    const url = el("dataAPI_BASE").value.trim();
    if (!url) return;
    try {
      setStatus(`Fetching ${url}...`, "Working");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const rows = parseApiPayload(text, response.headers.get("content-type") || "");
      loadRows(rows, url);
    } catch (error) {
      setStatus(`${error.message}. Check CORS and response format.`, "API error");
    }
  });
  el("exportJsonBtn").addEventListener("click", () => {
    const payload = {
      dependent: state.dependent,
      independent: state.independent,
      formula: state.model ? state.model.latex : null,
      coefficients: state.model ? state.model.coefficients : [],
      stats: state.model ? state.model.stats : null,
      dependence: state.model?.dependence || []
    };
    download("symbolic-regression-model.json", JSON.stringify(payload, null, 2), "application/json");
  });
  document.querySelectorAll(".info-btn").forEach((button) => button.addEventListener("click", () => openModal(button.dataset.infoTitle, button.dataset.infoBody)));
  document.querySelectorAll("[data-fullscreen]").forEach((button) => button.addEventListener("click", () => {
    const panel = document.querySelector(button.dataset.fullscreen);
    panel.classList.toggle("fullscreen");
    setTimeout(drawAllCharts, 40);
  }));
  el("formulaBtn").addEventListener("click", openFormulaModal);
  el("fitCanvas").addEventListener("mousemove", (event) => {
    if (!state.model) return;
    const rect = el("fitCanvas").getBoundingClientRect();
    const padLeft = 48;
    const padRight = 18;
    const forecast = forecastSeries();
    const { start, end } = visibleRange();
    const visibleCount = end - start + 1;
    const total = visibleCount + forecast.length;
    const x = clamp(event.clientX - rect.left, padLeft, rect.width - padRight);
    const index = Math.round((x - padLeft) / Math.max(rect.width - padLeft - padRight, 1) * (total - 1));
    state.hover = index;
    drawFitChart();
    if (index < visibleCount) {
      const rowIndex = start + index;
      const actual = cleanValue(state.rows[rowIndex], state.dependent);
      const predicted = state.model.predictions[rowIndex];
      showTooltip(event, `<strong>Row ${rowIndex + 1}</strong><br>Actual: ${fmt(actual, 3)}<br>Predicted: ${fmt(predicted, 3)}<br>Error: ${fmt(actual - predicted, 3)}`);
    } else {
      const step = index - visibleCount + 1;
      showTooltip(event, `<strong>Forecast +${step}</strong><br>Projected: ${fmt(forecast[step - 1], 3)}<br>Scenario-driven`);
    }
  });
  el("fitCanvas").addEventListener("mouseleave", () => { state.hover = null; hideTooltip(); drawFitChart(); });
  el("fitCanvas").addEventListener("wheel", (event) => {
    if (!state.model) return;
    event.preventDefault();
    const rect = el("fitCanvas").getBoundingClientRect();
    const padLeft = 48;
    const padRight = 18;
    const anchor = clamp((event.clientX - rect.left - padLeft) / Math.max(rect.width - padLeft - padRight, 1), 0, 1);
    zoomObservationRange(anchor, event.deltaY < 0);
  }, { passive: false });
  el("scatterCanvas").addEventListener("mousemove", (event) => {
    if (!state.model) return;
    const rect = el("scatterCanvas").getBoundingClientRect();
    const y = state.rows.map((row) => cleanValue(row, state.dependent));
    const pred = state.model.predictions;
    const min = Math.min(...y, ...pred);
    const max = Math.max(...y, ...pred);
    const pad = { left: 64, right: 22, top: 18, bottom: 50 };
    const sx = (v) => pad.left + (v - min) * (rect.width - pad.left - pad.right) / Math.max(max - min, 1e-9);
    const sy = (v) => rect.height - pad.bottom - (v - min) * (rect.height - pad.top - pad.bottom) / Math.max(max - min, 1e-9);
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    let index = 0;
    let bestDistance = Infinity;
    y.forEach((value, i) => {
      const distance = (sx(value) - mx) ** 2 + (sy(pred[i]) - my) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        index = i;
      }
    });
    state.scatterHover = index;
    drawScatterChart();
    showTooltip(event, `<strong>Row ${index + 1}</strong><br>Observed: ${fmt(y[index], 3)}<br>Predicted: ${fmt(pred[index], 3)}<br>Error: ${fmt(y[index] - pred[index], 3)}`);
  });
  el("scatterCanvas").addEventListener("mouseleave", () => { state.scatterHover = null; hideTooltip(); drawScatterChart(); });
  el("residualCanvas").addEventListener("mousemove", (event) => {
    if (!state.model) return;
    const rect = el("residualCanvas").getBoundingClientRect();
    const padLeft = 64;
    const padRight = 22;
    const x = clamp(event.clientX - rect.left, padLeft, rect.width - padRight);
    const index = Math.round((x - padLeft) / Math.max(rect.width - padLeft - padRight, 1) * (state.model.residuals.length - 1));
    state.residualHover = index;
    drawResidualChart();
    showTooltip(event, `<strong>Row ${index + 1}</strong><br>Residual: ${fmt(state.model.residuals[index], 3)}<br>Observed - predicted`);
  });
  el("residualCanvas").addEventListener("mouseleave", () => { state.residualHover = null; hideTooltip(); drawResidualChart(); });
  window.addEventListener("resize", drawAllCharts);
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
    }
    if (event.key === "Escape") {
      closeModal();
      closeFormulaModal();
      closePalette();
      document.querySelectorAll(".panel.fullscreen").forEach((panel) => panel.classList.remove("fullscreen"));
      drawAllCharts();
    }
  });
  el("paletteBtn").addEventListener("click", openPalette);
  el("paletteSearch").addEventListener("input", renderCommands);
  el("modalClose").addEventListener("click", closeModal);
  el("formulaModalClose").addEventListener("click", closeFormulaModal);
  el("modalBackdrop").addEventListener("click", (event) => { if (event.target === el("modalBackdrop")) closeModal(); });
  el("formulaModalBackdrop").addEventListener("click", (event) => { if (event.target === el("formulaModalBackdrop")) closeFormulaModal(); });
  el("palette").addEventListener("click", (event) => { if (event.target === el("palette")) closePalette(); });
  updateThemeButton();
}

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  el("themeIcon").textContent = dark ? "\u2600" : "\u263E";
  el("themeBtn").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  el("themeBtn").setAttribute("title", dark ? "Switch to light mode" : "Switch to dark mode");
}

function openModal(title, body) {
  el("modalTitle").textContent = title || "Info";
  el("modalBody").textContent = body || "";
  el("modalBackdrop").style.display = "flex";
}

function closeModal() {
  el("modalBackdrop").style.display = "none";
}

function openFormulaModal() {
  renderFormula();
  el("formulaModalBackdrop").style.display = "flex";
}

function closeFormulaModal() {
  el("formulaModalBackdrop").style.display = "none";
}

const commands = [
  { label: "Fit symbolic model", action: () => fitModel() },
  { label: "Open formula", action: () => openFormulaModal() },
  { label: "Toggle theme", action: () => el("themeBtn").click() },
  { label: "Load sample data", action: () => loadSampleCsv() },
  { label: "Export model JSON", action: () => el("exportJsonBtn").click() },
  { label: "Reset scenario to medians", action: () => { resetScenario(); renderScenario(); } },
  { label: "Jump to residual diagnostics", action: () => el("residualPanel").scrollIntoView({ behavior: "smooth" }) }
];

function openPalette() {
  el("palette").style.display = "flex";
  el("paletteSearch").value = "";
  renderCommands();
  setTimeout(() => el("paletteSearch").focus(), 20);
}

function closePalette() {
  el("palette").style.display = "none";
}

function renderCommands() {
  const query = el("paletteSearch").value.toLowerCase();
  const filtered = commands.filter((command) => command.label.toLowerCase().includes(query));
  el("commandList").innerHTML = filtered.map((command, index) => `<button class="command" data-command="${index}" type="button">${escapeHtml(command.label)}</button>`).join("") || '<div class="empty" style="margin:10px;">No command</div>';
  el("commandList").querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      filtered[Number(button.dataset.command)].action();
      closePalette();
    });
  });
}


async function loadSampleCsv() {
  try {
    setStatus("Loading sample.csv...", "Working");

    const response = await fetch("sample.csv", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    loadRows(parseDelimited(text), "sample.csv");
  } catch (error) {
    setStatus(error.message || "Could not load sample.csv.", "Sample load error");
  }
}

wireEvents();
loadSampleCsv();