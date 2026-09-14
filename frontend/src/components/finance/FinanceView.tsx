import React, { useState, useEffect } from 'react';
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
  X,
  Receipt,
  CalendarClock,
  ShieldAlert,
  SlidersHorizontal,
  Zap
} from 'lucide-react';
import { FinanceSummary, FinanceAccount, Transaction, PaymentMode, TransactionType, RecurringBill, FinanceCategory } from '../../types';
import { api } from '../../services/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Skeleton } from '../common/Skeleton';
import { useToast } from '../../context/ToastContext';
import { motion } from 'framer-motion';
import { haptics } from '../../utils/haptics';

interface FinanceViewProps {
  isLoading?: boolean;
  summary: FinanceSummary | null;
  transactions: Transaction[];
  onRefresh: () => void;
  onCreateAccount?: (acc: { name: string; account_type: string; balance: number; currency?: string; is_upi_default?: boolean }) => void;
  onUpdateAccount?: (id: string, updates: { name?: string; balance?: number; is_upi_default?: boolean }) => void;
  onDeleteAccount?: (id: string) => void;
  onCreateTransaction?: (tx: {
    account_id: string;
    category_id?: string;
    type: TransactionType;
    amount: number;
    payment_mode: PaymentMode;
    description?: string;
    transfer_to_account_id?: string;
    date: string;
  }) => void;
  onDeleteTransaction?: (id: string) => void;
}

