import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FinanceView } from '../FinanceView';
import { ToastProvider } from '../../../context/ToastContext';
import { FinanceSummary, Transaction } from '../../../types';

vi.mock('../../../services/api', () => ({
  api: {
    getRecurringBills: vi.fn().mockResolvedValue([]),
    getBudgets: vi.fn().mockResolvedValue([]),
    createTransaction: vi.fn().mockResolvedValue({}),
    createAccount: vi.fn().mockResolvedValue({}),
    deleteRecurringBill: vi.fn().mockResolvedValue({}),
    createRecurringBill: vi.fn().mockResolvedValue({}),
    setBudget: vi.fn().mockResolvedValue({}),
  },
}));

const summary: FinanceSummary = {
  accounts: [
    { id: 'acc-1', name: 'HDFC Salary', account_type: 'bank', balance: 48250, currency: 'INR', is_upi_default: true, updated_at: '2026-09-20T09:00:00' },
    { id: 'acc-2', name: 'Cash in Wallet', account_type: 'cash', balance: 1200, currency: 'INR', updated_at: '2026-09-20T09:00:00' },
  ],
  net_worth: 49450,
  total_bank: 48250,
  total_cash: 1200,
  total_wallet: 0,
  today_spend: 340,
  today_breakdown: { upi: 340, debit_card: 0, cash: 0 },
  monthly_spend: 12400,
  monthly_budget: 30000,
  categories: [
    { id: 'cat-1', name: 'Food', monthly_budget: 8000, spent_this_month: 5200, budget_percentage: 65 },
    { id: 'cat-2', name: 'Transport', monthly_budget: 3000, spent_this_month: 2800, budget_percentage: 93 },
  ],
};

const transactions: Transaction[] = [];

function renderFinance(overrides: Partial<React.ComponentProps<typeof FinanceView>> = {}) {
  const onCreateTransaction = vi.fn();
  const onCreateAccount = vi.fn();
  render(
    <ToastProvider>
    <FinanceView
      summary={summary}
      transactions={transactions}
      onRefresh={vi.fn()}
      onCreateTransaction={onCreateTransaction}
      onCreateAccount={onCreateAccount}
      onUpdateAccount={vi.fn()}
      onDeleteAccount={vi.fn()}
      onDeleteTransaction={vi.fn()}
      {...overrides}
    />
    </ToastProvider>
  );
  return { onCreateTransaction, onCreateAccount };
}

const openLogForm = () => {
  fireEvent.click(screen.getByRole('button', { name: /log transaction/i }));
  return within(screen.getByRole('dialog'));
};

describe('logging a transaction', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends what was typed, with the account it was paid from', () => {
    const { onCreateTransaction } = renderFinance();
    const form = openLogForm();

    fireEvent.change(form.getByLabelText('Amount'), { target: { value: '340' } });
    fireEvent.change(form.getByLabelText('Description'), { target: { value: 'Swiggy order' } });
    fireEvent.click(form.getByRole('button', { name: 'Confirm & Save' }));

    expect(onCreateTransaction).toHaveBeenCalledTimes(1);
    expect(onCreateTransaction.mock.calls[0][0]).toMatchObject({
      account_id: 'acc-1',
      amount: 340,
      type: 'expense',
      description: 'Swiggy order',
    });
  });

  it('refuses an amount of zero rather than writing a meaningless row', () => {
    const { onCreateTransaction } = renderFinance();
    const form = openLogForm();

    fireEvent.change(form.getByLabelText('Amount'), { target: { value: '0' } });
    fireEvent.click(form.getByRole('button', { name: 'Confirm & Save' }));

    expect(onCreateTransaction).not.toHaveBeenCalled();
  });

  it('will not take a negative amount, whichever direction the money went', () => {
    renderFinance();
    const form = openLogForm();

    // The direction is the type toggle's job; the amount itself is a
    // magnitude, so the field says so rather than letting -340 through.
    expect(form.getByLabelText('Amount')).toHaveAttribute('min', '0');
  });

  it('asks for a destination account once it is a transfer', () => {
    renderFinance();
    const form = openLogForm();

    expect(form.queryByLabelText('Into')).not.toBeInTheDocument();
    fireEvent.click(form.getByRole('button', { name: 'transfer' }));

    expect(form.getByLabelText('Into')).toBeInTheDocument();
    // A transfer has no category: the money did not leave, it moved.
    expect(form.queryByLabelText('Category')).not.toBeInTheDocument();
  });

  it('carries the chosen category through', () => {
    const { onCreateTransaction } = renderFinance();
    const form = openLogForm();

    fireEvent.change(form.getByLabelText('Amount'), { target: { value: '120' } });
    fireEvent.change(form.getByLabelText('Category'), { target: { value: 'cat-2' } });
    fireEvent.click(form.getByRole('button', { name: 'Confirm & Save' }));

    expect(onCreateTransaction.mock.calls[0][0]).toMatchObject({ category_id: 'cat-2' });
  });

  it('opens a number keypad on a phone for money', () => {
    renderFinance();
    const form = openLogForm();

    expect(form.getByLabelText('Amount')).toHaveAttribute('inputMode', 'decimal');
  });
});

describe('the finance screen itself', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('writes amounts the way they are read in India', () => {
    renderFinance();
    // 48250 as 48,250 rather than 48250 — grouping by the Indian convention.
    expect(screen.getAllByText(/48,250/).length).toBeGreaterThan(0);
  });

  it('offers a way in when there are no accounts yet', () => {
    renderFinance({ summary: { ...summary, accounts: [], net_worth: 0, total_bank: 0, total_cash: 0 } });
    expect(screen.getByRole('button', { name: /add your first account/i })).toBeInTheDocument();
  });
});
