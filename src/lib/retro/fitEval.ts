/**
 * Retro study — honest evaluation of a fit.
 *
 * Everything here exists to keep the corpus studies from fooling us:
 * in-sample R² rises whenever a predictor is added, a family of tests
 * produces "significant" results by chance, and a null result on a small
 * sample is usually a power failure rather than evidence of no effect.
 * So: out-of-sample R² by k-fold cross-validation, Benjamini–Hochberg FDR
 * across a test family, and the power / minimum-detectable-effect for each
 * incremental test.
 *
 * Pure statistics. Imports nothing from the engines.
 */

/** Solve a symmetric positive-definite system by Gaussian elimination. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    if (Math.abs(M[piv][i]) < 1e-12) return null;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** OLS with intercept. `X` is row-major, one array of predictors per case. */
export function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0].length + 1;
  const D = X.map(r => [1, ...r]);
  const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => D.reduce((s, r) => s + r[a] * r[b], 0)));
  const rhs = Array.from({ length: k }, (_, a) => D.reduce((s, r, i) => s + r[a] * y[i], 0));
  return solve(A, rhs);
}

const predict = (coef: number[], row: number[]) => coef[0] + row.reduce((s, v, i) => s + v * coef[i + 1], 0);

/**
 * k-fold cross-validated R²: fit on k−1 folds, score the held-out fold,
 * pool the residuals. Unlike in-sample R² this can go negative, which is
 * the honest signal that a predictor set carries no transferable signal.
 * Folds are deterministic (stride assignment) so runs are reproducible.
 */
export function cvR2(X: number[][], y: number[], folds = 5): number {
  const n = y.length;
  if (n < folds * 3) return NaN;
  const meanAll = y.reduce((a, b) => a + b, 0) / n;
  let sse = 0, sst = 0;
  for (let f = 0; f < folds; f++) {
    const trX: number[][] = [], trY: number[] = [], teX: number[][] = [], teY: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i % folds === f) { teX.push(X[i]); teY.push(y[i]); } else { trX.push(X[i]); trY.push(y[i]); }
    }
    const coef = ols(trX, trY);
    if (!coef) return NaN;
    for (let i = 0; i < teY.length; i++) { sse += (teY[i] - predict(coef, teX[i])) ** 2; sst += (teY[i] - meanAll) ** 2; }
  }
  return sst > 0 ? 1 - sse / sst : NaN;
}

export function inSampleR2(X: number[][], y: number[]): number {
  const coef = ols(X, y);
  if (!coef) return NaN;
  const m = y.reduce((a, b) => a + b, 0) / y.length;
  let sse = 0, sst = 0;
  for (let i = 0; i < y.length; i++) { sse += (y[i] - predict(coef, X[i])) ** 2; sst += (y[i] - m) ** 2; }
  return sst > 0 ? 1 - sse / sst : NaN;
}

/** Adjusted R² — the in-sample number penalised for predictor count. */
export const adjR2 = (r2: number, n: number, k: number) => 1 - (1 - r2) * (n - 1) / (n - k - 1);

// ---------------------------------------------------------------------------
// Significance, power, and multiplicity
// ---------------------------------------------------------------------------

