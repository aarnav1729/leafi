# Comprehensive Development Plan

_Last updated: 2026-04-14_

## Prioritization

1. **Data Correction (Currency Backfill)**
2. **RBAC Overhaul**
3. **Dashboard Redesign**
4. **Workflow Engine**
5. **Forecasting + Anomaly Detection**

---

## 1) Data Correction & Integrity (Highest Priority)

### 1.1 Currency Conversion Backfill

### Objective
Reconcile historical transactions where stored conversion rates were incorrect without mutating original financial records.

### Deliverables
- Add `reconciled_amount` on transactional rows (nullable, base-currency value).
- Add immutable audit table for reconciliation events.
- Add idempotent backfill job that can be safely re-run.
- Add monitoring and reporting on reconciliation progress.

### Proposed Data Model

#### `transactions` additions
- `reconciled_amount DECIMAL(18, 6) NULL`
- `reconciled_at DATETIME2 NULL`
- `reconciliation_version INT NOT NULL DEFAULT 1`

#### New table: `currency_reconciliation_audit`
- `id UNIQUEIDENTIFIER PK`
- `transaction_id` (FK)
- `original_amount DECIMAL(18, 6)`
- `original_rate DECIMAL(18, 8)`
- `corrected_rate DECIMAL(18, 8)`
- `corrected_amount DECIMAL(18, 6)`
- `correction_reason NVARCHAR(255)`
- `source_rate_provider NVARCHAR(100)`
- `source_rate_date DATE`
- `backfill_run_id UNIQUEIDENTIFIER`
- `created_at DATETIME2 DEFAULT SYSUTCDATETIME()`

#### Idempotency constraints
- Unique key: `(transaction_id, reconciliation_version)`
- Optional unique key: `(transaction_id, corrected_rate, source_rate_date)`

### Backfill Algorithm
1. Select candidate transactions where:
   - conversion currency differs from base currency,
   - historical rate is missing/known-bad OR reconciliation requested,
   - no completed reconciliation exists for current version.
2. Resolve effective transaction date (transaction date > posted date > created date fallback).
3. Fetch authoritative FX rate for that date.
4. Compute corrected base amount (`original_amount * corrected_rate`, apply financial rounding rules).
5. In a single DB transaction:
   - write audit row,
   - write `reconciled_amount`, `reconciled_at`,
   - mark reconciliation status.
6. Commit and emit job metrics.

### Operational Guardrails
- Use `UPDLOCK, READPAST` batching to avoid duplicate workers.
- Batch size 500–2,000 rows; configurable.
- Retry transient failures with capped exponential backoff.
- Dead-letter unresolved rows (missing FX rate).
- Dry-run mode for validation.

### Acceptance Criteria
- Re-running the job does not duplicate audit rows or alter already-reconciled rows for same version.
- 100% of eligible rows end in one of: reconciled, unresolved_missing_rate, skipped_already_reconciled.
- Audit can reconstruct every corrected value.

---

## 2) Backend Feature Implementation

### 2.1 Enhanced Filtering & Search
- Add faceted filtering for Customers and Transactions.
- Support compound query parameters:
  - `status`, `date_range`, `category`, `min_value`, `max_value`, `owner`, `tags[]`.
- Add indexes for common combinations:
  - `(status, transaction_date)`
  - `(category, transaction_date)`
  - `(status, category, amount)`
- Enforce pagination and stable sorting.

### 2.2 RBAC Overhaul
- Define permission catalog at action level:
  - `CAN_CREATE_INVOICE`,
  - `CAN_APPROVE_EXPENSE`,
  - `CAN_APPROVE_EXPENSE_OVER_LIMIT`, etc.
- Add request middleware for endpoint-level permission checks.
- Add role-permission mapping table and admin management UI.
- Add audit trail for authz denials and policy changes.

### 2.3 Workflow Engine
- Implement configurable state machine:
  - `PENDING -> APPROVED -> COMPLETED` (with rejection path).
- Route based on approval matrix rules (e.g., amount thresholds).
- Persist step transitions and approver actions.
- Add SLA timers and escalation notifications.

---

## 3) Frontend / UX Enhancements

### 3.1 Navigation & Structure
- Reorganize information architecture by domain and task.
- Introduce role-aware sidebar or mega-menu.
- Keep advanced tools discoverable and consistently placed.

### 3.2 Date/Time Picker Standardization
- Standardize all date inputs on a single component system.
- Use locale-aware parsing/formatting with timezone visibility.
- Centralize validation and min/max constraints.

### 3.3 Dashboard Overhaul
- Replace raw totals with scorecard KPI widgets.
- Add trend-aware charts for time-series and composition.
- Make KPI cards drill-down capable to open detailed report views.

---

## 4) Reporting & Intelligence

### 4.1 Reconciliation Intelligence + Anomaly Detection
- Build background anomaly job over rolling windows.
- Flag metrics outside configured z-score / std-dev threshold.
- Notify admins with context and links to root-cause reports.
- Prefer read-replica/warehouse for heavy analytical workloads.

### 4.2 CRM / Funnel Visualization
- Add kanban and funnel visualizations by stage.
- Track cycle time per stage and stage-to-stage drop-off.
- Include cohort and owner filters.

### 4.3 Predictive Forecasting
- Start with baseline model (ARIMA/Prophet) on monthly cadence.
- Expose confidence intervals and forecast-vs-actual accuracy.
- Display forecast trend alongside historicals on dashboards.

---

## 5) Report View Enhancements

- Add configurable grouping dimensions (e.g., Region -> Product Line).
- Ensure CSV/Excel exports exactly match displayed filters/groupings.
- Include metadata block (generated_at, filters, timezone, user).

---

## 6) Delivery Plan

### Phase 1 (Weeks 1–2)
- Currency reconciliation schema + backfill + audit + observability.
- Success metric: >99.5% backfill completion, no duplicate reconciliation rows.

### Phase 2 (Weeks 3–4)
- RBAC catalog, middleware enforcement, admin mapping UI.
- Success metric: 100% protected endpoints mapped to explicit permissions.

### Phase 3 (Weeks 5–6)
- Dashboard redesign, nav improvements, date/time standardization.
- Success metric: reduced task completion time and support tickets.

### Phase 4 (Weeks 7–8)
- Workflow engine + approval matrix + notifications.
- Success metric: measurable reduction in manual approval turnaround.

### Phase 5 (Weeks 9–12)
- Analytics view, anomaly detection, forecasting, advanced report exports.
- Success metric: forecast MAPE baseline established and improving.
