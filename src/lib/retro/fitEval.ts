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
    for (let i = 0; i < n; i++) (i % folds === f ? (teX.push(X[i]), teY.push(y[i])) : (trX.push(X[i]), trY.push(y[i])));
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
