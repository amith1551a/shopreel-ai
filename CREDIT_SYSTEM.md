# ShopReel AI Credit System

## Overview

The ShopReel AI credit system provides a user-friendly way to display and track video generation costs. All costs are tracked internally in cents (USD), but displayed to users as large, comma-formatted credit amounts.

## Credit-to-Cost Mapping

### Conversion Formula
```
100,000 ShopReel credits = $1 USD cost to provider
1,000 credits = $0.01 USD
```

**Mathematical breakdown:**
- 1 dollar = 100 cents (USD)
- 100,000 credits per dollar
- Therefore: 1,000 credits per cent
- Conversion: `credits = ceiling(cents × 1,000)`

### Example Costs
- $0.15 video = 15 cents = 15,000 credits
- $0.25 per-job spending cap = 25,000 credits
- $0.60 daily spending cap = 60,000 credits (Phase 1: $100 = 10M credits)
- $20 monthly spending cap = 2,000,000 credits

## User-Facing Display

### Credit Balance Display
Users always see **large, comma-formatted numbers**:
- `15,000 credits` (never `$0.15`)
- `100,000 credits` (never `$1.00`)
- `2,000,000 credits` (never `$20.00`)

### Budget Status Fields
Each budget response includes both internal and display values:

**Internal tracking (cents) - never shown to users:**
- `today_used_cents`
- `today_pending_cents`
- `today_limit_cents`

**User display (credits) - always comma-formatted:**
- `today_used_credits`
- `today_pending_credits`
- `today_limit_credits`

Same for monthly budgets:
- `month_used_cents` → `month_used_credits`
- `month_pending_cents` → `month_pending_credits`
- `month_limit_cents` → `month_limit_credits`

## Data Migration

### One-Time Migration
Existing balances are migrated exactly once per user using the `CreditMigration` class:

```python
from credit_migration import CreditMigration

migration = CreditMigration(db_path)

# Check if user needs migration
if migration.needs_migration(user_id):
    # Get old balance in cents
    old_cents = get_user_balance_cents(user_id)
    
    # Mark as migrated (prevents repeated multiplication)
    migration.mark_migrated(user_id, old_cents)
```

### Migration Safety
- Migration flag prevents re-running on same user
- Audit trail stored: `credit_migration_status` table
- Old cents value and new credits value both recorded
- Timestamp of migration recorded

## Backend Enforcement

### Budget Limits
All spending limits are enforced server-side:

1. **Per-job limit:** $0.25 (25,000 credits)
2. **Daily limit:** $0.60 (60,000 credits in Phase 1: $100)
3. **Monthly limit:** $20 (2,000,000 credits)
4. **Concurrent jobs:** 1 paid job per account

### Quota Validation
- Deduplication: Same job ID cannot be reserved twice
- Atomicity: Budget reservation + job submission are atomic
- Session isolation: Multiple tabs/windows cannot bypass limits
- Reset timing: Daily reset at midnight Chicago time

## Phase 1 Implementation

In Phase 1 (current), we use mock budgets but with real credit conversion:

```javascript
// Mock daily budget: $100 = 100,000 cents = 100,000,000 credits
const dailyLimitCents = 10000;
const dailyLimitCredits = centsToCredits(dailyLimitCents);
// Result: 10,000,000 credits displayed
```

This allows testing the credit display system while maintaining backward compatibility with mock costs.

## API Endpoints

### GET /api/higgsfield/budget
Returns user budget status with both cents and credits:

```json
{
  "today_used_cents": 0,
  "today_pending_cents": 0,
  "today_available_cents": 10000,
  "today_limit_cents": 10000,
  "today_used_credits": 0,
  "today_pending_credits": 0,
  "today_available_credits": 10000000,
  "today_limit_credits": 10000000,
  "month_used_cents": 0,
  "month_used_credits": 0,
  ...
}
```

### POST /api/higgsfield/preview-cost
Returns estimated cost in both USD and credits:

```json
{
  "estimated_cost_usd": 0.5,
  "estimated_cost_cents": 50,
  "estimated_cost_credits": 50000,
  "budget": { ... }
}
```

### POST /api/higgsfield/submit-job
Reserves budget and returns confirmation:

```json
{
  "job_id": "...",
  "status": "queued",
  "estimated_cost_usd": 0.5,
  "estimated_cost_credits": 50000,
  "budget": { ... }
}
```

## Frontend Display

### Formatting Functions

**Show large numbers with commas:**
```typescript
export function formatCreditNumber(credits: number): string {
  return credits.toLocaleString();
}
// formatCreditNumber(15000) → "15,000"
// formatCreditNumber(2000000) → "2,000,000"
```

**Full display with "credits" label:**
```typescript
export function formatCredits(credits: number): string {
  return `${credits.toLocaleString()} credits`;
}
// formatCredits(15000) → "15,000 credits"
```

**Cost display (example):**
```tsx
<div className="cost-preview-box">
  <div className="cost-label">Estimated Credits Required</div>
  <div className="cost-amount">{formatCreditNumber(costCredits)} credits</div>
</div>
```

**Budget display (example):**
```tsx
<div className="budget-bar">
  <div className="budget-fill" style={{ width: `${percent}%` }}>
    <span className="budget-label">
      {formatCreditNumber(used)} / {formatCreditNumber(limit)}
    </span>
  </div>
</div>
```

## Testing

Run integration tests for credit system:

```bash
npm test tests/credit-system.test.ts
```

Tests cover:
- Conversion from cents to credits
- Display formatting with comma separators
- Budget status structure
- API response validation
- No dollar signs in user display
- Example scenarios (15k credits per video, etc.)

## Security Considerations

### No Secrets in Display
- Credits are NOT user secrets (shown on client)
- Internal costs in cents are only in backend
- All cost validation happens server-side
- User cannot manipulate credits via client

### Rate Limiting
- Per-job: Budget reservation is atomic
- Per-day: Daily counter resets at midnight Chicago time
- Per-month: Monthly counter resets on 1st of month
- Concurrent: Only 1 paid job per user can be pending

### Validation Order
1. Check daily limit
2. Check monthly limit
3. Check concurrent job count
4. Check for duplicate job_id
5. Reserve budget atomically
6. Return 402 Payment Required if any check fails

## Migration Checklist

- [x] Add migration flag to database
- [x] Create CreditMigration class
- [x] Update BudgetStatus interface with credit fields
- [x] Add centsToCredits conversion function
- [x] Update all budget response endpoints
- [x] Add formatCredits display functions
- [x] Update HiggsFieldWorkflow component
- [x] Create integration tests
- [x] Verify all limits in credits
- [ ] Run full test suite
- [ ] Verify no regressions
- [ ] Deploy to production with migration flag
