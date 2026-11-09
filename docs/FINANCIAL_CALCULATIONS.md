# Financial calculations

Both apps use the same engine, implemented twice and verified against each other:

- Desktop: `desktop/src/shared/engine.ts` (TypeScript, `decimal.js`)
- Android: `android/core/src/main/kotlin/com/emitracker/core/Engine.kt` (Kotlin, `BigDecimal`)

The cross-platform tests (`desktop/tests/unit/crossplatform.test.ts` and
`android/core/.../SnapshotTest.kt`) feed a backup from one platform to the other and assert
identical outstanding principal, total paid, interest paid, remaining interest, closure date and
installments paid.

## Money and rounding policy

| Rule | Value |
| --- | --- |
| Storage | 2-decimal strings (`"12345.67"`), never binary floating point |
| Intermediate precision | 40 significant digits, `ROUND_HALF_UP` |
| Posting | Each posted component (period interest, penal interest, allocation) is rounded half-up to the paisa when it is posted |
| EMI rounding | Per loan: *exact to paisa*, *nearest rupee* (default) or *round up to rupee* |
| Settled threshold | Amounts ≤ ₹0.005 are treated as zero |
| Final installment | Absorbs rounding: it pays the remaining balance plus interest |

## EMI formula

Reducing balance: `EMI = P · r · (1+r)^n / ((1+r)^n − 1)` with `r = annual rate / 100 / periods-per-year`
(monthly 12, quarterly 4, half-yearly 2, yearly 1, fortnightly 26, weekly 52). With `r = 0`, EMI = P / n.

Flat rate: `EMI = (P + P · rate · years) / n`; interest per installment is constant on the flat base.

Known examples verified by tests (both platforms):

| Principal | Rate | Months | EMI |
| --- | --- | --- | --- |
| 1,00,000 | 12% | 12 | 8,884.88 |
| 10,00,000 | 10% | 120 | 13,215.07 |
| 50,00,000 | 8.5% | 240 | 43,391.16 (43,391 rounded, 43,392 rounded up) |
| 1,00,000 | 10% flat | 24 | 5,000.00 |

## Schedule construction

1. **Due dates** — first EMI date, then +1/3/6/12 months (or +7/14 days). The EMI due day is
   clamped to the month length: due day 31 gives 29 Feb in leap years, 30 Apr, and so on.
2. **Moratorium** — the first *M* periods before EMIs. *Capitalise*: unpaid interest is added to
   principal. *Interest only*: the interest is due each period (pre-EMI). EMIs are then computed
   on the balance after the moratorium.
3. **Interest per period** — accrued segment by segment between dated events:
   - *Reducing, monthly rest*: `balance · rate/periods · days/periodDays`. Without mid-period
     events, this is exactly `balance · r`.
   - *Reducing, daily*: `balance · rate · days / 365` (actual/365, including leap days).
   - *Flat*: constant `flatBase · rate/periods`.
4. **Dated events inside a period** are processed chronologically:
   - prepayments reduce principal on their transaction date (pro-rata interest effect);
   - foreclosure pays fees, interest accrued to date plus arrears, then all principal, and closes the loan;
   - fee / penalty payments settle charges;
   - rate changes, EMI changes and restructures apply from their effective date. An
     adjustment effective *on* a due date applies from the next period.
5. **At each due date** the period's interest is posted, the contractual amount is fixed
   (`interest + min(balance, EMI − interest)`), and the payments recorded against that installment
   are allocated.

## Payment allocation

Per loan, configurable:

- **Interest → principal → charges** (default): installment payments clear interest (older arrears
  first), then the scheduled principal, then any outstanding late fees or penal interest. The
  excess becomes **extra principal**. With *reduce EMI* set, the EMI is recalculated.
- **Charges → interest → principal**: charges are cleared first.
- **Manual allocation**: the exact principal, interest, fees and penalty from the lender statement
  are used instead of the calculation.

Unpaid interest is carried as **interest arrears** (simple, not compounded). Unpaid principal stays
in the balance. Money beyond everything due is recorded as **unapplied** and is never lost.

