import React, { useState } from 'react';
import { 
  Plus, 
  Wallet, 
  CreditCard, 
  Coins, 
  ArrowDownLeft, 
  ArrowUpRight, 
  RefreshCw, 
  Trash2, 
  TrendingDown, 
  AlertTriangle,
  Pencil,
  X
} from 'lucide-react';
import { FinanceSummary, FinanceAccount, Transaction, PaymentMode, TransactionType } from '../../types';
import { api } from '../../services/api';

interface FinanceViewProps {
  summary: FinanceSummary | null;
  transactions: Transaction[];
  onRefresh: () => void;
}

export const FinanceView: React.FC<FinanceViewProps> = ({
  summary,
  transactions,
  onRefresh,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editBalance, setEditBalance] = useState('');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState<string>('bank');
  const [newAccBalance, setNewAccBalance] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('upi');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [transferToAccountId, setTransferToAccountId] = useState('');

  const accounts = summary?.accounts || [];
  const categories = summary?.categories || [];

  const handleOpenEdit = (acc: FinanceAccount) => {
    setEditingAccount(acc);
    setEditName(acc.name);
    setEditBalance(acc.balance.toString());
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    const val = parseFloat(editBalance);
    await api.updateAccount(editingAccount.id, {
      name: editName,
      balance: isNaN(val) ? 0 : val,
    });
    setEditingAccount(null);
    onRefresh();
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('Are you sure you want to delete this account?')) return;
    await api.deleteAccount(id);
    setEditingAccount(null);
    onRefresh();
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    const val = parseFloat(newAccBalance);
    await api.createAccount({
      name: newAccName.trim(),
      account_type: newAccType,
      balance: isNaN(val) ? 0 : val,
      currency: 'INR',
    });
    setNewAccName('');
    setNewAccBalance('');
    setIsCreatingAccount(false);
    onRefresh();
  };

  const handleCreateTx = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;

    // Default account if not selected
    const chosenAccount = accountId || accounts[0]?.id;
    if (!chosenAccount) return;

    const todayStr = new Date().toISOString().split('T')[0];

    await api.createTransaction({
      account_id: chosenAccount,
      category_id: categoryId || undefined,
      type,
      amount: parsedAmount,
      payment_mode: paymentMode,
      description: description || undefined,
      transfer_to_account_id: type === 'transfer' ? transferToAccountId : undefined,
      date: todayStr,
    });

    setAmount('');
    setDescription('');
    setIsAdding(false);
    onRefresh();
  };

  const handleDeleteTx = async (id: string) => {
    await api.deleteTransaction(id);
    onRefresh();
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12">
      {/* Header & Quick Log Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Personal Finance Tracker</h1>
          <p className="text-xs text-zinc-400">
            Total Net Worth: ₹{(summary?.net_worth ?? 0).toLocaleString('en-IN')} • Today's Spend: ₹{summary?.today_spend ?? 0}
          </p>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-auto">
          <button
            onClick={() => setIsCreatingAccount(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition-all"
          >
            <Plus className="w-4 h-4 text-zinc-400" />
            <span>Add Account</span>
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Log Transaction</span>
          </button>
        </div>
      </div>

      {/* 1. Account Cards (Bank, Cash, Wallet) with Real Balance Edit */}
      {accounts.length === 0 ? (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 text-center">
          <p className="text-xs text-zinc-400 mb-3">No financial accounts set up yet. Add your bank account or cash wallet to begin tracking.</p>
          <button
            onClick={() => setIsCreatingAccount(true)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add Your First Account</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <div key={acc.id} className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-5 rounded-2xl relative overflow-hidden group">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider">{acc.name}</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleOpenEdit(acc)}
                  className="p-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                  title="Edit Balance"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {acc.account_type === 'bank' ? (
                  <CreditCard className="w-4 h-4 text-blue-400" />
                ) : acc.account_type === 'cash' ? (
                  <Coins className="w-4 h-4 text-amber-400" />
                ) : (
                  <Wallet className="w-4 h-4 text-emerald-400" />
                )}
              </div>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-zinc-100">
                ₹{acc.balance.toLocaleString('en-IN')}
              </p>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[11px] text-zinc-400 capitalize">{acc.account_type} Balance</p>
                <button
                  onClick={() => handleOpenEdit(acc)}
                  className="text-[11px] text-blue-400 hover:text-blue-300 font-medium opacity-80 hover:opacity-100"
                >
                  Set Balance
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}

      {/* 2. Today's Breakdown by Payment Mode (UPI vs Debit vs Cash) */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-3">Today's Spend Breakdown</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
            <span className="text-[10px] uppercase font-bold text-purple-400">UPI Payments</span>
            <p className="text-lg font-bold text-zinc-100 mt-1">₹{summary?.today_breakdown?.upi ?? 0}</p>
          </div>
          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
            <span className="text-[10px] uppercase font-bold text-blue-400">Debit Card</span>
            <p className="text-lg font-bold text-zinc-100 mt-1">₹{summary?.today_breakdown?.debit_card ?? 0}</p>
          </div>
          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
            <span className="text-[10px] uppercase font-bold text-amber-400">Cash Spent</span>
            <p className="text-lg font-bold text-zinc-100 mt-1">₹{summary?.today_breakdown?.cash ?? 0}</p>
          </div>
        </div>
      </div>

      {/* 3. Monthly Category Budgets */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Monthly Category Budgets</h2>
            <p className="text-xs text-zinc-400">
              Total Budget: ₹{(summary?.monthly_budget ?? 0).toLocaleString('en-IN')} • Spent: ₹{(summary?.monthly_spend ?? 0).toLocaleString('en-IN')}
            </p>
          </div>
          <span className="text-xs font-semibold text-zinc-300">
            {summary?.monthly_budget ? Math.round(((summary?.monthly_spend || 0) / summary.monthly_budget) * 100) : 0}% used
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {categories.map((cat) => (
            <div key={cat.id} className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800/80 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-200">{cat.name}</span>
                <span className="text-zinc-400">
                  ₹{cat.spent_this_month.toLocaleString('en-IN')} / ₹{cat.monthly_budget.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    cat.budget_percentage > 90 ? 'bg-red-500' : cat.budget_percentage > 75 ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, cat.budget_percentage)}%` }}
                />
              </div>
              {cat.budget_percentage > 90 && (
                <div className="flex items-center space-x-1 text-[10px] text-red-400">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Approaching / exceeding monthly budget</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 4. Transaction History */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-zinc-100 mb-4">Recent Transactions</h2>

        <div className="space-y-2">
          {transactions.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 text-xs">
              No transactions recorded. Log an expense or dictate one via Siri!
            </div>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800/80 text-xs"
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    tx.type === 'expense' ? 'bg-red-500/10 text-red-400' : tx.type === 'income' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'
                  }`}>
                    {tx.type === 'expense' ? <ArrowDownLeft className="w-4 h-4" /> : tx.type === 'income' ? <ArrowUpRight className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-medium text-zinc-200">{tx.description || tx.category_name || 'Transaction'}</p>
                    <p className="text-[10px] text-zinc-400">
                      {tx.account_name} • <span className="uppercase font-semibold text-blue-400">{tx.payment_mode}</span> • {tx.date}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <span className={`font-bold ${tx.type === 'expense' ? 'text-zinc-100' : 'text-emerald-400'}`}>
                    {tx.type === 'expense' ? `-₹${tx.amount}` : `+₹${tx.amount}`}
                  </span>
                  <button
                    onClick={() => handleDeleteTx(tx.id)}
                    className="text-zinc-500 hover:text-red-400 p-1 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Log Transaction Modal */}
      {isAdding && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <h2 className="text-base font-semibold text-zinc-100">Log Transaction</h2>

            <form onSubmit={handleCreateTx} className="space-y-4">
              {/* Type Toggle */}
              <div className="grid grid-cols-3 gap-2 bg-zinc-800 p-1 rounded-xl">
                {(['expense', 'income', 'transfer'] as TransactionType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors ${
                      type === t ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 font-bold focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Payment Mode Selector */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Payment Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'upi', label: 'UPI' },
                    { id: 'debit_card', label: 'Debit Card' },
                    { id: 'cash', label: 'Cash' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMode(m.id as PaymentMode)}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                        paymentMode === m.id
                          ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Account Selector */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Account</label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} (₹{a.balance})
                      </option>
                    ))}
                  </select>
                </div>

                {type === 'transfer' ? (
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Transfer To</label>
                    <select
                      value={transferToAccountId}
                      onChange={(e) => setTransferToAccountId(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                    >
                      <option value="">Select Account</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Category</label>
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                    >
                      <option value="">Select Category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Swiggy order, Metro recharge, Grocery store..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                >
                  Confirm & Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">Edit Account & Balance</h3>
              <button onClick={() => setEditingAccount(null)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Account Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Current Balance (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editBalance}
                  onChange={(e) => setEditBalance(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                  placeholder="0.00"
                  required
                />
              </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteAccount(editingAccount.id)}
                    className="flex items-center space-x-1 text-xs text-red-400 hover:text-red-300 font-medium px-2 py-1 rounded hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Account</span>
                  </button>
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => setEditingAccount(null)}
                      className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                    >
                      Update Account
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

      {/* Add Account Modal */}
      {isCreatingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">Add New Account</h3>
              <button onClick={() => setIsCreatingAccount(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Account Name</label>
                <input
                  type="text"
                  placeholder="e.g. HDFC Salary, SBI Savings, Cash in Wallet..."
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Type</label>
                  <select
                    value={newAccType}
                    onChange={(e) => setNewAccType(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="bank">Bank Account</option>
                    <option value="cash">Cash in Hand</option>
                    <option value="wallet">Digital Wallet</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Initial Balance (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newAccBalance}
                    onChange={(e) => setNewAccBalance(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingAccount(false)}
                  className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
