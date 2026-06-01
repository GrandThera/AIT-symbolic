# Grand Thera AIT_Symbolic Regression Workbench

Grand Thera AIT_Symbolic Regression Workbench is a compact open source research demo for exploring symbolic regression workflows in a clean analytical dashboard. It is designed for specialists who want to add a transparent, dependency-light symbolic modeling tool to their research toolkit, inspect fitted expressions, stress-test variables, and reason about model behavior from raw tabular data.

This repository is not Grand Thera's final production technology. It does not include proprietary auto-calibration layers, production governance, internal model orchestration, enterprise data pipelines, or any closed Grand Thera decision systems. Its purpose is research-oriented: to show how symbolic regression concepts, statistical diagnostics, and interactive scenario analysis can be assembled into a small, inspectable tool.

**Project status:** research demo / alpha. The interface is usable as a standalone prototype, but it should be reviewed, extended, and validated before any production or regulated decision workflow.

## 1. Title and Description

**Title:** Grand Thera AIT_Symbolic Regression Workbench

**Description:** The project provides a browser-based symbolic regression interface for loading sample, CSV, XLS/XLSX, or API-driven datasets; selecting a dependent variable; choosing independent variables; fitting symbolic candidate terms; and exploring the resulting prediction interactively. The core analytical flow is intentionally explicit, with data treatment, normalization, term generation, model fitting, diagnostics, and formula rendering kept visible to the user.

The motivation is to give researchers, quants, analysts, and technical operators a practical way to investigate interpretable functional relationships without relying on a black-box UI. The workbench emphasizes clarity, manual statistical assumptions, and operational-style visualization over heavy framework abstraction.

**Status:** in development as an open source research tool and demonstration artifact.

## 2. Demonstration and Visual

The main visual experience is available through the main HTML page:

```text
index.html
```

Serve the repository locally and open the page in a browser. The interface follows a Palantir-like analytical style: dense dark panels, compact controls, formula rendering, hover-enabled diagnostics, scenario sliders, forecast controls, and fullscreen analytical frames.

Suggested demo flow:

1. Open the page.
2. Load the built-in sample dataset.
3. Select `demand` as the dependent variable.
4. Fit the symbolic model.
5. Inspect the fitted formula, selected terms, statistical summary, dependence diagnostics, residuals, and forecast behavior.
6. Change the interactive scenario sliders and observe how the predicted output changes.

## 3. Features

- Browser-based symbolic regression interface with no external JavaScript charting dependency.
- Built-in sample dataset for immediate experimentation.
- CSV, XLS/XLSX-style import path and API fetch input.
- Dependent variable selector and independent variable controls.
- Data loading, model fitting, prediction, and scenario flows through an external API.
- Interactive scenario panel with sliders and live prediction output.
- Forecast horizon control for forward simulation from the fitted expression.
- Formula view with LaTeX text and a rendered mathematical formula image.
- Statistical summary with R2, adjusted R2, RMSE, MAE, MAPE, RSS, AIC, and BIC.
- Dependence diagnostics with Pearson correlation and mutual information.
- Observed vs predicted and residual diagnostic plots with hover behavior.
- Data preview and export-oriented model inspection.
- Dark/light theme toggle and compact operational UI.

## 4. Prerequisites and Installation

### Requirements

- A modern browser with support for standard HTML, CSS, and JavaScript.
- Python 3.10+ if you want to serve files locally.
- Git for cloning the repository.
- Access to the external Symbolic API used by the frontend.

No Node.js build step is required for the current frontend because it is served as static HTML, CSS, and JavaScript files.

### Step by step

Clone the repository:

```bash
git clone https://github.com/GrandThera/symbolic.git
cd symbolic
```

Serve the repository locally:

```bash
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

Note: If another Grand Thera page is already running on the same port, this page may not load correctly. Try using a different port, such as 8001, 8002, or 3000.

## 5. API Dependency

This frontend consumes an external API for data processing and analytical responses.

The API is responsible for:

- parsing uploaded datasets;
- handling CSV/XLS/XLSX/API-driven inputs;
- detecting numeric columns;
- applying numeric cleanup and missing-value treatment;
- fitting the symbolic regression model;
- evaluating symbolic formulas;
- returning predictions, residuals, metrics, diagnostics, and scenario forecasts.

If the API base URL changes, update the corresponding API URL in the frontend JavaScript file.

## 6. How to Use

1. Open the page in a modern browser.
2. Click `Sample` to load the built-in demonstration dataset, or upload your own CSV/XLS/XLSX file.
3. Choose the dependent variable.
4. Select the independent variables that should be available to the symbolic model.
5. Set the maximum number of symbolic terms.
6. Click `Fit Symbolic Model`.
7. Review the fitted symbolic formula and selected terms.
8. Use the interactive scenario sliders to change independent variable values and observe the prediction.
9. Adjust the forecast horizon to inspect forward behavior.
10. Inspect diagnostics such as observed vs predicted, residuals, statistical summary, dependence metrics, and data preview.

## 7. Technologies Used

- HTML5 for the application structure.
- CSS3 for the Grand Thera / Palantir-like visual system.
- Vanilla JavaScript for API communication, interaction, plotting, and formula display.
- Fetch API for external API requests.
- FormData API for file upload requests.
- Browser File API for local file selection.
- Canvas/SVG for visual rendering.
- Python `http.server` for local static file serving during development.

No third-party frontend framework, charting library, or build tool is required by the interface.

## 8. How to Contribute

Contributions are welcome when they preserve the research-demo nature of the project and keep the modeling assumptions transparent.

Good contribution areas include:

- improving import and API error handling;
- improving interface usability;
- improving loading states;
- improving accessibility and responsive layout;
- improving chart rendering and hover behavior;
- documenting expected API contracts;
- adding focused frontend validation tests.

Please keep changes focused, explain the modeling reason behind analytical-display changes, and avoid adding heavy dependencies unless there is a strong research justification.

## 9. Authors and License

**Author:** Grand Thera Technologies

**License:** MIT. See [LICENSE](./LICENSE) for details.

This open source repository is provided as a research and demonstration tool. It should not be interpreted as a release of Grand Thera's final internal technology stack, production modeling infrastructure, proprietary auto-calibration systems, or enterprise decision workflows.