## Statuses (never inferred from dates alone)

| Status | Meaning |
| --- | --- |
| Upcoming | Due in the future, no payment recorded (projected) |
| Due | Due today or within the grace period |
| Paid / Prepaid | Fully paid (on or after the due date / before the due date) |
| Partially paid | Some, but not all, of the installment paid |
| Overdue | Past due plus grace, nothing recorded, after tracking started |
| Missed | You marked it missed |
| Waived | You marked it waived; that row's unpaid interest is forgiven |
| Cancelled | Rows after a foreclosure |
| No record | Past due **before** the tracking start date with no record. This is unknown history, not a missed payment |
| Paid (assumed) | Installments you declared as "paid before tracking"; labelled as estimates |

A past due date never turns into *Paid* without a recorded payment.

## Late charges (estimates)

When a loan has a late fee and/or penal rate, a row paid after (due + grace), or still unpaid,
accrues: the late fee, plus `shortfall-at-grace × penal rate × days late / 365`. These are labelled
estimates and appear as *charges due*.

## Chit funds

A loan of type **Chit fund** (`loanType: "chit_fund"`) has no interest: the wizard asks only for the
chit value, the full monthly installment, the number of months and the first installment date, and
stores `annualRate "0"`, `interestMethod "flat"`, a fixed monthly frequency and the installment as the
EMI. The first installment may fall on the start date.

Each month you record what you actually paid. For a chit, **any recorded amount settles that
installment**: if it is less than the full installment, the difference is the **dividend**. It is shown
per row (`dividend`) and in total (`summary.dividends`), and it is not owed:

- the row is `paid` (or `prepaid`), never `partially_paid`, and its shortfall is 0;
- the balance drops by the full installment, so outstanding = full installments still to come;
- `outstandingPrincipal = principal + capitalised + adjustment − repaid − dividends`, and progress counts dividends;
- later installments stay at the full amount until you record them; no extra month is added.

An installment with no record at all is still due / overdue as usual. If you pay one installment in
parts, record each part against the same month. Other loan types keep the normal partial-payment
behaviour. Both engines implement this identically (`desktop/tests/unit/chit.test.ts`,
`android/core/.../ChitTest.kt`, and the shared fixture loan `K1`).

## Totals and invariants

Per loan (tested on every platform):

- `total paid = principal repaid + interest paid + fees + penalties + unapplied`
- `principal repaid + outstanding principal = principal + capitalised interest (+ opening-balance adjustment)`
- `future cash outflow = outstanding principal + remaining interest (arrears included) + estimated charges`
- `remaining principal in the projection = outstanding principal`

**Outstanding principal**, **total future cash outflow** and **total already paid** are reported
separately and never mixed. The lender's displayed balance is never assumed to equal the
calculated principal. Enter it under *lender reconciliation* and the difference is shown.

## Projections, closure dates and scenarios

- Rows after today are projected as paid in full on their due date. Overdue amounts are cleared by
  the following EMIs (interest arrears first), which can extend the tenure.
- The **closure date** comes from running the amortization forward to zero, never from
  `balance ÷ EMI`. A test asserts that the two differ.
- If the EMI does not cover a period's own interest, the loan is flagged **non-converging** and has
  no closure date.
- **Interest / time saved** = contract schedule (same rate changes, no extra payments) versus
  actual-plus-projection. Missed payments make this negative, which is shown as "extra interest".
- **What-if scenarios** add hypothetical events (EMI increase, extra principal every installment,
  one-time prepayment, annual prepayment, rate change, prepayment effect) and run the *same* engine.
  These hypothetical records are tagged `sim:` and never saved.

## Incomplete histories

- *Installments paid before tracking*: assumed paid on schedule; principal and interest are
  labelled estimates.
- *Outstanding after those*: the lender figure replaces the calculated balance at that point. The
  adjustment is recorded and kept visible.
- *Tracking start date*: missing records before it are "no data", not missed.
- Results that rely on assumptions (calculated EMI, pre-tracking rows, estimated charges, daily or
  flat methods) carry an **Estimate** label and a warning explaining why.