const TransactionRow: React.FC<{
  tx: Transaction;
  onDelete: (id: string) => void;
}> = ({ tx, onDelete }) => {
  const [dragOffset, setDragOffset] = useState(0);

  return (
    <div className="relative overflow-hidden rounded-none clipping clipping-white border border-stone-300 dark:border-stone-800/80 mb-1.5 shadow-xs">
      {/* Background Swipe Action: Delete */}
      <div
        className={`absolute inset-0 flex items-center justify-end px-4 transition-colors rounded-none ${
          dragOffset <= -60 ? 'bg-rose-700 text-white' : 'bg-rose-950/60 text-rose-400'
        }`}
      >
        <Trash2 className="w-4 h-4" />
      </div>

      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.4}
        onDrag={(_e, info) => setDragOffset(info.offset.x)}
        onDragEnd={(_e, info) => {
          if (info.offset.x <= -65) {
            haptics.warning();
            onDelete(tx.id);
          }
          setDragOffset(0);
        }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative flex items-center justify-between p-3 bg-paper-white dark:bg-[#131317] text-xs select-none rounded-none border-b border-stone-200 dark:border-stone-800"
      >
        <div className="flex items-center space-x-3 truncate pr-2">
          <div
            className={`w-7 h-7 rounded-none border flex items-center justify-center shrink-0 ${
              tx.type === 'expense'
                ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800'
                : tx.type === 'income'
                ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                : 'bg-paper-aged text-amber-700 border-stone-300 dark:bg-stone-900 dark:text-amber-400 dark:border-stone-700'
            }`}
          >
            {tx.type === 'expense' ? (
              <ArrowDownLeft className="w-4 h-4" />
            ) : tx.type === 'income' ? (
              <ArrowUpRight className="w-4 h-4" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </div>

          <div className="truncate">
            <p className="font-editorial text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
              {tx.description || (tx.type === 'transfer' ? 'Internal Transfer' : 'Unspecified Ledger Entry')}
            </p>
            <div className="flex items-center space-x-2 text-[10px] font-ledger text-stone-500 dark:text-stone-400 mt-0.5">
              <span>{tx.date}</span>
              <span>&bull;</span>
              <span className="uppercase text-stone-700 dark:text-stone-300 font-bold">{tx.payment_mode}</span>
              {tx.account_name && (
                <>
                  <span>&bull;</span>
                  <span className="text-stone-500 dark:text-stone-400">{tx.account_name}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <span
            className={`font-ledger text-sm font-bold tracking-tight ${
              tx.type === 'expense'
                ? 'text-rose-700 dark:text-rose-400'
                : tx.type === 'income'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-stone-300'
            }`}
          >
            {tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : ''}₹{tx.amount.toLocaleString('en-IN')}
          </span>

          <button
            onClick={() => onDelete(tx.id)}
            className="hidden sm:flex text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 p-1 rounded-none border border-transparent hover:border-stone-300 dark:hover:border-stone-800 hover:bg-black/5 dark:hover:bg-stone-800 transition-colors"
            title="Delete entry"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export const FinanceView: React.FC<FinanceViewProps> = ({
  isLoading = false,
  summary,
  transactions,
  onRefresh,
  onCreateAccount,
  onUpdateAccount,
  onDeleteAccount,
  onCreateTransaction,
  onDeleteTransaction,
}) => {
  const toast = useToast();
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null);
  const [deletingBillId, setDeletingBillId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editBalance, setEditBalance] = useState('');
  const [editIsUpiDefault, setEditIsUpiDefault] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState<string>('bank');
  const [newAccBalance, setNewAccBalance] = useState('');
  const [newAccIsUpiDefault, setNewAccIsUpiDefault] = useState(false);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('upi');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [transferToAccountId, setTransferToAccountId] = useState('');
  const [dismissedUpiBanner, setDismissedUpiBanner] = useState(false);
  const [unifyingUpi, setUnifyingUpi] = useState(false);

  // Recurring Bills & Subscription Radar State
  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>([]);
  const [isAddingBill, setIsAddingBill] = useState(false);
  const [newBillName, setNewBillName] = useState('');
  const [newBillAmount, setNewBillAmount] = useState('');
  const [newBillDueDay, setNewBillDueDay] = useState('5');
  const [newBillCategory, setNewBillCategory] = useState('Utilities & Bills');

  // Budget Guardrail Editing State
  const [editingBudgetCat, setEditingBudgetCat] = useState<FinanceCategory | null>(null);
  const [newBudgetLimit, setNewBudgetLimit] = useState('');

  const fetchBills = async () => {
    try {
      const bills = await api.getRecurringBills();
      setRecurringBills(bills);
    } catch (e) {
      console.error('Failed to load recurring bills:', e);
    }
  };

  useEffect(() => {
    fetchBills();
  }, []);

  const handleAddBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBillName.trim() || !newBillAmount) return;
    try {
      await api.createRecurringBill({
        name: newBillName.trim(),
        amount: parseFloat(newBillAmount),
        due_day_of_month: parseInt(newBillDueDay) || 1,
        category: newBillCategory,
      });
      setIsAddingBill(false);
      setNewBillName('');
      setNewBillAmount('');
      fetchBills();
    } catch (err) {
      console.error('Failed to create recurring bill:', err);
    }
  };

  const executeDeleteBill = async (id: string) => {
    try {
      await api.deleteRecurringBill(id);
      toast.info('Removed recurring bill');
      fetchBills();
    } catch (err) {
      console.error('Failed to delete recurring bill:', err);
      toast.error('Failed to remove recurring bill');
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBudgetCat) return;
    const limit = parseFloat(newBudgetLimit);
    if (isNaN(limit)) return;
    try {
      await api.setBudget({
        category_id: editingBudgetCat.id,
        monthly_limit: limit,
      });
      setEditingBudgetCat(null);
      onRefresh();
    } catch (err) {
      console.error('Failed to update category budget:', err);
    }
  };

  const selectPaymentMode = (mode: PaymentMode) => {
    setPaymentMode(mode);
    if (mode === 'upi') {
      const upiAcc = accounts.find(a => a.is_upi_default) || accounts.find(a => a.account_type === 'bank');
      if (upiAcc) setAccountId(upiAcc.id);
    } else if (mode === 'debit_card') {
      const bankAcc = accounts.find(a => a.account_type === 'bank');
      if (bankAcc) setAccountId(bankAcc.id);
    } else if (mode === 'cash') {
      const cashAcc = accounts.find(a => a.account_type === 'cash');
      if (cashAcc) setAccountId(cashAcc.id);
    }
  };

  const accounts = summary?.accounts || [];
  const categories = summary?.categories || [];

  const handleOpenEdit = (acc: FinanceAccount) => {
    setEditingAccount(acc);
    setEditName(acc.name);
    setEditBalance(acc.balance.toString());
    setEditIsUpiDefault(Boolean(acc.is_upi_default));
  };

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    const val = parseFloat(editBalance);
    const balanceVal = isNaN(val) ? 0 : val;
    const updates = { name: editName.trim(), balance: balanceVal, is_upi_default: editIsUpiDefault };
    const accId = editingAccount.id;
    setEditingAccount(null);

    if (onUpdateAccount) {
      onUpdateAccount(accId, updates);
    } else {
      api.updateAccount(accId, updates as any).then(() => onRefresh());
    }
  };

  const executeDeleteAccount = (id: string) => {
    setEditingAccount(null);
    if (onDeleteAccount) {
      onDeleteAccount(id);
    } else {
      api.deleteAccount(id).then(() => onRefresh());
    }
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    const val = parseFloat(newAccBalance);
    const accData = {
      name: newAccName.trim(),
      account_type: newAccType,
      balance: isNaN(val) ? 0 : val,
      currency: 'INR',
      is_upi_default: newAccIsUpiDefault,
    };
    setNewAccName('');
    setNewAccBalance('');
    setNewAccIsUpiDefault(false);
    setIsCreatingAccount(false);

    if (onCreateAccount) {
      onCreateAccount(accData);
    } else {
      api.createAccount(accData).then(() => onRefresh());
    }
  };

  const handleUnifyUPI = async () => {
    const primaryBank = accounts.find(a => a.account_type === 'bank');
    const walletAccount = accounts.find(a => a.account_type === 'wallet');
    if (!primaryBank) return;
    setUnifyingUpi(true);
    try {
      await api.unifyUPI(primaryBank.id, walletAccount?.id);
      onRefresh();
    } catch (err) {
      console.error('Failed to unify UPI:', err);
    } finally {
      setUnifyingUpi(false);
    }
  };

  const handleCreateTx = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;

    // Default account if not selected
    const chosenAccount = accountId || accounts[0]?.id;
    if (!chosenAccount) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const txData = {
      account_id: chosenAccount,
      category_id: categoryId || undefined,
      type,
      amount: parsedAmount,
      payment_mode: paymentMode,
      description: description || undefined,
      transfer_to_account_id: type === 'transfer' ? transferToAccountId : undefined,
      date: todayStr,
    };

    setAmount('');
    setDescription('');
    setIsAdding(false);

    if (onCreateTransaction) {
      onCreateTransaction(txData);
    } else {
      api.createTransaction(txData).then(() => onRefresh());
    }
  };

  const handleDeleteTx = (id: string) => {
    if (onDeleteTransaction) {
      onDeleteTransaction(id);
    } else {
      api.deleteTransaction(id).then(() => onRefresh());
    }
  };

  if (!summary && isLoading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in">
        <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-3">
          <Skeleton variant="text" className="w-48 h-6" />
          <Skeleton variant="text" className="w-96 h-4" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton variant="card" count={3} />
        </div>
        <div className="space-y-2">
          <Skeleton variant="row" count={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12">
      {/* Header & Quick Log Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-stone-300 dark:border-stone-800 pb-3">
        <div>
          <div className="text-[10px] font-ledger uppercase tracking-widest text-amber-700 dark:text-amber-500 font-bold mb-0.5">
            SECTION V &bull; FISCAL COMMUNIQUÉ
          </div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100 uppercase tracking-tight">
            The Financial Ledger
          </h1>
          <p className="font-ledger text-[11px] text-stone-600 dark:text-stone-400 uppercase tracking-wider mt-0.5">
            NET LIQUID CAPITAL: ₹{(summary?.net_worth ?? 0).toLocaleString('en-IN')} &bull; TODAY'S DISBURSEMENTS: ₹{summary?.today_spend ?? 0}
          </p>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-auto">
          <button
            onClick={() => setIsCreatingAccount(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-none bg-paper-aged dark:bg-stone-900 hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-800 dark:text-stone-300 text-xs font-ledger uppercase tracking-wider border border-stone-300 dark:border-stone-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-amber-700 dark:text-amber-500" />
            <span>+ New Account</span>
          </button>
          <button
            onClick={() => {
              setIsAdding(true);
              selectPaymentMode(paymentMode || 'upi');
            }}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-none bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-ledger font-bold uppercase tracking-wider border border-amber-600 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Transaction</span>
          </button>
        </div>
      </div>

      {/* Smart Unification Banner if separate wallet exists */}
      {accounts.some(a => a.account_type === 'wallet') && accounts.some(a => a.account_type === 'bank') && !dismissedUpiBanner && (
        <div className="bg-gradient-to-r from-purple-950/40 via-zinc-900 to-blue-950/40 border border-purple-800/40 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30 mt-0.5">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                Keep UPI & Bank Account as the same?
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">Unified Balance</span>
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                In India, UPI payments come directly from your bank. Consolidate your separate{' '}
                <strong>
                  {accounts.find(a => a.account_type === 'wallet')?.name} (₹{(accounts.find(a => a.account_type === 'wallet')?.balance ?? 0).toLocaleString('en-IN')})
                </strong>{' '}
                into{' '}
                <strong>{accounts.find(a => a.account_type === 'bank')?.name}</strong> so all UPI transactions deduct from your true bank balance.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto flex-shrink-0">
            <button
              onClick={handleUnifyUPI}
              disabled={unifyingUpi}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-purple-600/20 flex items-center gap-1.5 transition-all"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{unifyingUpi ? 'Unifying...' : `Merge into ${accounts.find(a => a.account_type === 'bank')?.name}`}</span>
            </button>
            <button
              onClick={() => setDismissedUpiBanner(true)}
              className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Keep Separate
            </button>
          </div>
        </div>
      )}

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
            <div key={acc.id} className="clipping clipping-aged border-2 border-stone-300 dark:border-stone-800 p-5 rounded-none relative overflow-hidden group shadow-xs">
              <div className="tape-strip -top-2 right-6 transform rotate-2" />
              <div className="flex items-center justify-between text-xs text-stone-600 dark:text-zinc-400">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-ledger font-bold uppercase tracking-wider text-stone-900 dark:text-zinc-200">{acc.name}</span>
                  {acc.is_upi_default && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none text-[9px] font-ledger font-bold bg-amber-100 text-amber-800 dark:bg-purple-500/20 dark:text-purple-300 border border-amber-300 dark:border-purple-500/30 uppercase">
                      <Zap className="w-2.5 h-2.5 text-amber-700 dark:text-purple-400" />
                      UPI Linked
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleOpenEdit(acc)}
                    className="p-1 rounded-none bg-paper-white dark:bg-zinc-800 border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-zinc-300 hover:text-stone-900 dark:hover:text-white transition-colors"
                    title="Edit Balance"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {acc.account_type === 'bank' ? (
                    <CreditCard className="w-4 h-4 text-amber-700 dark:text-blue-400" />
                  ) : acc.account_type === 'cash' ? (
                    <Coins className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  ) : (
                    <Wallet className="w-4 h-4 text-amber-700 dark:text-emerald-400" />
                  )}
                </div>
              </div>
              <div className="mt-3">
                <p className="font-editorial text-3xl font-bold text-stone-900 dark:text-zinc-100">
                  ₹{acc.balance.toLocaleString('en-IN')}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <p className="font-ledger text-[11px] text-stone-500 dark:text-zinc-400 uppercase">
                    {acc.is_upi_default ? 'Bank & UPI Balance' : `${acc.account_type} Balance`}
                  </p>
                  <button
                    onClick={() => handleOpenEdit(acc)}
                    className="font-ledger text-[11px] text-amber-800 dark:text-blue-400 hover:underline uppercase font-bold"
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
      <div className="clipping clipping-cream border-2 border-stone-300 dark:border-stone-800/80 rounded-none p-5 shadow-xs">
        <h2 className="font-editorial text-sm font-bold text-stone-900 dark:text-zinc-200 uppercase tracking-wider mb-3">Today's Spend Breakdown</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-3 rounded-none clipping clipping-white border border-stone-300 dark:border-zinc-800">
            <span className="text-[10px] font-ledger uppercase font-bold text-amber-800 dark:text-purple-400">UPI Payments</span>
            <p className="text-lg font-editorial font-bold text-stone-900 dark:text-zinc-100 mt-1">₹{summary?.today_breakdown?.upi ?? 0}</p>
          </div>
          <div className="p-3 rounded-none clipping clipping-white border border-stone-300 dark:border-zinc-800">
            <span className="text-[10px] font-ledger uppercase font-bold text-amber-800 dark:text-blue-400">Debit Card</span>
            <p className="text-lg font-editorial font-bold text-stone-900 dark:text-zinc-100 mt-1">₹{summary?.today_breakdown?.debit_card ?? 0}</p>
          </div>
          <div className="p-3 rounded-none clipping clipping-white border border-stone-300 dark:border-zinc-800">
            <span className="text-[10px] font-ledger uppercase font-bold text-amber-800 dark:text-amber-400">Cash Spent</span>
            <p className="text-lg font-editorial font-bold text-stone-900 dark:text-zinc-100 mt-1">₹{summary?.today_breakdown?.cash ?? 0}</p>
          </div>
        </div>
      </div>

      {/* 3. Recurring Bills & Subscription Radar */}
      <div className="clipping clipping-white border-2 border-stone-300 dark:border-stone-800/80 rounded-none p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-none bg-paper-base dark:bg-stone-900 text-amber-700 dark:text-amber-400 border border-stone-300 dark:border-stone-700">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-editorial text-base font-bold text-stone-900 dark:text-zinc-100 uppercase tracking-tight">Recurring Bills & Subscription Radar</h2>
              <p className="font-ledger text-[11px] text-stone-500 dark:text-zinc-400 uppercase">
                Monthly commitment: ₹{recurringBills.reduce((acc, b) => acc + b.amount, 0).toLocaleString('en-IN')} &bull; {recurringBills.length} active bills
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsAddingBill(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-paper-aged dark:bg-stone-900 hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-800 dark:text-indigo-300 border border-stone-300 dark:border-stone-700 text-xs font-ledger uppercase font-bold self-start sm:self-auto transition-all"
          >
            <Plus className="w-3.5 h-3.5 text-amber-700" /> Add Bill
          </button>
        </div>

        {recurringBills.length === 0 ? (
          <div className="text-center py-6 text-zinc-500 text-xs bg-zinc-900/40 border border-zinc-800/60 rounded-xl">
            No recurring bills tracked. Add your Netflix, WiFi, electricity, or SIP bills!
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recurringBills.map((bill) => {
              const isOverdue = bill.is_overdue;
              const days = bill.days_until_due;
              const badgeClass = isOverdue
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold'
                : days === 0
                ? 'bg-red-500/20 text-red-300 border-red-500/40 font-bold animate-pulse'
                : days <= 2
                ? 'bg-red-500/10 text-red-300 border-red-500/30'
                : days <= 6
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';

              const badgeText = isOverdue
                ? '🚨 Overdue'
                : days === 0
                ? '⏰ Due Today'
                : days === 1
                ? '⚡ Due Tomorrow'
                : `Due in ${days} days`;

              return (
                <div 
                  key={bill.id}
                  className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col justify-between gap-3 hover:border-zinc-700 transition-all shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-white">{bill.name}</h4>
                      <p className="text-[11px] text-zinc-400 mt-0.5 font-mono">
                        Due on {bill.due_day_of_month}{bill.due_day_of_month === 1 ? 'st' : bill.due_day_of_month === 2 ? 'nd' : bill.due_day_of_month === 3 ? 'rd' : 'th'} of month
                      </p>
                    </div>
                    <span className="text-sm font-bold text-zinc-100 font-mono">
                      ₹{bill.amount.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badgeClass}`}>
                      {badgeText}
                    </span>
                    <button
                      onClick={() => setDeletingBillId(bill.id)}
                      aria-label={`Remove bill: ${bill.name}`}
                      className="text-zinc-500 hover:text-rose-400 p-1 rounded transition-colors"
                      title="Remove bill"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Monthly Category Budgets & Visual Guardrails */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">Monthly Category Budgets & Guardrails</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                Visual Thresholds
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Total Budget: ₹{(summary?.monthly_budget ?? 0).toLocaleString('en-IN')} • Spent: ₹{(summary?.monthly_spend ?? 0).toLocaleString('en-IN')}
            </p>
          </div>
          <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded-lg border ${
            (summary?.monthly_spend || 0) > (summary?.monthly_budget || 0)
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
              : 'bg-zinc-800 text-zinc-300 border-zinc-700'
          }`}>
            {summary?.monthly_budget ? Math.round(((summary?.monthly_spend || 0) / summary.monthly_budget) * 100) : 0}% used
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {categories.map((cat) => {
            const pct = cat.budget_percentage;
            // Guardrail color coding:
            // Green: 0–69%
            // Amber: 70–89%
            // Red: 90%+
            const isDanger = pct >= 90;
            const isWarning = pct >= 70 && pct < 90;
            const barColor = isDanger 
              ? 'bg-gradient-to-r from-red-500 to-rose-600' 
              : isWarning 
              ? 'bg-gradient-to-r from-amber-400 to-orange-500' 
              : 'bg-gradient-to-r from-emerald-400 to-teal-500';

            return (
              <div key={cat.id} className={`p-3.5 rounded-xl bg-zinc-900 border transition-all space-y-2.5 ${
                isDanger ? 'border-rose-500/40 shadow-sm' : isWarning ? 'border-amber-500/30' : 'border-zinc-800/80'
              }`}>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-200">{cat.name}</span>
                    <button
                      onClick={() => {
                        setEditingBudgetCat(cat);
                        setNewBudgetLimit(cat.monthly_budget.toString());
                      }}
                      className="text-zinc-500 hover:text-blue-400 p-0.5 rounded"
                      title="Adjust monthly limit"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="text-zinc-300 font-mono text-[11px]">
                    ₹{cat.spent_this_month.toLocaleString('en-IN')} <span className="text-zinc-500">/ ₹{cat.monthly_budget.toLocaleString('en-IN')}</span>
                  </span>
                </div>

                {/* Progress Meter with Visual Guardrails */}
                <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px]">
                  {isDanger ? (
                    <span className="flex items-center gap-1 text-rose-400 font-bold">
                      <ShieldAlert className="w-3 h-3" />
                      {pct >= 100 ? 'Budget Exceeded!' : 'Critical Guardrail (>90%)'}
                    </span>
                  ) : isWarning ? (
                    <span className="flex items-center gap-1 text-amber-400 font-medium">
                      <AlertTriangle className="w-3 h-3" />
                      Amber Alert (70–89% consumed)
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-medium">
                      ✓ Safe Guardrail (&lt;70%)
                    </span>
                  )}
                  <span className="font-mono text-zinc-400 font-bold">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Transaction History */}
      <div className="clipping clipping-aged border-2 border-stone-300 dark:border-stone-800/80 rounded-none p-5 shadow-xs">
        <h2 className="font-editorial text-base font-bold text-stone-900 dark:text-zinc-100 uppercase tracking-tight mb-4">The Ledger Journal &bull; Recent Transactions</h2>

        <div className="space-y-2">
          {transactions.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 text-xs">
              No transactions recorded. Log an expense or dictate one via Siri!
            </div>
          ) : (
            transactions.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                onDelete={(id) => setDeletingTxId(id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Log Transaction Modal */}
      <Modal
        isOpen={isAdding}
        onClose={() => setIsAdding(false)}
        title="Log Transaction"
        icon={<Receipt className="w-4 h-4 text-blue-400" />}
        maxWidth="max-w-lg"
      >
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
                      onClick={() => selectPaymentMode(m.id as PaymentMode)}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                        paymentMode === m.id
                          ? m.id === 'upi'
                            ? 'bg-purple-600/20 border-purple-500 text-purple-400'
                            : 'bg-blue-600/20 border-blue-500 text-blue-400'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {paymentMode === 'upi' && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-purple-300 bg-purple-950/40 border border-purple-800/40 px-2.5 py-1.5 rounded-lg">
                    <Zap className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                    <span>
                      UPI Linked: Auto-deducts from <strong>{accounts.find(a => a.id === accountId)?.name || 'Primary Bank Account'}</strong>
                    </span>
                  </div>
                )}
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
                        {a.name} (₹{a.balance}){a.is_upi_default ? ' • ⚡ UPI Linked' : ''}
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
      </Modal>

      {/* Edit Account Modal */}
      <Modal
        isOpen={!!editingAccount}
        onClose={() => setEditingAccount(null)}
        title="Edit Account & Balance"
        icon={<Pencil className="w-4 h-4 text-blue-400" />}
        maxWidth="max-w-md"
      >
        {editingAccount && (
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

              {editingAccount.account_type === 'bank' && (
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-purple-950/20 border border-purple-800/30 cursor-pointer text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={editIsUpiDefault}
                    onChange={(e) => setEditIsUpiDefault(e.target.checked)}
                    className="rounded bg-zinc-800 border-zinc-700 text-purple-600 focus:ring-purple-500"
                  />
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-purple-400" />
                    <span>Keep UPI & this Bank Account as the same (Primary UPI)</span>
                  </div>
                </label>
              )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const id = editingAccount.id;
                      setEditingAccount(null);
                      setDeletingAccountId(id);
                    }}
                    aria-label={`Delete account: ${editingAccount.name}`}
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
        )}
      </Modal>

      {/* Add Account Modal */}
      <Modal
        isOpen={isCreatingAccount}
        onClose={() => setIsCreatingAccount(false)}
        title="Add New Account"
        icon={<Wallet className="w-4 h-4 text-blue-400" />}
        maxWidth="max-w-md"
      >
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

              {newAccType === 'bank' && (
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-purple-950/20 border border-purple-800/30 cursor-pointer text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={newAccIsUpiDefault}
                    onChange={(e) => setNewAccIsUpiDefault(e.target.checked)}
                    className="rounded bg-zinc-800 border-zinc-700 text-purple-600 focus:ring-purple-500"
                  />
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-purple-400" />
                    <span>Set as Primary UPI Account (Keep UPI & Bank Same)</span>
                  </div>
                </label>
              )}

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
      </Modal>

      {/* Add Recurring Bill Modal */}
      <Modal
        isOpen={isAddingBill}
        onClose={() => setIsAddingBill(false)}
        title="Add Recurring Bill or Subscription"
        icon={<Receipt className="w-4 h-4 text-indigo-400" />}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleAddBill} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Bill Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Netflix, Airtel Broadband, Gym Membership"
                  value={newBillName}
                  onChange={(e) => setNewBillName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="e.g. 999"
                    value={newBillAmount}
                    onChange={(e) => setNewBillAmount(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Due Day of Month</label>
                  <select
                    value={newBillDueDay}
                    onChange={(e) => setNewBillDueDay(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'} of month
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Category</label>
                <input
                  type="text"
                  placeholder="Utilities & Bills, Entertainment, Housing..."
                  value={newBillCategory}
                  onChange={(e) => setNewBillCategory(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingBill(false)}
                  className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20"
                >
                  Track Bill
                </button>
              </div>
            </form>
      </Modal>

      {/* Edit Category Budget Modal */}
      <Modal
        isOpen={!!editingBudgetCat}
        onClose={() => setEditingBudgetCat(null)}
        title="Adjust Budget Guardrail"
        icon={<SlidersHorizontal className="w-4 h-4 text-blue-400" />}
        maxWidth="max-w-sm"
      >
        {editingBudgetCat && (
          <form onSubmit={handleSaveBudget} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Category</label>
                <p className="text-sm font-bold text-white">{editingBudgetCat.name}</p>
                <p className="text-xs text-zinc-400 mt-1">
                  Spent this month: ₹{editingBudgetCat.spent_this_month.toLocaleString('en-IN')}
                </p>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Monthly Limit (₹)</label>
                <input
                  type="number"
                  step="100"
                  required
                  placeholder="e.g. 8000"
                  value={newBudgetLimit}
                  onChange={(e) => setNewBudgetLimit(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 font-mono text-base"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingBudgetCat(null)}
                  className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20"
                >
                  Save Guardrail
                </button>
              </div>
            </form>
        )}
      </Modal>

      {/* Delete Account Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingAccountId}
        title="Delete Account"
        message={`Are you sure you want to delete "${summary?.accounts.find(a => a.id === deletingAccountId)?.name || 'this account'}"? This can be undone from the undo toast or with Ctrl+Z.`}
        confirmLabel="Delete Account"
        confirmVariant="danger"
        onConfirm={() => {
          if (deletingAccountId) {
            executeDeleteAccount(deletingAccountId);
            setDeletingAccountId(null);
          }
        }}
        onCancel={() => setDeletingAccountId(null)}
      />

      {/* Delete Transaction Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingTxId}
        title="Delete Transaction"
        message={`Are you sure you want to delete this transaction? This action can be undone immediately via the Undo button or Ctrl+Z.`}
        confirmLabel="Delete Transaction"
        confirmVariant="danger"
        onConfirm={() => {
          if (deletingTxId) {
            if (onDeleteTransaction) {
              onDeleteTransaction(deletingTxId);
            } else {
              api.deleteTransaction(deletingTxId).then(() => onRefresh());
            }
            setDeletingTxId(null);
          }
        }}
        onCancel={() => setDeletingTxId(null)}
      />

      {/* Delete Recurring Bill Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingBillId}
        title="Remove Recurring Bill"
        message={`Are you sure you want to remove "${recurringBills.find(b => b.id === deletingBillId)?.name || 'this recurring bill'}" from your radar?`}
        confirmLabel="Remove Bill"
        confirmVariant="danger"
        onConfirm={() => {
          if (deletingBillId) {
            executeDeleteBill(deletingBillId);
            setDeletingBillId(null);
          }
        }}
        onCancel={() => setDeletingBillId(null)}
      />
    </div>
  );
};
