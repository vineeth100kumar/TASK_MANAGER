import { useState, useCallback } from 'react';
import { api } from '../services/api';
import { useToast } from '../context/ToastContext';
import {
  FinanceSummary,
  Transaction,
  FinanceAccount
} from '../types';
import { HistoryAction } from './useUndoRedo';

interface UseFinanceStateProps {
  todayStr: string;
  startSync: () => void;
  endSync: () => void;
  pushHistoryAction: (action: HistoryAction) => void;
}

export function useFinanceState({
  todayStr,
  startSync,
  endSync,
  pushHistoryAction,
}: UseFinanceStateProps) {
  const toast = useToast();

  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Create Account
  const handleCreateAccount = useCallback((accData: {
    name: string;
    account_type: string;
    balance: number;
    currency?: string;
    is_upi_default?: boolean;
  }) => {
    const tempId = `acc_temp_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const optimisticAcc: FinanceAccount = {
      id: tempId,
      name: accData.name,
      account_type: accData.account_type as any,
      balance: accData.balance || 0,
      currency: accData.currency || 'INR',
      is_upi_default: Boolean(accData.is_upi_default),
      updated_at: nowIso,
    };

    setFinanceSummary(prev => {
      if (!prev) return prev;
      let newAccounts = accData.is_upi_default
        ? prev.accounts.map(a => ({ ...a, is_upi_default: false }))
        : [...prev.accounts];
      newAccounts = [...newAccounts, optimisticAcc];
      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
      };
    });

    startSync();
    api.createAccount(accData)
      .then(realAcc => {
        setFinanceSummary(prev => prev ? {
          ...prev,
          accounts: prev.accounts.map(a => a.id === tempId ? realAcc : a)
        } : prev);
        toast.success(`Account "${realAcc.name}" created`);
        pushHistoryAction({
          id: `act_${Date.now()}_${Math.random()}`,
          description: `Created account "${realAcc.name}"`,
          undo: () => handleDeleteAccount(realAcc.id, false),
          redo: () => handleCreateAccount(accData),
          timestamp: Date.now()
        });
      })
      .catch(err => {
        console.error('Failed to create account on Pi', err);
        toast.error('Failed to create account on Raspberry Pi');
        setFinanceSummary(prev => prev ? {
          ...prev,
          accounts: prev.accounts.filter(a => a.id !== tempId)
        } : prev);
      })
      .finally(endSync);
  }, [startSync, endSync, pushHistoryAction, toast]);

  // Update Account
  const handleUpdateAccount = useCallback((id: string, updates: { name?: string; balance?: number; is_upi_default?: boolean }) => {
    setFinanceSummary(prev => {
      if (!prev) return prev;
      let newAccounts = prev.accounts.map(a => {
        if (a.id === id) {
          return { ...a, ...updates };
        }
        if (updates.is_upi_default) {
          return { ...a, is_upi_default: false };
        }
        return a;
      });
      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
      };
    });

    startSync();
    api.updateAccount(id, updates as any)
      .then(() => toast.info('Account updated'))
      .catch(err => {
        console.error('Failed to update account on Pi', err);
        toast.error('Failed to update account');
      })
      .finally(endSync);
  }, [startSync, endSync, toast]);

  // Delete Account
  const handleDeleteAccount = useCallback((id: string, recordHistory = true) => {
    const targetAcc = financeSummary?.accounts.find(a => a.id === id);
    if (!targetAcc) return;

    setFinanceSummary(prev => {
      if (!prev) return prev;
      const newAccounts = prev.accounts.filter(a => a.id !== id);
      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
      };
    });

    startSync();
    api.deleteAccount(id)
      .then(() => {
        toast.info(`Deleted account "${targetAcc.name}"`);
        if (recordHistory) {
          pushHistoryAction({
            id: `act_${Date.now()}_${Math.random()}`,
            description: `Deleted account "${targetAcc.name}"`,
            undo: async () => {
              startSync();
              try {
                const created = await api.createAccount({
                  name: targetAcc.name,
                  account_type: targetAcc.account_type,
                  balance: targetAcc.balance,
                  currency: targetAcc.currency,
                  is_upi_default: targetAcc.is_upi_default
                });
                setFinanceSummary(prev => prev ? {
                  ...prev,
                  accounts: [...prev.accounts, created],
                  net_worth: prev.net_worth + (created.account_type === 'credit' ? -created.balance : created.balance)
                } : prev);
                toast.info(`Restored account "${created.name}"`);
              } catch (e) {
                toast.error('Failed to restore account');
              } finally {
                endSync();
              }
            },
            redo: () => handleDeleteAccount(id, false),
            timestamp: Date.now()
          });
        }
      })
      .catch(err => {
        console.error('Failed to delete account on Pi', err);
        toast.error('Failed to delete account on Raspberry Pi');
        setFinanceSummary(prev => prev ? {
          ...prev,
          accounts: [...prev.accounts, targetAcc],
          net_worth: prev.net_worth + (targetAcc.account_type === 'credit' ? -targetAcc.balance : targetAcc.balance)
        } : prev);
      })
      .finally(endSync);
  }, [financeSummary, startSync, endSync, pushHistoryAction, toast]);

  // Create Transaction
  const handleCreateTransaction = useCallback((txData: any) => {
    const tempId = `tx_temp_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const targetAcc = financeSummary?.accounts.find(a => a.id === txData.account_id);
    const targetCat = financeSummary?.categories.find(c => c.id === txData.category_id);
    const targetDstAcc = txData.transfer_to_account_id ? financeSummary?.accounts.find(a => a.id === txData.transfer_to_account_id) : undefined;

    const optimisticTx: Transaction = {
      id: tempId,
      account_id: txData.account_id,
      account_name: targetAcc?.name,
      category_id: txData.category_id,
      category_name: targetCat?.name,
      type: txData.type,
      amount: txData.amount,
      payment_mode: txData.payment_mode,
      description: txData.description,
      transfer_to_account_id: txData.transfer_to_account_id,
      transfer_to_account_name: targetDstAcc?.name,
      date: txData.date || todayStr,
      created_at: nowIso,
    };

    setTransactions(prev => [optimisticTx, ...prev]);

    setFinanceSummary(prev => {
      if (!prev) return prev;
      const newAccounts = prev.accounts.map(acc => {
        if (acc.id === txData.account_id) {
          const delta = txData.type === 'expense' ? -txData.amount : txData.type === 'income' ? txData.amount : -txData.amount;
          return { ...acc, balance: acc.balance + delta };
        }
        if (txData.type === 'transfer' && acc.id === txData.transfer_to_account_id) {
          return { ...acc, balance: acc.balance + txData.amount };
        }
        return acc;
      });

      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      const isToday = (txData.date || todayStr) === todayStr;
      const addedTodaySpend = (isToday && txData.type === 'expense') ? txData.amount : 0;

      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
        today_spend: prev.today_spend + addedTodaySpend,
      };
    });

    startSync();
    api.createTransaction(txData)
      .then(realTx => {
        setTransactions(prev => prev.map(t => t.id === tempId ? realTx : t));
        toast.success(`Logged ₹${realTx.amount} ${realTx.type}`);
        pushHistoryAction({
          id: `act_${Date.now()}_${Math.random()}`,
          description: `Logged ₹${realTx.amount} (${realTx.description || realTx.type})`,
          undo: () => handleDeleteTransaction(realTx.id, false),
          redo: () => handleCreateTransaction(txData),
          timestamp: Date.now()
        });
      })
      .catch(err => {
        console.error('Failed to create transaction on Pi', err);
        toast.error('Failed to save transaction to Raspberry Pi');
        setTransactions(prev => prev.filter(t => t.id !== tempId));
      })
      .finally(endSync);
  }, [financeSummary, todayStr, startSync, endSync, pushHistoryAction, toast]);

  // Delete Transaction
  const handleDeleteTransaction = useCallback((id: string, recordHistory = true) => {
    const txToDelete = transactions.find(t => t.id === id);
    if (!txToDelete) return;
    setTransactions(prev => prev.filter(t => t.id !== id));

    setFinanceSummary(prev => {
      if (!prev) return prev;
      const newAccounts = prev.accounts.map(acc => {
        if (acc.id === txToDelete.account_id) {
          const revDelta = txToDelete.type === 'expense' ? txToDelete.amount : txToDelete.type === 'income' ? -txToDelete.amount : txToDelete.amount;
          return { ...acc, balance: acc.balance + revDelta };
        }
        if (txToDelete.type === 'transfer' && acc.id === txToDelete.transfer_to_account_id) {
          return { ...acc, balance: acc.balance - txToDelete.amount };
        }
        return acc;
      });

      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      const isToday = txToDelete.date === todayStr;
      const subTodaySpend = (isToday && txToDelete.type === 'expense') ? txToDelete.amount : 0;

      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
        today_spend: Math.max(0, prev.today_spend - subTodaySpend),
      };
    });

    startSync();
    api.deleteTransaction(id)
      .then(() => {
        toast.info(`Deleted transaction ₹${txToDelete.amount}`);
        if (recordHistory) {
          pushHistoryAction({
            id: `act_${Date.now()}_${Math.random()}`,
            description: `Deleted ₹${txToDelete.amount} (${txToDelete.description || txToDelete.type})`,
            undo: async () => {
              startSync();
              try {
                const restored = await api.createTransaction({
                  account_id: txToDelete.account_id,
                  category_id: txToDelete.category_id || undefined,
                  type: txToDelete.type,
                  amount: txToDelete.amount,
                  payment_mode: txToDelete.payment_mode,
                  description: txToDelete.description || undefined,
                  transfer_to_account_id: txToDelete.transfer_to_account_id || undefined,
                  date: txToDelete.date
                });
                setTransactions(prev => [restored, ...prev]);
                toast.info(`Restored transaction ₹${txToDelete.amount}`);
              } catch (e) {
                toast.error('Failed to restore transaction');
              } finally {
                endSync();
              }
            },
            redo: () => handleDeleteTransaction(id, false),
            timestamp: Date.now()
          });
        }
      })
      .catch(err => {
        console.error('Failed to delete transaction on Pi', err);
        toast.error('Failed to delete transaction on Raspberry Pi');
        if (txToDelete) setTransactions(prev => [txToDelete, ...prev]);
      })
      .finally(endSync);
  }, [transactions, todayStr, startSync, endSync, pushHistoryAction, toast]);

  // Handle selective WebSocket event for finance
  const handleWsFinanceEvent = useCallback((event: { type: string; data: any }): boolean => {
    switch (event.type) {
      case 'FINANCE_TRANSACTION_CREATED': {
        const tx = event.data as Transaction;
        if (tx && tx.id) {
          setTransactions(prev => {
            if (prev.some(t => t.id === tx.id)) return prev;
            return [tx, ...prev];
          });
        }
        return true;
      }
      case 'FINANCE_TRANSACTION_DELETED': {
        const id = event.data?.id;
        if (id) {
          setTransactions(prev => prev.filter(t => t.id !== id));
        }
        return true;
      }
      case 'FINANCE_ACCOUNT_UPDATED': {
        const updated = event.data as FinanceAccount;
        if (updated && updated.id) {
          setFinanceSummary(prev => prev ? {
            ...prev,
            accounts: prev.accounts.map(a => a.id === updated.id ? updated : a)
          } : prev);
        }
        return true;
      }
      case 'FINANCE_ACCOUNT_DELETED': {
        const id = event.data?.id;
        if (id) {
          setFinanceSummary(prev => prev ? {
            ...prev,
            accounts: prev.accounts.filter(a => a.id !== id)
          } : prev);
        }
        return true;
      }
      default:
        return false;
    }
  }, []);

  return {
    financeSummary,
    setFinanceSummary,
    transactions,
    setTransactions,
    handleCreateAccount,
    handleUpdateAccount,
    handleDeleteAccount,
    handleCreateTransaction,
    handleDeleteTransaction,
    handleWsFinanceEvent,
  };
}