function normCdf(z: number): number {
  const s = Math.sign(z); const x = Math.abs(z) / Math.SQRT2;
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429], p = 0.3275911;
  const t = 1 / (1 + p * x);
  const erf = 1 - ((((a[4] * t + a[3]) * t + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * erf);
}

/** p-value for F(1, df) via its t equivalence. */
export function pFromF1(f: number, df: number): number {
  if (!Number.isFinite(f) || f <= 0) return 1;
  const t = Math.sqrt(f);
  const z = t * (1 - 1 / (4 * df)) / Math.sqrt(1 + t * t / (2 * df));
  return 2 * (1 - normCdf(z));
}

export interface PowerResult {
  /** Cohen's f² for the observed increment. */
  f2: number;
  /** Probability this design would detect an effect of the OBSERVED size. */
  power: number;
  /** Smallest ΔR² this design could detect at 80% power. */
  mdeDeltaR2: number;
}

/**
 * Power for adding one predictor. λ = f²·n; the test is F(1, n−k−1), so the
 * normal approximation on √λ against the two-sided critical value is close
 * enough at these sample sizes, and it is the number that matters: a null
 * result with power well under 0.8 is "we couldn't see it", not "it isn't there".
 */
export function powerOfIncrement(deltaR2: number, r2Full: number, n: number, alpha = 0.05): PowerResult {
  const f2 = r2Full < 1 ? deltaR2 / (1 - r2Full) : NaN;
  const zCrit = alpha === 0.01 ? 2.576 : 1.96;
  const lambda = f2 * n;
  const power = Number.isFinite(lambda) && lambda >= 0 ? 1 - normCdf(zCrit - Math.sqrt(lambda)) : NaN;
  const mdeF2 = ((zCrit + 0.842) ** 2) / n; // 80% power
  return { f2, power, mdeDeltaR2: mdeF2 * (1 - r2Full) };
}

/** Benjamini–Hochberg: returns the FDR-adjusted p-values, input order preserved. */
export function benjaminiHochberg(ps: number[]): number[] {
  const idx = ps.map((p, i) => [p, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const m = ps.length;
  const out = new Array<number>(m);
  let prev = 1;
  for (let r = m - 1; r >= 0; r--) {
    const [p, i] = idx[r];
    prev = Math.min(prev, (p * m) / (r + 1));
    out[i] = Math.min(1, prev);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Poisson regression — the count-model workhorse for the per-knob fits
// ---------------------------------------------------------------------------

/** Invert a square matrix by solving against each basis vector. */
function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    const c = solve(A, e);
    if (!c) return null;
    cols.push(c);
  }
  return Array.from({ length: n }, (_, i) => cols.map(c => c[i]));
}

export interface PoissonFit {
  beta: number[];
  se: number[];
}

/**
 * Poisson log-link regression by IRLS (Newton on the exact Hessian, which
 * for a Poisson GLM is Xᵀ diag(μ) X). `X` is row-major and must carry its
 * own intercept column. Returns coefficients and their standard errors
 * from the inverse information matrix.
 *
 * The counting stats this repo grades (H, HR, K, BB, TB per game) are
 * small non-negative integers, so a log-link count model is the right
 * likelihood; OLS on them would weight a 4-TB game like a 0-TB one.
 *
 * `offset` is a per-row term entering the linear predictor with a FIXED
 * coefficient of 1 — the exposure a rate model is quoted against (log PA,
 * log innings, log expected-count). Passing exposure as a design column
 * instead would let the fit rescale it, which is a different model.
 */
export function poissonFit(X: number[][], y: number[], offset?: number[]): PoissonFit | null {
  const k = X[0].length;
  const off = (i: number) => offset?.[i] ?? 0;
  let beta = new Array(k).fill(0);
  beta[0] = Math.log(Math.max(y.reduce((a, b) => a + b, 0) / y.length, 1e-3));
  for (let iter = 0; iter < 60; iter++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    const g = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      const mu = Math.exp(Math.min(X[i].reduce((s, v, j) => s + v * beta[j], 0) + off(i), 20));
      const r = y[i] - mu;
      for (let a = 0; a < k; a++) {
        g[a] += r * X[i][a];
        for (let b = 0; b < k; b++) H[a][b] += mu * X[i][a] * X[i][b];
      }
    }
    const step = solve(H, g);
    if (!step) return null;
    beta = beta.map((b, j) => b + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-10) break;
  }
  const H = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < X.length; i++) {
    const row = X[i];
    const mu = Math.exp(Math.min(row.reduce((s, v, j) => s + v * beta[j], 0) + off(i), 20));
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) H[a][b] += mu * row[a] * row[b];
  }
  const inv = invert(H);
  return inv ? { beta, se: inv.map((r, i) => Math.sqrt(Math.abs(r[i]))) } : null;
}

/** Poisson log-likelihood of `y` under fitted means `mu` (constant terms
 *  dropped — only differences between models are meaningful). */
export function poissonLogLik(y: number[], mu: number[]): number {
  let ll = 0;
  for (let i = 0; i < y.length; i++) ll += y[i] * Math.log(Math.max(mu[i], 1e-12)) - mu[i];
  return ll;
}

/**
 * Binomial (logistic) regression by IRLS. `y[i]` successes out of `n[i]`
 * trials; `X` carries its own intercept; `offset` enters the linear
 * predictor with a fixed coefficient of 1.
 *
 * The offset is what makes this the right tool for a conditional
 * comparison. To ask "how does A's rate differ from B's, within a player",
 * take y = A's count, n = A+B, and offset = log(exposureA / exposureB): the
 * player's own overall rate cancels out of the likelihood entirely, so no
 * per-player parameter and no noisy reference rate is needed. Every player
 * contributes at the weight his sample earns, however small.
 */
export function binomialFit(X: number[][], y: number[], n: number[], offset?: number[]): PoissonFit | null {
  const k = X[0].length;
  const off = (i: number) => offset?.[i] ?? 0;
  let beta = new Array(k).fill(0);
  for (let iter = 0; iter < 100; iter++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    const g = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      const eta = X[i].reduce((s, v, j) => s + v * beta[j], 0) + off(i);
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, eta))));
      const w = n[i] * p * (1 - p);
      const r = y[i] - n[i] * p;
      for (let a = 0; a < k; a++) {
        g[a] += r * X[i][a];
        for (let b = 0; b < k; b++) H[a][b] += w * X[i][a] * X[i][b];
      }
    }
    const step = solve(H, g);
    if (!step) return null;
    beta = beta.map((b, j) => b + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-10) break;
  }
  const H = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < X.length; i++) {
    const eta = X[i].reduce((s, v, j) => s + v * beta[j], 0) + off(i);
    const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, eta))));
    const w = n[i] * p * (1 - p);
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) H[a][b] += w * X[i][a] * X[i][b];
  }
  const inv = invert(H);
  return inv ? { beta, se: inv.map((r, i) => Math.sqrt(Math.abs(r[i]))) } : null;
}
